package enay.service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Exports an already saved, local record set without changing the live data folder. */
public final class BackupExporter {
    private static final String[] FILES = {"maternal_records.txt", "child_records.txt", "system_data.dat"};
    private BackupExporter() { }

    public static void export(Path dataDirectory, Path destination) throws IOException {
        Path target = destination.toAbsolutePath().normalize();
        if (!target.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".zip")) {
            throw new IOException("Choose a backup filename ending in .zip.");
        }
        if (Files.isSymbolicLink(target) || (Files.exists(target) && !Files.isRegularFile(target))) {
            throw new IOException("The backup destination must be a regular ZIP file.");
        }
        for (String filename : FILES) {
            Path source = dataDirectory.resolve(filename);
            if (Files.isSymbolicLink(source) || !Files.isRegularFile(source)) {
                throw new IOException("Save all records successfully before exporting a backup.");
            }
        }
        Path temporary = Files.createTempFile(target.getParent(), "enay-backup-", ".tmp");
        try {
            try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(temporary), StandardCharsets.UTF_8)) {
                for (String filename : FILES) {
                    zip.putNextEntry(new ZipEntry(filename));
                    try (InputStream input = Files.newInputStream(dataDirectory.resolve(filename))) {
                        input.transferTo(zip);
                    }
                    zip.closeEntry();
                }
                zip.putNextEntry(new ZipEntry("README.txt"));
                zip.write(("E-Nay local backup\nCreated: " + Instant.now()
                        + "\nTo restore: close E-Nay, back up your current data folder, then copy the three record files "
                        + "into that folder. Start E-Nay to validate and load the restored records.\n")
                        .getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
            try {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }
}
