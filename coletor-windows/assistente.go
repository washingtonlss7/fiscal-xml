package main

// Assistente de instalação e configuração: uma página local (só neste computador, 127.0.0.1, com segredo de uso único)
// que abre no navegador. Passos: token → pastas (busca automática ou escolha) → histórico → instalar.

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed assistente.html
var paginaAssistente []byte

type sessaoAssistente struct {
	mu       sync.Mutex
	segredo  string
	porta    int
	token    string // token novo digitado (fica só na memória até instalar)
	servidor string
	cfgSrv   *ConfigServidor
	busca    *ProgressoBusca
	cancelar context.CancelFunc
	ultimo   time.Time
	fim      chan struct{}
}

func aleatorioHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func modoAssistente() error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	s := &sessaoAssistente{segredo: aleatorioHex(24), porta: ln.Addr().(*net.TCPAddr).Port, ultimo: time.Now(), fim: make(chan struct{})}
	if cfg, err := LerConfig(); err == nil {
		s.servidor = cfg.Servidor
	} else {
		s.servidor = ServidorPadrao
	}
	srv := &http.Server{Handler: s, ReadHeaderTimeout: 10 * time.Second}
	go srv.Serve(ln)
	url := fmt.Sprintf("http://127.0.0.1:%d/?s=%s", s.porta, s.segredo)
	fmt.Println("Assistente do Appura Coletor:", url)
	if err := abrirNavegador(url); err != nil {
		avisarUsuario("Abra este endereço no navegador para configurar o Appura Coletor:\n\n" + url)
	}
	// Fecha sozinho depois de 60 minutos parado, ou quando a pessoa clica em "Fechar"
	for {
		select {
		case <-s.fim:
			time.Sleep(500 * time.Millisecond)
			return srv.Close()
		case <-time.After(time.Minute):
			s.mu.Lock()
			parado := time.Since(s.ultimo)
			s.mu.Unlock()
			if parado > time.Hour {
				return srv.Close()
			}
		}
	}
}

func responderJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func erroJSON(w http.ResponseWriter, status int, msg string) {
	responderJSON(w, status, map[string]string{"erro": msg})
}

func (s *sessaoAssistente) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Só este computador, e só pelo endereço exato (impede que um site aberto no navegador fale com o assistente)
	if r.Host != fmt.Sprintf("127.0.0.1:%d", s.porta) {
		http.Error(w, "host inválido", http.StatusForbidden)
		return
	}
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'")
	s.mu.Lock()
	s.ultimo = time.Now()
	s.mu.Unlock()
	if r.URL.Path == "/" && r.URL.Query().Get("s") != "" {
		if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("s")), []byte(s.segredo)) != 1 {
			http.Error(w, "link inválido: abra o assistente de novo", http.StatusForbidden)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "apc", Value: s.segredo, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	c, err := r.Cookie("apc")
	if err != nil || subtle.ConstantTimeCompare([]byte(c.Value), []byte(s.segredo)) != 1 {
		http.Error(w, "acesso negado: abra o assistente pelo atalho do Appura Coletor", http.StatusForbidden)
		return
	}
	if r.Method == http.MethodPost && r.Header.Get("X-Appura") != "1" {
		erroJSON(w, http.StatusForbidden, "requisição inválida")
		return
	}
	switch {
	case r.URL.Path == "/" && r.Method == http.MethodGet:
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(paginaAssistente)
	case r.URL.Path == "/api/estado":
		s.estado(w)
	case r.URL.Path == "/api/token" && r.Method == http.MethodPost:
		s.validarToken(w, r)
	case r.URL.Path == "/api/buscar" && r.Method == http.MethodPost:
		s.iniciarBusca(w)
	case r.URL.Path == "/api/buscar":
		s.mu.Lock()
		b := s.busca
		s.mu.Unlock()
		if b == nil {
			responderJSON(w, 200, map[string]any{"rodando": false})
			return
		}
		responderJSON(w, 200, b.Copia())
	case r.URL.Path == "/api/pastas":
		s.listarPastas(w, r)
	case r.URL.Path == "/api/analisar" && r.Method == http.MethodPost:
		s.analisar(w, r)
	case r.URL.Path == "/api/instalar" && r.Method == http.MethodPost:
		s.instalar(w, r)
	case r.URL.Path == "/api/desinstalar" && r.Method == http.MethodPost:
		if err := desinstalarPrograma(); err != nil {
			erroJSON(w, 500, err.Error())
			return
		}
		responderJSON(w, 200, map[string]bool{"ok": true})
	case r.URL.Path == "/api/sair" && r.Method == http.MethodPost:
		responderJSON(w, 200, map[string]bool{"ok": true})
		select {
		case <-s.fim:
		default:
			close(s.fim)
		}
	default:
		http.NotFound(w, r)
	}
}

func lerCorpoJSON(r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20)).Decode(v)
}

// cnpjsAtuais: da validação do token nesta sessão ou, numa reconfiguração, da configuração salva.
func (s *sessaoAssistente) cnpjsAtuais() map[string]bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := map[string]bool{}
	if s.cfgSrv != nil {
		for _, e := range s.cfgSrv.Empresas {
			m[e.Cnpj] = true
		}
		return m
	}
	if cfg, err := LerConfig(); err == nil {
		for _, c := range cfg.Cnpjs {
			m[c] = true
		}
	}
	return m
}

func ultimasLinhas(caminho string, n int) []string {
	f, err := os.Open(caminho)
	if err != nil {
		return nil
	}
	defer f.Close()
	var linhas []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		linhas = append(linhas, sc.Text())
		if len(linhas) > n {
			linhas = linhas[1:]
		}
	}
	return linhas
}

func (s *sessaoAssistente) estado(w http.ResponseWriter) {
	r := map[string]any{"versao": Versao, "servidorPadrao": ServidorPadrao, "instalado": false}
	if cfg, err := LerConfig(); err == nil {
		r["instalado"] = true
		r["config"] = map[string]any{"servidor": cfg.Servidor, "tokenPrefixo": cfg.TokenPrefixo, "pastas": cfg.Pastas, "historico": cfg.Historico,
			"instalacao": cfg.Instalacao, "maquina": cfg.Maquina, "cnpjs": cfg.Cnpjs, "instaladoEm": cfg.InstaladoEm}
		r["tarefa"] = servicoInstalado()
		if reg, err := AbrirRegistroSomenteLeitura(caminhoRegistro()); err == nil {
			e, rc, b := reg.Total()
			r["registro"] = map[string]int{"enviados": e, "recusados": rc, "ignorados": b}
		}
		r["log"] = ultimasLinhas(caminhoLog(), 25)
	}
	responderJSON(w, 200, r)
}

func (s *sessaoAssistente) validarToken(w http.ResponseWriter, r *http.Request) {
	var c struct{ Token, Servidor string }
	if err := lerCorpoJSON(r, &c); err != nil {
		erroJSON(w, 400, "dados inválidos")
		return
	}
	c.Token = strings.TrimSpace(c.Token)
	servidor := strings.TrimRight(strings.TrimSpace(c.Servidor), "/")
	if servidor == "" {
		servidor = ServidorPadrao
	}
	if !strings.HasPrefix(servidor, "https://") && !strings.HasPrefix(servidor, "http://127.0.0.1") && !strings.HasPrefix(servidor, "http://localhost") {
		erroJSON(w, 400, "O endereço do Appura precisa começar com https://")
		return
	}
	if !TokenComFormatoValido(c.Token) {
		erroJSON(w, 400, "Token inválido. Ele começa com apc_ e tem 47 caracteres: copie de novo no Appura (Captação → Appura Coletor).")
		return
	}
	cfg, err := NovaApi(servidor, c.Token).Config()
	if err != nil {
		var e *ErroApi
		if errors.As(err, &e) {
			erroJSON(w, 400, e.Mensagem)
		} else {
			erroJSON(w, 502, "Não consegui falar com o Appura ("+err.Error()+"). Confira a internet deste computador e tente de novo.")
		}
		return
	}
	s.mu.Lock()
	s.token, s.servidor, s.cfgSrv = c.Token, servidor, cfg
	s.mu.Unlock()
	responderJSON(w, 200, cfg)
}

func (s *sessaoAssistente) iniciarBusca(w http.ResponseWriter) {
	cnpjs := s.cnpjsAtuais()
	if len(cnpjs) == 0 {
		erroJSON(w, 400, "Informe o token primeiro.")
		return
	}
	s.mu.Lock()
	if s.cancelar != nil {
		s.cancelar()
	}
	ctx, cancelar := context.WithCancel(context.Background())
	prog := &ProgressoBusca{}
	s.busca, s.cancelar = prog, cancelar
	s.mu.Unlock()
	go BuscarPastas(ctx, unidades(), cnpjs, 2*time.Minute, prog)
	responderJSON(w, 200, map[string]bool{"ok": true})
}

func (s *sessaoAssistente) listarPastas(w http.ResponseWriter, r *http.Request) {
	caminho := r.URL.Query().Get("caminho")
	type item struct {
		Nome    string `json:"nome"`
		Caminho string `json:"caminho"`
	}
	if caminho == "" {
		var l []item
		for _, u := range unidades() {
			l = append(l, item{Nome: u, Caminho: u})
		}
		responderJSON(w, 200, map[string]any{"caminho": "", "pai": "", "pastas": l})
		return
	}
	caminho = filepath.Clean(caminho)
	ents, err := os.ReadDir(caminho)
	if err != nil {
		erroJSON(w, 400, "Não consegui abrir esta pasta: "+err.Error())
		return
	}
	l := []item{}
	xml := 0
	for _, e := range ents {
		if e.IsDir() {
			if strings.HasPrefix(e.Name(), "$") {
				continue
			}
			l = append(l, item{Nome: e.Name(), Caminho: filepath.Join(caminho, e.Name())})
		} else if strings.EqualFold(filepath.Ext(e.Name()), ".xml") {
			xml++
		}
	}
	sort.Slice(l, func(i, j int) bool { return strings.ToLower(l[i].Nome) < strings.ToLower(l[j].Nome) })
	pai := filepath.Dir(caminho)
	if pai == caminho {
		pai = ""
	}
	responderJSON(w, 200, map[string]any{"caminho": caminho, "pai": pai, "pastas": l, "xmlAqui": xml})
}

func (s *sessaoAssistente) analisar(w http.ResponseWriter, r *http.Request) {
	var c struct{ Caminho string }
	if err := lerCorpoJSON(r, &c); err != nil || strings.TrimSpace(c.Caminho) == "" {
		erroJSON(w, 400, "Informe a pasta.")
		return
	}
	responderJSON(w, 200, AnalisarPasta(strings.TrimSpace(c.Caminho), s.cnpjsAtuais(), 90*time.Second))
}

func (s *sessaoAssistente) instalar(w http.ResponseWriter, r *http.Request) {
	var c struct {
		Pastas         []Pasta
		Historico      string
		ConfirmarVazia bool
	}
	if err := lerCorpoJSON(r, &c); err != nil {
		erroJSON(w, 400, "dados inválidos")
		return
	}
	if len(c.Pastas) == 0 || len(c.Pastas) > 10 {
		erroJSON(w, 400, "Escolha de 1 a 10 pastas.")
		return
	}
	cnpjs := s.cnpjsAtuais()
	vistos := map[string]bool{}
	var pastas []Pasta
	for _, p := range c.Pastas {
		p.Caminho = filepath.Clean(strings.TrimSpace(p.Caminho))
		if p.Tipo != "nfe" && p.Tipo != "nfce" {
			p.Tipo = "ambos"
		}
		if vistos[strings.ToLower(p.Caminho)] {
			continue
		}
		vistos[strings.ToLower(p.Caminho)] = true
		a := AnalisarPasta(p.Caminho, cnpjs, 30*time.Second)
		if !a.Existe {
			erroJSON(w, 400, "A pasta "+p.Caminho+" não existe ou não pode ser aberta.")
			return
		}
		if a.DaInstalacao == 0 && !a.Incompleta && !c.ConfirmarVazia {
			responderJSON(w, 409, map[string]any{"erro": "A pasta " + p.Caminho + " não tem nenhum XML dos CNPJs desta instalação. Confira se é a pasta certa.", "vazia": p.Caminho})
			return
		}
		pastas = append(pastas, p)
	}
	historico := c.Historico
	if historico != "tudo" && historico != "agora" {
		historico = "3meses"
	}
	s.mu.Lock()
	token, servidor, cfgSrv := s.token, s.servidor, s.cfgSrv
	s.mu.Unlock()
	cfg, errLer := LerConfig()
	novo := errLer != nil
	if novo {
		if token == "" {
			erroJSON(w, 400, "Informe o token primeiro.")
			return
		}
		cfg = &Config{InstaladoEm: time.Now()}
	}
	if token != "" {
		if err := cfg.DefinirToken(token); err != nil {
			erroJSON(w, 500, "Não consegui proteger o token no Windows: "+err.Error())
			return
		}
		cfg.Servidor = servidor
		// Token novo (máquina trocada ou token regerado): os CNPJs podem ser outros
		cfg.BaseFeita = false
	}
	if cfgSrv != nil {
		cfg.Instalacao, cfg.Maquina = cfgSrv.Instalacao.Nome, cfgSrv.Maquina.Nome
		cfg.Cnpjs = cfg.Cnpjs[:0]
		for _, e := range cfgSrv.Empresas {
			cfg.Cnpjs = append(cfg.Cnpjs, e.Cnpj)
		}
	}
	mudouHistorico := !novo && cfg.Historico != historico
	cfg.Pastas = pastas
	if mudouHistorico {
		// Arquivos antes ignorados por estarem fora do período voltam a ser avaliados (o coletor faz isso ao reiniciar)
		cfg.ReavaliarPeriodo = true
	}
	if novo || mudouHistorico {
		cfg.Historico = historico
		cfg.DesdeAAMM = DesdeParaHistorico(historico, time.Now())
		if historico == "agora" {
			cfg.BaseFeita = false
		}
	}
	if _, err := instalarPrograma(); err != nil {
		erroJSON(w, 500, "Não consegui instalar: "+err.Error())
		return
	}
	if err := SalvarConfig(cfg); err != nil {
		erroJSON(w, 500, "Não consegui gravar a configuração: "+err.Error())
		return
	}
	if err := reiniciarServico(); err != nil {
		erroJSON(w, 500, "Configuração salva, mas não consegui iniciar o coletor: "+err.Error())
		return
	}
	responderJSON(w, 200, map[string]any{"ok": true, "pastas": pastas, "historico": cfg.Historico})
}
