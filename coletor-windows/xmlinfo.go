package main

// Identificação de um XML fiscal sem abrir o arquivo inteiro: chave de acesso (pelo nome ou pelo começo do
// conteúdo), CNPJ do emitente, modelo, competência e se é nota ou evento.

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// InfoXml é o que sabemos de um arquivo antes de enviar.
type InfoXml struct {
	Chave  string // 44 dígitos
	Cnpj   string // emitente (posições 7 a 20 da chave)
	Modelo string // 55 NF-e, 65 NFC-e
	AAMM   string // ano e mês de emissão (posições 3 a 6 da chave)
	Evento bool   // cancelamento, carta de correção etc. (nunca é pulado pelo "já existe")
}

var (
	reDigitos  = regexp.MustCompile(`\d{44,}`)
	reChNFe    = regexp.MustCompile(`<chNFe>(\d{44})</chNFe>`)
	reIdNFe    = regexp.MustCompile(`Id="NFe(\d{44})"`)
	reIdEvento = regexp.MustCompile(`Id="ID\d{6}(\d{44})\d{2}"`)
)

// ChaveValida confere o dígito verificador (módulo 11) da chave de acesso.
func ChaveValida(ch string) bool {
	if len(ch) != 44 {
		return false
	}
	soma, peso := 0, 2
	for i := 42; i >= 0; i-- {
		c := ch[i]
		if c < '0' || c > '9' {
			return false
		}
		soma += int(c-'0') * peso
		peso++
		if peso > 9 {
			peso = 2
		}
	}
	dv := 11 - soma%11
	if dv >= 10 {
		dv = 0
	}
	return int(ch[43]-'0') == dv
}

func infoDaChave(ch string, evento bool) InfoXml {
	return InfoXml{Chave: ch, Cnpj: ch[6:20], Modelo: ch[20:22], AAMM: ch[2:6], Evento: evento}
}

// chaveDoNome tenta achar a chave no nome do arquivo (a maioria dos emissores usa a chave no nome).
// Eventos costumam vir como <tipo(6)><chave(44)><seq(2)>; notas, só a chave.
func chaveDoNome(nome string) (string, bool, bool) {
	base := strings.ToLower(filepath.Base(nome))
	evento := strings.Contains(base, "evento") || strings.Contains(base, "canc") || strings.Contains(base, "cce") || strings.Contains(base, "inut")
	for _, d := range reDigitos.FindAllString(base, -1) {
		cands := []string{}
		switch {
		case len(d) == 44:
			cands = append(cands, d)
		case len(d) == 52: // evento: tipo + chave + sequência
			cands = append(cands, d[6:50])
			evento = true
		default:
			for i := 0; i+44 <= len(d); i++ {
				cands = append(cands, d[i:i+44])
			}
		}
		for _, c := range cands {
			if ChaveValida(c) {
				return c, evento, true
			}
		}
	}
	return "", false, false
}

// lerCabeca lê o começo do arquivo (o suficiente para achar a raiz e a chave).
func lerCabeca(caminho string, n int64) ([]byte, error) {
	f, err := os.Open(caminho)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, n))
}

// raizEvento: o XML é um evento? (procEventoNFe, evento, retEnvEvento…)
func raizEvento(cab []byte) bool {
	i := bytes.IndexByte(cab, '<')
	for i >= 0 && i+1 < len(cab) && (cab[i+1] == '?' || cab[i+1] == '!') {
		j := bytes.IndexByte(cab[i+1:], '<')
		if j < 0 {
			return false
		}
		i = i + 1 + j
	}
	if i < 0 {
		return false
	}
	resto := cab[i:]
	if len(resto) > 40 {
		resto = resto[:40]
	}
	return bytes.Contains(bytes.ToLower(resto), []byte("evento"))
}

// IdentificarXml descobre chave, CNPJ e modelo. Usa o nome quando dá; senão lê só o começo do arquivo.
func IdentificarXml(caminho string) (InfoXml, bool) {
	cab, err := lerCabeca(caminho, 16*1024)
	if err != nil || !bytes.Contains(cab, []byte("<")) {
		return InfoXml{}, false
	}
	evento := raizEvento(cab)
	if ch, evNome, ok := chaveDoNome(caminho); ok {
		return infoDaChave(ch, evento || evNome), true
	}
	for _, re := range []*regexp.Regexp{reIdNFe, reChNFe, reIdEvento} {
		if m := re.FindSubmatch(cab); m != nil && ChaveValida(string(m[1])) {
			return infoDaChave(string(m[1]), evento || re == reIdEvento), true
		}
	}
	// O começo não tinha a chave (XML com muita assinatura antes do protocolo): lê o arquivo inteiro, até 5 MB
	tudo, err := lerCabeca(caminho, 5*1024*1024)
	if err == nil {
		for _, re := range []*regexp.Regexp{reIdNFe, reChNFe, reIdEvento} {
			if m := re.FindSubmatch(tudo); m != nil && ChaveValida(string(m[1])) {
				return infoDaChave(string(m[1]), evento || re == reIdEvento), true
			}
		}
	}
	return InfoXml{}, false
}
