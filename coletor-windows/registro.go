package main

// Registro local do que já foi tratado: um arquivo JSON por linha, só acrescentado (seguro contra queda de energia:
// no máximo a última linha se perde, e aí o arquivo é reenviado; o Appura descarta repetidas pela chave).
// Na abertura o registro é compactado (uma linha por arquivo).

import (
	"bufio"
	"encoding/json"
	"os"
	"sync"
	"time"
)

// Situações finais de um arquivo no registro.
const (
	StEnviado  = "enviado"  // o Appura gravou ou já tinha
	StRecusado = "recusado" // o Appura recusou (XML ilegível, de outro CNPJ…): não reenviar enquanto o arquivo não mudar
	StBase     = "base"     // já existia na instalação com "só daqui para frente", ou fora do período de histórico
)

type ItemRegistro struct {
	Caminho  string    `json:"p"`
	Tamanho  int64     `json:"s"`
	Mtime    int64     `json:"m"`
	Chave    string    `json:"k,omitempty"`
	Situacao string    `json:"st"`
	Detalhe  string    `json:"d,omitempty"`
	Em       time.Time `json:"t"`
}

type Registro struct {
	mu      sync.Mutex
	caminho string
	itens   map[string]ItemRegistro
	arq     *os.File
}

func AbrirRegistro(caminho string) (*Registro, error) {
	r := &Registro{caminho: caminho, itens: map[string]ItemRegistro{}}
	if f, err := os.Open(caminho); err == nil {
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			var it ItemRegistro
			if json.Unmarshal(sc.Bytes(), &it) == nil && it.Caminho != "" {
				r.itens[it.Caminho] = it
			}
		}
		f.Close()
	}
	if err := r.compactar(); err != nil {
		return nil, err
	}
	return r, nil
}

// AbrirRegistroSomenteLeitura: só para mostrar números no assistente (não mexe no arquivo que o coletor está usando).
func AbrirRegistroSomenteLeitura(caminho string) (*Registro, error) {
	r := &Registro{caminho: caminho, itens: map[string]ItemRegistro{}}
	f, err := os.Open(caminho)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		var it ItemRegistro
		if json.Unmarshal(sc.Bytes(), &it) == nil && it.Caminho != "" {
			r.itens[it.Caminho] = it
		}
	}
	return r, nil
}

func (r *Registro) compactar() error {
	tmp := r.caminho + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	for _, it := range r.itens {
		b, _ := json.Marshal(it)
		w.Write(b)
		w.WriteByte('\n')
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	f.Close()
	if err := os.Rename(tmp, r.caminho); err != nil {
		return err
	}
	r.arq, err = os.OpenFile(r.caminho, os.O_APPEND|os.O_WRONLY, 0o600)
	return err
}

// Tratado: o arquivo (com este tamanho e data) já foi resolvido?
func (r *Registro) Tratado(caminho string, tamanho, mtime int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	it, ok := r.itens[caminho]
	return ok && it.Tamanho == tamanho && it.Mtime == mtime
}

func (r *Registro) Marcar(itens []ItemRegistro) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	w := bufio.NewWriter(r.arq)
	for _, it := range itens {
		if it.Em.IsZero() {
			it.Em = time.Now()
		}
		r.itens[it.Caminho] = it
		b, _ := json.Marshal(it)
		w.Write(b)
		w.WriteByte('\n')
	}
	if err := w.Flush(); err != nil {
		return err
	}
	return r.arq.Sync()
}

// Reabrir esquece os itens "base" com estes detalhes (ex.: um CNPJ entrou na instalação, o período de histórico mudou):
// eles voltam a ser avaliados na próxima varredura.
func (r *Registro) Reabrir(detalhes ...string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	alvo := map[string]bool{}
	for _, d := range detalhes {
		alvo[d] = true
	}
	n := 0
	for k, it := range r.itens {
		if it.Situacao == StBase && alvo[it.Detalhe] {
			delete(r.itens, k)
			n++
		}
	}
	if n > 0 {
		r.arq.Close()
		r.compactar()
	}
	return n
}

func (r *Registro) Total() (enviados, recusados, base int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, it := range r.itens {
		switch it.Situacao {
		case StEnviado:
			enviados++
		case StRecusado:
			recusados++
		case StBase:
			base++
		}
	}
	return
}

func (r *Registro) Fechar() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.arq != nil {
		r.arq.Close()
	}
}
