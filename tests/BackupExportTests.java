import enay.service.BackupExporter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Arrays;
import java.util.zip.ZipFile;

public final class BackupExportTests {
    private static int checks;
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
    }
    @FunctionalInterface private interface Action { void run() throws IOException; }
    private static void rejects(Action action) throws IOException {
        try { action.run(); throw new AssertionError("Expected export rejection"); }
        catch (IOException expected) { checks++; }
    }
    public static void main(String[] args) throws Exception {
        Path root = Paths.get("backup-export-test");
        Path data = root.resolve("data");
        Files.createDirectories(data);
        byte[] maternal = "M001|María McDonald|28|2027-01-01|Active\n".getBytes(StandardCharsets.UTF_8);
        byte[] child = "C001|Demo Child|Female|2026-01-01|María McDonald|Active\n".getBytes(StandardCharsets.UTF_8);
        byte[] metadata = {0, 0, 0, 1, 0, 0, 0, 1};
        Files.write(data.resolve("maternal_records.txt"), maternal);
        Files.write(data.resolve("child_records.txt"), child);
        Files.write(data.resolve("system_data.dat"), metadata);
        Path target = root.resolve("backup.zip");
        BackupExporter.export(data, target);
        try (ZipFile zip = new ZipFile(target.toFile(), StandardCharsets.UTF_8)) {
            check(zip.size() == 4, "Unexpected backup entries");
            check(Arrays.equals(zip.getInputStream(zip.getEntry("maternal_records.txt")).readAllBytes(), maternal), "Maternal bytes changed");
            check(Arrays.equals(zip.getInputStream(zip.getEntry("child_records.txt")).readAllBytes(), child), "Child bytes changed");
            check(Arrays.equals(zip.getInputStream(zip.getEntry("system_data.dat")).readAllBytes(), metadata), "Metadata bytes changed");
            check(zip.getEntry("README.txt") != null, "Restore instructions missing");
            check(zip.stream().allMatch(entry -> !entry.getName().contains("/") && !entry.getName().contains("\\")), "Unsafe backup paths");
        }
        check(Arrays.equals(Files.readAllBytes(data.resolve("maternal_records.txt")), maternal), "Export changed live data");
        byte[] originalZip = Files.readAllBytes(target);
        Files.delete(data.resolve("child_records.txt"));
        rejects(() -> BackupExporter.export(data, target));
        check(Arrays.equals(Files.readAllBytes(target), originalZip), "Failed export damaged existing backup");
        rejects(() -> BackupExporter.export(data, root.resolve("backup.txt")));
        Files.createDirectory(root.resolve("directory.zip"));
        rejects(() -> BackupExporter.export(data, root.resolve("directory.zip")));
        Files.write(data.resolve("child_records.txt"), child);
        BackupExporter.export(data, target);
        try (ZipFile zip = new ZipFile(target.toFile())) { check(zip.size() == 4, "Replacement export invalid"); }
        try (var files = Files.walk(root)) {
            check(files.noneMatch(path -> path.toString().endsWith(".tmp")), "Export left temporary files");
        }
        System.out.println("PASS: " + checks + " backup export assertions");
    }
}
