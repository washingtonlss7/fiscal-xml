// Appura Coletor: envia ao Appura os XMLs de NF-e e NFC-e que o sistema de vendas grava no computador do cliente.
//
//	appura-coletor.exe              abre o assistente de instalação (ou de configuração, se já instalado)
//	appura-coletor.exe configurar   abre o assistente de configuração
//	appura-coletor.exe rodar        o coletor em si (é o que a tarefa do Windows executa)
//	appura-coletor.exe desinstalar  remove a tarefa e o atalho (os dados ficam em ProgramData)
//	appura-coletor.exe versao
package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	modo := ""
	if len(os.Args) > 1 {
		modo = os.Args[1]
	}
	switch modo {
	case "versao", "--version", "-v":
		fmt.Println("Appura Coletor", Versao)
	case "rodar":
		os.Exit(modoRodar())
	case "desinstalar":
		if !ehAdministrador() {
			if err := elevar([]string{"desinstalar"}); err != nil {
				avisarUsuario("É preciso permissão de administrador para desinstalar: " + err.Error())
				os.Exit(1)
			}
			return
		}
		if err := desinstalarPrograma(); err != nil {
			avisarUsuario("Erro ao desinstalar: " + err.Error())
			os.Exit(1)
		}
		avisarUsuario("Appura Coletor removido. Os dados ficaram em " + PastaDados())
	case "", "configurar", "instalar":
		if !ehAdministrador() {
			// A instalação cria a tarefa do Windows e protege a pasta de dados: precisa de administrador uma vez
			if err := elevar([]string{"configurar"}); err != nil {
				avisarUsuario("É preciso permissão de administrador para instalar o Appura Coletor.\n\n" + err.Error())
				os.Exit(1)
			}
			return
		}
		if err := modoAssistente(); err != nil {
			avisarUsuario("Erro no assistente: " + err.Error())
			os.Exit(1)
		}
	default:
		fmt.Println("Uso: appura-coletor [configurar|rodar|desinstalar|versao]")
		os.Exit(2)
	}
}

// abrirLog: arquivo em ProgramData, girado em 5 MB (fica o atual e o anterior).
func abrirLog() *log.Logger {
	os.MkdirAll(PastaDados(), 0o700)
	c := caminhoLog()
	if st, err := os.Stat(c); err == nil && st.Size() > 5*1024*1024 {
		os.Rename(c, c+".1")
	}
	f, err := os.OpenFile(c, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	var w io.Writer = os.Stdout
	if err == nil {
		w = io.MultiWriter(f, os.Stdout)
	}
	return log.New(w, "", log.LstdFlags)
}

func modoRodar() int {
	lg := abrirLog()
	cfg, err := LerConfig()
	if err != nil {
		lg.Printf("sem configuração (%v): rode o assistente \"Appura Coletor - Configurar\"", err)
		time.Sleep(time.Minute)
		return 1
	}
	token, err := cfg.Token()
	if err != nil {
		lg.Printf("token: %v", err)
		time.Sleep(time.Minute)
		return 1
	}
	reg, err := AbrirRegistro(caminhoRegistro())
	if err != nil {
		lg.Printf("registro local: %v", err)
		time.Sleep(time.Minute)
		return 1
	}
	defer reg.Fechar()
	if cfg.ReavaliarPeriodo {
		n := reg.Reabrir(DetForaDoPeriodo)
		cfg.ReavaliarPeriodo = false
		SalvarConfig(cfg)
		lg.Printf("período de histórico mudou: %d arquivo(s) voltam a ser avaliados", n)
	}
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()
	ag := &Agente{Cfg: cfg, Api: NovaApi(cfg.Servidor, token), Reg: reg, Log: lg}
	ag.Rodar(ctx)
	return 0
}
