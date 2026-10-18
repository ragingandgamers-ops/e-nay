# E-Nay desktop

The desktop interface uses JavaFX 17.0.18 and the same record models, validation,
and file repository as the console application. Records stay in the project's
`data/` directory. A shared data-folder lock prevents the console and desktop
interfaces from writing to the same folder at the same time.

## Start on Windows

1. Install a **64-bit JDK 17 or later**. Both `java` and `javac` must be available
   on `PATH`, or `JAVA_HOME` must point to that JDK.
2. Extract the project into a folder you can write to.
3. Double-click **`run-desktop.bat`**.

The first start downloads three JavaFX libraries from Maven Central over HTTPS
and verifies their pinned SHA-256 checksums. This requires an internet connection.
Later starts reuse the verified cache and work offline. No Maven or Python
installation is needed to launch the application.

In PowerShell you can build without opening a window:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/desktop.ps1 -BuildOnly
```

The launcher's execution-policy setting applies only to that PowerShell process.
It does not change the computer's saved PowerShell policy. Windows ARM machines
need an x64 JDK to use these Windows JavaFX libraries.

## Start on Linux or macOS

Install JDK 17+, then run from the project folder:

```sh
sh scripts/desktop.sh
```

The first setup also needs `curl` and either `sha256sum` or `shasum`. The launcher
supports Linux x64 and macOS x64/ARM64, choosing libraries for the JDK's architecture.
Linux needs a graphical desktop with GTK 3 libraries. An SSH or CI session needs
a display server such as Xvfb.

To compile only:

```sh
sh scripts/desktop.sh --build-only
```

## Build outputs and dependencies

- `out-desktop/`: compiled Java classes and CSS copied from `src/`.
- `.javafx/17.0.18/<platform>/`: verified JavaFX `base`, `graphics`, and `controls`
  JAR files; `<platform>` is `win`, `linux`, `mac`, or `mac-aarch64`.
- `data/`: local records; keep this folder when updating the application.

Builds and dependency caches are excluded from Git. The launchers recompile from
source before starting; if compilation fails they stop and show the error. An
incomplete download is never used as a dependency. A corrupt cache is downloaded
again and must pass verification before use.

An optional Maven configuration is included for IDE import and developers who
already have Maven:

```sh
mvn compile
mvn javafx:run
```

Run Maven from the project root so both interfaces share `data/`. Maven resolves
its own dependency cache and does not use `.javafx/`. `mvn compile` does not run
the project's standalone regression suites; use the test commands below.

## Verification

Core model, persistence, and console checks need Python 3 and JDK 17+:

```sh
python tests/run_tests.py
```

Desktop checks use the compiled UI and JavaFX modules. On Windows, after building:

```powershell
python tests/run_desktop_tests.py --module-path .javafx/17.0.18/win
```

For Linux CI with Xvfb:

```sh
sh scripts/desktop.sh --build-only
xvfb-run -a python tests/run_desktop_tests.py --module-path .javafx/17.0.18/linux
```

The tests use disposable data folders. Do not use real patient records for
demonstrations or screenshots. The console remains available through `run.bat`;
it does not require JavaFX.

## Dependency references

JavaFX usage follows the [OpenJFX setup guide](https://openjfx.io/openjfx-docs/).
The pinned [JavaFX 17.0.18 release artifacts](https://repo.maven.apache.org/maven2/org/openjfx/javafx-controls/17.0.18/)
and [JavaFX Maven plugin 0.0.8](https://repo.maven.apache.org/maven2/org/openjfx/javafx-maven-plugin/0.0.8/)
are published on Maven Central. This release publishes SHA-1 checksums; the
launchers embed SHA-256 hashes calculated after checking those official values.
