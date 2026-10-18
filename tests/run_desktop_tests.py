"""Exercise real JavaFX scenes against disposable records; needs a desktop or Xvfb."""
import argparse
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--module-path", type=Path, required=True)
    parser.add_argument("--screenshots", type=Path, default=ROOT / "test-output" / "desktop")
    args = parser.parse_args()
    modules = args.module_path.resolve()
    classes = ROOT / "out-desktop"
    if not (classes / "enay" / "desktop" / "DesktopView.class").exists():
        raise SystemExit("Build the desktop first: scripts/desktop.ps1 -BuildOnly or sh scripts/desktop.sh --build-only")
    for source in (ROOT / "src").rglob("*.java"):
        binary = classes / source.relative_to(ROOT / "src").with_suffix(".class")
        if not binary.exists() or binary.stat().st_mtime < source.stat().st_mtime:
            raise SystemExit("Desktop classes are out of date. Rebuild the desktop before running screen tests.")
    if not modules.is_dir():
        raise SystemExit("JavaFX module directory not found. Run the desktop build once to download verified dependencies.")
    args.screenshots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="enay-ui-tests-") as temporary:
        work = Path(temporary)
        tests = work / "classes"
        tests.mkdir()
        subprocess.run(["javac", "-encoding", "UTF-8", "-Xlint:all", "--module-path", str(modules),
                        "--add-modules", "javafx.controls", "-cp", str(classes), "-d", str(tests),
                        *map(str, (ROOT / "tests" / "desktop").glob("*.java"))], check=True)
        import os
        classpath = os.pathsep.join([str(tests), str(classes)])
        result = subprocess.run(["java", "--module-path", str(modules), "--add-modules", "javafx.controls",
                                 "-Dprism.order=sw", "-cp", classpath, "DesktopWorkflowTests",
                                 str(work / "data"), str(args.screenshots.resolve())],
                                cwd=work, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=150)
        print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        if result.returncode:
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
