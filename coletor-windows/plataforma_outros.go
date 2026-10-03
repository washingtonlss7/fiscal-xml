//go:build !windows

package main

// Fora do Windows (desenvolvimento e testes): sem DPAPI, sem tarefa agendada. O token fica só codificado,
// por isso este modo nunca deve ser usado em produção.

import (
	"encoding/base64"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func protegerSegredo(s string) (string, error) {
	return "dev:" + base64.StdEncoding.EncodeToString([]byte(s)), nil
}

func desprotegerSegredo(p string) (string, error) {
	if !strings.HasPrefix(p, "dev:") {
		return "", errors.New("token protegido em formato desconhecido")
	}
	b, err := base64.StdEncoding.DecodeString(p[4:])
	return string(b), err
}

func pastaDadosPadrao() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".appura-coletor")
}

func descricaoSistema() string { return runtime.GOOS }
func ehAdministrador() bool    { return true }
func elevar([]string) error    { return errors.New("elevação só no Windows") }
func abrirNavegador(url string) error {
	return exec.Command("xdg-open", url).Start()
}
func unidades() []string {
	if r := os.Getenv("APPURA_BUSCA_RAIZES"); r != "" { // testes
		return strings.Split(r, ":")
	}
	return []string{"/"}
}
func pastaIgnoradaNaBusca(c string) bool {
	for _, x := range []string{"/proc", "/sys", "/dev", "/run", "/usr", "/lib", "/bin", "/sbin", "/etc", "/var/lib", "/snap", "/node_modules", "/.git"} {
		if c == x || strings.HasPrefix(c, x+"/") || strings.Contains(c, "/node_modules") || strings.Contains(c, "/.git") {
			return true
		}
	}
	return false
}
func instalarPrograma() (string, error) {
	exe, _ := os.Executable()
	return exe, os.MkdirAll(PastaDados(), 0o700)
}
func iniciarServico() error      { return nil }
func reiniciarServico() error    { return nil }
func servicoInstalado() bool     { _, err := os.Stat(caminhoConfig()); return err == nil }
func desinstalarPrograma() error { return nil }

func avisarUsuario(texto string) { println(texto) }
