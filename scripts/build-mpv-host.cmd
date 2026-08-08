@echo off
setlocal
set "ROOT=%~dp0.."
set "DEV=%ROOT%\vendor\libmpv\dev"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 >nul
if errorlevel 1 exit /b 1
dumpbin /exports "%DEV%\libmpv-2.dll" | findstr " mpv_" > "%DEV%\exports.txt"
powershell -NoProfile -Command "$lines = Get-Content '%DEV%\exports.txt'; @('LIBRARY libmpv-2.dll','EXPORTS') | Set-Content '%DEV%\mpv.def'; $lines | ForEach-Object { if ($_ -match ' (mpv_[A-Za-z0-9_]+)$') { $matches[1] } } | Add-Content '%DEV%\mpv.def'"
if errorlevel 1 exit /b 1
lib /nologo /def:"%DEV%\mpv.def" /out:"%DEV%\mpv.lib" /machine:x64
if errorlevel 1 exit /b 1
cl /nologo /EHsc /std:c++17 /O2 /I"%DEV%\include" "%ROOT%\native\mpv-host.cpp" /link /SUBSYSTEM:WINDOWS /OUT:"%ROOT%\vendor\libmpv\mpv-host.exe" "%DEV%\mpv.lib" user32.lib shell32.lib
if errorlevel 1 exit /b 1
copy /y "%DEV%\libmpv-2.dll" "%ROOT%\vendor\libmpv\libmpv-2.dll" >nul
echo Native libmpv host built successfully.
