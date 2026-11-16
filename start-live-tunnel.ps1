# start-live-tunnel.ps1
# Runs Node.js backend server and Cloudflare Quick Tunnel in an external terminal

Write-Host "🦷 Starting WhatsApp Dental AI Receptionist..." -ForegroundColor Cyan

# 1. Start backend server in background if not running
$serverRunning = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
if (-not $serverRunning) {
    Write-Host "Starting node server/server.js on port 3001..." -ForegroundColor Yellow
    Start-Process -FilePath "node" -ArgumentList "server/server.js" -WindowStyle Hidden
    Start-Sleep -Seconds 2
} else {
    Write-Host "Port 3001 is already active!" -ForegroundColor Green
}

# 2. Run Cloudflare Quick Tunnel in this window
Write-Host "Launching Cloudflare Tunnel to port 3001..." -ForegroundColor Cyan
& ".\tools\cloudflared.exe" tunnel --url http://localhost:3001
