<#
  Appura — Diagnóstico do banco do Domínio (primeiro entregável da especificação contábil, item 42)

  O QUE FAZ (somente leitura):
    - lista as conexões ODBC do computador e as instalações do SQL Anywhere;
    - conecta no banco do Domínio pela conexão ODBC escolhida;
    - lê SÓ o catálogo do banco (nomes de tabelas, colunas e quantidade aproximada de linhas);
    - destaca as tabelas que parecem ser de empresas, folha/rubricas, contabilidade e escrita fiscal;
    - grava um relatório .txt na Área de Trabalho para mandar ao Appura.

  O QUE NÃO FAZ:
    - não lê dados de clientes (nenhuma linha de nenhuma tabela de dados);
    - não executa INSERT, UPDATE, DELETE nem altera nada;
    - não guarda usuário nem senha (são pedidos na hora e descartados).

  COMO RODAR (no servidor onde o Domínio está instalado, com um usuário do Windows que já usa o Domínio):
    1. Clique com o botão direito no arquivo → "Executar com o PowerShell"
       (ou abra o PowerShell e rode:  powershell -ExecutionPolicy Bypass -File .\diagnostico-dominio.ps1 )
    2. Escolha a conexão ODBC do banco (Domínio novo; depois rode de novo para o Domínio antigo).
    3. Informe usuário e senha de banco que o suporte Domínio indicar (de preferência um usuário só de leitura).
    4. Mande o arquivo gerado na Área de Trabalho (diagnostico-dominio-*.txt).
#>

$ErrorActionPreference = 'Stop'
$saida = New-Object System.Collections.Generic.List[string]
function Linha([string]$t = '') { $saida.Add($t); Write-Host $t }
function Salvar {
  $arq = Join-Path ([Environment]::GetFolderPath('Desktop')) ("diagnostico-dominio-" + (Get-Date -Format 'yyyyMMdd-HHmm') + ".txt")
  $saida | Out-File -FilePath $arq -Encoding UTF8
  Write-Host ""
  Write-Host "Relatório gravado em: $arq" -ForegroundColor Green
  Write-Host "Ele contém só nomes de tabelas e colunas (nenhum dado de cliente). Envie para o Appura."
}

Linha "Appura - Diagnóstico do banco do Domínio (somente leitura)"
Linha ("Gerado em: " + (Get-Date -Format 'dd/MM/yyyy HH:mm') + " no computador " + $env:COMPUTERNAME)
Linha ""

# 1) Instalações do SQL Anywhere (o Domínio usa Sybase/SAP SQL Anywhere)
Linha "== SQL Anywhere instalado =="
$pastas = @()
foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'C:\')) {
  if ($base -and (Test-Path $base)) { $pastas += Get-ChildItem -Path $base -Directory -Filter 'SQL Anywhere*' -ErrorAction SilentlyContinue }
}
if ($pastas.Count -eq 0) { Linha "Nenhuma pasta 'SQL Anywhere*' encontrada nos locais padrão." } else { $pastas | ForEach-Object { Linha ("- " + $_.FullName) } }
$servicos = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'SQLANY|dbsrv|Dominio' -or $_.DisplayName -match 'SQL Anywhere|Dom[ií]nio' }
foreach ($s in $servicos) { Linha ("- Serviço: " + $s.DisplayName + " (" + $s.Status + ")") }
Linha ""

# 2) Conexões ODBC
Linha "== Conexões ODBC =="
$dsns = @()
try { $dsns = Get-OdbcDsn -ErrorAction Stop | Sort-Object Name } catch { Linha "Não foi possível listar as conexões ODBC: $($_.Exception.Message)" }
$i = 0
foreach ($d in $dsns) { $i++; Linha ("[{0}] {1}  (driver: {2}, {3} {4})" -f $i, $d.Name, $d.DriverName, $d.DsnType, $d.Platform) }
if ($dsns.Count -eq 0) { Linha "Nenhuma conexão ODBC encontrada. Peça ao suporte Domínio o nome da conexão (DSN) do banco." }
Linha ""

$escolha = Read-Host "Número da conexão do banco do Domínio (ou digite o nome do DSN)"
$dsn = $null
if ($escolha -match '^\d+$' -and [int]$escolha -ge 1 -and [int]$escolha -le $dsns.Count) { $dsn = $dsns[[int]$escolha - 1].Name } else { $dsn = $escolha.Trim() }
if (-not $dsn) { Write-Host "Nenhuma conexão escolhida."; exit 1 }
$ambiente = Read-Host "Este banco é o Domínio NOVO ou ANTIGO? (N/A)"
$usuario = Read-Host "Usuário do banco"
$senhaSegura = Read-Host "Senha do banco (não aparece na tela e não é guardada)" -AsSecureString
$senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaSegura))

Linha ("== Banco: DSN '" + $dsn + "' (" + ($(if ($ambiente -match '^[Aa]') { 'Domínio ANTIGO' } else { 'Domínio NOVO' })) + ") ==")
$con = New-Object System.Data.Odbc.OdbcConnection("DSN=$dsn;UID=$usuario;PWD=$senha")
try { $con.Open() } catch { Linha ("Não conectou: " + $_.Exception.Message); $senha = $null; Salvar; exit 1 }
$senha = $null

function Consulta([string]$sql) {
  # Só SELECT no catálogo do banco. Qualquer outro comando é recusado aqui mesmo.
  if ($sql -notmatch '^\s*select\s' -or $sql -match '\b(insert|update|delete|drop|alter|create|grant|call|execute)\b') { throw "Consulta não permitida." }
  $cmd = $con.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 120
  $da = New-Object System.Data.Odbc.OdbcDataAdapter($cmd); $t = New-Object System.Data.DataTable; [void]$da.Fill($t); return $t
}

try { $v = Consulta "select @@version as versao"; Linha ("Versão do banco: " + $v.Rows[0].versao) } catch { Linha "Versão do banco: não informada" }

# 3) Tabelas (catálogo): nome, dono e linhas aproximadas
$tabelas = $null
foreach ($sql in @(
  "select u.user_name as dono, t.table_name as tabela, t.count as linhas, t.table_id as id from SYS.SYSTABLE t join SYS.SYSUSERPERM u on u.user_id = t.creator where t.table_type = 'BASE' and u.user_name not in ('SYS','dbo','rs_systabgroup')",
  "select u.user_name as dono, t.table_name as tabela, t.count as linhas, t.table_id as id from SYS.SYSTAB t join SYS.SYSUSER u on u.user_id = t.creator where t.table_type = 1 and u.user_name not in ('SYS','dbo','rs_systabgroup')"
)) { try { $tabelas = Consulta $sql; break } catch { } }
if (-not $tabelas) { Linha "Não consegui ler o catálogo de tabelas (permissão?). Peça ao suporte Domínio um usuário com leitura do catálogo."; $con.Close(); Salvar; exit 1 }
Linha ("Tabelas encontradas: " + $tabelas.Rows.Count)
Linha ""

# 4) Grupos de interesse (pistas pelo nome; a confirmação é na análise)
$grupos = [ordered]@{
  'EMPRESAS'       = '^(ge|gr)?empr|empresa|^geempre$|filial|estab'
  'FOLHA/RUBRICAS' = '^fo|folha|rubric|evento|verba|empreg|funcion|calculo|provis|ferias|rescis|decimo|fgts|inss'
  'CONTABILIDADE'  = '^ct|contab|lancto|lanc|plano|conta|historico|saldo|lote'
  'ESCRITA FISCAL' = '^ef|fiscal|nota|cfop|apurac|imposto|entrada|saida'
}
$candidatas = @{}
foreach ($g in $grupos.Keys) {
  Linha ("== Possíveis tabelas de " + $g + " ==")
  $achou = $tabelas.Rows | Where-Object { $_.tabela -match $grupos[$g] } | Sort-Object { [double]($_.linhas) } -Descending | Select-Object -First 60
  foreach ($r in $achou) { Linha ("{0}.{1}  ~{2} linhas" -f $r.dono, $r.tabela, $r.linhas); $candidatas[[string]$r.id] = $r }
  if (-not $achou) { Linha "(nenhuma pelo nome)" }
  Linha ""
}

# 5) Colunas das tabelas candidatas (só nomes e tipos)
Linha "== Colunas das tabelas candidatas =="
foreach ($id in $candidatas.Keys) {
  $r = $candidatas[$id]
  $cols = $null
  foreach ($sql in @(
    "select c.column_name as coluna, d.domain_name as tipo, c.width as tamanho from SYS.SYSCOLUMN c join SYS.SYSDOMAIN d on d.domain_id = c.domain_id where c.table_id = $id order by c.column_id",
    "select c.column_name as coluna, d.domain_name as tipo, c.width as tamanho from SYS.SYSTABCOL c join SYS.SYSDOMAIN d on d.domain_id = c.domain_id where c.table_id = $id order by c.column_id"
  )) { try { $cols = Consulta $sql; break } catch { } }
  if ($cols) { Linha ("{0}.{1}: {2}" -f $r.dono, $r.tabela, (($cols.Rows | ForEach-Object { "$($_.coluna) $($_.tipo)($($_.tamanho))" }) -join ', ')) }
}
Linha ""

# 6) Relação entre tabelas (chaves estrangeiras), se o banco tiver
Linha "== Relacionamentos (chaves estrangeiras) entre as candidatas =="
try {
  $fks = Consulta "select p.table_name as pai, f.table_name as filha, fk.role as nome from SYS.SYSFOREIGNKEY fk join SYS.SYSTABLE p on p.table_id = fk.primary_table_id join SYS.SYSTABLE f on f.table_id = fk.foreign_table_id"
  $nomes = @($candidatas.Values | ForEach-Object { $_.tabela })
  $fks.Rows | Where-Object { $nomes -contains $_.pai -or $nomes -contains $_.filha } | ForEach-Object { Linha ("{0} -> {1} ({2})" -f $_.filha, $_.pai, $_.nome) }
} catch { Linha "(o banco não informa chaves estrangeiras ou não há permissão)" }
Linha ""

# 7) Lista completa de tabelas (para a análise)
Linha "== Todas as tabelas (dono.tabela ~linhas) =="
$tabelas.Rows | Sort-Object dono, tabela | ForEach-Object { Linha ("{0}.{1} ~{2}" -f $_.dono, $_.tabela, $_.linhas) }
$con.Close()

Salvar
Read-Host "Pressione Enter para fechar"
