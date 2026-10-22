# Makes this machine sync Polar data. Idempotent; the hub launch runs it on every machine (hub.ps1).
#   1. clones the private fitness-data repo next to this repo if missing (or pulls it)
#   2. registers/updates the Windows task "Fitness Assistant Polar sync" (logon +2 min, daily 12:00 +0-30 min random)
#   3. runs one sync now
# Credentials come from fitness-data/imports/polar/credentials.json (shared); if they are missing,
# run `python tools\polar.py setup` once on any machine. Log: data\polar\sync.log.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dataRepo = Join-Path (Split-Path $root -Parent) 'fitness-data'
$name = 'Fitness Assistant Polar sync'
$log = Join-Path $root 'data\polar\sync.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { "$(Get-Date -Format s) ensure: $m" | Add-Content -LiteralPath $log -Encoding UTF8; $m }

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { Log 'no python on PATH, Polar sync not set up'; return }
$pythonw = Join-Path (Split-Path $python.Source) 'pythonw.exe'

if (Test-Path -LiteralPath (Join-Path $dataRepo '.git')) {
    git -C $dataRepo pull --rebase --autostash --quiet 2>$null
} else {
    Log "cloning fitness-data to $dataRepo"
    git clone --quiet https://github.com/nicolasstephan/fitness-data.git $dataRepo
}
if (-not (Test-Path -LiteralPath (Join-Path $dataRepo 'imports\polar\credentials.json'))) {
    Log 'no Polar credentials in fitness-data yet: run  python tools\polar.py setup  once'
    return
}

$arg = '-X utf8 tools\polar.py sync'
$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
$current = $task -and $task.Actions[0].Execute -eq $pythonw -and $task.Actions[0].WorkingDirectory -eq $root -and
    $task.Actions[0].Arguments -eq $arg -and ($task.Triggers | Where-Object RandomDelay)
if (-not $current) {
    $action = New-ScheduledTaskAction -Execute $pythonw -WorkingDirectory $root -Argument $arg
    $logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $logon.Delay = 'PT2M'
    $daily = New-ScheduledTaskTrigger -Daily -At '12:00' -RandomDelay (New-TimeSpan -Minutes 30)  # machines don't all push at once
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $logon, $daily -Settings $settings -Principal $principal -Force | Out-Null
    Log "task '$name' registered ($pythonw)"
}
Start-ScheduledTask -TaskName $name
