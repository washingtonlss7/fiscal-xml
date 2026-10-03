package main

// Busca inteligente das pastas de XML: percorre os discos locais procurando arquivos cujo nome traz uma chave de
// acesso de um CNPJ da instalação. Agrupa pela pasta "de cima" (tirando subpastas de data como 2026, 09, 2026-09…)
// e sugere as pastas com mais notas, separando NF-e de NFC-e. Também analisa uma pasta escolhida à mão.

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var reParteData = regexp.MustCompile(`^(\d{1,8}|\d{4}[-_.]\d{1,2}([-_.]\d{1,2})?|\d{1,2}[-_.]\d{4}|(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*([-_ .]?\d{2,4})?|\d{2,4}[-_ .]?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*)$`)

// PastaRaiz tira do fim do caminho as subpastas que são datas (ano, mês, dia), voltando à pasta principal.
func PastaRaiz(dir string) string {
	d := filepath.Clean(dir)
	for {
		base := strings.ToLower(filepath.Base(d))
		pai := filepath.Dir(d)
		if pai == d || !reParteData.MatchString(base) {
			return d
		}
		d = pai
	}
}

type Sugestao struct {
	Caminho   string   `json:"caminho"`
	Tipo      string   `json:"tipo"` // nfe, nfce, ambos
	NFe       int      `json:"nfe"`
	NFCe      int      `json:"nfce"`
	Eventos   int      `json:"eventos"`
	DeAAMM    string   `json:"de"`
	AteAAMM   string   `json:"ate"`
	Cnpjs     []string `json:"cnpjs"`
	Exemplo   string   `json:"exemplo"`
	cnpjsMapa map[string]bool
}

func (s *Sugestao) somar(x InfoXml, caminho string) {
	switch {
	case x.Evento:
		s.Eventos++
	case x.Modelo == "65":
		s.NFCe++
	default:
		s.NFe++
	}
	if s.DeAAMM == "" || x.AAMM < s.DeAAMM {
		s.DeAAMM = x.AAMM
	}
	if x.AAMM > s.AteAAMM {
		s.AteAAMM = x.AAMM
	}
	if s.cnpjsMapa == nil {
		s.cnpjsMapa = map[string]bool{}
	}
	s.cnpjsMapa[x.Cnpj] = true
	if s.Exemplo == "" {
		s.Exemplo = caminho
	}
}

func (s *Sugestao) fechar() {
	s.Cnpjs = s.Cnpjs[:0]
	for c := range s.cnpjsMapa {
		s.Cnpjs = append(s.Cnpjs, c)
	}
	sort.Strings(s.Cnpjs)
	t := s.NFe + s.NFCe
	switch {
	case t > 0 && s.NFCe*10 >= t*9:
		s.Tipo = "nfce"
	case t > 0 && s.NFe*10 >= t*9:
		s.Tipo = "nfe"
	default:
		s.Tipo = "ambos"
	}
}

// ProgressoBusca é lido pela tela enquanto a busca roda.
type ProgressoBusca struct {
	mu          sync.Mutex
	Pastas      int        `json:"pastas"`
	Arquivos    int        `json:"arquivos"`
	Atual       string     `json:"atual"`
	Terminou    bool       `json:"terminou"`
	Interrompeu bool       `json:"interrompeu"`
	Sugestoes   []Sugestao `json:"sugestoes"`
}

func (p *ProgressoBusca) Copia() map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	return map[string]any{"pastas": p.Pastas, "arquivos": p.Arquivos, "atual": p.Atual, "terminou": p.Terminou, "interrompeu": p.Interrompeu, "sugestoes": append([]Sugestao{}, p.Sugestoes...)}
}

// BuscarPastas percorre as raízes (discos) até o tempo limite e devolve as melhores pastas.
func BuscarPastas(ctx context.Context, raizes []string, cnpjs map[string]bool, limite time.Duration, prog *ProgressoBusca) []Sugestao {
	ctx, cancelar := context.WithTimeout(ctx, limite)
	defer cancelar()
	grupos := map[string]*Sugestao{}
	semChaveLidos := map[string]int{}
	for _, raiz := range raizes {
		filepath.WalkDir(raiz, func(caminho string, d fs.DirEntry, err error) error {
			if ctx.Err() != nil {
				return filepath.SkipAll
			}
			if err != nil {
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				if caminho != raiz && (pastaIgnoradaNaBusca(caminho) || strings.Count(strings.TrimPrefix(caminho, raiz), string(os.PathSeparator)) > 10) {
					return filepath.SkipDir
				}
				prog.mu.Lock()
				prog.Pastas++
				if prog.Pastas%50 == 0 {
					prog.Atual = caminho
				}
				prog.mu.Unlock()
				return nil
			}
			if !strings.EqualFold(filepath.Ext(caminho), ".xml") {
				return nil
			}
			prog.mu.Lock()
			prog.Arquivos++
			prog.mu.Unlock()
			var x InfoXml
			if ch, ev, ok := chaveDoNome(caminho); ok {
				x = infoDaChave(ch, ev)
			} else {
				// Nome sem chave: lê o começo de só alguns arquivos por pasta (a busca precisa ser rápida)
				dir := filepath.Dir(caminho)
				if semChaveLidos[dir] >= 3 {
					return nil
				}
				semChaveLidos[dir]++
				var ok2 bool
				if x, ok2 = IdentificarXml(caminho); !ok2 {
					return nil
				}
			}
			if !cnpjs[x.Cnpj] || (x.Modelo != "55" && x.Modelo != "65") {
				return nil
			}
			raizGrupo := PastaRaiz(filepath.Dir(caminho))
			g := grupos[raizGrupo]
			if g == nil {
				g = &Sugestao{Caminho: raizGrupo}
				grupos[raizGrupo] = g
			}
			g.somar(x, caminho)
			return nil
		})
	}
	lista := make([]Sugestao, 0, len(grupos))
	for _, g := range grupos {
		g.fechar()
		lista = append(lista, *g)
	}
	sort.Slice(lista, func(i, j int) bool {
		ti, tj := lista[i].NFe+lista[i].NFCe, lista[j].NFe+lista[j].NFCe
		if ti != tj {
			return ti > tj
		}
		return lista[i].Caminho < lista[j].Caminho
	})
	if len(lista) > 12 {
		lista = lista[:12]
	}
	prog.mu.Lock()
	prog.Terminou, prog.Interrompeu, prog.Sugestoes, prog.Atual = true, ctx.Err() == context.DeadlineExceeded, lista, ""
	prog.mu.Unlock()
	return lista
}

// AnalisePasta: o que existe numa pasta escolhida (para conferir antes de salvar).
type AnalisePasta struct {
	Caminho      string `json:"caminho"`
	Existe       bool   `json:"existe"`
	Xml          int    `json:"xml"`
	DaInstalacao int    `json:"daInstalacao"`
	NFe          int    `json:"nfe"`
	NFCe         int    `json:"nfce"`
	Eventos      int    `json:"eventos"`
	OutrosCnpjs  int    `json:"outrosCnpjs"`
	NaoFiscais   int    `json:"naoFiscais"`
	DeAAMM       string `json:"de"`
	AteAAMM      string `json:"ate"`
	Incompleta   bool   `json:"incompleta"` // passou do tempo limite: os números são parciais
}

func AnalisarPasta(caminho string, cnpjs map[string]bool, limite time.Duration) AnalisePasta {
	a := AnalisePasta{Caminho: filepath.Clean(caminho)}
	st, err := os.Stat(a.Caminho)
	if err != nil || !st.IsDir() {
		return a
	}
	a.Existe = true
	fim := time.Now().Add(limite)
	filepath.WalkDir(a.Caminho, func(c string, d fs.DirEntry, err error) error {
		if time.Now().After(fim) {
			a.Incompleta = true
			return filepath.SkipAll
		}
		if err != nil || d.IsDir() || !strings.EqualFold(filepath.Ext(c), ".xml") {
			return nil
		}
		a.Xml++
		x, ok := IdentificarXml(c)
		switch {
		case !ok || (x.Modelo != "55" && x.Modelo != "65"):
			a.NaoFiscais++
		case !cnpjs[x.Cnpj]:
			a.OutrosCnpjs++
		default:
			a.DaInstalacao++
			switch {
			case x.Evento:
				a.Eventos++
			case x.Modelo == "65":
				a.NFCe++
			default:
				a.NFe++
			}
			if a.DeAAMM == "" || x.AAMM < a.DeAAMM {
				a.DeAAMM = x.AAMM
			}
			if x.AAMM > a.AteAAMM {
				a.AteAAMM = x.AAMM
			}
		}
		return nil
	})
	return a
}
