@echo off
"E:\Code\deadnet\.tools\cloudflared.exe" tunnel --url http://localhost:5173 --no-autoupdate > "E:\Code\deadnet\.tunnel-logs\frontend.log" 2>&1
