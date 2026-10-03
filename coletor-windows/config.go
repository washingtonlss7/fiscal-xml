package main

// Configuração do coletor (gravada pelo assistente de instalação) e onde ficam os arquivos.

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	Versao         = "0.1.1"
	ServidorPadrao = "https://fiscal.contabilfarmatech.com.br"
)

// Pasta acompanhada pelo coletor.
type Pasta struct {
	Caminho string `json:"caminho"`
	Tipo    string `json:"tipo"` // "nfe", "nfce" ou "ambos" (só informativo: o modelo vem da chave)
}

// Config é o que o assistente grava. O token fica protegido pelo Windows (DPAPI) em TokenProtegido.
type Config struct {
	Servidor       string   `json:"servidor"`
	TokenProtegido string   `json:"token_protegido"`
	TokenPrefixo   string   `json:"token_prefixo"`
	Pastas         []Pasta  `json:"pastas"`
	Cnpjs          []string `json:"cnpjs"`
	Instalacao     string   `json:"instalacao"`
	Maquina        string   `json:"maquina"`
	// Histórico na primeira vez: "3meses" (padrão), "tudo" ou "agora" (só o que aparecer depois da instalação)
	Historico string `json:"historico"`
	DesdeAAMM string `json:"desde_aamm"` // notas com competência anterior não são enviadas ("" = tudo)
	BaseFeita bool   `json:"base_feita"`
	// Pedido do assistente (histórico mudou): o coletor reavalia os arquivos fora do período ao iniciar
	ReavaliarPeriodo bool      `json:"reavaliar_periodo,omitempty"` // "só daqui para frente": os arquivos que já existiam foram marcados
	InstaladoEm      time.Time `json:"instalado_em"`
}

// PastaDados é onde ficam config, registro e log (C:\ProgramData\AppuraColetor no Windows).
func PastaDados() string {
	if d := os.Getenv("APPURA_COLETOR_DADOS"); d != "" {
		return d
	}
	return pastaDadosPadrao()
}

func caminhoConfig() string   { return filepath.Join(PastaDados(), "config.json") }
func caminhoRegistro() string { return filepath.Join(PastaDados(), "registro.jsonl") }
func caminhoLog() string      { return filepath.Join(PastaDados(), "coletor.log") }

func LerConfig() (*Config, error) {
	b, err := os.ReadFile(caminhoConfig())
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	if c.Servidor == "" {
		c.Servidor = ServidorPadrao
	}
	return &c, nil
}

func SalvarConfig(c *Config) error {
	if err := os.MkdirAll(PastaDados(), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	tmp := caminhoConfig() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, caminhoConfig())
}

// Token devolve o token em claro (desprotegido pelo Windows).
func (c *Config) Token() (string, error) {
	if c.TokenProtegido == "" {
		return "", errors.New("coletor sem token: rode o assistente de configuração")
	}
	return desprotegerSegredo(c.TokenProtegido)
}

func (c *Config) DefinirToken(t string) error {
	p, err := protegerSegredo(t)
	if err != nil {
		return err
	}
	c.TokenProtegido = p
	if len(t) >= 12 {
		c.TokenPrefixo = t[:12]
	}
	return nil
}

// DesdeParaHistorico: competência mínima (AAMM) a enviar conforme a escolha de histórico.
func DesdeParaHistorico(h string, agora time.Time) string {
	switch h {
	case "tudo", "agora":
		return ""
	default: // últimos 3 meses: o mês atual e os 3 anteriores
		d := time.Date(agora.Year(), agora.Month(), 1, 0, 0, 0, 0, time.Local).AddDate(0, -3, 0)
		return d.Format("0601")
	}
}

func TokenComFormatoValido(t string) bool {
	t = strings.TrimSpace(t)
	if !strings.HasPrefix(t, "apc_") || len(t) != 47 {
		return false
	}
	for _, r := range t[4:] {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
