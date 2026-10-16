package enay;
import enay.controller.RecordController;
import enay.repository.FileRecordRepository;
import enay.view.ConsoleView;
import java.io.IOException;
import java.nio.channels.*;
import java.nio.file.*;
import java.util.Scanner;

/** Composition root: chooses storage and view, holds the data-folder process lock. */
public final class Main {
    private Main() { }
    public static Path resolveDataDirectory() {
        Path working = Paths.get("").toAbsolutePath().normalize();
        if (working.getFileName() != null && working.getFileName().toString().equals("src")
                && Files.isRegularFile(working.resolve("enay/Main.java"))) working = working.getParent();
        return working.resolve("data");
    }
    public static void main(String[] args) {
        Path data = resolveDataDirectory();
        try {
            Files.createDirectories(data);
            try (FileChannel channel = FileChannel.open(data.resolve(".enay.lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
                FileLock lock = channel.tryLock();
                if (lock == null) { System.out.println("Another E-Nay instance is already using this data folder. Close it first."); return; }
                try (FileLock acquired = lock; Scanner input = new Scanner(System.in)) {
                    if (acquired.isValid()) new RecordController(new FileRecordRepository(data), new ConsoleView(input, System.out)).run();
                }
            }
        } catch (IOException | OverlappingFileLockException e) {
            System.out.println("Unable to secure the data folder: " + e.getMessage());
        }
    }
}
