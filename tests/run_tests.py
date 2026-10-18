"""Compile and test with Java 17+ in temporary directories; never alter real data."""
from datetime import date, timedelta
from pathlib import Path
import struct
import subprocess
import tempfile
import threading

PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT / "src"


def main():
    with tempfile.TemporaryDirectory(prefix="enay-tests-") as temporary:
        root = Path(temporary)
        build = root / "classes"
        build.mkdir()
        subprocess.run(["javac", "-encoding", "UTF-8", "-Xlint:all", "-d", str(build),
                        *map(str, (path for path in SOURCE.rglob("*.java") if "desktop" not in path.parts)),
                        *map(str, (PROJECT / "tests").glob("*Tests.java"))], check=True)
        unit = root / "regression"
        unit.mkdir()
        result = subprocess.run(["java", "-cp", str(build), "RegressionTests"], cwd=unit,
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        print(result.stdout.splitlines()[-1])
        result = subprocess.run(["java", "-cp", str(build), "BackupExportTests"], cwd=unit,
                                capture_output=True, text=True, encoding="utf-8", timeout=60)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        print(result.stdout.splitlines()[-1])
        desktop_repository = root / "desktop-repository"
        desktop_repository.mkdir()
        result = subprocess.run(["java", "-cp", str(build), "DesktopRepositoryTests"], cwd=desktop_repository,
                                capture_output=True, text=True, encoding="utf-8", timeout=60)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        print(result.stdout.splitlines()[-1])
        result = subprocess.run(["java", "-cp", str(build), "ValidationRuleTests"], cwd=unit,
                                capture_output=True, text=True, encoding="utf-8", timeout=60)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        print(result.stdout.splitlines()[-1])
        safety = root / "safety"
        safety.mkdir()
        result = subprocess.run(["java", "-cp", str(build), "SafetyRegressionTests"], cwd=safety,
                                capture_output=True, text=True, encoding="utf-8", timeout=60)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        print(result.stdout.splitlines()[-1])

        scenarios = 0

        def console(lines, name, files=None):
            nonlocal scenarios
            directory = root / name
            directory.mkdir()
            (directory / "data").mkdir()
            for filename, contents in (files or {}).items():
                if contents is None:
                    (directory / "data" / filename).mkdir()
                else:
                    (directory / "data" / filename).write_bytes(contents)
            result = subprocess.run(["java", "-cp", str(build), "enay.Main"], cwd=directory,
                                    input="\n".join(lines) + "\n", capture_output=True,
                                    text=True, encoding="utf-8", timeout=30)
            assert result.returncode == 0, result.stderr
            assert "An unexpected error" not in result.stdout, result.stdout
            scenarios += 1
            return result.stdout, directory

        today = date.today()
        # Equivalent to Java's minusYears(2), including February 29.
        try:
            two_years_ago = today.replace(year=today.year - 2)
        except ValueError:
            two_years_ago = today.replace(year=today.year - 2, day=28)
        # Console loops must reject each bad value and consume its correction.
        output, directory = console([
            "abc", "9", "1", "", "M001", "Bad|Name", "Ana", "abc", "11", "28",
            "2026-02-30", str(today - timedelta(days=1)), str(today), "Unknown", "active",
            "1", "m001", "M002", "Carla", "31", str(today), "Inactive",
            "2", "", "C001", "", "Baby", "boy", "male", "bad-date",
            str(today + timedelta(days=1)), str(two_years_ago - timedelta(days=1)),
            str(today), "", "Ana", "Unknown", "Active", "3", "4", "5", "6", "3", "4", "7"
        ], "retries")
        assert output.count("Maternal Record added successfully!") == 2
        assert output.count("Child Record added successfully!") == 1
        assert "ID already exists" in output
        assert "24 months" in output
        assert len((directory / "data" / "maternal_records.txt").read_text().splitlines()) == 2
        assert struct.unpack(">ii", (directory / "data" / "system_data.dat").read_bytes()) == (2, 1)

        for index, lines in enumerate([
            [], ["1"], ["1", "M001", "Ana"],
            ["1", "M001", "Ana", "28"], ["2", "C001", "Baby", "Male"],
            ["2", "C001", "Baby", "Male", str(today), "Ana"]
        ]):
            output, _ = console(lines, "eof" + str(index))
            assert "Input stream closed unexpectedly" in output
            assert "added successfully" not in output
        output, _ = console(["6", "3", "4", "7"], "first-run")
        assert "No maternal records found" in output and "No child records found" in output
        # Separate JVM runs must restore saved records before duplicate checks or saves.
        output, directory = console([
            "1", "M001", "Original Mother", "28", str(today), "Active",
            "2", "C001", "Original Child", "Male", str(today), "Original Mother", "Active",
            "5", "7"
        ], "restart")

        def restart(lines):
            nonlocal scenarios
            result = subprocess.run(["java", "-cp", str(build), "enay.Main"], cwd=directory,
                                    input="\n".join(lines) + "\n", capture_output=True,
                                    text=True, encoding="utf-8", timeout=30)
            assert result.returncode == 0, result.stderr
            assert "An unexpected error" not in result.stdout, result.stdout
            scenarios += 1
            return result.stdout

        output = restart([
            "1", "m001", "M002", "Second Mother", "31", str(today), "Inactive",
            "2", "c001", "C002", "Second Child", "Female", str(today), "Second Mother", "Active",
            "5", "7"
        ])
        assert output.count("ID already exists") == 2, output
        mothers = (directory / "data" / "maternal_records.txt").read_text()
        children = (directory / "data" / "child_records.txt").read_text()
        assert "M001|Original Mother|" in mothers and "M002|Second Mother|" in mothers
        assert "C001|Original Child|" in children and "C002|Second Child|" in children
        assert len(mothers.splitlines()) == len(children.splitlines()) == 2
        # Saving immediately after a fresh restart must not erase persisted records.
        restart(["5", "7"])
        assert (directory / "data" / "maternal_records.txt").read_text() == mothers
        assert (directory / "data" / "child_records.txt").read_text() == children
        output = restart(["3", "4", "7"])
        assert "Original Mother" in output and "Second Mother" in output
        assert "Original Child" in output and "Second Child" in output

        # Startup read failures must not authorize a save over existing bytes.
        valid_mother = f"M001|Mother|28|{today}|Active\n".encode()
        valid_child = f"C001|Child|Male|{today}|Mother|Active\n".encode()
        for name, maternal, child in [
            ("bad-maternal", b"\xc3\x28", valid_child),
            ("bad-child", valid_mother, b"\xc3\x28")
        ]:
            metadata = struct.pack(">ii", 1, 1)
            output, directory = console(["5", "7"], name, {
                "maternal_records.txt": maternal,
                "child_records.txt": child,
                "system_data.dat": metadata
            })
            assert "Save blocked" in output
            assert (directory / "data" / "maternal_records.txt").read_bytes() == maternal
            assert (directory / "data" / "child_records.txt").read_bytes() == child
            assert (directory / "data" / "system_data.dat").read_bytes() == metadata

        # An excess valid row must remain on disk after a blocked save.
        for name, overflowing_file in [("maternal-overflow", "maternal_records.txt"),
                                       ("child-overflow", "child_records.txt")]:
            if overflowing_file.startswith("maternal"):
                rows = "".join(f"M{i:03d}|Mother|28|{today}|Active\n" for i in range(101)).encode()
            else:
                rows = "".join(f"C{i:03d}|Child|Male|{today}|Mother|Active\n" for i in range(101)).encode()
            output, directory = console(["5", "7"], name, {overflowing_file: rows})
            assert "Save blocked" in output
            assert (directory / "data" / overflowing_file).read_bytes() == rows

        output, directory = console(["5", "7"], "empty-first-save")
        assert "Save blocked" not in output
        assert (directory / "data" / "maternal_records.txt").read_bytes() == b""
        assert (directory / "data" / "child_records.txt").read_bytes() == b""
        assert struct.unpack(">ii", (directory / "data" / "system_data.dat").read_bytes()) == (0, 0)

        # A Windows-editor BOM must not bypass the console's duplicate-ID check.
        output, directory = console([
            "1", "m001", "M002", "Second Mother", "31", str(today), "Active",
            "2", "c001", "C002", "Second Child", "Female", str(today), "Mother", "Active",
            "5", "7"
        ], "bom", {"maternal_records.txt": b"\xef\xbb\xbf" + valid_mother,
                   "child_records.txt": b"\xef\xbb\xbf" + valid_child})
        assert output.count("ID already exists") == 2, output
        assert len((directory / "data" / "maternal_records.txt").read_text().splitlines()) == 2
        assert len((directory / "data" / "child_records.txt").read_text().splitlines()) == 2

        output, directory = console([
            "1", "M002", "Unsaved Mother", "28", str(today), "Active",
            "6", "No", "3", "7", "No", "5", "7"
        ], "unsaved-cancel", {"maternal_records.txt": valid_mother})
        assert "Reload will discard unsaved records" in output
        assert "Exit will discard unsaved records" in output
        assert "ID: M002" in output
        assert len((directory / "data" / "maternal_records.txt").read_text().splitlines()) == 2

        output, directory = console([
            "1", "M002", "Discarded Mother", "28", str(today), "Active",
            "6", "Yes", "3", "7"
        ], "unsaved-discard-reload", {"maternal_records.txt": valid_mother})
        assert "ID: M002" not in output
        assert (directory / "data" / "maternal_records.txt").read_bytes() == valid_mother

        output, directory = console([
            "1", "M002", "Discarded Mother", "28", str(today), "Active", "7", "Yes"
        ], "unsaved-discard-exit", {"maternal_records.txt": valid_mother})
        assert "Exit will discard unsaved records" in output
        assert (directory / "data" / "maternal_records.txt").read_bytes() == valid_mother

        # An unusable binary destination must not update either text file.
        output, directory = console([
            "1", "M002", "Retained In Memory", "28", str(today), "Active",
            "5", "3", "7", "Yes"
        ], "binary-save-failure", {"maternal_records.txt": valid_mother, "system_data.dat": None})
        assert "Save failed" in output and "ID: M002" in output
        assert (directory / "data" / "maternal_records.txt").read_bytes() == valid_mother
        assert not (directory / "data" / "child_records.txt").exists()

        # Loading alone never writes files; saving after an all-invalid load must be blocked.
        for name, files in [
            ("all-invalid-maternal", {"maternal_records.txt": b"BROKEN|ROW\n", "child_records.txt": valid_child}),
            ("all-invalid-child", {"maternal_records.txt": valid_mother, "child_records.txt": b"BROKEN|ROW\n"})
        ]:
            output, directory = console(["6", "5", "7"], name, files)
            assert "contains no valid records" in output
            assert "Save blocked" in output
            for filename, original in files.items():
                assert (directory / "data" / filename).read_bytes() == original
            assert not (directory / "data" / "system_data.dat").exists()

        def start_interactive(directory):
            process = subprocess.Popen(["java", "-cp", str(build), "enay.Main"], cwd=directory,
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, encoding="utf-8")
            startup = []

            def read_menu():
                for line in process.stdout:
                    startup.append(line)
                    if "7. Exit" in line:
                        return

            reader = threading.Thread(target=read_menu, daemon=True)
            reader.start()
            reader.join(timeout=15)
            if reader.is_alive() or not any("7. Exit" in line for line in startup):
                process.kill()
                process.communicate(timeout=10)
                raise AssertionError("Interactive startup failed: " + "".join(startup))
            return process

        directory = root / "concurrent"
        directory.mkdir()
        (directory / "data").mkdir()
        (directory / "data" / "maternal_records.txt").write_bytes(valid_mother)
        first = start_interactive(directory)
        try:
            second = subprocess.run(["java", "-cp", str(build), "enay.Main"], cwd=directory,
                                    input="5\n7\n", capture_output=True, text=True, encoding="utf-8", timeout=30)
            assert second.returncode == 0
            assert "Another E-Nay instance" in second.stdout
            assert (directory / "data" / "maternal_records.txt").read_bytes() == valid_mother
            scenarios += 1
            # An editor can still write despite the cooperative process lock.
            external = valid_mother.replace(b"Mother|28", b"Externally Edited|28")
            (directory / "data" / "maternal_records.txt").write_bytes(external)
            output, error = first.communicate("5\n6\n3\n7\n", timeout=30)
            assert first.returncode == 0, error
            assert "Save blocked" in output and "changed since" in output
            assert "Externally Edited" in output
            assert (directory / "data" / "maternal_records.txt").read_bytes() == external
            assert not (directory / "data" / "child_records.txt").exists()
            scenarios += 1
        finally:
            if first.poll() is None:
                first.kill()
                first.communicate(timeout=10)
        # The stable lock file remains, but closing the process releases the lock.
        result = subprocess.run(["java", "-cp", str(build), "enay.Main"], cwd=directory,
                                input="3\n7\n", capture_output=True, text=True, encoding="utf-8", timeout=30)
        assert result.returncode == 0 and "Externally Edited" in result.stdout
        assert "Another E-Nay instance" not in result.stdout
        scenarios += 1
        # Professor's requested independent persistence test: clean cwd, raw input,
        # exact normalized UTF-8 files, a separate JVM reload, and no root data files.
        clean = root / "clean-save-load"
        clean.mkdir()
        raw = ["1", " m001 ", "  McDonald   J. P.  ", " 28 ", str(today), "aCtIvE",
               "2", " c001 ", "  O'Neill  Jr. ", "mAlE", str(today), " McDonald   J. P. ", "INACTIVE", "5", "7"]
        result = subprocess.run(["java", "-cp", str(build), "enay.Main"], cwd=clean,
                                input="\n".join(raw) + "\n", capture_output=True, text=True, encoding="utf-8", timeout=30)
        assert result.returncode == 0 and "An unexpected error" not in result.stdout, result.stdout
        expected_maternal = f"M001|McDonald J. P.|28|{today}|Active\n"
        expected_child = f"C001|O'Neill Jr.|Male|{today}|McDonald J. P.|Inactive\n"
        assert (clean / "data" / "maternal_records.txt").read_text(encoding="utf-8") == expected_maternal
        assert (clean / "data" / "child_records.txt").read_text(encoding="utf-8") == expected_child
        assert struct.unpack(">ii", (clean / "data" / "system_data.dat").read_bytes()) == (1, 1)
        for filename in ["maternal_records.txt", "child_records.txt", "system_data.dat"]:
            assert not (clean / filename).exists(), f"Data leaked to project root: {filename}"
        reloaded = subprocess.run(["java", "-cp", str(build), "enay.Main"], cwd=clean,
                                  input="3\n4\n6\n3\n4\n7\n", capture_output=True,
                                  text=True, encoding="utf-8", timeout=30)
        assert reloaded.returncode == 0, reloaded.stderr
        assert "ID: M001 | Name: McDonald J. P." in reloaded.stdout
        assert "ID: C001 | Name: O'Neill Jr." in reloaded.stdout
        assert (clean / "data" / "maternal_records.txt").read_text(encoding="utf-8") == expected_maternal
        assert (clean / "data" / "child_records.txt").read_text(encoding="utf-8") == expected_child
        scenarios += 2

        # Entering short/long IDs and invalid names must retry before creating objects.
        output, directory = console([
            "1", "M01", "M0001", "M1234", "m001", "Maria 1234", "  McDonald  III ", "abc", "61", "28",
            "2026/10/15", "2026-02-30", str(today), "Active",
            "2", "C01", "C0001", "C1234", "c001", "Child 123", "Anne-Marie", "Female", str(today), "McDonald III", "Active", "5", "7"
        ], "validation-retries")
        assert output.count("exactly 3 digits") >= 6
        assert output.count("Maternal Record added successfully!") == 1
        assert output.count("Child Record added successfully!") == 1
        assert (directory / "data" / "maternal_records.txt").read_text().startswith("M001|McDonald III|")

        # Launching from src must share the same data folder and process lock.
        import shutil
        source_launch = clean / "src"
        source_launch.mkdir()
        (source_launch / "enay").mkdir()
        shutil.copyfile(SOURCE / "enay/Main.java", source_launch / "enay/Main.java")
        result = subprocess.run(["java", "-cp", str(build), "enay.Main"], cwd=source_launch,
                                input="3\n4\n7\n", capture_output=True, text=True, encoding="utf-8", timeout=30)
        assert result.returncode == 0 and "McDonald J. P." in result.stdout, result.stdout
        assert not (source_launch / "data").exists()
        scenarios += 1

        print("PASS: clean-directory normalized save/load and root/src data layout")
        print(f"PASS: {scenarios} console scenarios")


if __name__ == "__main__":
    main()
