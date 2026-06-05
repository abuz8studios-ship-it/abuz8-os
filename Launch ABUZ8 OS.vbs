' ABUZ8 OS — windowless launcher (no terminal). Double-click to open the app.
' Runs the de-faked OS in its own Electron window via the bundled electron binary.
Set sh = CreateObject("WScript.Shell")
appDir = "E:\ABU\ABUZ8_OS_DIST\electron"
elec   = appDir & "\node_modules\electron\dist\electron.exe"
sh.CurrentDirectory = appDir
' window style 0 = no console window; the Electron BrowserWindow shows itself
sh.Run """" & elec & """ """ & appDir & """", 0, False
