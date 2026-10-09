# Execute em PowerShell: powershell -NoProfile -ExecutionPolicy Bypass -File D:\Prospector\start-dashboard.ps1
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 22+ nao encontrado no PATH" }
$version = [int]((node -p "process.versions.node").Split('.')[0])
if ($version -lt 22) { throw "Instale Node.js 22 ou superior" }
if (!(Test-Path (Join-Path $root 'node_modules'))) { npm ci; if ($LASTEXITCODE -ne 0) { throw "npm ci falhou" } }
$existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*dashboard/server.mjs*" }
if ($existing) {
  Write-Host "Painel ja iniciado (PID $($existing.ProcessId))."
} else {
  $legacy = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*bot.mjs*" }
  if ($legacy) { throw "O bot legado esta rodando. Pare-o antes de iniciar o painel para evitar duas conexoes WhatsApp." }
  $logs = Join-Path $root 'logs'
  if (!(Test-Path $logs)) { New-Item -ItemType Directory -Path $logs | Out-Null }
  $env:PORT = '3030'
  $p = Start-Process -FilePath 'node' -ArgumentList 'dashboard/server.mjs' -WorkingDirectory $root -PassThru -RedirectStandardOutput (Join-Path $logs 'dashboard.out.log') -RedirectStandardError (Join-Path $logs 'dashboard.err.log')
  Write-Host "Painel iniciado no PID $($p.Id)"
}
Start-Sleep -Seconds 2
Start-Process 'http://127.0.0.1:3030'
