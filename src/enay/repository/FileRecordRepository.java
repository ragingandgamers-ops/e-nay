package enay.repository;
import enay.model.*;
import enay.validation.ValidationUtils;
import enay.exception.InvalidRecordException;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** Owns record collections and local persistence; returns diagnostics for the view. */
public class FileRecordRepository implements RecordRepository {
    private MaternalProfile[] maternalRecords = new MaternalProfile[100];
    private int maternalCount = 0;

    private ChildProfile[] childRecords = new ChildProfile[100];
    private int childCount = 0;

    // A failed/incomplete load must never authorize replacing unread saved data.
    private boolean maternalSaveAllowed = false;
    private boolean childSaveAllowed = false;
    private boolean maternalDirty = false;
    private boolean childDirty = false;
    private byte[] maternalFingerprint;
    private byte[] childFingerprint;


    private final String MATERNAL_FILE;
    private final String CHILD_FILE;
    private final String BINARY_FILE;
    private final Path dataDirectory;
    private final List<String> messages = new ArrayList<>();

    public FileRecordRepository(Path dataDirectory) {
        this.dataDirectory = Objects.requireNonNull(dataDirectory, "Data directory").toAbsolutePath().normalize();
        MATERNAL_FILE = dataDirectory.resolve("maternal_records.txt").toString();
        CHILD_FILE = dataDirectory.resolve("child_records.txt").toString();
        BINARY_FILE = dataDirectory.resolve("system_data.dat").toString();
    }

    @Override public List<MaternalProfile> maternalRecords() {
        return List.copyOf(Arrays.asList(Arrays.copyOf(maternalRecords, maternalCount)));
    }
    @Override public List<ChildProfile> childRecords() {
        return List.copyOf(Arrays.asList(Arrays.copyOf(childRecords, childCount)));
    }
    @Override public boolean maternalFull() { return maternalCount >= maternalRecords.length; }
    @Override public boolean childFull() { return childCount >= childRecords.length; }
    @Override public boolean hasUnsavedChanges() { return maternalDirty || childDirty; }
    @Override public boolean canSave() { return maternalSaveAllowed && childSaveAllowed; }
    @Override public Path dataDirectory() { return dataDirectory; }
    @Override public boolean containsId(String id, boolean maternal) {
        return maternal ? maternalRecords().stream().anyMatch(r -> r.getProfileId().equalsIgnoreCase(id))
                : childRecords().stream().anyMatch(r -> r.getChildId().equalsIgnoreCase(id));
    }
    @Override public void addMaternal(MaternalProfile record) throws InvalidRecordException {
        if (record == null) throw new InvalidRecordException("Maternal record cannot be empty.");
        if (maternalFull()) throw new InvalidRecordException("Maternal record array is full!");
        if (containsId(record.getProfileId(), true)) throw new InvalidRecordException("ID already exists. Enter a unique ID.");
        ValidationUtils.newEdd(ValidationUtils.date(record.getExpectedDeliveryDate(), "Expected delivery date"));
        maternalRecords[maternalCount++] = record;
        maternalDirty = true;
    }
    @Override public void addChild(ChildProfile record) throws InvalidRecordException {
        if (record == null) throw new InvalidRecordException("Child record cannot be empty.");
        if (childFull()) throw new InvalidRecordException("Child record array is full!");
        if (containsId(record.getChildId(), false)) throw new InvalidRecordException("ID already exists. Enter a unique ID.");
        ValidationUtils.newDob(ValidationUtils.date(record.getDateOfBirth(), "Date of Birth"));
        childRecords[childCount++] = record;
        childDirty = true;
    }
    @Override public void updateMaternal(String originalId, MaternalProfile record) throws InvalidRecordException {
        String id = ValidationUtils.profileId(originalId);
        if (record == null) throw new InvalidRecordException("Maternal record cannot be empty.");
        if (!id.equals(record.getProfileId())) {
            throw new InvalidRecordException("A maternal record's ID cannot be changed.");
        }
        for (int i = 0; i < maternalCount; i++) {
            MaternalProfile previous = maternalRecords[i];
            if (!id.equals(previous.getProfileId())) continue;
            if (!previous.getExpectedDeliveryDate().equals(record.getExpectedDeliveryDate())) {
                ValidationUtils.newEdd(ValidationUtils.date(record.getExpectedDeliveryDate(), "Expected delivery date"));
            }
            if (!previous.toTextFormat().equals(record.toTextFormat())) {
                maternalRecords[i] = record;
                maternalDirty = true;
            }
            return;
        }
        throw new InvalidRecordException("Maternal record was not found: " + id);
    }
    @Override public void updateChild(String originalId, ChildProfile record) throws InvalidRecordException {
        String id = ValidationUtils.childId(originalId);
        if (record == null) throw new InvalidRecordException("Child record cannot be empty.");
        if (!id.equals(record.getChildId())) {
            throw new InvalidRecordException("A child record's ID cannot be changed.");
        }
        for (int i = 0; i < childCount; i++) {
            ChildProfile previous = childRecords[i];
            if (!id.equals(previous.getChildId())) continue;
            if (!previous.getDateOfBirth().equals(record.getDateOfBirth())) {
                ValidationUtils.newDob(ValidationUtils.date(record.getDateOfBirth(), "Date of Birth"));
            }
            if (!previous.toTextFormat().equals(record.toTextFormat())) {
                childRecords[i] = record;
                childDirty = true;
            }
            return;
        }
        throw new InvalidRecordException("Child record was not found: " + id);
    }
    @Override public void loadRecords() { loadTextRecords(); }
    @Override public void loadMetadata() { loadSystemData(); }
    @Override public boolean saveAll() { return saveFiles(true); }
    @Override public List<String> drainMessages() {
        List<String> result = List.copyOf(messages);
        messages.clear();
        return result;
    }
    private static MessageDigest newDigest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static byte[] fingerprint(String filename) throws IOException {
        MessageDigest digest = newDigest();
        try (InputStream input = new DigestInputStream(Files.newInputStream(Paths.get(filename)), digest)) {
            byte[] buffer = new byte[8192];
            while (input.read(buffer) != -1) { /* digest the complete saved file */ }
        } catch (NoSuchFileException e) {
            return null;
        }
        return digest.digest();
    }

    private static void verifyUnchanged(String filename, byte[] expected) throws IOException {
        if (!Arrays.equals(fingerprint(filename), expected)) {
            throw new IOException(filename + " changed since it was loaded or saved. "
                    + "Save was canceled to preserve those changes. Reload with option 6 to read them.");
        }
    }

    @FunctionalInterface
    private interface FileWriterAction {
        void write(Path temporary) throws IOException;
    }

    // Complete and close a replacement before touching the previous saved file.
    private static void replaceFile(String filename, FileWriterAction action) throws IOException {
        Path target = Paths.get(filename).toAbsolutePath();
        if (Files.exists(target) && !Files.isRegularFile(target)) {
            throw new IOException("Destination is not a regular file: " + filename);
        }
        Path temporary = Files.createTempFile(target.getParent(), target.getFileName().toString(), ".tmp");
        try {
            action.write(temporary);
            try {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    @FunctionalInterface
    private interface FileMoveAction {
        void move(Path source, Path target) throws IOException;
    }

    private static void moveReplacement(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void cleanupTemporary(Path path) {
        if (path == null) return;
        try {
            Files.deleteIfExists(path);
        } catch (IOException e) {
            messages.add("Unable to remove temporary file " + path + ": " + e.getMessage());
        }
    }

    // Prepare every file first, then roll back completed replacements if a move fails.
    private void replaceFiles(String[] filenames, FileWriterAction[] actions, FileMoveAction mover)
            throws IOException {
        Path[] targets = new Path[filenames.length];
        Path[] staged = new Path[filenames.length];
        Path[] backups = new Path[filenames.length];
        boolean[] retainBackup = new boolean[filenames.length];
        int committed = 0;
        try {
            for (int i = 0; i < filenames.length; i++) {
                targets[i] = Paths.get(filenames[i]).toAbsolutePath();
                if (Files.isSymbolicLink(targets[i])
                        || (Files.exists(targets[i]) && !Files.isRegularFile(targets[i]))) {
                    throw new IOException("Destination is not a regular file: " + filenames[i]);
                }
                staged[i] = Files.createTempFile(targets[i].getParent(), targets[i].getFileName().toString(), ".tmp");
                actions[i].write(staged[i]);
                if (Files.exists(targets[i])) {
                    backups[i] = Files.createTempFile(targets[i].getParent(), targets[i].getFileName().toString(), ".backup");
                    Files.copy(targets[i], backups[i], StandardCopyOption.REPLACE_EXISTING);
                }
            }
            // Recheck after staging so edits during preparation also cancel the save.
            for (String filename : filenames) {
                if (filename.equals(MATERNAL_FILE)) verifyUnchanged(filename, maternalFingerprint);
                if (filename.equals(CHILD_FILE)) verifyUnchanged(filename, childFingerprint);
            }
            for (int i = 0; i < filenames.length; i++) {
                mover.move(staged[i], targets[i]);
                committed++;
            }
        } catch (IOException e) {
            for (int i = committed - 1; i >= 0; i--) {
                try {
                    if (backups[i] != null) moveReplacement(backups[i], targets[i]);
                    else Files.deleteIfExists(targets[i]);
                } catch (IOException rollbackError) {
                    e.addSuppressed(rollbackError);
                    retainBackup[i] = true;
                    messages.add("Unable to restore " + targets[i] + "; backup retained at " + backups[i]);
                }
            }
            throw e;
        } finally {
            for (int i = 0; i < filenames.length; i++) {
                cleanupTemporary(staged[i]);
                if (!retainBackup[i]) cleanupTemporary(backups[i]);
            }
        }
    }

    private boolean saveTextRecords() {
        return saveFiles(false);
    }

    private boolean saveFiles(boolean includeBinary) {
        if (!maternalSaveAllowed || !childSaveAllowed) {
            messages.add("Save blocked: a record file could not be fully loaded. "
                    + "Fix the file or its access permissions, then choose option 6 before saving.");
            return false;
        }
        try {
            verifyUnchanged(MATERNAL_FILE, maternalFingerprint);
            verifyUnchanged(CHILD_FILE, childFingerprint);
        } catch (IOException e) {
            messages.add("Save blocked: " + e.getMessage());
            return false;
        }
        String[] filenames = includeBinary ? new String[] {MATERNAL_FILE, CHILD_FILE, BINARY_FILE}
                : new String[] {MATERNAL_FILE, CHILD_FILE};
        FileWriterAction maternalWriter = temporary -> {
            try (BufferedWriter writer = Files.newBufferedWriter(temporary, StandardCharsets.UTF_8)) {
                for (int i = 0; i < maternalCount; i++) {
                    writer.write(maternalRecords[i].toTextFormat());
                    writer.newLine();
                }
            }
        };
        FileWriterAction childWriter = temporary -> {
            try (BufferedWriter writer = Files.newBufferedWriter(temporary, StandardCharsets.UTF_8)) {
                for (int i = 0; i < childCount; i++) {
                    writer.write(childRecords[i].toTextFormat());
                    writer.newLine();
                }
            }
        };
        FileWriterAction binaryWriter = temporary -> {
            try (DataOutputStream output = new DataOutputStream(Files.newOutputStream(temporary))) {
                output.writeInt(maternalCount);
                output.writeInt(childCount);
            }
        };
        FileWriterAction[] actions = includeBinary
                ? new FileWriterAction[] {maternalWriter, childWriter, binaryWriter}
                : new FileWriterAction[] {maternalWriter, childWriter};
        try {
            replaceFiles(filenames, actions, FileRecordRepository::moveReplacement);
            maternalFingerprint = fingerprint(MATERNAL_FILE);
            childFingerprint = fingerprint(CHILD_FILE);
            maternalDirty = false;
            childDirty = false;
            messages.add("Maternal records saved successfully.");
            messages.add("Child records saved successfully.");
            if (includeBinary) messages.add("System data (binary) saved successfully.");
            return true;
        } catch (IOException e) {
            messages.add("Save failed; records remain in memory: " + e.getMessage());
            return false;
        }
    }

    private void loadTextRecords() {
        loadMaternalRecords();
        loadChildRecords();
    }

    private void loadMaternalRecords() {
        MaternalProfile[] loaded = new MaternalProfile[maternalRecords.length];
        int loadedCount = 0;
        int errors = 0;
        boolean capacityExceeded = false;
        boolean firstLine = true;
        Set<String> ids = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        MessageDigest digest = newDigest();
        try (InputStream input = new DigestInputStream(Files.newInputStream(Paths.get(MATERNAL_FILE)), digest);
                BufferedReader reader = new BufferedReader(new InputStreamReader(input,
                        StandardCharsets.UTF_8.newDecoder()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (firstLine) {
                    // Some Windows editors prefix UTF-8 files with a byte-order mark.
                    if (line.startsWith("\uFEFF")) line = line.substring(1);
                    firstLine = false;
                }
                if (line.trim().isEmpty()) continue;
                try {
                    MaternalProfile parsed = MaternalProfile.fromTextFormat(line);
                    if (!ids.add(parsed.getProfileId())) {
                        throw new InvalidRecordException("Duplicate maternal ID: " + parsed.getProfileId());
                    }
                    if (loadedCount >= loaded.length) {
                        capacityExceeded = true;
                        throw new InvalidRecordException("Maternal record array is full, cannot load more records.");
                    }
                    loaded[loadedCount] = parsed;
                    loadedCount++;
                } catch (InvalidRecordException e) {
                    errors++;
                    messages.add("Skipping invalid maternal record: " + e.getMessage());
                }
            }
        } catch (IOException e) {
            // A missing file is safe to create; an existing unreadable file is not.
            maternalSaveAllowed = e instanceof NoSuchFileException;
            if (maternalSaveAllowed) {
                maternalFingerprint = null;
                messages.add("No maternal file found; current records were preserved.");
                return;
            }
            messages.add("Maternal load failed; current records were preserved: " + e.getMessage());
            return;
        }
        // Commit only after the entire read and resource close succeed.
        if (loadedCount == 0 && errors > 0) {
            maternalSaveAllowed = false;
            messages.add("Maternal file contains no valid records; current records were preserved. "
                    + "Saving is blocked until the file is repaired and reloaded.");
            return;
        }
        maternalRecords = loaded;
        maternalCount = loadedCount;
        maternalSaveAllowed = !capacityExceeded;
        maternalFingerprint = digest.digest();
        maternalDirty = false;
        if (capacityExceeded) messages.add("Maternal file exceeds capacity; saving is blocked to preserve extra records.");
        messages.add("Maternal records loaded successfully: " + loadedCount + ".");
        if (errors > 0) messages.add(errors + " maternal record(s) were skipped due to errors.");
    }

    private void loadChildRecords() {
        ChildProfile[] loaded = new ChildProfile[childRecords.length];
        int loadedCount = 0;
        int errors = 0;
        boolean capacityExceeded = false;
        boolean firstLine = true;
        Set<String> ids = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        MessageDigest digest = newDigest();
        try (InputStream input = new DigestInputStream(Files.newInputStream(Paths.get(CHILD_FILE)), digest);
                BufferedReader reader = new BufferedReader(new InputStreamReader(input,
                        StandardCharsets.UTF_8.newDecoder()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (firstLine) {
                    if (line.startsWith("\uFEFF")) line = line.substring(1);
                    firstLine = false;
                }
                if (line.trim().isEmpty()) continue;
                try {
                    ChildProfile parsed = ChildProfile.fromTextFormat(line);
                    if (!ids.add(parsed.getChildId())) {
                        throw new InvalidRecordException("Duplicate child ID: " + parsed.getChildId());
                    }
                    if (loadedCount >= loaded.length) {
                        capacityExceeded = true;
                        throw new InvalidRecordException("Child record array is full, cannot load more records.");
                    }
                    loaded[loadedCount] = parsed;
                    loadedCount++;
                } catch (InvalidRecordException e) {
                    errors++;
                    messages.add("Skipping invalid child record: " + e.getMessage());
                }
            }
        } catch (IOException e) {
            childSaveAllowed = e instanceof NoSuchFileException;
            if (childSaveAllowed) {
                childFingerprint = null;
                messages.add("No child file found; current records were preserved.");
                return;
            }
            messages.add("Child load failed; current records were preserved: " + e.getMessage());
            return;
        }
        if (loadedCount == 0 && errors > 0) {
            childSaveAllowed = false;
            messages.add("Child file contains no valid records; current records were preserved. "
                    + "Saving is blocked until the file is repaired and reloaded.");
            return;
        }
        childRecords = loaded;
        childCount = loadedCount;
        childSaveAllowed = !capacityExceeded;
        childFingerprint = digest.digest();
        childDirty = false;
        if (capacityExceeded) messages.add("Child file exceeds capacity; saving is blocked to preserve extra records.");
        messages.add("Child records loaded successfully: " + loadedCount + ".");
        if (errors > 0) messages.add(errors + " child record(s) were skipped due to errors.");
    }

    private void saveSystemData() {
        try {
            replaceFile(BINARY_FILE, temporary -> {
                try (DataOutputStream dos = new DataOutputStream(Files.newOutputStream(temporary))) {
                    dos.writeInt(maternalCount);
                    dos.writeInt(childCount);
                }
            });
            messages.add("System data (binary) saved successfully.");
        } catch (IOException e) {
            messages.add("Error saving system data: " + e.getMessage());
        }
    }

    private void loadSystemData() {
        try (DataInputStream dis = new DataInputStream(new FileInputStream(BINARY_FILE))) {
            int expectedMaternal = dis.readInt();
            int expectedChild = dis.readInt();
            if (expectedMaternal < 0 || expectedMaternal > maternalRecords.length
                    || expectedChild < 0 || expectedChild > childRecords.length || dis.read() != -1) {
                throw new IOException("Invalid binary counts or unsupported metadata format.");
            }
            messages.add("Loaded System Data -> Expected Maternal: " + expectedMaternal + " | Expected Child: " + expectedChild);
        } catch (FileNotFoundException e) {
            messages.add("No existing binary file found. Starting fresh.");
        } catch (EOFException e) {
            messages.add("System data file is corrupted or incomplete. Skipping binary metadata.");
        } catch (IOException e) {
            messages.add("Error reading system data: " + e.getMessage());
        }
    }

}
