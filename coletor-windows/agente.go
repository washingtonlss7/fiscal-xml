package main

// Laço do coletor (o que roda como tarefa do Windows): varre as pastas, pergunta ao Appura o que já existe,
// envia o resto em lotes e manda sinal de vida. Erros de rede esperam e tentam de novo; token revogado para de enviar.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"runtime"
	"sort"
	"time"
)

type Agente struct {
	Cfg       *Config
	Api       *Api
	Reg       *Registro
	Log       *log.Logger
	Intervalo time.Duration // entre varreduras (padrão 60 s)
	Agora     func() time.Time

	cnpjs        map[string]bool
	limArquivos  int
	limBytes     int
	limChaves    int
	estados      []EstadoPasta
	pendentes    int
	ultimoErro   string
	ultimoSinal  time.Time
	intervaloSin time.Duration
	pausaAte     time.Time
	falhas       int
}

func (a *Agente) agora() time.Time {
	if a.Agora != nil {
		return a.Agora()
	}
	return time.Now()
}

// Sincronizar busca a configuração no Appura (CNPJs da instalação podem ter mudado no painel).
func (a *Agente) Sincronizar() error {
	c, err := a.Api.Config()
	if err != nil {
		return err
	}
	novos := map[string]bool{}
	for _, e := range c.Empresas {
		novos[e.Cnpj] = true
	}
	mudou := len(novos) != len(a.cnpjs)
	for k := range novos {
		if !a.cnpjs[k] {
			mudou = true
		}
	}
	if mudou && a.cnpjs != nil {
		// CNPJ novo na instalação: arquivos antes ignorados por "outro CNPJ" voltam a valer
		a.Reg.Reabrir(DetOutroCnpj)
		a.Log.Printf("CNPJs da instalação mudaram no Appura (%d agora)", len(novos))
	}
	a.cnpjs = novos
	a.limArquivos, a.limBytes, a.limChaves = c.Limites.ArquivosPorLote, c.Limites.BytesPorLote, c.Limites.ChavesPorConsulta
	if a.limArquivos <= 0 || a.limArquivos > 200 {
		a.limArquivos = 200
	}
	if a.limBytes <= 0 {
		a.limBytes = 20 * 1024 * 1024
	}
	if a.limChaves <= 0 {
		a.limChaves = 2000
	}
	a.intervaloSin = time.Duration(c.IntervaloSinalSeg) * time.Second
	if a.intervaloSin < time.Minute {
		a.intervaloSin = 5 * time.Minute
	}
	cnpjs := make([]string, 0, len(novos))
	for k := range novos {
		cnpjs = append(cnpjs, k)
	}
	sort.Strings(cnpjs)
	a.Cfg.Cnpjs, a.Cfg.Instalacao, a.Cfg.Maquina = cnpjs, c.Instalacao.Nome, c.Maquina.Nome
	return nil
}

// Ciclo: uma varredura e o envio do que estiver pendente. Devolve quantos arquivos foram resolvidos.
func (a *Agente) Ciclo(ctx context.Context) (int, error) {
	if a.cnpjs == nil {
		if err := a.Sincronizar(); err != nil {
			return 0, err
		}
	}
	baseTudo := a.Cfg.Historico == "agora" && !a.Cfg.BaseFeita
	pend, estados := Varrer(a.Cfg.Pastas, a.Reg, Filtro{Cnpjs: a.cnpjs, Desde: a.Cfg.DesdeAAMM}, baseTudo)
	a.estados = estados
	if baseTudo {
		a.Cfg.BaseFeita = true
		if err := SalvarConfig(a.Cfg); err != nil {
			a.Log.Printf("aviso: não consegui gravar a configuração: %v", err)
		}
		a.Log.Printf("instalação \"só daqui para frente\": arquivos existentes marcados como base")
	}
	// Mais antigos primeiro (o Appura recebe na ordem em que as notas aconteceram)
	sort.Slice(pend, func(i, j int) bool { return pend[i].Mtime < pend[j].Mtime })
	a.pendentes = len(pend)
	resolvidos := 0
	for len(pend) > 0 {
		if ctx.Err() != nil {
			return resolvidos, ctx.Err()
		}
		lote := a.proximoLote(pend)
		pend = pend[len(lote):]
		n, err := a.enviar(lote)
		resolvidos += n
		a.pendentes = len(pend) + (len(lote) - n)
		if err != nil {
			return resolvidos, err
		}
	}
	return resolvidos, nil
}

func (a *Agente) proximoLote(pend []Pendente) []Pendente {
	bytes := 0
	for i, p := range pend {
		if i >= a.limArquivos || (i > 0 && bytes+int(p.Tamanho) > a.limBytes*9/10) {
			return pend[:i]
		}
		bytes += int(p.Tamanho)
	}
	return pend
}

// enviar: pergunta o que já existe (notas completas não sobem de novo; eventos sempre sobem) e manda o resto.
func (a *Agente) enviar(lote []Pendente) (int, error) {
	var chaves []string
	for _, p := range lote {
		if !p.Info.Evento {
			chaves = append(chaves, p.Info.Chave)
		}
	}
	existe := map[string]bool{}
	if len(chaves) > 0 {
		m, err := a.Api.Existentes(chaves)
		if err != nil {
			return 0, err
		}
		existe = m
	}
	var marcar []ItemRegistro
	var mandar []Pendente
	for _, p := range lote {
		if !p.Info.Evento && existe[p.Info.Chave] {
			marcar = append(marcar, ItemRegistro{Caminho: p.Caminho, Tamanho: p.Tamanho, Mtime: p.Mtime, Chave: p.Info.Chave, Situacao: StEnviado, Detalhe: "ja_existia"})
		} else {
			mandar = append(mandar, p)
		}
	}
	if len(mandar) > 0 {
		z, nomes, err := MontarLote(mandar)
		if err != nil {
			return 0, err
		}
		if len(nomes) > 0 {
			r, err := a.Api.EnviarLote(z)
			if err != nil {
				return 0, err
			}
			vistos := map[string]bool{}
			for _, res := range r.Resultados {
				p, ok := nomes[res.Arquivo]
				if !ok {
					continue
				}
				vistos[res.Arquivo] = true
				st := StEnviado
				if res.Situacao == "rejeitada" || res.Situacao == "fora_da_instalacao" {
					st = StRecusado
				}
				det := res.Situacao
				if res.Motivo != "" && st == StRecusado {
					det = res.Situacao + ": " + res.Motivo
				}
				marcar = append(marcar, ItemRegistro{Caminho: p.Caminho, Tamanho: p.Tamanho, Mtime: p.Mtime, Chave: p.Info.Chave, Situacao: st, Detalhe: det})
			}
			// Arquivo sem resultado na resposta fica pendente e vai no próximo ciclo
			a.Log.Printf("lote: %d arquivos · %d novas · %d já existiam · %d rejeitadas pela SEFAZ · %d recusadas · %d de outro CNPJ",
				r.Arquivos, r.Importadas+r.CompletouResumo, r.JaExistiam, r.RejeitadasSefaz, r.Rejeitadas, r.ForaDaInstalacao)
		}
	}
	if len(marcar) > 0 {
		if err := a.Reg.Marcar(marcar); err != nil {
			return 0, fmt.Errorf("registro local: %w", err)
		}
	}
	return len(marcar), nil
}

func (a *Agente) Sinal() {
	pastas := make([]map[string]any, 0, len(a.estados))
	for _, e := range a.estados {
		pastas = append(pastas, map[string]any{"caminho": e.Caminho, "tipo": e.Tipo, "arquivos": e.Arquivos, "ultimoArquivoEm": e.UltimoArquivoEm, "ok": e.Ok})
	}
	host, _ := os.Hostname()
	err := a.Api.Sinal(map[string]any{"versao": Versao, "hostname": host, "sistema": descricaoSistema() + " " + runtime.GOARCH, "pastas": pastas, "pendentes": a.pendentes, "erro": a.ultimoErro})
	if err != nil {
		a.Log.Printf("sinal de vida falhou: %v", err)
		return
	}
	a.ultimoSinal = a.agora()
}

// Rodar: laço até o contexto ser cancelado.
func (a *Agente) Rodar(ctx context.Context) {
	if a.Intervalo <= 0 {
		a.Intervalo = time.Minute
	}
	a.Log.Printf("Appura Coletor %s iniciado · %d pasta(s) · servidor %s", Versao, len(a.Cfg.Pastas), a.Api.Base)
	ultimaConfig := time.Time{}
	for {
		agora := a.agora()
		if agora.After(a.pausaAte) {
			if agora.Sub(ultimaConfig) > 30*time.Minute {
				if err := a.Sincronizar(); err != nil {
					a.falhou(err)
				} else {
					ultimaConfig = agora
				}
			}
			if a.cnpjs != nil {
				n, err := a.Ciclo(ctx)
				if err != nil && !errors.Is(err, context.Canceled) {
					a.falhou(err)
				} else if err == nil {
					a.falhas, a.ultimoErro = 0, ""
					if n > 0 {
						a.Log.Printf("%d arquivo(s) resolvido(s); %d pendente(s)", n, a.pendentes)
					}
				}
			}
			if a.agora().Sub(a.ultimoSinal) >= a.intervaloSinal() {
				a.Sinal()
			}
		}
		select {
		case <-ctx.Done():
			a.Log.Printf("coletor encerrando")
			a.Sinal()
			return
		case <-time.After(a.Intervalo):
		}
	}
}

func (a *Agente) intervaloSinal() time.Duration {
	if a.intervaloSin > 0 {
		return a.intervaloSin
	}
	return 5 * time.Minute
}

// falhou: rede ou Appura fora → espera crescente (1, 2, 4… até 30 min). Token revogado → 1 hora.
func (a *Agente) falhou(err error) {
	a.ultimoErro = err.Error()
	a.falhas++
	espera := time.Minute << min(a.falhas-1, 5)
	if espera > 30*time.Minute {
		espera = 30 * time.Minute
	}
	var e *ErroApi
	if errors.As(err, &e) && e.Definitivo() {
		espera = time.Hour
		a.cnpjs = nil // relê a configuração quando voltar
	}
	a.pausaAte = a.agora().Add(espera)
	a.Log.Printf("erro: %v · nova tentativa em %s", err, espera)
}
