$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    New-Item -ItemType Directory -Force out | Out-Null
    $enaySources = @(Get-ChildItem -LiteralPath src -Recurse -Filter *.java | Where-Object { $_.FullName -notmatch '[\\/]desktop[\\/]' } | ForEach-Object FullName)
    & javac -encoding UTF-8 -d out $enaySources
    if ($LASTEXITCODE -ne 0) { throw 'E-Nay compilation failed. Check JDK 17 or later.' }
    & java -cp out enay.Main
    if ($LASTEXITCODE -ne 0) { throw 'E-Nay exited with an error.' }
} finally { Pop-Location }
