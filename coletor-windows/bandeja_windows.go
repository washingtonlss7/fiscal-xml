//go:build windows

package main

// Ícone na bandeja do Windows (ao lado do relógio): cor pela situação do coletor (verde, amarelo, vermelho),
// dica com o resumo, clique abre o painel de atividades, menu com Configurar e Ocultar, e aviso do Windows quando
// o coletor para ou dá erro. Só a biblioteca padrão (syscall). Roda como o usuário logado.

import (
	"embed"
	"encoding/binary"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

//go:embed icones/*.ico
var icones embed.FS

var (
	user32                = syscall.NewLazyDLL("user32.dll")
	procRegisterClassExW  = user32.NewProc("RegisterClassExW")
	procCreateWindowExW   = user32.NewProc("CreateWindowExW")
	procDefWindowProcW    = user32.NewProc("DefWindowProcW")
	procGetMessageW       = user32.NewProc("GetMessageW")
	procTranslateMessage  = user32.NewProc("TranslateMessage")
	procDispatchMessageW  = user32.NewProc("DispatchMessageW")
	procPostQuitMessage   = user32.NewProc("PostQuitMessage")
	procCreatePopupMenu   = user32.NewProc("CreatePopupMenu")
	procAppendMenuW       = user32.NewProc("AppendMenuW")
	procTrackPopupMenu    = user32.NewProc("TrackPopupMenu")
	procDestroyMenu       = user32.NewProc("DestroyMenu")
	procSetForegroundWin  = user32.NewProc("SetForegroundWindow")
	procGetCursorPos      = user32.NewProc("GetCursorPos")
	procSetTimer          = user32.NewProc("SetTimer")
	procCreateIconFromRes = user32.NewProc("CreateIconFromResourceEx")
	procGetSystemMetrics  = user32.NewProc("GetSystemMetrics")
	procRegisterWindowMsg = user32.NewProc("RegisterWindowMessageW")
	procDestroyWindow     = user32.NewProc("DestroyWindow")
	procShellNotifyIconW  = shell32.NewProc("Shell_NotifyIconW")
	procGetModuleHandleW  = kernel32.NewProc("GetModuleHandleW")
	procCreateMutexW      = kernel32.NewProc("CreateMutexW")
)

const (
	wmDestroy     = 0x0002
	wmCommand     = 0x0111
	wmTimer       = 0x0113
	wmLButtonUp   = 0x0202
	wmLButtonDbl  = 0x0203
	wmRButtonUp   = 0x0205
	wmApp         = 0x8000
	wmIcone       = wmApp + 1
	nimAdd        = 0
	nimModify     = 1
	nimDelete     = 2
	nifMessage    = 0x1
	nifIcon       = 0x2
	nifTip        = 0x4
	nifInfo       = 0x10
	niifWarning   = 0x2
	niifInfo      = 0x1
	mfString      = 0x0
	mfSeparator   = 0x800
	tpmRightAlign = 0x8
	tpmBottom     = 0x20
	tpmReturnCmd  = 0x100
	cmdPainel     = 1
	cmdConfigurar = 2
	cmdOcultar    = 3
)

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         [16]byte
	HBalloonIcon     uintptr
}

type wndClassEx struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}

type msgW struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
	Private uint32
}

type bandeja struct {
	hwnd         uintptr
	nid          notifyIconData
	icones       map[string]uintptr
	cor          string
	painel       PainelLocal
	msgTaskbar   uint32
	avisouParado bool
}

var bandejaAtual *bandeja

func copiarUTF16(dst []uint16, s string) {
	u, _ := syscall.UTF16FromString(s)
	if len(u) > len(dst) {
		u = append(u[:len(dst)-2], '…', 0)
	}
	copy(dst, u)
}

// carregarIcone escolhe no .ico a imagem do tamanho pedido e cria o ícone (aceita PNG ou bitmap).
func carregarIcone(nome string, tamanho int) uintptr {
	b, err := icones.ReadFile("icones/" + nome + ".ico")
	if err != nil || len(b) < 6 {
		return 0
	}
	n := int(binary.LittleEndian.Uint16(b[4:6]))
	melhor, melhorDif := -1, 1<<30
	for i := 0; i < n; i++ {
		e := b[6+16*i:]
		w := int(e[0])
		if w == 0 {
			w = 256
		}
		dif := w - tamanho
		if dif < 0 {
			dif = -dif * 4 // prefere reduzir a ampliar
		}
		if dif < melhorDif {
			melhor, melhorDif = i, dif
		}
	}
	if melhor < 0 {
		return 0
	}
	e := b[6+16*melhor:]
	tam := binary.LittleEndian.Uint32(e[8:12])
	off := binary.LittleEndian.Uint32(e[12:16])
	if int(off+tam) > len(b) {
		return 0
	}
	h, _, _ := procCreateIconFromRes.Call(uintptr(unsafe.Pointer(&b[off])), uintptr(tam), 1, 0x00030000, uintptr(tamanho), uintptr(tamanho), 0)
	return h
}

func (t *bandeja) atualizar() {
	s, err := LerStatus()
	cor, texto := Resumo(s, err, time.Now())
	t.nid.UFlags = nifIcon | nifTip | nifMessage
	if cor != t.cor {
		t.nid.HIcon = t.icones[cor]
	}
	for i := range t.nid.SzTip {
		t.nid.SzTip[i] = 0
	}
	copiarUTF16(t.nid.SzTip[:], "Appura Coletor\n"+texto)
	// Aviso do Windows uma vez quando fica vermelho (coletor parado ou com erro)
	if cor == "vermelho" && t.cor != "" && t.cor != "vermelho" && !t.avisouParado {
		t.nid.UFlags |= nifInfo
		t.nid.DwInfoFlags = niifWarning
		copiarUTF16(t.nid.SzInfoTitle[:], "Appura Coletor precisa de atenção")
		copiarUTF16(t.nid.SzInfo[:], texto+"\nClique no ícone para ver os detalhes.")
		t.avisouParado = true
	}
	if cor != "vermelho" {
		t.avisouParado = false
	}
	t.cor = cor
	procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&t.nid)))
}

func (t *bandeja) adicionar() {
	t.nid.UFlags = nifIcon | nifTip | nifMessage
	procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&t.nid)))
}

func (t *bandeja) abrirPainel() {
	url, err := t.painel.Endereco()
	if err == nil {
		abrirNavegador(url)
	}
}

func (t *bandeja) menu() {
	m, _, _ := procCreatePopupMenu.Call()
	add := func(id int, texto string) {
		p, _ := syscall.UTF16PtrFromString(texto)
		procAppendMenuW.Call(m, mfString, uintptr(id), uintptr(unsafe.Pointer(p)))
	}
	add(cmdPainel, "Abrir painel de atividades")
	add(cmdConfigurar, "Configurar…")
	procAppendMenuW.Call(m, mfSeparator, 0, 0)
	add(cmdOcultar, "Ocultar ícone (volta ao entrar no Windows)")
	var pt struct{ X, Y int32 }
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWin.Call(t.hwnd)
	cmd, _, _ := procTrackPopupMenu.Call(m, tpmRightAlign|tpmBottom|tpmReturnCmd, uintptr(pt.X), uintptr(pt.Y), 0, t.hwnd, 0)
	procDestroyMenu.Call(m)
	t.comando(int(cmd))
}

func (t *bandeja) comando(cmd int) {
	switch cmd {
	case cmdPainel:
		t.abrirPainel()
	case cmdConfigurar:
		exe, _ := os.Executable()
		exec.Command(exe, "configurar").Start()
	case cmdOcultar:
		procDestroyWindow.Call(t.hwnd)
	}
}

func procJanela(hwnd uintptr, msg uint32, wparam, lparam uintptr) uintptr {
	t := bandejaAtual
	switch {
	case msg == wmIcone:
		switch uint32(lparam) {
		case wmLButtonUp, wmLButtonDbl:
			t.abrirPainel()
		case wmRButtonUp:
			t.menu()
		}
		return 0
	case msg == wmTimer:
		t.atualizar()
		return 0
	case msg == wmDestroy:
		procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&t.nid)))
		procPostQuitMessage.Call(0)
		return 0
	case t != nil && t.msgTaskbar != 0 && msg == t.msgTaskbar:
		// O Explorer reiniciou: o ícone precisa ser recriado
		t.adicionar()
		t.atualizar()
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wparam, lparam)
	return r
}

// modoBandeja: um só por usuário (mutex), roda até "Ocultar" ou o usuário sair do Windows.
func modoBandeja() {
	runtime.LockOSThread()
	nomeMutex, _ := syscall.UTF16PtrFromString(`Local\AppuraColetorBandeja`)
	_, _, e := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(nomeMutex)))
	if e == syscall.Errno(183) { // ERROR_ALREADY_EXISTS: já tem um ícone aberto para este usuário
		return
	}
	t := &bandeja{icones: map[string]uintptr{}}
	bandejaAtual = t
	tam, _, _ := procGetSystemMetrics.Call(49) // SM_CXSMICON
	if tam == 0 {
		tam = 16
	}
	for _, c := range []string{"azul", "verde", "amarelo", "vermelho"} {
		t.icones[c] = carregarIcone(c, int(tam))
	}
	inst, _, _ := procGetModuleHandleW.Call(0)
	classe, _ := syscall.UTF16PtrFromString("AppuraColetorBandeja")
	wc := wndClassEx{LpfnWndProc: syscall.NewCallback(procJanela), HInstance: inst, LpszClassName: classe}
	wc.CbSize = uint32(unsafe.Sizeof(wc))
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	titulo, _ := syscall.UTF16PtrFromString("Appura Coletor")
	t.hwnd, _, _ = procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(classe)), uintptr(unsafe.Pointer(titulo)), 0, 0, 0, 0, 0, 0, 0, inst, 0)
	tb, _ := syscall.UTF16PtrFromString("TaskbarCreated")
	m, _, _ := procRegisterWindowMsg.Call(uintptr(unsafe.Pointer(tb)))
	t.msgTaskbar = uint32(m)
	t.nid = notifyIconData{HWnd: t.hwnd, UID: 1, UCallbackMessage: wmIcone, HIcon: t.icones["azul"]}
	t.nid.CbSize = uint32(unsafe.Sizeof(t.nid))
	copiarUTF16(t.nid.SzTip[:], "Appura Coletor")
	t.adicionar()
	t.atualizar()
	procSetTimer.Call(t.hwnd, 1, 15000, 0)
	var msg msgW
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(r) <= 0 {
			return
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}
}
