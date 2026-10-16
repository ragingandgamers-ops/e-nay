@echo off
cd /d "%~dp0"
if not exist out mkdir out
(for /r src %%f in (*.java) do @echo "%%f") > out\sources.txt
javac -encoding UTF-8 -d out @out\sources.txt
if errorlevel 1 (
    echo E-Nay compilation failed. Check JDK 17 or later.
    pause
    exit /b 1
)
java -cp out enay.Main
if errorlevel 1 pause
