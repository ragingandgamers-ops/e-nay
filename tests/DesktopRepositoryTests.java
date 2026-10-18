import enay.exception.InvalidRecordException;
import enay.model.ChildProfile;
import enay.model.MaternalProfile;
import enay.repository.FileRecordRepository;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** GUI-independent editing and persistence tests; only disposable data is used. */
public final class DesktopRepositoryTests {
    private static int checks;
    private static final String TODAY = LocalDate.now().toString();

    @FunctionalInterface
    private interface InvalidAction { void run() throws Exception; }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
    }

    private static String snapshot(FileRecordRepository repository) {
        return repository.maternalRecords().stream().map(MaternalProfile::toTextFormat)
                .collect(Collectors.joining("\n")) + "\nCHILDREN\n"
                + repository.childRecords().stream().map(ChildProfile::toTextFormat)
                .collect(Collectors.joining("\n"));
    }

    private static void rejected(FileRecordRepository repository, InvalidAction action) throws Exception {
        String before = snapshot(repository);
        boolean dirty = repository.hasUnsavedChanges();
        try {
            action.run();
            throw new AssertionError("Expected InvalidRecordException");
        } catch (InvalidRecordException expected) {
            check(!expected.getMessage().isBlank(), "Missing validation explanation");
        }
        check(snapshot(repository).equals(before), "Rejected edit changed records");
        check(repository.hasUnsavedChanges() == dirty, "Rejected edit changed dirty state");
    }

    private static MaternalProfile mother(String id, String name, String date, String status)
            throws InvalidRecordException {
        return new MaternalProfile(id, name, 28, date, status);
    }

    private static ChildProfile child(String id, String name, String date, String status)
            throws InvalidRecordException {
        return new ChildProfile(id, name, "Female", date, "Ana McDonald", status);
    }

    private static FileRecordRepository open(Path directory) throws IOException {
        Files.createDirectories(directory);
        FileRecordRepository repository = new FileRecordRepository(directory);
        repository.loadRecords();
        repository.drainMessages();
        return repository;
    }

    private static void editAndArchive(Path directory) throws Exception {
        Files.createDirectories(directory);
        FileRecordRepository repository = new FileRecordRepository(directory);
        check(!repository.canSave(), "Saving allowed before source files were checked");
        check(repository.dataDirectory().equals(directory.toAbsolutePath().normalize()), "Wrong data directory");
        repository.loadRecords();
        check(repository.canSave(), "Missing initial files should permit first save");
        check(!repository.hasUnsavedChanges(), "Loading new data marked it dirty");
        repository.addMaternal(mother("M001", "Ana", TODAY, "Active"));
        repository.addMaternal(mother("M002", "Bea", TODAY, "Active"));
        repository.addChild(child("C001", "J. McDonald", TODAY, "Active"));
        check(repository.saveAll(), "Initial save failed");

        repository.updateMaternal(" m001 ", mother("M001", "Ana", TODAY, "Active"));
        repository.updateChild(" c001 ", child("C001", "J. McDonald", TODAY, "Active"));
        check(!repository.hasUnsavedChanges(), "Unchanged forms incorrectly need saving");
        List<MaternalProfile> oldSnapshot = repository.maternalRecords();
        MaternalProfile editedMother = new MaternalProfile("m001", "  Ana  McDonald ", 29,
                LocalDate.now().plusDays(30).toString(), "inactive");
        ChildProfile editedChild = new ChildProfile("c001", " J.  McDonald ", "male",
                LocalDate.now().minusDays(10).toString(), " Ana McDonald ", "inactive");
        repository.updateMaternal("M001", editedMother);
        repository.updateChild("C001", editedChild);
        check(repository.hasUnsavedChanges(), "Edits were not marked unsaved");
        check(repository.maternalRecords().size() == 2, "Edit added or deleted a maternal record");
        check(repository.childRecords().size() == 1, "Edit added or deleted a child record");
        check(repository.maternalRecords().get(1).getProfileId().equals("M002"), "Edit reordered other records");
        check(oldSnapshot.get(0).getMotherName().equals("Ana"), "Previous snapshot changed after edit");
        check(repository.saveAll(), "Edited records did not save");
        check(!repository.hasUnsavedChanges(), "Successful save left unsaved flag");
        check(Files.readAllLines(directory.resolve("maternal_records.txt")).get(0)
                .equals(editedMother.toTextFormat()), "Saved maternal text disagrees with normalized edit");
        check(Files.readAllLines(directory.resolve("child_records.txt")).get(0)
                .equals(editedChild.toTextFormat()), "Saved child text disagrees with normalized edit");
        FileRecordRepository reopened = open(directory);
        check(snapshot(reopened).equals(snapshot(repository)), "Edited fields or archived status lost after restart");
        check(reopened.maternalRecords().get(0).getStatus().equals("Inactive"), "Maternal archive not persisted");
        check(reopened.childRecords().get(0).getStatus().equals("Inactive"), "Child archive not persisted");

        rejected(reopened, () -> reopened.updateMaternal("M001", mother("M002", "Changed", TODAY, "Active")));
        rejected(reopened, () -> reopened.updateMaternal("M001", mother("M003", "Changed", TODAY, "Active")));
        rejected(reopened, () -> reopened.updateChild("C001", child("C002", "Changed", TODAY, "Active")));
        rejected(reopened, () -> reopened.updateMaternal("M099", mother("M099", "Missing", TODAY, "Active")));
        rejected(reopened, () -> reopened.updateChild("C099", child("C099", "Missing", TODAY, "Active")));
        rejected(reopened, () -> reopened.updateMaternal(null, editedMother));
        rejected(reopened, () -> reopened.updateChild("invalid", editedChild));
        rejected(reopened, () -> reopened.updateMaternal("M001", null));
        rejected(reopened, () -> reopened.updateChild("C001", null));
        rejected(reopened, () -> reopened.addMaternal(mother(" m001 ", "Duplicate", TODAY, "Active")));
        rejected(reopened, () -> reopened.addChild(child(" c001 ", "Duplicate", TODAY, "Active")));
        rejected(reopened, () -> reopened.addMaternal(null));
        rejected(reopened, () -> reopened.addChild(null));
    }

    private static void historicalEdits(Path directory) throws Exception {
        Files.createDirectories(directory);
        String pastEdd = LocalDate.now().minusYears(1).toString();
        String pastDob = LocalDate.now().minusYears(4).toString();
        Files.writeString(directory.resolve("maternal_records.txt"), mother("M001", "Ana", pastEdd, "Active").toTextFormat());
        Files.writeString(directory.resolve("child_records.txt"), child("C001", "Older Child", pastDob, "Active").toTextFormat());
        FileRecordRepository repository = open(directory);
        repository.updateMaternal("M001", mother("M001", "Ana McDonald", pastEdd, "Inactive"));
        repository.updateChild("C001", child("C001", "Older Child", pastDob, "Inactive"));
        check(repository.hasUnsavedChanges(), "Historical status changes were not tracked");
        check(repository.saveAll(), "Unchanged historical dates prevented archive save");
        FileRecordRepository reopened = open(directory);
        check(reopened.maternalRecords().get(0).getExpectedDeliveryDate().equals(pastEdd), "Historical EDD changed");
        check(reopened.childRecords().get(0).getDateOfBirth().equals(pastDob), "Historical DOB changed");
        rejected(reopened, () -> reopened.updateMaternal("M001", mother("M001", "Ana", LocalDate.now().minusDays(1).toString(), "Active")));
        rejected(reopened, () -> reopened.updateChild("C001", child("C001", "Child", LocalDate.now().minusYears(3).toString(), "Active")));
        rejected(reopened, () -> reopened.updateChild("C001", child("C001", "Child", LocalDate.now().plusDays(1).toString(), "Active")));
        reopened.updateMaternal("M001", mother("M001", "Ana", TODAY, "Active"));
        reopened.updateChild("C001", child("C001", "Child", LocalDate.now().minusYears(2).toString(), "Active"));
        check(reopened.saveAll(), "Valid changed date boundaries failed to save");
        check(open(directory).childRecords().get(0).getDateOfBirth().equals(LocalDate.now().minusYears(2).toString()),
                "Valid changed child date lost on reload");
    }

    private static void fullCapacityEdits(Path directory) throws Exception {
        FileRecordRepository repository = open(directory);
        for (int i = 0; i < 100; i++) {
            repository.addMaternal(mother(String.format("M%03d", i), "Mother", TODAY, "Active"));
            repository.addChild(child(String.format("C%03d", i), "Child", TODAY, "Active"));
        }
        check(repository.maternalFull() && repository.childFull(), "Capacity fixture did not fill both lists");
        check(repository.saveAll(), "Full capacity save failed");
        repository.updateMaternal("M099", mother("M099", "Mother", TODAY, "Inactive"));
        repository.updateChild("C099", child("C099", "Child", TODAY, "Inactive"));
        check(repository.maternalRecords().size() == 100 && repository.childRecords().size() == 100,
                "Full capacity edit changed the counts");
        check(repository.saveAll(), "Full capacity prevented existing-record edits");
        FileRecordRepository reopened = open(directory);
        check(reopened.maternalRecords().get(99).getStatus().equals("Inactive"), "Last maternal archive lost");
        check(reopened.childRecords().get(99).getStatus().equals("Inactive"), "Last child archive lost");
    }

    private static void failureRetention(Path directory) throws Exception {
        FileRecordRepository repository = open(directory);
        repository.addMaternal(mother("M001", "Ana", TODAY, "Active"));
        repository.addChild(child("C001", "Child", TODAY, "Active"));
        check(repository.saveAll(), "Failure fixture initial save failed");
        Path maternal = directory.resolve("maternal_records.txt");
        Path childFile = directory.resolve("child_records.txt");
        Path binary = directory.resolve("system_data.dat");
        String savedMaternal = Files.readString(maternal);
        String savedChild = Files.readString(childFile);
        repository.updateMaternal("M001", mother("M001", "Edited Mother", TODAY, "Inactive"));
        repository.updateChild("C001", child("C001", "Edited Child", TODAY, "Inactive"));
        String unsaved = snapshot(repository);

        // The binary destination fails during staging; previous text stays intact.
        Files.delete(binary);
        Files.createDirectory(binary);
        check(!repository.saveAll(), "Invalid binary destination incorrectly saved");
        check(Files.readString(maternal).equals(savedMaternal), "Failed save damaged maternal file");
        check(Files.readString(childFile).equals(savedChild), "Failed save damaged child file");
        check(snapshot(repository).equals(unsaved) && repository.hasUnsavedChanges(), "Failed save lost unsaved edits");
        Files.delete(binary);
        check(repository.saveAll(), "Save did not recover after destination was repaired");
        check(!repository.hasUnsavedChanges(), "Recovery save did not clear dirty state");

        repository.updateMaternal("M001", mother("M001", "Local Mother", TODAY, "Active"));
        repository.updateChild("C001", child("C001", "Local Child", TODAY, "Active"));
        unsaved = snapshot(repository);
        String external = mother("M001", "External Mother", TODAY, "Active").toTextFormat();
        Files.writeString(maternal, external);
        check(!repository.saveAll(), "Edit save overwrote an external change");
        check(Files.readString(maternal).equals(external), "External file changed after canceled save");
        check(snapshot(repository).equals(unsaved) && repository.hasUnsavedChanges(), "Conflict discarded local edits");

        Files.writeString(maternal, "BROKEN|ROW\n");
        Files.writeString(childFile, "BROKEN|ROW\n");
        repository.loadRecords();
        check(!repository.canSave(), "Entirely malformed load allowed saving");
        check(snapshot(repository).equals(unsaved) && repository.hasUnsavedChanges(), "Failed reload lost unsaved edits");
        check(!repository.saveAll(), "Blocked load allowed edited records to overwrite malformed sources");
        check(Files.readString(maternal).equals("BROKEN|ROW\n"), "Blocked save blanked malformed source");
        check(repository.drainMessages().stream().anyMatch(message -> message.contains("blocked")), "Save failure has no explanation");
        Files.writeString(maternal, savedMaternal);
        Files.writeString(childFile, savedChild);
        repository.loadRecords();
        check(repository.canSave(), "Repair and reload did not re-enable saving");
        check(!repository.hasUnsavedChanges(), "Successful reload did not accept disk state");
        check(repository.maternalRecords().get(0).getMotherName().equals("Ana"), "Repaired reload did not replace local edit");
    }

    public static void main(String[] args) throws Exception {
        Path temporary = Files.createTempDirectory("enay-desktop-repository-");
        try {
            editAndArchive(temporary.resolve("edit"));
            historicalEdits(temporary.resolve("history"));
            fullCapacityEdits(temporary.resolve("full"));
            failureRetention(temporary.resolve("failure"));
            System.out.println("Desktop repository assertions passed: " + checks);
        } finally {
            try (Stream<Path> paths = Files.walk(temporary)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).collect(Collectors.toList())) {
                    Files.deleteIfExists(path);
                }
            }
        }
    }
}
