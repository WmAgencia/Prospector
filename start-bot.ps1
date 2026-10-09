# Prospector - launcher durável do bot de WhatsApp
#
# Por que este arquivo existe:
#   A execução anterior (2026-10-07) subiu o bot como "background task" de uma sessão.
#   Quando a sessão terminou, o bot morreu e as respostas ficaram ~30h sem ninguém ler.
#   Start-Process cria um processo independente, que sobrevive ao fim da sessão.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File D:\Prospector\start-bot.ps1
#
# LISTEN_ONLY=1  → só escuta (registra inbox + mapeamento LID). NÃO envia nada. É o modo seguro.
# LISTEN_ONLY=0  → modo ativo: drena data/queue.jsonl respeitando a cadência do bot.mjs.

param(
    [string]$ListenOnly = "1"
)

$ErrorActionPreference = "Stop"
$root = "D:\Prospector"
$logs = Join-Path $root "logs"

if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs -Force | Out-Null }

# Já existe um bot rodando? Não subir dois (duas conexões = sessão corrompida).
$existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*bot.mjs*" }

if ($existing) {
    Write-Host "[start-bot] Já existe bot.mjs rodando (PID $($existing.ProcessId)). Nada a fazer."
    exit 0
}

$env:LISTEN_ONLY = $ListenOnly

# AUTO_AUDIO=1 → manda o áudio pré-programado quando a pessoa responde a uma abordagem.
# O arquivo do áudio deve estar em D:\Prospector\audio\abordagem.ogg (ver bot.mjs).
# Nunca manda áudio para quem recusou / pediu para parar.
$env:AUTO_AUDIO = "1"

$outLog = Join-Path $logs "listen.out.log"
$errLog = Join-Path $logs "listen.err.log"

$p = Start-Process -FilePath "node" `
    -ArgumentList "bot.mjs" `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Write-Host "[start-bot] PID=$($p.Id) LISTEN_ONLY=$ListenOnly"
Write-Host "[start-bot] stdout: $outLog"
Write-Host "[start-bot] stderr: $errLog"
Write-Host "[start-bot] log principal: D:\Prospector\logs\bot.log"