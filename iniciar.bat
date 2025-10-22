@echo off
REM =============================
REM start_all_one_window.bat
REM Corre backend y frontend en la misma consola
REM =============================

cd /d "%~dp0"

echo.
echo ================================
echo  Iniciando Transcriber + Frontend
echo ================================
echo.

REM --- Cargar variables del .env si existe ---
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if not "%%a"=="" (
      set %%a=%%b
    )
  )
)

REM --- Instala dependencias si no existe node_modules ---
if not exist "node_modules" (
  echo Instalando dependencias...
  npm install
)

REM --- Ejecutar backend y frontend al tiempo ---
REM El truco es usar `start /b` para lanzar en background y mantener todo en la misma consola

echo Iniciando backend en http://localhost:3001 ...
start /b cmd /c "npm start"

echo Iniciando frontend en http://localhost:8080 ...
npx http-server -p 8080 -c-1 .

pause
