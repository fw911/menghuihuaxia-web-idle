@echo off
cd /d "%~dp0"
echo 正在启动《梦回华夏》挂机版后端（端口 8014）...
where node >nul 2>nul && (node server\server.js) || ("C:/Program Files/nodejs/node.exe" server\server.js)
pause
