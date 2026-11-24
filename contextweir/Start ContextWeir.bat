@echo off
rem ContextWeir 0.6.0.0, built 25 Nov 2026. Part of the Wellspring tools.
rem Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
rem Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir
rem ContextWeir: starts the recorder (unless it is already running) and opens its window.
rem The recorder runs in its own console window. Quit in the panel closes it all; closing the
rem console window also stops it; closing only the panel window keeps it recording.
rem The window gets a free port each time ContextWeir starts; the launcher reads running.json
rem to open the right one.
cd /d "%~dp0"
where node >nul 2>nul || (echo ContextWeir needs Node.js: https://nodejs.org & pause & exit /b 1)

rem Already running? Then just open the window again.
set "URL="
for /f "usebackq delims=" %%u in (`node launch\where.js`) do set "URL=%%u"
if defined URL (
  echo ContextWeir is already running, so its window was only reopened.
  echo To restart it, use Restart in its window, or close its console window and start again.
  call launch\open-window.bat %URL%
  timeout /t 6 >nul
  exit /b
)

rem /c: the console closes when ContextWeir ends (Quit in its panel); if it stops
rem with an error, "pause" keeps the console open so the reason can be read.
start "ContextWeir" cmd /c "node contextweir.js || pause"
for /f "usebackq delims=" %%u in (`node launch\where.js --wait 15`) do set "URL=%%u"
if not defined URL (
  echo ContextWeir did not start. Its console window says why.
  pause
  exit /b 1
)
call launch\open-window.bat %URL%
