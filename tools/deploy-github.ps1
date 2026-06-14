# deploy-github.ps1 — authorizes the official GitHub CLI and pushes the repo.
# everything here is the standard gh device-auth flow. nothing exotic.
$ErrorActionPreference = 'Stop'
Set-Location "A:\Bois chat"

Write-Host ""
Write-Host "=== LOCKED IN -> GITHUB ===" -ForegroundColor Green
Write-Host "1) press Enter when asked - your browser opens github.com/login/device"
Write-Host "2) the one-time code is already copied to your clipboard - paste it, click Authorize"
Write-Host "3) come back here; the rest is automatic"
Write-Host ""

gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git

Write-Host ""
Write-Host "creating repo + pushing..." -ForegroundColor Green
gh repo create lockedin --public --source . --remote origin --push
gh repo view lockedin --json url -q .url | Out-File -FilePath "A:\Bois chat\data\repo-url.txt" -Encoding ascii

Write-Host ""
Write-Host "DONE - repo is on github. you can close this window." -ForegroundColor Green
