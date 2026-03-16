@echo off
cd /d D:\jobber-perfect\backend
set API_PORT=3000
:loop
npx ts-node src/scripts/websocket-collector.ts
echo Collector crashed or stopped, restarting in 15s...
timeout /t 15
goto loop
