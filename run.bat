@echo off
cd /d "%~dp0"
if not exist out mkdir out
powershell -NoProfile -Command "$enaySources = @(Get-ChildItem -LiteralPath src -Recurse -Filter *.java | Where-Object { $_.FullName -notmatch '[\\/]desktop[\\/]' } | ForEach-Object FullName); & javac -encoding UTF-8 -d out $enaySources; exit $LASTEXITCODE"
if errorlevel 1 (
    echo E-Nay compilation failed. Check JDK 17 or later.
    pause
    exit /b 1
)
java -cp out enay.Main
if errorlevel 1 pause
