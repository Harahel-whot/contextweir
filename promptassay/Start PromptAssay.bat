@echo off
rem PromptAssay 0.4.0.0, built 25 Nov 2026. Part of the Wellspring tools.
rem Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
rem Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir
rem PromptAssay: starts the reader (unless it is already running) and opens its window.
rem It runs in a small minimised console window; close that window to stop it.
rem The window gets a free port each time PromptAssay starts; the launcher reads running.json
rem to open the right one.
cd /d "%~dp0"
where node >nul 2>nul || (echo PromptAssay needs Node.js: https://nodejs.org & pause & exit /b 1)

rem Already running? Then just open the window again.
set "URL="
for /f "usebackq delims=" %%u in (`node launch\where.js`) do set "URL=%%u"
if defined URL (
  echo PromptAssay is already running, so its window was only reopened.
  echo To restart it, close its console window and start again.
  call launch\open-window.bat %URL%
  timeout /t 6 >nul
  exit /b
)

start "PromptAssay" /min cmd /c "node promptassay.js || pause"
for /f "usebackq delims=" %%u in (`node launch\where.js --wait 15`) do set "URL=%%u"
if not defined URL (
  echo PromptAssay did not start. Its console window says why.
  pause
  exit /b 1
)
call launch\open-window.bat %URL%
