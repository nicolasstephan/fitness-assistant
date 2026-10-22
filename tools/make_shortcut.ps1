# Creates (or refreshes) the "Fitness Assistant" desktop shortcut: the live site in Firefox (where the
# app's sync settings live; they are per browser), with the hub icon (FA-60, black mark + thin white outline).
# Without Firefox it opens in the default browser. Re-run after moving the project folder.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$url = "https://nicolasstephan.github.io/fitness-assistant/"
$icon = Join-Path $root "icons\fitness-assistant.ico"

$firefox = @(
    "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
    "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe",
    "$env:LOCALAPPDATA\Mozilla Firefox\firefox.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Fitness Assistant.lnk"
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
if ($firefox) {
    $s.TargetPath = $firefox
    $s.Arguments = "--new-window $url"
} else {
    $s.TargetPath = $url
    $s.Arguments = ""
}
$s.IconLocation = $icon
$s.Description = "Fitness Assistant: training, muscles and health data"
$s.Save()
Write-Host "Shortcut created: $lnk" -ForegroundColor Green
