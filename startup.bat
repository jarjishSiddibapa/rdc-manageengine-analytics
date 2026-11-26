@echo off
REM Starts RDC ManageEngine SR Analytics (default http://localhost:7780).
REM First run installs what it needs and builds the screens; after that it just starts.
setlocal EnableExtensions
cd /d "%~dp0"
title RDC ManageEngine SR Analytics

REM ---- 1. Node.js and npm ----
where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js is not installed, or is not on the PATH.
  echo     Install the LTS version from https://nodejs.org , then double-click startup.bat again.
  goto :stopped
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [X] npm was not found. It normally installs together with Node.js - reinstall Node.js from https://nodejs.org
  goto :stopped
)
REM The tool that builds the screens needs 20.19+, 22.12+ or anything newer.
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)" >nul 2>&1
if errorlevel 1 (
  for /f %%v in ('node -v') do echo [X] Node.js %%v is too old. Install the current LTS version from https://nodejs.org
  goto :stopped
)

REM ---- 2. Settings file ----
if not exist "backend\.env" (
  if not exist "backend\.env.example" (
    echo [X] backend\.env is missing. Create it with your database and ManageEngine settings, then run this again.
    goto :stopped
  )
  copy "backend\.env.example" "backend\.env" >nul
  echo [!] First run: backend\.env did not exist, so it was created from the example and opened in Notepad.
  echo     Fill in the database password and the ManageEngine details ^(or replace the file with the one from
  echo     your other PC^), save it, then run startup.bat again.
  start "" notepad "backend\.env"
  goto :stopped
)

REM Read PORT, DB_HOST and DB_PORT from backend\.env (defaults if they are not set).
set "PORT=7780"
set "DB_HOST=localhost"
set "DB_PORT=3306"
for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /r "PORT= DB_HOST= DB_PORT=" "backend\.env"`) do (
  if /i "%%a"=="PORT" set "PORT=%%b"
  if /i "%%a"=="DB_HOST" set "DB_HOST=%%b"
  if /i "%%a"=="DB_PORT" set "DB_PORT=%%b"
)

REM ---- 3. Is it already running? ----
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [!] Port %PORT% is already in use - RDC ManageEngine SR Analytics is probably already running.
  echo     Open http://localhost:%PORT% in your browser. To start a fresh copy, close the other window first
  echo     ^(or set a different PORT in backend\.env^).
  goto :stopped
)

REM ---- 4. Server libraries (kept in backend\node_modules, Node's version of a virtual environment) ----
call :packages backend
if errorlevel 1 goto :failed

REM ---- 5. Screens: build when missing, or when the source is newer than the last build ----
set NEEDBUILD=0
if not exist "frontend\dist\index.html" set NEEDBUILD=1
if %NEEDBUILD%==0 if exist "frontend\src" (
  powershell -NoProfile -Command "$built=(Get-Item 'frontend\dist\index.html').LastWriteTime; $src=Get-ChildItem 'frontend\src','frontend\index.html','frontend\package.json','frontend\package-lock.json','frontend\vite.config.js' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($src -and $src.LastWriteTime -gt $built) { exit 1 } else { exit 0 }" >nul 2>&1
  if errorlevel 1 set NEEDBUILD=1
)
if %NEEDBUILD%==1 if exist "frontend\package.json" (
  call :packages frontend
  if errorlevel 1 goto :buildfailed
  echo Building the screens...
  call npm --prefix frontend run build
  if errorlevel 1 goto :buildfailed
)
goto :database

:buildfailed
if exist "frontend\dist\index.html" (
  echo.
  echo [!] The screens could not be rebuilt - starting with the previous build.
) else (
  goto :failed
)

REM ---- 6. Is MySQL reachable? ----
:database
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $r = $c.BeginConnect('%DB_HOST%', %DB_PORT%, $null, $null); if ($r.AsyncWaitHandle.WaitOne(3000) -and $c.Connected) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo.
  echo [X] MySQL is not reachable at %DB_HOST%:%DB_PORT%.
  echo     Start the MySQL service ^(Windows Services, "MySQL..."; or in an administrator window:  net start MySQL80 ^),
  echo     or check DB_HOST / DB_PORT in backend\.env. Then run this again.
  goto :stopped
)

REM ---- 7. Go ----
set NODE_ENV=production
echo.
echo RDC ManageEngine SR Analytics is starting on http://localhost:%PORT%
echo Sign in with the administrator account ^(see README.md^). Leave this window open while you use it. Close it, or press Ctrl+C, to stop.
echo.
node backend\server.js
if errorlevel 1 (
  echo.
  echo [X] The app stopped because of an error - see the message above.
  goto :stopped
)
echo.
echo RDC ManageEngine SR Analytics has stopped.
pause
exit /b 0

:failed
echo.
echo [X] Setup failed - see the messages above.
:stopped
echo.
pause
exit /b 1

REM ---- Libraries of one part (%1 = backend or frontend) ----
REM Installs what package-lock.json lists: on the first run, again after an update changed that list, and whenever a listed
REM library is missing. A copy of the list is kept inside node_modules to remember what was installed.
:packages
if not exist "%~1\node_modules" (
  echo Installing %~1 libraries ^(first run, needs internet^)...
  call npm --prefix %~1 ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
  goto :remember
)
call :complete %~1
if errorlevel 1 goto :update
fc /b "%~1\package-lock.json" "%~1\node_modules\.installed-lock.json" >nul 2>&1
if errorlevel 1 goto :update
exit /b 0

:update
echo Updating %~1 libraries ^(needs internet^)...
call npm --prefix %~1 install --no-save --no-audit --no-fund
if errorlevel 1 (
  call :complete %~1
  if errorlevel 1 exit /b 1
  echo [!] The %~1 libraries could not be updated - carrying on with the ones already installed.
  exit /b 0
)
:remember
copy /y "%~1\package-lock.json" "%~1\node_modules\.installed-lock.json" >nul
exit /b 0

REM Succeeds when every library named in package.json is present.
:complete
node -e "const p=require('./%~1/package.json'); process.exit(Object.keys({...p.dependencies,...p.devDependencies}).every(n=>require('fs').existsSync('%~1/node_modules/'+n+'/package.json'))?0:1)" >nul 2>&1
exit /b %errorlevel%
