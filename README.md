# E-Nay

E-Nay is an offline Java application for managing maternal and child health records in rural communities. The project supports SDG 3 (Good Health and Well-being) and SDG 10 (Reduced Inequalities).

## Run

Install **JDK 17 or later** and make `java` and `javac` available on PATH. No external Java libraries are needed.

On Windows, double-click `run.bat`, or open PowerShell in this folder and run:

```powershell
New-Item -ItemType Directory -Force out | Out-Null
$sources = @(Get-ChildItem src -Recurse -Filter *.java | ForEach-Object FullName)
javac -encoding UTF-8 -d out $sources
java -cp out enay.Main
```

On Linux/macOS:

```sh
mkdir -p out
find src -name '*.java' > /tmp/enay-sources.txt
javac -encoding UTF-8 -d out @/tmp/enay-sources.txt
java -cp out enay.Main
```

Launch from the project root. The first run starts with no records. Options 1–2 add records, 3–4 display them, 5 saves, 6 reloads, and 7 exits. There are no login credentials. Save before closing the application; closing the terminal does not save automatically.

## MVC structure

```text
src/enay/
  Main.java                         Application startup and process lock
  model/                            MaternalProfile and ChildProfile
  view/                             RecordView interface and ConsoleView
  controller/                       RecordController
  repository/                       RecordRepository and FileRecordRepository
  validation/                       Shared ValidationUtils
  exception/                        InvalidRecordException
tests/                              Validation, recovery, and console scenarios
docs/                               Architecture and documentation
data/                               Local records (excluded from Git)
```

The **model** encapsulates record fields and validation. The **view** owns prompts and presentation. The **controller** coordinates user actions through `RecordView` and `RecordRepository`. The repository owns in-memory collections and file persistence and returns diagnostic messages for the controller to pass to the view. `Main` creates and connects these objects.

The current interface is a console. A future Swing implementation can use the view interface without putting file operations inside GUI event handlers. No Swing UI or background worker is implemented yet.

Read [the architecture guide](docs/ARCHITECTURE.md) and [the team workflow](CONTRIBUTING.md) before changing shared interfaces.

## Record rules

- Maternal IDs: `M` plus exactly three digits; child IDs: `C` plus exactly three digits. IDs are normalized to uppercase and must be unique within their record type.
- Maternal age: integer from 12 through 60, inclusive.
- Names: Unicode letters and attached accents, spaces, hyphens, apostrophes, and periods. Preserve entered capitalization and normalize whitespace. Digits, pipes, and line breaks are rejected.
- Dates: real `YYYY-MM-DD` dates, year 0001 or later. A new delivery date must be today or later. A new child's birth date must be within the last two years, inclusive, and cannot be future.
- Historical records remain loadable after their delivery date passes or the child ages beyond the new-registration window.
- Status: `Active` / `Inactive`; gender: `Male` / `Female`, accepted without case.
- Capacity: 100 maternal and 100 child records.

## Local storage

UTF-8 text files hold one pipe-delimited record per line:

```text
maternal_records.txt: profileId|motherName|age|expectedDeliveryDate|status
child_records.txt:   childId|childName|gender|dateOfBirth|motherName|status
```

`data/system_data.dat` holds two four-byte Java integers: maternal count, then child count. Text rows determine actual loaded counts. The data-folder lock prevents simultaneous E-Nay processes from using the same folder. Fingerprints detect external text-file changes before saving. Save All stages all files before replacement and attempts rollback on ordinary I/O failure. Multi-file saves are not guaranteed atomic across process termination or power loss.

Missing files preserve current memory. Malformed rows are reported and skipped; a permitted later save writes accepted rows only. Unreadable, entirely malformed, or over-capacity files block saving. Reload deliberately after repairing files or accepting external changes. Keep backups of important records.

Live records, `.enay.lock`, temporary files, and backups are excluded by `.gitignore`. The repository contains no patient data.

## Verify

With Python 3 and JDK 17+:

```sh
python tests/run_tests.py
```

Tests create disposable directories. They cover field normalization, boundaries, historical records, malformed files, save rollback, unsaved-change prompts, concurrent process locking, external modifications, and a save/reload across separate JVMs. See [TEST_RESULTS.txt](TEST_RESULTS.txt) for the recorded run.
