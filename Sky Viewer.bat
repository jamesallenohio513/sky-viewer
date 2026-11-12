@echo off
rem Opens Sky Viewer in its own app window (Microsoft Edge app mode). No server or internet needed.
setlocal
set "APPDIR=%~dp0"
set "URL=file:///%APPDIR:\=/%index.html"
start "" msedge --app="%URL%" --window-size=1400,900
