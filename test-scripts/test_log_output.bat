@echo off
echo [INFO] Batch test script started
echo [INFO] PID: %RANDOM%
echo [INFO] Outputting test logs every 2 seconds...
echo.

:loop
echo [INFO] %time% - Server processing request
echo [DEBUG] %time% - Cache hit ratio: 85%%
echo [WARN] %time% - High memory usage detected
echo [ERROR] %time% - Connection timeout to upstream
echo [INFO] %time% - Request completed successfully
timeout /t 3 /nobreak >nul
goto loop
