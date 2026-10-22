# Creates (or refreshes) the "Fitness Assistant" desktop shortcut: the live site in its own app window
# (Chrome or Edge --app, no tabs or address bar), with the hub icon (FA-60, black mark + thin white outline).
# Re-run after moving the project folder.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$url = "https://nicolasstephan.github.io/fitness-assistant/"
$icon = Join-Path $root "icons\fitness-assistant.ico"

$browser = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Fitness Assistant.lnk"
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
if ($browser) {
    $s.TargetPath = $browser
    $s.Arguments = "--app=$url"
} else {
    $s.TargetPath = $url   # no Chrome/Edge: opens in the default browser
}
$s.IconLocation = $icon
$s.Description = "Fitness Assistant: training, muscles and health data"
$s.Save()
Write-Host "Shortcut created: $lnk" -ForegroundColor Green
