package main

// Painel de atividades (aberto pelo ícone da bandeja): página local em 127.0.0.1 com segredo de uso único,
// que lê a situação publicada pelo coletor. Roda como o usuário logado, sem permissão de administrador.

import (
	"crypto/subtle"
	_ "embed"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"
)

//go:embed painel.html
var paginaPainel []byte

type PainelLocal struct {
	mu      sync.Mutex
	segredo string
	porta   int
	ln      net.Listener
}

// Iniciar sobe o servidor do painel (uma vez por processo) e devolve o endereço para abrir no navegador.
func (p *PainelLocal) Endereco() (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.ln == nil {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return "", err
		}
		p.ln, p.segredo, p.porta = ln, aleatorioHex(24), ln.Addr().(*net.TCPAddr).Port
		go (&http.Server{Handler: p, ReadHeaderTimeout: 10 * time.Second}).Serve(ln)
	}
	return fmt.Sprintf("http://127.0.0.1:%d/?s=%s", p.porta, p.segredo), nil
}

func (p *PainelLocal) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Host != fmt.Sprintf("127.0.0.1:%d", p.porta) {
		http.Error(w, "host inválido", http.StatusForbidden)
		return
	}
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
	if r.URL.Path == "/" && r.URL.Query().Get("s") != "" {
		if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("s")), []byte(p.segredo)) != 1 {
			http.Error(w, "link inválido: abra pelo ícone do Appura Coletor", http.StatusForbidden)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "apcp", Value: p.segredo, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	c, err := r.Cookie("apcp")
	if err != nil || subtle.ConstantTimeCompare([]byte(c.Value), []byte(p.segredo)) != 1 {
		http.Error(w, "acesso negado: abra pelo ícone do Appura Coletor", http.StatusForbidden)
		return
	}
	switch {
	case r.URL.Path == "/":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(paginaPainel)
	case r.URL.Path == "/api/status":
		s, err := LerStatus()
		agora := time.Now()
		cor, texto := Resumo(s, err, agora)
		responderJSON(w, 200, map[string]any{"status": s, "cor": cor, "resumo": texto, "agora": agora, "versaoIcone": Versao})
	case r.URL.Path == "/api/configurar" && r.Method == http.MethodPost && r.Header.Get("X-Appura") == "1":
		// Abre o assistente (o Windows pede permissão de administrador)
		exe, _ := os.Executable()
		if err := exec.Command(exe, "configurar").Start(); err != nil {
			erroJSON(w, 500, err.Error())
			return
		}
		responderJSON(w, 200, map[string]bool{"ok": true})
	default:
		http.NotFound(w, r)
	}
}
