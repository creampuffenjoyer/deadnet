@echo off
"E:\Code\deadnet\.tools\cloudflared.exe" tunnel --url http://localhost:8000 --no-autoupdate > "E:\Code\deadnet\.tunnel-logs\backend.log" 2>&1
