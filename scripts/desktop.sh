#!/bin/sh
# JDK 17+, curl, and shasum or sha256sum are required; Maven/Python are not.
set -eu
enay_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$enay_root"
enay_version=17.0.18
enay_build_only=false
if [ "${1:-}" = '--build-only' ]; then
    enay_build_only=true
    shift
fi
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
    enay_java="$JAVA_HOME/bin/java"
    enay_javac="$JAVA_HOME/bin/javac"
else
    enay_java=$(command -v java) || { printf '%s\n' 'Install JDK 17+ and add java and javac to PATH.' >&2; exit 1; }
    enay_javac=$(command -v javac) || { printf '%s\n' 'Install JDK 17+ and add java and javac to PATH.' >&2; exit 1; }
fi
enay_properties=$("$enay_java" -XshowSettings:properties -version 2>&1)
enay_java_version=$(printf '%s\n' "$enay_properties" | sed -n 's/^[[:space:]]*java.specification.version = //p')
case "$enay_java_version" in
    ''|*[!0-9]*) printf '%s\n' 'E-Nay desktop requires JDK 17 or later.' >&2; exit 1 ;;
esac
if [ "$enay_java_version" -lt 17 ]; then
    printf '%s\n' 'E-Nay desktop requires JDK 17 or later.' >&2
    exit 1
fi
enay_arch=$(printf '%s\n' "$enay_properties" | sed -n 's/^[[:space:]]*os.arch = //p')
case "$(uname -s):$enay_arch" in
    Linux:amd64|Linux:x86_64) enay_platform=linux ;;
    Darwin:amd64|Darwin:x86_64) enay_platform=mac ;;
    Darwin:aarch64|Darwin:arm64) enay_platform=mac-aarch64 ;;
    *) printf '%s\n' 'Supported: Linux x64, macOS x64/ARM64, or Windows x64 using run-desktop.bat.' >&2; exit 1 ;;
esac

# SHA-256 values pinned after verifying Maven Central's published SHA-1 hashes.
enay_expected_hash() {
    case "$enay_platform:$1" in
        linux:base) printf '%s' '453971fe39ac42066f40a74dfbfaa8e90960d006b7d9038cffccd4d47e52ad4e' ;;
        linux:graphics) printf '%s' '16f3d3633dc8b34133a178e9e81cad1c8d2f87ebb2eb121a0ac3dfdbc0ed130a' ;;
        linux:controls) printf '%s' 'ef40df4ea4f3666d9a913ccf8694967939d7522f57faf44d007e49157577eb4f' ;;
        mac:base) printf '%s' '0eb9792c6baa8145b62522cf92e74798dbbdf001caf246fdd82a9bbe9209e417' ;;
        mac:graphics) printf '%s' '3a5262eb547951378c6691b31eedb1fa57c967243ffcc4983ba6bde1dddba4aa' ;;
        mac:controls) printf '%s' '63906d48633534487db2ab1fc5d902abee8934872e20bd2426d26d8afb30248e' ;;
        mac-aarch64:base) printf '%s' '77404f253bd3b8338830dbfa58de184aae0630fb0bb98d5079803d14bb078d0d' ;;
        mac-aarch64:graphics) printf '%s' 'b1259fb946360e20010a17b96df6f2ebe6ee185ade5e8f9f99bdbd85b3031687' ;;
        mac-aarch64:controls) printf '%s' 'b31a227fd4745f3e461524072c97a1c6d540450645af00afad61573e12a7b1cf' ;;
        *) return 1 ;;
    esac
}
enay_hash_file() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        printf '%s\n' 'Install sha256sum or shasum to verify JavaFX dependencies.' >&2
        return 1
    fi
}
enay_cache="$enay_root/.javafx/$enay_version/$enay_platform"
enay_build="$enay_root/out-desktop"
mkdir -p "$enay_cache" "$enay_build"
enay_incoming=''
trap 'if [ -n "$enay_incoming" ]; then rm -f -- "$enay_incoming"; fi' EXIT HUP INT TERM
for enay_module in base graphics controls; do
    enay_file="javafx-$enay_module-$enay_version-$enay_platform.jar"
    enay_jar="$enay_cache/$enay_file"
    enay_expected=$(enay_expected_hash "$enay_module")
    if [ ! -f "$enay_jar" ] || [ "$(enay_hash_file "$enay_jar")" != "$enay_expected" ]; then
        command -v curl >/dev/null 2>&1 || { printf '%s\n' 'Install curl for the first JavaFX setup.' >&2; exit 1; }
        enay_url="https://repo.maven.apache.org/maven2/org/openjfx/javafx-$enay_module/$enay_version/$enay_file"
        enay_incoming="$enay_jar.download.$$"
        printf 'Setting up JavaFX %s (%s)...\n' "$enay_version" "$enay_module"
        curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 120 "$enay_url" -o "$enay_incoming"
        if [ "$(enay_hash_file "$enay_incoming")" != "$enay_expected" ]; then
            printf 'Checksum verification failed: %s\n' "$enay_file" >&2
            exit 1
        fi
        mv -f -- "$enay_incoming" "$enay_jar"
        enay_incoming=''
    fi
done
printf '%s\n' 'Compiling E-Nay desktop...'
# Relative quoted paths keep javac's argument file safe when the project folder
# contains spaces. The script always compiles from the project root.
find src -type f -name '*.java' -print | LC_ALL=C sort | sed 's/.*/"&"/' > "$enay_build/sources.txt"
"$enay_javac" --release 17 -encoding UTF-8 --module-path "$enay_cache" --add-modules javafx.controls -d "$enay_build" "@$enay_build/sources.txt"
find src -type f -name '*.css' -print | while IFS= read -r enay_resource; do
    enay_relative=${enay_resource#src/}
    mkdir -p "$(dirname -- "$enay_build/$enay_relative")"
    cp "$enay_resource" "$enay_build/$enay_relative"
done
if [ "$enay_build_only" = true ]; then
    printf 'Desktop build ready: %s\n' "$enay_build"
else
    "$enay_java" --module-path "$enay_cache" --add-modules javafx.controls -cp "$enay_build" enay.desktop.DesktopLauncher "$@"
fi
