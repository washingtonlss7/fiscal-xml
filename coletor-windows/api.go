package main

// Cliente da API do Appura Coletor (/api/coletor/v1), autenticado pelo token da máquina.

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ErroApi struct {
	Status   int
	Mensagem string
}

func (e *ErroApi) Error() string { return fmt.Sprintf("Appura respondeu %d: %s", e.Status, e.Mensagem) }

// Definitivo: o token não vale mais (revogado, instalação desativada). Não adianta insistir a cada minuto.
func (e *ErroApi) Definitivo() bool { return e.Status == 401 || e.Status == 403 }

type IdNome struct {
	Id   string `json:"id"`
	Nome string `json:"nome"`
}

type ConfigServidor struct {
	VersaoApi  int    `json:"versaoApi"`
	Maquina    IdNome `json:"maquina"`
	Instalacao IdNome `json:"instalacao"`
	Empresas   []struct {
		Cnpj        string `json:"cnpj"`
		RazaoSocial string `json:"razaoSocial"`
	} `json:"empresas"`
	Limites struct {
		ArquivosPorLote   int `json:"arquivosPorLote"`
		BytesPorLote      int `json:"bytesPorLote"`
		ChavesPorConsulta int `json:"chavesPorConsulta"`
	} `json:"limites"`
	IntervaloSinalSeg int `json:"intervaloSinalSeg"`
}

type ResultadoArquivo struct {
	Arquivo  string `json:"arquivo"`
	Situacao string `json:"situacao"`
	Chave    string `json:"chave"`
	Motivo   string `json:"motivo"`
}

type RespostaLote struct {
	Arquivos         int                `json:"arquivos"`
	Importadas       int                `json:"importadas"`
	CompletouResumo  int                `json:"completouResumo"`
	JaExistiam       int                `json:"jaExistiam"`
	Rejeitadas       int                `json:"rejeitadas"`
	RejeitadasSefaz  int                `json:"rejeitadasSefaz"`
	ForaDaInstalacao int                `json:"foraDaInstalacao"`
	Resultados       []ResultadoArquivo `json:"resultados"`
}

type Api struct {
	Base   string
	Token  string
	Http   *http.Client
	Agente string
}

func NovaApi(base, token string) *Api {
	return &Api{Base: strings.TrimRight(base, "/"), Token: token, Http: &http.Client{Timeout: 3 * time.Minute}, Agente: "AppuraColetor/" + Versao}
}

func (a *Api) chamar(metodo, rota string, corpo io.Reader, tipo string, saida any) error {
	req, err := http.NewRequest(metodo, a.Base+rota, corpo)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.Token)
	req.Header.Set("User-Agent", a.Agente)
	if tipo != "" {
		req.Header.Set("Content-Type", tipo)
	}
	resp, err := a.Http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 20*1024*1024))
	if resp.StatusCode >= 300 {
		var e struct{ Erro string }
		json.Unmarshal(b, &e)
		if e.Erro == "" {
			e.Erro = strings.TrimSpace(string(b))
			if len(e.Erro) > 200 {
				e.Erro = e.Erro[:200]
			}
		}
		return &ErroApi{Status: resp.StatusCode, Mensagem: e.Erro}
	}
	if saida != nil {
		return json.Unmarshal(b, saida)
	}
	return nil
}

func (a *Api) Config() (*ConfigServidor, error) {
	var c ConfigServidor
	if err := a.chamar("GET", "/api/coletor/v1/config", nil, "", &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func (a *Api) Existentes(chaves []string) (map[string]bool, error) {
	b, _ := json.Marshal(map[string]any{"chaves": chaves})
	var r struct{ Existentes []string }
	if err := a.chamar("POST", "/api/coletor/v1/existentes", bytes.NewReader(b), "application/json", &r); err != nil {
		return nil, err
	}
	m := map[string]bool{}
	for _, c := range r.Existentes {
		m[c] = true
	}
	return m, nil
}

func (a *Api) Sinal(dados map[string]any) error {
	b, _ := json.Marshal(dados)
	return a.chamar("POST", "/api/coletor/v1/sinal", bytes.NewReader(b), "application/json", nil)
}

// NomeNoLote: nome único dentro do ZIP (o índice garante que dois arquivos com o mesmo nome em pastas diferentes não colidam).
func NomeNoLote(i int, caminho string) string {
	return fmt.Sprintf("%05d_%s", i, filepath.Base(caminho))
}

// MontarLote compacta os arquivos num ZIP. Devolve o ZIP e os itens que entraram (arquivo sumido fica de fora).
func MontarLote(itens []Pendente) ([]byte, map[string]Pendente, error) {
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	nomes := map[string]Pendente{}
	for i, p := range itens {
		conteudo, err := os.ReadFile(p.Caminho)
		if err != nil {
			continue
		}
		nome := NomeNoLote(i, p.Caminho)
		w, err := z.CreateHeader(&zip.FileHeader{Name: nome, Method: zip.Deflate, Modified: time.Unix(p.Mtime, 0)})
		if err != nil {
			return nil, nil, err
		}
		if _, err := w.Write(conteudo); err != nil {
			return nil, nil, err
		}
		nomes[nome] = p
	}
	if err := z.Close(); err != nil {
		return nil, nil, err
	}
	return buf.Bytes(), nomes, nil
}

func (a *Api) EnviarLote(zipBytes []byte) (*RespostaLote, error) {
	var r RespostaLote
	if err := a.chamar("POST", "/api/coletor/v1/xml?nome="+url.QueryEscape("lote.zip"), bytes.NewReader(zipBytes), "application/zip", &r); err != nil {
		return nil, err
	}
	return &r, nil
}
