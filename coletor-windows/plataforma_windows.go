//go:build windows

package main

// Windows: pasta de dados em ProgramData, token protegido pelo DPAPI (escopo da máquina, porque o coletor roda como
// SYSTEM e o assistente como administrador), tarefa agendada como SYSTEM na inicialização (roda sem ninguém logado,
// reinicia sozinha), atalho no menu Iniciar e elevação para administrador. Só a biblioteca padrão (syscall).

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const nomeTarefa = "Appura Coletor"

var (
	crypt32                = syscall.NewLazyDLL("crypt32.dll")
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	shell32                = syscall.NewLazyDLL("shell32.dll")
	procCryptProtectData   = crypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
	procLocalFree          = kernel32.NewProc("LocalFree")
	procIsUserAnAdmin      = shell32.NewProc("IsUserAnAdmin")
	procGetLogicalDrives   = kernel32.NewProc("GetLogicalDrives")
)

type dataBlob struct {
	cbData uint32
	pbData *byte
}

func novoBlob(d []byte) *dataBlob {
	if len(d) == 0 {
		return &dataBlob{}
	}
	return &dataBlob{cbData: uint32(len(d)), pbData: &d[0]}
}

func (b *dataBlob) bytes() []byte {
	d := make([]byte, b.cbData)
	copy(d, unsafe.Slice(b.pbData, b.cbData))
	return d
}

const cryptprotectLocalMachine = 0x4
const cryptprotectUiForbidden = 0x1

// Entropia fixa do Appura: outro programa que use DPAPI não decifra o token por engano.
var entropia = []byte("AppuraColetor/token/v1")

func protegerSegredo(s string) (string, error) {
	var saida dataBlob
	r, _, err := procCryptProtectData.Call(uintptr(unsafe.Pointer(novoBlob([]byte(s)))), 0, uintptr(unsafe.Pointer(novoBlob(entropia))), 0, 0,
		cryptprotectLocalMachine|cryptprotectUiForbidden, uintptr(unsafe.Pointer(&saida)))
	if r == 0 {
		return "", fmt.Errorf("DPAPI: %v", err)
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(saida.pbData)))
	return "dpapi:" + base64.StdEncoding.EncodeToString(saida.bytes()), nil
}

func desprotegerSegredo(p string) (string, error) {
	if !strings.HasPrefix(p, "dpapi:") {
		return "", errors.New("token protegido em formato desconhecido")
	}
	d, err := base64.StdEncoding.DecodeString(p[6:])
	if err != nil {
		return "", err
	}
	var saida dataBlob
	r, _, e := procCryptUnprotectData.Call(uintptr(unsafe.Pointer(novoBlob(d))), 0, uintptr(unsafe.Pointer(novoBlob(entropia))), 0, 0,
		cryptprotectUiForbidden, uintptr(unsafe.Pointer(&saida)))
	if r == 0 {
		return "", fmt.Errorf("DPAPI: %v", e)
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(saida.pbData)))
	return string(saida.bytes()), nil
}

func pastaDadosPadrao() string {
	pd := os.Getenv("ProgramData")
	if pd == "" {
		pd = `C:\ProgramData`
	}
	return filepath.Join(pd, "AppuraColetor")
}

func pastaPrograma() string {
	pf := os.Getenv("ProgramFiles")
	if pf == "" {
		pf = `C:\Program Files`
	}
	return filepath.Join(pf, "Appura Coletor")
}

func descricaoSistema() string {
	out, err := exec.Command("cmd", "/c", "ver").Output()
	if err != nil {
		return "Windows"
	}
	return strings.TrimSpace(string(out))
}

func ehAdministrador() bool {
	r, _, _ := procIsUserAnAdmin.Call()
	return r != 0
}

// elevar reabre este programa pedindo permissão de administrador (janela do Windows "Deseja permitir…").
func elevar(args []string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	lista := "''"
	if len(args) > 0 {
		q := make([]string, len(args))
		for i, a := range args {
			q[i] = "'" + strings.ReplaceAll(a, "'", "''") + "'"
		}
		lista = strings.Join(q, ",")
	}
	ps := fmt.Sprintf("Start-Process -FilePath '%s' -ArgumentList %s -Verb RunAs", strings.ReplaceAll(exe, "'", "''"), lista)
	return exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps).Run()
}

func abrirNavegador(url string) error {
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// unidades: discos locais existentes (C:\, D:\…) para a busca automática.
func unidades() []string {
	m, _, _ := procGetLogicalDrives.Call()
	var r []string
	for i := 0; i < 26; i++ {
		if m&(1<<uint(i)) == 0 {
			continue
		}
		u := string(rune('A'+i)) + `:\`
		if tipoUnidade(u) == 3 { // DRIVE_FIXED: só discos locais (rede e pendrive ficam de fora da busca automática)
			r = append(r, u)
		}
	}
	return r
}

func tipoUnidade(u string) uint32 {
	p, _ := syscall.UTF16PtrFromString(u)
	r, _, _ := kernel32.NewProc("GetDriveTypeW").Call(uintptr(unsafe.Pointer(p)))
	return uint32(r)
}

// Pastas que a busca automática nunca percorre (sistema, lixeira, perfis de navegador…)
func pastaIgnoradaNaBusca(caminho string) bool {
	b := strings.ToLower(caminho)
	for _, x := range []string{`\windows`, `\$recycle.bin`, `\system volume information`, `\programdata\microsoft`, `\appdata\local\microsoft`, `\appdata\local\google`,
		`\appdata\local\packages`, `\appdata\roaming\microsoft`, `\program files\windowsapps`, `\program files\common files`, `\node_modules`, `\.git`, `\appuracoletor`} {
		if strings.Contains(b, x) {
			return true
		}
	}
	return false
}

func rodar(nome string, args ...string) error {
	cmd := exec.Command(nome, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %v: %s", nome, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// xmlTarefa: tarefa agendada como SYSTEM, ao ligar o computador, reiniciando a cada minuto se cair, sem limite de tempo.
func xmlTarefa(exe string) string {
	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Envia os XMLs de NF-e e NFC-e para o Appura.</Description><Author>Appura</Author></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT1M</Delay></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>` + escaparXml(exe) + `</Command><Arguments>rodar</Arguments></Exec></Actions>
</Task>`
}

func escaparXml(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}

// instalarPrograma copia o executável para Arquivos de Programas, protege a pasta de dados, registra a tarefa e o atalho.
func instalarPrograma() (string, error) {
	origem, err := os.Executable()
	if err != nil {
		return "", err
	}
	destDir := pastaPrograma()
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", err
	}
	destino := filepath.Join(destDir, "appura-coletor.exe")
	if !strings.EqualFold(filepath.Clean(origem), filepath.Clean(destino)) {
		// Atualização: para a versão antiga (coletor e ícone) antes de copiar, senão o Windows não deixa sobrescrever
		_ = rodar("schtasks", "/End", "/TN", nomeTarefa)
		pararOutrasInstancias()
		b, err := os.ReadFile(origem)
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(destino, b, 0o755); err != nil {
			return "", fmt.Errorf("copiar o programa: %w", err)
		}
	}
	// Pasta de dados: só SYSTEM e Administradores (o token protegido e o registro ficam lá)
	if err := os.MkdirAll(PastaDados(), 0o700); err != nil {
		return "", err
	}
	if err := rodar("icacls", PastaDados(), "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"); err != nil {
		return "", err
	}
	// Só a situação (sem segredos) pode ser lida por qualquer usuário: é o que o ícone da bandeja mostra
	if err := os.MkdirAll(pastaPublica(), 0o755); err == nil {
		_ = rodar("icacls", pastaPublica(), "/grant", "*S-1-5-32-545:(OI)(CI)RX")
	}
	xmlPath := filepath.Join(PastaDados(), "tarefa.xml")
	// O schtasks exige UTF-16 com BOM
	u := syscall.StringToUTF16(xmlTarefa(destino))
	buf := []byte{0xFF, 0xFE}
	for _, c := range u[:len(u)-1] {
		buf = append(buf, byte(c), byte(c>>8))
	}
	if err := os.WriteFile(xmlPath, buf, 0o600); err != nil {
		return "", err
	}
	if err := rodar("schtasks", "/Create", "/TN", nomeTarefa, "/XML", xmlPath, "/F"); err != nil {
		return "", err
	}
	os.Remove(xmlPath)
	criarAtalho(destino)
	// Ícone na bandeja ao entrar no Windows (todos os usuários deste computador)
	_ = rodar("reg", "add", `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run`, "/v", nomeTarefa, "/t", "REG_SZ", "/d", `"`+destino+`" bandeja`, "/f")
	return destino, nil
}

func criarAtalho(exe string) {
	menu := filepath.Join(os.Getenv("ProgramData"), `Microsoft\Windows\Start Menu\Programs`)
	lnk := filepath.Join(menu, "Appura Coletor - Configurar.lnk")
	ps := fmt.Sprintf(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');$s.TargetPath='%s';$s.Arguments='configurar';$s.Description='Configurar o Appura Coletor';$s.Save()`,
		strings.ReplaceAll(lnk, "'", "''"), strings.ReplaceAll(exe, "'", "''"))
	_ = rodar("powershell", "-NoProfile", "-Command", ps)
}

func iniciarServico() error { return rodar("schtasks", "/Run", "/TN", nomeTarefa) }

// pararOutrasInstancias encerra o coletor e o ícone que estiverem rodando (menos este processo).
func pararOutrasInstancias() {
	_ = rodar("taskkill", "/F", "/FI", "IMAGENAME eq appura-coletor.exe", "/FI", fmt.Sprintf("PID ne %d", os.Getpid()))
	time.Sleep(time.Second)
}

// iniciarBandeja abre o ícone ao lado do relógio para quem está usando o computador agora.
func iniciarBandeja() {
	exe := filepath.Join(pastaPrograma(), "appura-coletor.exe")
	cmd := exec.Command(exe, "bandeja")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Start()
}

func reiniciarServico() error {
	_ = rodar("schtasks", "/End", "/TN", nomeTarefa)
	return iniciarServico()
}

func servicoInstalado() bool { return rodar("schtasks", "/Query", "/TN", nomeTarefa) == nil }

func desinstalarPrograma() error {
	_ = rodar("schtasks", "/End", "/TN", nomeTarefa)
	err := rodar("schtasks", "/Delete", "/TN", nomeTarefa, "/F")
	_ = rodar("reg", "delete", `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run`, "/v", nomeTarefa, "/f")
	pararOutrasInstancias()
	os.Remove(filepath.Join(os.Getenv("ProgramData"), `Microsoft\Windows\Start Menu\Programs\Appura Coletor - Configurar.lnk`))
	return err
}

// avisarUsuario mostra uma caixa de mensagem do Windows (o programa não tem janela de console).
func avisarUsuario(texto string) {
	t, _ := syscall.UTF16PtrFromString(texto)
	c, _ := syscall.UTF16PtrFromString("Appura Coletor")
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x40)
}
