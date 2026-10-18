# Windows launcher. JDK 17+ is required; Maven and Python are not required.
[CmdletBinding()]
param(
    [switch]$BuildOnly,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$AppArguments = @()
)

$ErrorActionPreference = 'Stop'
$enayRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$enayVersion = '17.0.18'
# These SHA-256 values were calculated from Maven Central artifacts after checking
# the release's published SHA-1 values. No unpinned executable downloads are used.
$enayHashes = @{
    base = 'f26427652e64520b150161f350cab6b72adedbfd42462bebf82abff6f075d4e3'
    graphics = 'feb3e1db587ea314658bf21f4da29e2f2f48072614d27b06d97afadabe5ac23d'
    controls = '04c1f3ff98ec1d4d955097e6ac2346247d7b95a7b7fe6bca4da0fa950e744d3b'
}

function Find-EnayJavaTool([string]$Name) {
    if ($env:JAVA_HOME) {
        $enayCandidate = Join-Path $env:JAVA_HOME "bin/$Name.exe"
        if (Test-Path -LiteralPath $enayCandidate -PathType Leaf) { return $enayCandidate }
    }
    $enayCommand = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
    if (-not $enayCommand) { throw 'Install a 64-bit JDK 17 or later, then make java and javac available on PATH (or set JAVA_HOME).' }
    return $enayCommand.Source
}

function Get-EnayFileHash([string]$Path) {
    # Use the framework directly; some Windows PowerShell hosts do not autoload Get-FileHash.
    $enayStream = [System.IO.File]::OpenRead($Path)
    $enayHasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [System.BitConverter]::ToString($enayHasher.ComputeHash($enayStream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $enayHasher.Dispose()
        $enayStream.Dispose()
    }
}

function Get-EnayJavaProperties([string]$JavaTool) {
    # java writes its properties to stderr; capture them without treating them as
    # PowerShell errors (including on Windows PowerShell 5.1).
    $enayStart = New-Object System.Diagnostics.ProcessStartInfo
    $enayStart.FileName = $JavaTool
    $enayStart.Arguments = '-XshowSettings:properties -version'
    $enayStart.UseShellExecute = $false
    $enayStart.RedirectStandardOutput = $true
    $enayStart.RedirectStandardError = $true
    $enayStart.CreateNoWindow = $true
    $enayProcess = [System.Diagnostics.Process]::Start($enayStart)
    $enayOutput = $enayProcess.StandardOutput.ReadToEnd()
    $enayOutput += $enayProcess.StandardError.ReadToEnd()
    $enayProcess.WaitForExit()
    if ($enayProcess.ExitCode -ne 0) { throw "Could not inspect Java: $enayOutput" }
    $enayProcess.Dispose()
    return $enayOutput
}

Push-Location $enayRoot
try {
    if ($env:OS -ne 'Windows_NT') { throw 'On Linux or macOS, use sh scripts/desktop.sh.' }
    $enayJava = Find-EnayJavaTool 'java'
    $enayJavac = Find-EnayJavaTool 'javac'
    $enayProperties = Get-EnayJavaProperties $enayJava
    if ($enayProperties -notmatch 'java\.specification\.version\s*=\s*(\d+)') { throw 'Could not identify the Java version.' }
    if ([int]$Matches[1] -lt 17) { throw 'E-Nay desktop requires JDK 17 or later.' }
    if ($enayProperties -notmatch 'os\.arch\s*=\s*(amd64|x86_64)\b') { throw 'This Windows launcher requires a 64-bit x86 JDK. Windows ARM users can run it with an x64 JDK.' }

    $enayCache = Join-Path $enayRoot ".javafx/$enayVersion/win"
    $enayBuild = Join-Path $enayRoot 'out-desktop'
    New-Item -ItemType Directory -Path $enayCache -Force | Out-Null
    New-Item -ItemType Directory -Path $enayBuild -Force | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    foreach ($enayModule in @('base', 'graphics', 'controls')) {
        $enayFileName = "javafx-$enayModule-$enayVersion-win.jar"
        $enayJar = Join-Path $enayCache $enayFileName
        $enayExpected = $enayHashes[$enayModule]
        $enayValid = (Test-Path -LiteralPath $enayJar -PathType Leaf) -and ((Get-EnayFileHash $enayJar) -eq $enayExpected)
        if (-not $enayValid) {
            $enayUrl = "https://repo.maven.apache.org/maven2/org/openjfx/javafx-$enayModule/$enayVersion/$enayFileName"
            $enayIncoming = "$enayJar.download.$PID"
            Write-Host "Setting up JavaFX $enayVersion ($enayModule)..."
            try {
                Invoke-WebRequest -UseBasicParsing -Uri $enayUrl -OutFile $enayIncoming -TimeoutSec 120
                if ((Get-EnayFileHash $enayIncoming) -ne $enayExpected) { throw "Checksum verification failed: $enayFileName" }
                Move-Item -LiteralPath $enayIncoming -Destination $enayJar -Force
            } finally {
                if (Test-Path -LiteralPath $enayIncoming -PathType Leaf) { Remove-Item -LiteralPath $enayIncoming -Force }
            }
        }
    }

    Write-Host 'Compiling E-Nay desktop...'
    $enaySources = @(Get-ChildItem -LiteralPath (Join-Path $enayRoot 'src') -Recurse -Filter '*.java' | Sort-Object FullName | ForEach-Object FullName)
    if ($enaySources.Count -eq 0) { throw 'No Java source files found in src/.' }
    & $enayJavac --release 17 -encoding UTF-8 --module-path $enayCache --add-modules javafx.controls -d $enayBuild $enaySources
    if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed. See the compiler messages above.' }
    foreach ($enayResource in @(Get-ChildItem -LiteralPath (Join-Path $enayRoot 'src') -Recurse -Filter '*.css')) {
        $enayRelative = $enayResource.FullName.Substring((Join-Path $enayRoot 'src').Length + 1)
        $enayDestination = Join-Path $enayBuild $enayRelative
        New-Item -ItemType Directory -Path (Split-Path -Parent $enayDestination) -Force | Out-Null
        Copy-Item -LiteralPath $enayResource.FullName -Destination $enayDestination -Force
    }
    if ($BuildOnly) {
        Write-Host "Desktop build ready: $enayBuild"
    } else {
        & $enayJava --module-path $enayCache --add-modules javafx.controls -cp $enayBuild enay.desktop.DesktopLauncher @AppArguments
        if ($LASTEXITCODE -ne 0) { throw "E-Nay desktop exited with code $LASTEXITCODE." }
    }
} catch {
    Write-Host "E-Nay: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
