# Registers the Windows task "Fitness Assistant Polar sync": runs `tools\polar.py sync` at logon (+2 min)
# and daily at 12:00, so the 28-day Polar API window is captured into data\polar\history.json and
# health\polar.json in the fitness-data repo. Log: data\polar\sync.log. Run once per machine
# (needs data\polar\credentials.json from `python tools\polar.py setup` and the ..\fitness-data clone).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$name = 'Fitness Assistant Polar sync'
$pythonw = Join-Path (Split-Path (Get-Command python).Source) 'pythonw.exe'
$action = New-ScheduledTaskAction -Execute $pythonw -WorkingDirectory $root -Argument '-X utf8 tools\polar.py sync'
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$logon.Delay = 'PT2M'
$daily = New-ScheduledTaskTrigger -Daily -At '12:00'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $logon, $daily -Settings $settings -Principal $principal -Force | Out-Null
"task '$name': at logon (+2 min) and daily 12:00 -> $pythonw"
