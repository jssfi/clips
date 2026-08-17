@echo off
setlocal
set "ROOT=%~dp0.."
set "SDK=%ROOT%\vendor\obs-sdk"
set "OBS=%ROOT%\vendor\obs-studio"
set "LIBOBS=%ROOT%\vendor\libobs"
set "DEV=%ROOT%\vendor\capture-host\dev"
set "OUT=%ROOT%\vendor\capture-host"

if not exist "%SDK%\libobs\obs.h" (
  git clone --depth 1 --branch 31.1.2 https://github.com/obsproject/obs-studio.git "%SDK%"
  if errorlevel 1 exit /b 1
)
if not exist "%OBS%\bin\64bit\obs.dll" (
  echo OBS runtime is missing. Run npm run stage:obs first.
  exit /b 1
)
if not exist "%LIBOBS%\bin\64bit\obs.dll" (
  echo Private libobs runtime is missing. Run npm run stage:libobs first.
  exit /b 1
)

if not exist "%DEV%" mkdir "%DEV%"
if not exist "%OUT%" mkdir "%OUT%"

set "VSDEVCMD="
for %%E in (BuildTools Enterprise Professional Community) do if not defined VSDEVCMD if exist "C:\Program Files\Microsoft Visual Studio\2022\%%E\Common7\Tools\VsDevCmd.bat" set "VSDEVCMD=C:\Program Files\Microsoft Visual Studio\2022\%%E\Common7\Tools\VsDevCmd.bat"
if not defined VSDEVCMD if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if not defined VSDEVCMD (
  echo Visual Studio 2022 C++ build tools were not found.
  exit /b 1
)
call "%VSDEVCMD%" -arch=x64 >nul
if errorlevel 1 exit /b 1

dumpbin /exports "%OBS%\bin\64bit\obs.dll" > "%DEV%\obs-exports.txt"
if errorlevel 1 exit /b 1
powershell -NoProfile -Command "$lines = Get-Content '%DEV%\obs-exports.txt'; @('LIBRARY obs.dll','EXPORTS') | Set-Content '%DEV%\obs.def'; $lines | ForEach-Object { if ($_ -match '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+([A-Za-z_][A-Za-z0-9_]*)') { $matches[1] } } | Add-Content '%DEV%\obs.def'"
if errorlevel 1 exit /b 1
lib /nologo /def:"%DEV%\obs.def" /out:"%DEV%\obs.lib" /machine:x64
if errorlevel 1 exit /b 1

cl /nologo /EHsc /std:c++17 /O2 /utf-8 ^
  /Fo"%DEV%\capture-host.obj" ^
  /I"%ROOT%\native\obs-sdk-config" ^
  /I"%SDK%\libobs" ^
  "%ROOT%\native\capture-host.cpp" ^
  /link /SUBSYSTEM:WINDOWS /OUT:"%OUT%\clips-capture-host.exe" ^
  "%DEV%\obs.lib" user32.lib shell32.lib ole32.lib dxgi.lib
if errorlevel 1 exit /b 1
copy /y "%OUT%\clips-capture-host.exe" "%LIBOBS%\bin\64bit\clips-capture-host.exe" >nul
if errorlevel 1 exit /b 1

echo Native libobs capture host built successfully.
