@echo off
"E:\Code\deadnet\.tools\cloudflared.exe" tunnel --url http://localhost:8000 --no-autoupdate > "E:\Code\deadnet\.tunnel-logs\url-test2.log" 2>&1
