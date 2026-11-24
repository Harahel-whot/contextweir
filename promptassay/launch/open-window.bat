@echo off
rem PromptAssay 0.4.0.0, built 25 Nov 2026. Part of the Wellspring tools.
rem Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
rem Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir
rem Opens %1 (a 127.0.0.1 address) in your default browser.
rem If the default browser can show an app-style window (no tabs, no address bar), it does:
rem Chrome, Edge, Brave, Vivaldi and Chromium can. Any other browser (Firefox, for example)
rem gets a normal tab instead.
setlocal
set "URL=%~1/?fit"

rem Which browser is the default? Windows keeps its choice for web links in the registry.
set "PROGID="
for %%k in (UserChoiceLatest UserChoice) do if not defined PROGID (
  for /f "tokens=3" %%a in ('reg query "HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\%%k" /v ProgId 2^>nul ^| find "ProgId"') do set "PROGID=%%a"
)
if not defined PROGID goto plain

rem The program that choice runs, e.g. "C:\Program Files\Google\Chrome\Application\chrome.exe"
set "CMD="
for /f "tokens=2,*" %%a in ('reg query "HKCR\%PROGID%\shell\open\command" /ve 2^>nul ^| find "REG_"') do set "CMD=%%b"
if not defined CMD goto plain
set "EXE="
for %%x in (%CMD%) do if not defined EXE set "EXE=%%~x"
if not exist "%EXE%" goto plain

for %%n in ("%EXE%") do set "NAME=%%~nxn"
for %%b in (chrome.exe msedge.exe brave.exe vivaldi.exe chromium.exe) do (
  if /i "%NAME%"=="%%b" (
    start "" "%EXE%" --app=%URL% --window-size=1400,900
    exit /b
  )
)

:plain
start "" "%URL%"
