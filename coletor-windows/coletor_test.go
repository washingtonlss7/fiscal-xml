package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const cnpjA = "55885998000140"
const cnpjB = "11222333000181"

// chaveTeste monta uma chave válida (com DV) para o CNPJ, modelo, AAMM e número.
func chaveTeste(cnpj, modelo, aamm string, n int) string {
	base := fmt.Sprintf("32%s%s%s001%09d1%08d", aamm, cnpj, modelo, n, n)
	soma, peso := 0, 2
	for i := 42; i >= 0; i-- {
		soma += int(base[i]-'0') * peso
		peso++
		if peso > 9 {
			peso = 2
		}
	}
	dv := 11 - soma%11
	if dv >= 10 {
		dv = 0
	}
	return base + fmt.Sprint(dv)
}

func xmlNota(ch string) string {
	return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe` + ch + `" versao="4.00"><ide><mod>` + ch[20:22] + `</mod></ide></infNFe></NFe><protNFe><infProt><chNFe>` + ch + `</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`
}
func xmlEvento(ch string) string {
	return `<?xml version="1.0"?><procEventoNFe versao="1.00"><evento><infEvento Id="ID110111` + ch + `01"><chNFe>` + ch + `</chNFe></infEvento></evento></procEventoNFe>`
}

func escrever(t *testing.T, caminho, conteudo string, idade time.Duration) {
	t.Helper()
	os.MkdirAll(filepath.Dir(caminho), 0o755)
	if err := os.WriteFile(caminho, []byte(conteudo), 0o644); err != nil {
		t.Fatal(err)
	}
	quando := time.Now().Add(-idade)
	os.Chtimes(caminho, quando, quando)
}

func TestChaveENomes(t *testing.T) {
	ch := chaveTeste(cnpjA, "65", "2609", 123)
	if !ChaveValida(ch) || ChaveValida(ch[:42]+"00") {
		t.Fatal("DV")
	}
	if c, ev, ok := chaveDoNome(`D:\PDV\2026\09\` + ch + "-nfce.xml"); !ok || c != ch || ev {
		t.Fatal("nome com chave")
	}
	if c, ev, ok := chaveDoNome("110111" + ch + "01-procEventoNFe.xml"); !ok || c != ch || !ev {
		t.Fatal("nome de evento")
	}
	if _, _, ok := chaveDoNome("nota_000123.xml"); ok {
		t.Fatal("nome sem chave")
	}
	for in, out := range map[string]string{
		`D:\Sistema\XML\NFCe\2026\09\15`: `D:\Sistema\XML\NFCe`,
		`/x/xml/2026-09`:                 `/x/xml`,
		`/x/Autorizadas/setembro_2026`:   `/x/Autorizadas`,
		`/x/xml/202609/01`:               `/x/xml`,
		`/x/NFe`:                         `/x/NFe`,
	} {
		in, out = filepath.FromSlash(strings.ReplaceAll(in, `\`, "/")), filepath.FromSlash(strings.ReplaceAll(out, `\`, "/"))
		if got := PastaRaiz(in); got != out {
			t.Errorf("PastaRaiz(%s) = %s, esperava %s", in, got, out)
		}
	}
}

func TestIdentificarPeloConteudo(t *testing.T) {
	dir := t.TempDir()
	ch := chaveTeste(cnpjA, "55", "2609", 7)
	escrever(t, filepath.Join(dir, "nota7.xml"), xmlNota(ch), time.Hour)
	escrever(t, filepath.Join(dir, "canc.xml"), xmlEvento(ch), time.Hour)
	escrever(t, filepath.Join(dir, "outro.xml"), "<config><x>1</x></config>", time.Hour)
	if x, ok := IdentificarXml(filepath.Join(dir, "nota7.xml")); !ok || x.Chave != ch || x.Evento || x.Modelo != "55" || x.AAMM != "2609" || x.Cnpj != cnpjA {
		t.Fatalf("nota pelo conteúdo: %+v", x)
	}
	if x, ok := IdentificarXml(filepath.Join(dir, "canc.xml")); !ok || !x.Evento {
		t.Fatalf("evento pelo conteúdo: %+v", x)
	}
	if _, ok := IdentificarXml(filepath.Join(dir, "outro.xml")); ok {
		t.Fatal("XML não fiscal")
	}
}

func TestRegistroPersisteEReabre(t *testing.T) {
	c := filepath.Join(t.TempDir(), "reg.jsonl")
	r, err := AbrirRegistro(c)
	if err != nil {
		t.Fatal(err)
	}
	r.Marcar([]ItemRegistro{{Caminho: "a", Tamanho: 1, Mtime: 1, Situacao: StEnviado}, {Caminho: "b", Tamanho: 1, Mtime: 1, Situacao: StBase, Detalhe: DetOutroCnpj}})
	r.Marcar([]ItemRegistro{{Caminho: "a", Tamanho: 2, Mtime: 2, Situacao: StEnviado}})
	r.Fechar()
	r2, _ := AbrirRegistro(c)
	if !r2.Tratado("a", 2, 2) || r2.Tratado("a", 1, 1) || !r2.Tratado("b", 1, 1) {
		t.Fatal("registro relido")
	}
	if n := r2.Reabrir(DetOutroCnpj); n != 1 || r2.Tratado("b", 1, 1) {
		t.Fatal("reabrir")
	}
	r2.Fechar()
	r3, _ := AbrirRegistro(c)
	if r3.Tratado("b", 1, 1) {
		t.Fatal("reabrir persiste")
	}
	b, _ := os.ReadFile(c)
	if strings.Count(string(b), "\n") != 1 {
		t.Fatalf("compactado: %q", b)
	}
	r3.Fechar()
}

func TestVarrerFiltra(t *testing.T) {
	dir := t.TempDir()
	reg, _ := AbrirRegistro(filepath.Join(t.TempDir(), "r.jsonl"))
	defer reg.Fechar()
	ok1 := chaveTeste(cnpjA, "65", "2609", 1)
	velha := chaveTeste(cnpjA, "65", "2501", 2)
	outro := chaveTeste(cnpjB, "65", "2609", 3)
	escrever(t, filepath.Join(dir, "2026", "09", ok1+".xml"), xmlNota(ok1), time.Hour)
	escrever(t, filepath.Join(dir, "2025", "01", velha+".xml"), xmlNota(velha), time.Hour)
	escrever(t, filepath.Join(dir, "2026", "09", outro+".xml"), xmlNota(outro), time.Hour)
	escrever(t, filepath.Join(dir, "lixo.xml"), "<a/>", time.Hour)
	escrever(t, filepath.Join(dir, "leia.txt"), "x", time.Hour)
	recente := chaveTeste(cnpjA, "65", "2609", 4)
	escrever(t, filepath.Join(dir, recente+".xml"), xmlNota(recente), 0) // ainda sendo gravado
	f := Filtro{Cnpjs: map[string]bool{cnpjA: true}, Desde: "2606"}
	pend, est := Varrer([]Pasta{{Caminho: dir, Tipo: "nfce"}, {Caminho: filepath.Join(dir, "nao-existe")}}, reg, f, false)
	if len(pend) != 1 || pend[0].Info.Chave != ok1 {
		t.Fatalf("pendentes: %+v", pend)
	}
	if len(est) != 2 || !est[0].Ok || est[0].Arquivos != 5 || est[1].Ok {
		t.Fatalf("estados: %+v", est)
	}
	// Segunda varredura: os ignorados não são relidos, o pendente continua pendente
	pend2, _ := Varrer([]Pasta{{Caminho: dir}}, reg, f, false)
	if len(pend2) != 1 {
		t.Fatal("segunda varredura")
	}
	_, _, base := reg.Total()
	if base != 3 {
		t.Fatalf("base = %d", base)
	}
}

// servidorFalso imita a API do Appura: guarda as chaves recebidas e responde como o servidor real.
type servidorFalso struct {
	mu         sync.Mutex
	tem        map[string]bool
	recebidas  []string
	lotes      int
	revogado   bool
	sinais     int
	falharLote int // quantos lotes devolvem 503 antes de aceitar
}

func (s *servidorFalso) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer apc_teste" || s.revogado {
		w.WriteHeader(401)
		w.Write([]byte(`{"erro":"Este token foi revogado no Appura."}`))
		return
	}
	switch r.URL.Path {
	case "/api/coletor/v1/config":
		json.NewEncoder(w).Encode(map[string]any{"versaoApi": 1, "instalacao": map[string]string{"nome": "Grupo Farma"}, "maquina": map[string]string{"nome": "Servidor"},
			"empresas": []map[string]string{{"cnpj": cnpjA, "razaoSocial": "FARMA"}}, "limites": map[string]int{"arquivosPorLote": 3, "bytesPorLote": 1 << 20, "chavesPorConsulta": 2000}, "intervaloSinalSeg": 300})
	case "/api/coletor/v1/existentes":
		var c struct{ Chaves []string }
		json.NewDecoder(r.Body).Decode(&c)
		var ex []string
		for _, k := range c.Chaves {
			if s.tem[k] {
				ex = append(ex, k)
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"existentes": ex})
	case "/api/coletor/v1/xml":
		if s.falharLote > 0 {
			s.falharLote--
			w.WriteHeader(503)
			w.Write([]byte(`{"erro":"O Appura não conseguiu gravar este lote agora."}`))
			return
		}
		b, _ := io.ReadAll(r.Body)
		z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
		if err != nil {
			w.WriteHeader(422)
			return
		}
		s.lotes++
		var res []map[string]string
		for _, f := range z.File {
			rc, _ := f.Open()
			conteudo, _ := io.ReadAll(rc)
			rc.Close()
			m := reChNFe.FindSubmatch(conteudo)
			if m == nil {
				res = append(res, map[string]string{"arquivo": f.Name, "situacao": "rejeitada", "motivo": "XML malformado."})
				continue
			}
			ch := string(m[1])
			sit := "importada"
			if bytes.Contains(conteudo, []byte("procEvento")) {
				sit = "importada"
			} else if s.tem[ch] {
				sit = "ja_existia"
			}
			s.tem[ch] = true
			s.recebidas = append(s.recebidas, f.Name)
			res = append(res, map[string]string{"arquivo": f.Name, "situacao": sit, "chave": ch})
		}
		json.NewEncoder(w).Encode(map[string]any{"arquivos": len(z.File), "resultados": res})
	case "/api/coletor/v1/sinal":
		s.sinais++
		w.Write([]byte(`{"ok":true}`))
	default:
		w.WriteHeader(404)
	}
}

func TestAgentePontaAPonta(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPURA_COLETOR_DADOS", t.TempDir())
	falso := &servidorFalso{tem: map[string]bool{}}
	srv := httptest.NewServer(falso)
	defer srv.Close()
	var chaves []string
	for i := 1; i <= 7; i++ {
		ch := chaveTeste(cnpjA, "65", "2609", i)
		chaves = append(chaves, ch)
		escrever(t, filepath.Join(dir, "2026", "09", fmt.Sprintf("%02d", i), ch+"-nfce.xml"), xmlNota(ch), time.Hour)
	}
	falso.tem[chaves[0]] = true // o Appura já tinha a primeira (veio pela importação manual)
	escrever(t, filepath.Join(dir, "2026", "09", "07", "110111"+chaves[0]+"01-procEventoNFe.xml"), xmlEvento(chaves[0]), time.Hour)
	escrever(t, filepath.Join(dir, "quebrado-"+chaveTeste(cnpjA, "65", "2609", 99)+".xml"), "<nfeProc><x>", time.Hour)

	cfg := &Config{Servidor: srv.URL, Pastas: []Pasta{{Caminho: dir, Tipo: "nfce"}}, Historico: "3meses", DesdeAAMM: "2606"}
	reg, _ := AbrirRegistro(caminhoRegistro())
	lg := log.New(io.Discard, "", 0)
	ag := &Agente{Cfg: cfg, Api: NovaApi(srv.URL, "apc_teste"), Reg: reg, Log: lg}
	// Primeiro lote falha (Appura fora): nada é marcado, tudo continua pendente
	falso.falharLote = 1
	if _, err := ag.Ciclo(context.Background()); err == nil {
		t.Fatal("esperava erro 503")
	}
	if n, err := ag.Ciclo(context.Background()); err != nil || n != 9 {
		t.Fatalf("ciclo: n=%d err=%v", n, err)
	}
	// 6 notas novas e o evento gravados, o quebrado recusado; a que o Appura já tinha não subiu
	if len(falso.recebidas) != 7 || falso.lotes != 3 {
		t.Fatalf("recebidas=%d lotes=%d", len(falso.recebidas), falso.lotes)
	}
	env, rec, _ := reg.Total()
	if env != 8 || rec != 1 {
		t.Fatalf("registro: enviados=%d recusados=%d", env, rec)
	}
	// Reinício do coletor: nada é reenviado
	reg.Fechar()
	reg2, _ := AbrirRegistro(caminhoRegistro())
	ag2 := &Agente{Cfg: cfg, Api: NovaApi(srv.URL, "apc_teste"), Reg: reg2, Log: lg}
	if n, _ := ag2.Ciclo(context.Background()); n != 0 || len(falso.recebidas) != 7 {
		t.Fatalf("depois do reinício: n=%d recebidas=%d", n, len(falso.recebidas))
	}
	// Nota nova aparece na pasta: só ela vai
	nova := chaveTeste(cnpjA, "65", "2609", 50)
	escrever(t, filepath.Join(dir, "2026", "09", "20", nova+"-nfce.xml"), xmlNota(nova), time.Minute)
	if n, _ := ag2.Ciclo(context.Background()); n != 1 || !falso.tem[nova] {
		t.Fatal("nota nova")
	}
	// Token revogado: erro definitivo, pausa de 1 hora
	falso.revogado = true
	escrever(t, filepath.Join(dir, "2026", "09", "21", chaveTeste(cnpjA, "65", "2609", 51)+".xml"), xmlNota(chaveTeste(cnpjA, "65", "2609", 51)), time.Minute)
	_, err := ag2.Ciclo(context.Background())
	var e *ErroApi
	if err == nil || !errors.As(err, &e) || !e.Definitivo() {
		t.Fatalf("revogado: %v", err)
	}
	ag2.falhou(err)
	if ag2.pausaAte.Sub(time.Now()) < 59*time.Minute || ag2.cnpjs != nil {
		t.Fatal("pausa de 1 hora e relê a configuração depois")
	}
	reg2.Fechar()
}

func TestHistoricoAgora(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPURA_COLETOR_DADOS", t.TempDir())
	falso := &servidorFalso{tem: map[string]bool{}}
	srv := httptest.NewServer(falso)
	defer srv.Close()
	velha := chaveTeste(cnpjA, "65", "2609", 1)
	escrever(t, filepath.Join(dir, velha+".xml"), xmlNota(velha), time.Hour)
	cfg := &Config{Servidor: srv.URL, Pastas: []Pasta{{Caminho: dir}}, Historico: "agora"}
	reg, _ := AbrirRegistro(caminhoRegistro())
	defer reg.Fechar()
	ag := &Agente{Cfg: cfg, Api: NovaApi(srv.URL, "apc_teste"), Reg: reg, Log: log.New(io.Discard, "", 0)}
	ag.Ciclo(context.Background())
	if len(falso.recebidas) != 0 || !cfg.BaseFeita {
		t.Fatal("o que já existia não sobe")
	}
	nova := chaveTeste(cnpjA, "65", "2609", 2)
	escrever(t, filepath.Join(dir, nova+".xml"), xmlNota(nova), time.Minute)
	ag.Ciclo(context.Background())
	if len(falso.recebidas) != 1 {
		t.Fatal("o novo sobe")
	}
}

func TestBuscaSugerePastas(t *testing.T) {
	raiz := t.TempDir()
	for i := 1; i <= 5; i++ {
		ch := chaveTeste(cnpjA, "65", "2609", i)
		escrever(t, filepath.Join(raiz, "PDV", "XML", "NFCe", "2026", "09", fmt.Sprintf("%02d", i), ch+".xml"), xmlNota(ch), time.Hour)
	}
	for i := 1; i <= 2; i++ {
		ch := chaveTeste(cnpjA, "55", "2608", i)
		escrever(t, filepath.Join(raiz, "PDV", "XML", "NFe", "2026-08", ch+".xml"), xmlNota(ch), time.Hour)
	}
	ch := chaveTeste(cnpjB, "65", "2609", 9)
	escrever(t, filepath.Join(raiz, "Outra", ch+".xml"), xmlNota(ch), time.Hour)
	prog := &ProgressoBusca{}
	s := BuscarPastas(context.Background(), []string{raiz}, map[string]bool{cnpjA: true}, time.Minute, prog)
	if len(s) != 2 || s[0].Caminho != filepath.Join(raiz, "PDV", "XML", "NFCe") || s[0].NFCe != 5 || s[0].Tipo != "nfce" || s[0].DeAAMM != "2609" {
		t.Fatalf("sugestões: %+v", s)
	}
	if s[1].Caminho != filepath.Join(raiz, "PDV", "XML", "NFe") || s[1].Tipo != "nfe" {
		t.Fatalf("NF-e: %+v", s[1])
	}
	a := AnalisarPasta(filepath.Join(raiz, "PDV"), map[string]bool{cnpjA: true}, time.Minute)
	if !a.Existe || a.DaInstalacao != 7 || a.NFCe != 5 || a.NFe != 2 || a.DeAAMM != "2608" || a.AteAAMM != "2609" {
		t.Fatalf("análise: %+v", a)
	}
	if !prog.Copia()["terminou"].(bool) {
		t.Fatal("progresso")
	}
}

func TestTokenEHistorico(t *testing.T) {
	if !TokenComFormatoValido("apc_"+strings.Repeat("A", 43)) || TokenComFormatoValido("apc_curto") || TokenComFormatoValido("xyz_"+strings.Repeat("A", 43)) {
		t.Fatal("formato do token")
	}
	agora := time.Date(2026, 10, 3, 9, 0, 0, 0, time.Local)
	if DesdeParaHistorico("3meses", agora) != "2607" || DesdeParaHistorico("tudo", agora) != "" {
		t.Fatal("histórico")
	}
	t.Setenv("APPURA_COLETOR_DADOS", t.TempDir())
	c := &Config{}
	c.DefinirToken("apc_" + strings.Repeat("B", 43))
	SalvarConfig(c)
	c2, _ := LerConfig()
	if tk, _ := c2.Token(); tk != "apc_"+strings.Repeat("B", 43) || c2.TokenPrefixo != "apc_BBBBBBBB" || c2.Servidor != ServidorPadrao {
		t.Fatal("config")
	}
	b, _ := os.ReadFile(caminhoConfig())
	if strings.Contains(string(b), strings.Repeat("B", 43)) {
		t.Fatal("token em claro no arquivo")
	}
}
