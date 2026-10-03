package main

// Situação do coletor para o ícone da bandeja e o painel local. Fica em ProgramData\AppuraColetor\publico\status.json,
// a única parte da pasta de dados que qualquer usuário do computador pode ler (não tem token nem segredo).

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type LoteResumo struct {
	Em              time.Time `json:"em"`
	Arquivos        int       `json:"arquivos"`
	Novas           int       `json:"novas"`
	JaExistiam      int       `json:"jaExistiam"`
	RejeitadasSefaz int       `json:"rejeitadasSefaz"`
	Recusadas       int       `json:"recusadas"`
	PuladosLocal    int       `json:"puladosLocal"` // o Appura já tinha: nem subiram
}

type Status struct {
	Versao           string        `json:"versao"`
	Servidor         string        `json:"servidor"`
	Instalacao       string        `json:"instalacao"`
	Maquina          string        `json:"maquina"`
	Cnpjs            []string      `json:"cnpjs"`
	Estado           string        `json:"estado"` // iniciando, varrendo, enviando, ok, erro, pausado
	AtualizadoEm     time.Time     `json:"atualizadoEm"`
	IniciadoEm       time.Time     `json:"iniciadoEm"`
	UltimaVarredura  time.Time     `json:"ultimaVarredura"`
	UltimoEnvioEm    time.Time     `json:"ultimoEnvioEm"`
	UltimoSinalEm    time.Time     `json:"ultimoSinalEm"`
	Pendentes        int           `json:"pendentes"`
	NovasHoje        int           `json:"novasHoje"`
	Dia              string        `json:"dia"`
	Enviados         int           `json:"enviados"`
	Recusados        int           `json:"recusados"`
	Ignorados        int           `json:"ignorados"`
	UltimoErro       string        `json:"ultimoErro"`
	ProximaTentativa time.Time     `json:"proximaTentativa"`
	Pastas           []EstadoPasta `json:"pastas"`
	Lotes            []LoteResumo  `json:"lotes"` // os 30 mais recentes, do mais novo para o mais antigo
}

func pastaPublica() string  { return filepath.Join(PastaDados(), "publico") }
func caminhoStatus() string { return filepath.Join(pastaPublica(), "status.json") }

var muStatus sync.Mutex

func GravarStatus(s *Status) error {
	muStatus.Lock()
	defer muStatus.Unlock()
	s.AtualizadoEm = time.Now()
	if err := os.MkdirAll(pastaPublica(), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(s, "", " ")
	tmp := caminhoStatus() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, caminhoStatus())
}

func LerStatus() (*Status, error) {
	b, err := os.ReadFile(caminhoStatus())
	if err != nil {
		return nil, err
	}
	var s Status
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// Cor do ícone e frase curta para a dica do mouse, a partir da situação gravada pelo coletor.
func Resumo(s *Status, err error, agora time.Time) (cor, texto string) {
	if err != nil || s == nil {
		return "vermelho", "Coletor sem informações: ele está instalado e rodando?"
	}
	parado := agora.Sub(s.AtualizadoEm)
	switch {
	case parado > 10*time.Minute:
		return "vermelho", "Coletor parado há " + duracaoCurta(parado)
	case s.Estado == "erro" || s.Estado == "pausado":
		t := "Erro: " + s.UltimoErro
		if len(t) > 100 {
			t = t[:100] + "…"
		}
		return "vermelho", t
	case s.Pendentes > 0 || s.Estado == "varrendo" || s.Estado == "enviando" || s.Estado == "iniciando":
		return "amarelo", "Enviando · " + inteiro(s.Pendentes) + " na fila"
	}
	t := "Tudo enviado"
	if !s.UltimoEnvioEm.IsZero() {
		t += " · último envio há " + duracaoCurta(agora.Sub(s.UltimoEnvioEm))
	}
	if s.NovasHoje > 0 {
		t += " · " + inteiro(s.NovasHoje) + " novas hoje"
	}
	return "verde", t
}

func duracaoCurta(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "menos de 1 min"
	case d < time.Hour:
		return inteiro(int(d.Minutes())) + " min"
	case d < 48*time.Hour:
		return inteiro(int(d.Hours())) + " h"
	default:
		return inteiro(int(d.Hours()/24)) + " dias"
	}
}

func inteiro(n int) string {
	s := []byte{}
	v := n
	if v < 0 {
		v = -v
	}
	for i := 0; ; i++ {
		if i > 0 && i%3 == 0 {
			s = append([]byte{'.'}, s...)
		}
		s = append([]byte{byte('0' + v%10)}, s...)
		v /= 10
		if v == 0 {
			break
		}
	}
	if n < 0 {
		s = append([]byte{'-'}, s...)
	}
	return string(s)
}
