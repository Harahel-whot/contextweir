@echo off
rem ContextWeir 0.5.6.0 and PromptAssay 0.4.0.0, built 25 Nov 2026. Part of the Wellspring tools.
rem Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
rem Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir
rem Makes "ContextWeir" and "PromptAssay" shortcuts, with their icons, in this folder,
rem and on your desktop if you say yes. Run it again if you move the tools folder.
rem It only creates shortcut files; it changes nothing else.
rem Folder paths reach PowerShell through environment variables, never pasted into
rem the command itself, so an unusual folder name cannot change what the command does.
cd /d "%~dp0"
set "CW_TOOLS_ROOT=%~dp0"
set "CW_TOOLS_DEST=%~dp0"
call :make
choice /m "Also put the two shortcuts on your desktop"
if errorlevel 2 goto done
set "CW_TOOLS_DEST=DESKTOP"
call :make
:done
echo.
echo Done. Double-click the ContextWeir or PromptAssay shortcut to start a tool.
pause
exit /b

:make
powershell -NoProfile -Command "$root = $env:CW_TOOLS_ROOT; $dest = $env:CW_TOOLS_DEST; if ($dest -eq 'DESKTOP') { $dest = [Environment]::GetFolderPath('Desktop') }; $w = New-Object -ComObject WScript.Shell; foreach ($t in @(@('ContextWeir','contextweir'), @('PromptAssay','promptassay'))) { $s = $w.CreateShortcut((Join-Path $dest ($t[0] + '.lnk'))); $s.TargetPath = Join-Path $root ($t[1] + '\Start ' + $t[0] + '.bat'); $s.WorkingDirectory = Join-Path $root $t[1]; $s.IconLocation = (Join-Path $root ($t[1] + '\icon\' + $t[1] + '.ico')) + ',0'; $s.Description = 'Start ' + $t[0]; $s.WindowStyle = 7; $s.Save() }"
exit /b
