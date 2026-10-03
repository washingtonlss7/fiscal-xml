package main

// Varredura das pastas acompanhadas: todas as subpastas (ano/mês/dia ou o que o sistema usar), só arquivos .xml.
// O que já está no registro (mesmo tamanho e data) nem é aberto; o resto é identificado pela chave.

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	tamanhoMaxXml   = 10 * 1024 * 1024
	profundidadeMax = 12
	// Detalhes de itens "base" que podem voltar a valer se a configuração mudar
	DetForaDoPeriodo = "fora_do_periodo"
	DetOutroCnpj     = "outro_cnpj"
	DetNaoFiscal     = "nao_fiscal"
	DetJaExistia     = "ja_existia_na_instalacao"
)

// Pendente é um XML a enviar.
type Pendente struct {
	Caminho string
	Tamanho int64
	Mtime   int64
	Info    InfoXml
}

// EstadoPasta vai no sinal de vida (o painel mostra se a pasta está acessível e recebendo arquivos).
type EstadoPasta struct {
	Caminho         string `json:"caminho"`
	Tipo            string `json:"tipo"`
	Arquivos        int    `json:"arquivos"`
	UltimoArquivoEm string `json:"ultimoArquivoEm,omitempty"`
	Ok              bool   `json:"ok"`
	Erro            string `json:"-"`
}

type Filtro struct {
	Cnpjs map[string]bool
	Desde string // AAMM mínimo ("" = tudo)
}

// Varrer percorre as pastas e devolve o que falta enviar. Itens que não interessam (outro CNPJ, fora do período,
// XML não fiscal) entram no registro como "base" para não serem relidos a cada minuto.
func Varrer(pastas []Pasta, reg *Registro, f Filtro, baseTudo bool) ([]Pendente, []EstadoPasta) {
	var pend []Pendente
	var estados []EstadoPasta
	var marcar []ItemRegistro
	vistos := map[string]bool{}
	for _, p := range pastas {
		est := EstadoPasta{Caminho: p.Caminho, Tipo: p.Tipo, Ok: true}
		var ultimo time.Time
		raiz := filepath.Clean(p.Caminho)
		if st, err := os.Stat(raiz); err != nil || !st.IsDir() {
			est.Ok = false
			if err != nil {
				est.Erro = err.Error()
			} else {
				est.Erro = "não é uma pasta"
			}
			estados = append(estados, est)
			continue
		}
		baseProf := strings.Count(raiz, string(os.PathSeparator))
		filepath.WalkDir(raiz, func(caminho string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil // pasta sem permissão ou sumiu no meio: segue
			}
			if d.IsDir() {
				if strings.Count(caminho, string(os.PathSeparator))-baseProf > profundidadeMax {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.EqualFold(filepath.Ext(caminho), ".xml") || vistos[caminho] {
				return nil
			}
			vistos[caminho] = true
			info, err := d.Info()
			if err != nil || info.Size() == 0 || info.Size() > tamanhoMaxXml {
				return nil
			}
			est.Arquivos++
			if info.ModTime().After(ultimo) {
				ultimo = info.ModTime()
			}
			tam, mt := info.Size(), info.ModTime().Unix()
			if reg.Tratado(caminho, tam, mt) {
				return nil
			}
			// Arquivo ainda sendo gravado pelo sistema de vendas: espera o próximo ciclo
			if time.Since(info.ModTime()) < 5*time.Second {
				return nil
			}
			if baseTudo {
				marcar = append(marcar, ItemRegistro{Caminho: caminho, Tamanho: tam, Mtime: mt, Situacao: StBase, Detalhe: DetJaExistia})
				return nil
			}
			x, ok := IdentificarXml(caminho)
			switch {
			case !ok:
				marcar = append(marcar, ItemRegistro{Caminho: caminho, Tamanho: tam, Mtime: mt, Situacao: StBase, Detalhe: DetNaoFiscal})
			case x.Modelo != "55" && x.Modelo != "65":
				marcar = append(marcar, ItemRegistro{Caminho: caminho, Tamanho: tam, Mtime: mt, Chave: x.Chave, Situacao: StBase, Detalhe: DetNaoFiscal})
			case !f.Cnpjs[x.Cnpj]:
				marcar = append(marcar, ItemRegistro{Caminho: caminho, Tamanho: tam, Mtime: mt, Chave: x.Chave, Situacao: StBase, Detalhe: DetOutroCnpj})
			case f.Desde != "" && x.AAMM < f.Desde:
				marcar = append(marcar, ItemRegistro{Caminho: caminho, Tamanho: tam, Mtime: mt, Chave: x.Chave, Situacao: StBase, Detalhe: DetForaDoPeriodo})
			default:
				pend = append(pend, Pendente{Caminho: caminho, Tamanho: tam, Mtime: mt, Info: x})
			}
			return nil
		})
		if !ultimo.IsZero() {
			est.UltimoArquivoEm = ultimo.UTC().Format(time.RFC3339)
		}
		estados = append(estados, est)
	}
	if len(marcar) > 0 {
		reg.Marcar(marcar)
	}
	return pend, estados
}
