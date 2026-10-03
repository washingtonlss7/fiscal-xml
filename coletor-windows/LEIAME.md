# Appura Coletor (Windows)

Programa instalado na máquina onde o sistema de vendas do cliente grava os XMLs. Envia ao Appura as NF-e e NFC-e
emitidas (e os eventos, como cancelamento), lembra o que já mandou e respeita os CNPJs da instalação.

- Só biblioteca padrão do Go (sem dependências). Windows 10/11 ou Server 2016+ (64 bits).
- `appura-coletor.exe` sem argumentos abre o assistente (pede administrador uma vez): token → pastas (busca
  automática ou escolha) → histórico (3 meses, tudo ou só daqui para frente) → instalar.
- Instala em `C:\Program Files\Appura Coletor`, dados em `C:\ProgramData\AppuraColetor` (só SYSTEM e
  Administradores), tarefa agendada "Appura Coletor" como SYSTEM na inicialização, atalho
  "Appura Coletor - Configurar" no menu Iniciar. O token fica protegido pelo DPAPI do Windows.
- Registro local `registro.jsonl` (o que já foi tratado) e log `coletor.log` (girado em 5 MB).

## Compilar

    cd coletor-windows
    go test ./...
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w" -o appura-coletor.exe .

O executável não vai para o repositório.
