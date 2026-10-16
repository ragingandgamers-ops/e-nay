import enay.model.*;
import enay.validation.ValidationUtils;
import enay.exception.InvalidRecordException;
import enay.repository.FileRecordRepository;
import enay.controller.RecordController;
import enay.view.ConsoleView;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDate;
import java.io.*;

/** Runs only in the disposable working directory created by run_tests.py. */
public class RegressionTests {
    private static int checks;
    private static final FileRecordRepository repository = new FileRecordRepository(Paths.get("data"));
    private static final Path MATERNAL = Paths.get("data", "maternal_records.txt");
    private static final Path CHILD = Paths.get("data", "child_records.txt");

    private static Object invoke(String name) throws Exception {
        Method method = FileRecordRepository.class.getDeclaredMethod(name);
        method.setAccessible(true);
        try {
            return method.invoke(repository);
        } catch (InvocationTargetException e) {
            throw new AssertionError(name + " failed", e.getCause());
        }
    }

    private static Object field(String name) throws Exception {
        Field field = FileRecordRepository.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(repository);
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
    }

    private static void counts(int maternal, int child) throws Exception {
        check((int) field("maternalCount") == maternal, "Wrong maternal count");
        check((int) field("childCount") == child, "Wrong child count");
        Object[] mothers = (Object[]) field("maternalRecords");
        Object[] children = (Object[]) field("childRecords");
        for (int i = 0; i < maternal; i++) check(mothers[i] != null, "Null maternal slot " + i);
        for (int i = 0; i < child; i++) check(children[i] != null, "Null child slot " + i);
    }

    @FunctionalInterface
    private interface InvalidAction { void run() throws Exception; }

    private static void invalid(InvalidAction action) throws Exception {
        try {
            action.run();
            throw new AssertionError("Expected InvalidRecordException");
        } catch (InvalidRecordException expected) {
            checks++;
        }
    }

    public static void main(String[] args) throws Exception {
        Files.createDirectories(Paths.get("data"));
        String today = LocalDate.now().toString();
        String mother1 = "M001|Ana Santos|28|2026-12-15|Active\n";
        String mother2 = "M003|Carla Reyes|31|2027-01-20|Active\n";
        String child1 = "C001|Baby One|Male|" + today + "|Ana Santos|Active\n";
        String child2 = "C003|Baby Two|Female|" + today + "|Carla Reyes|Inactive\n";
        Files.writeString(MATERNAL, mother1 + "BROKEN|ROW\n" + mother2);
        Files.writeString(CHILD, child1 + "BROKEN|ROW\n" + child2);
        invoke("loadTextRecords");
        counts(2, 2);
        new ConsoleView(new java.util.Scanner(""), System.out).showMaternalRecords(repository.maternalRecords());
        new ConsoleView(new java.util.Scanner(""), System.out).showChildRecords(repository.childRecords());
        check(((MaternalProfile[]) field("maternalRecords"))[1].getProfileId().equals("M003"),
                "Second maternal row lost");
        check(((ChildProfile[]) field("childRecords"))[1].getChildId().equals("C003"),
                "Second child row lost");

        // Reload must preserve the actual array, not just restore the count.
        Object mothers = field("maternalRecords");
        Object children = field("childRecords");
        Files.delete(MATERNAL);
        Files.delete(CHILD);
        invoke("loadTextRecords");
        counts(2, 2);
        check(mothers == field("maternalRecords"), "Missing file replaced maternal array");
        check(children == field("childRecords"), "Missing file replaced child array");
        Files.createDirectory(MATERNAL);
        Files.createDirectory(CHILD);
        invoke("loadTextRecords");
        counts(2, 2);
        check(mothers == field("maternalRecords"), "Unreadable file replaced maternal array");
        check(children == field("childRecords"), "Unreadable file replaced child array");
        check(!(boolean) invoke("saveTextRecords"), "Failed save reported success");
        Files.delete(MATERNAL);
        Files.delete(CHILD);

        // An encoding/read failure must not commit a partially loaded replacement.
        Files.write(MATERNAL, new byte[] {(byte) 0xC3, (byte) 0x28});
        Files.write(CHILD, new byte[] {(byte) 0xC3, (byte) 0x28});
        invoke("loadTextRecords");
        check(mothers == field("maternalRecords"), "Read failure replaced maternal records");
        check(children == field("childRecords"), "Read failure replaced child records");
        check(!(boolean) invoke("saveTextRecords"), "Unreadable source was allowed to be overwritten");
        check(java.util.Arrays.equals(Files.readAllBytes(MATERNAL), new byte[] {(byte) 0xC3, (byte) 0x28}),
                "Failed reload damaged maternal source");
        check(java.util.Arrays.equals(Files.readAllBytes(CHILD), new byte[] {(byte) 0xC3, (byte) 0x28}),
                "Failed reload damaged child source");

        // Duplicates are skipped, case-insensitively, and do not consume slots.
        Files.writeString(MATERNAL, mother1 + mother1.replace("M001", "m001") + mother2);
        Files.writeString(CHILD, child1 + child1.replace("C001", "c001") + child2);
        invoke("loadTextRecords");
        counts(2, 2);

        check((boolean) invoke("saveTextRecords"), "Valid save failed");
        invoke("saveSystemData");
        check(Files.readAllLines(MATERNAL).size() == 2, "Wrong maternal saved count");
        check(Files.readAllLines(CHILD).size() == 2, "Wrong child saved count");
        // Simulate a disk/write error after writing part of the temporary file.
        String original = Files.readString(MATERNAL);
        Class<?> writerAction = Class.forName("enay.repository.FileRecordRepository$FileWriterAction");
        Object failingWriter = Proxy.newProxyInstance(writerAction.getClassLoader(),
                new Class<?>[] {writerAction}, (proxy, method, parameters) -> {
                    Files.writeString((Path) parameters[0], "partial replacement");
                    throw new IOException("Simulated write failure");
                });
        Method replace = FileRecordRepository.class.getDeclaredMethod("replaceFile", String.class, writerAction);
        replace.setAccessible(true);
        try {
            replace.invoke(repository, MATERNAL.toString(), failingWriter);
            throw new AssertionError("Expected save failure");
        } catch (InvocationTargetException e) {
            check(e.getCause() instanceof IOException, "Wrong save failure exception");
        }
        check(Files.readString(MATERNAL).equals(original), "Failed write damaged previous save");
        try (java.util.stream.Stream<Path> paths = Files.walk(Paths.get("."))) {
            check(paths.noneMatch(path -> path.toString().endsWith(".tmp")), "Temporary save file leaked");
        }
        try (DataInputStream input = new DataInputStream(Files.newInputStream(Paths.get("data", "system_data.dat")))) {
            check(input.readInt() == 2 && input.readInt() == 2 && input.read() == -1, "Wrong binary counts");
        }
        invoke("loadSystemData");
        invoke("loadTextRecords");
        counts(2, 2);

        StringBuilder motherRows = new StringBuilder("BROKEN\n");
        StringBuilder childRows = new StringBuilder("BROKEN\n");
        for (int i = 0; i < 101; i++) {
            motherRows.append(String.format("M%03d", i)).append("|Mother|28|").append(today).append("|Active\n");
            childRows.append(String.format("C%03d", i)).append("|Child|Male|").append(today).append("|Mother|Active\n");
        }
        Files.writeString(MATERNAL, motherRows);
        Files.writeString(CHILD, childRows);
        invoke("loadTextRecords");
        counts(100, 100);
        check(!(boolean) invoke("saveTextRecords"), "Overflow file was allowed to be truncated by saving");
        check(Files.readString(MATERNAL).equals(motherRows.toString()), "Overflow damaged maternal source");
        check(Files.readString(CHILD).equals(childRows.toString()), "Overflow damaged child source");

        // A duplicate after the 100th record does not mean there are 101 unique records.
        Files.writeString(MATERNAL, motherRows.toString().replace("M100|", "M000|"));
        Files.writeString(CHILD, childRows.toString().replace("C100|", "C000|"));
        invoke("loadTextRecords");
        check((boolean) invoke("saveTextRecords"), "Duplicate at capacity incorrectly blocked save");

        // Smaller and empty successful files replace all stale slots.
        Files.writeString(MATERNAL, mother1);
        Files.writeString(CHILD, "");
        invoke("loadTextRecords");
        counts(1, 0);
        Object preservedMothers = field("maternalRecords");
        Object preservedChildren = field("childRecords");
        String brokenRows = "BROKEN|ROW\nALSO BROKEN\n";
        Files.writeString(MATERNAL, brokenRows);
        Files.writeString(CHILD, brokenRows);
        invoke("loadTextRecords");
        counts(1, 0);
        check(preservedMothers == field("maternalRecords"), "All-invalid maternal load cleared current records");
        check(preservedChildren == field("childRecords"), "All-invalid child load cleared current records");
        check(!(boolean) invoke("saveTextRecords"), "All-invalid load allowed a destructive save");
        check(Files.readString(MATERNAL).equals(brokenRows), "All-invalid maternal file was erased");
        check(Files.readString(CHILD).equals(brokenRows), "All-invalid child file was erased");
        Files.writeString(MATERNAL, mother1);
        Files.writeString(CHILD, "");
        invoke("loadTextRecords");
        check((boolean) invoke("saveTextRecords"), "Repaired files did not unblock saving");
        check(((Object[]) field("maternalRecords"))[1] == null, "Stale maternal tail retained");
        check(((Object[]) field("childRecords"))[0] == null, "Stale child tail retained");
        check((boolean) invoke("saveTextRecords"), "Successful reload did not unblock saving");

        // A UTF-8 BOM must not become an invisible part of the first ID.
        Files.writeString(MATERNAL, "\uFEFF" + mother1 + mother1.replace("M001", "m001") + mother2);
        Files.writeString(CHILD, "\uFEFF" + child1 + child1.replace("C001", "c001") + child2);
        invoke("loadTextRecords");
        counts(2, 2);
        check(((MaternalProfile[]) field("maternalRecords"))[0].getProfileId().equals("M001"), "BOM changed maternal ID");
        check(((ChildProfile[]) field("childRecords"))[0].getChildId().equals("C001"), "BOM changed child ID");
        check((boolean) invoke("saveTextRecords"), "BOM load blocked valid save");
        check(!Files.readString(MATERNAL).startsWith("\uFEFF"), "BOM leaked into saved maternal ID");
        Files.writeString(CHILD, "");

        invalid(() -> new MaternalProfile(" ", "Mother", 28, today, "Active"));
        invalid(() -> new MaternalProfile("M001", "Mother|Other", 28, today, "Active"));
        invalid(() -> new MaternalProfile("M001", "Mother", 11, today, "Active"));
        invalid(() -> new MaternalProfile("M001", "Mother", 61, today, "Active"));
        invalid(() -> new MaternalProfile("M001", "Mother", 28, "2026-02-30", "Active"));
        invalid(() -> new MaternalProfile("M001", "Mother", 28, today, "Unknown"));
        invalid(() -> new ChildProfile("C001", "Child", "Unknown", today, "Mother", "Active"));
        invalid(() -> new ChildProfile("C001", "Child", "Male", today, "", "Active"));
        invalid(() -> new ChildProfile("C001", "Child", "Male", LocalDate.now().plusDays(1).toString(), "Mother", "Active"));
        invalid(() -> MaternalProfile.fromTextFormat("M001|Mother|abc|" + today + "|Active"));
        invalid(() -> ChildProfile.fromTextFormat("C001|Child|Male|" + today + "|Mother|Active|extra"));
        invalid(() -> ValidationUtils.newEdd(LocalDate.now().minusDays(1)));
        ValidationUtils.newDob(LocalDate.now().minusYears(2));
        invalid(() -> ValidationUtils.newDob(LocalDate.now().minusYears(2).minusDays(1)));
        invalid(() -> ValidationUtils.newDob(LocalDate.now().plusDays(1)));
        ChildProfile historical = ChildProfile.fromTextFormat("C001|Child|Male|"
                + LocalDate.now().minusYears(3) + "|Mother|Inactive");
        check(historical.getStatus().equals("Inactive"), "Historical child record lost");
        String unicode = "M009|María 王|28|" + today + "|active";
        Files.writeString(MATERNAL, unicode, StandardCharsets.UTF_8);
        invoke("loadTextRecords");
        check((boolean) invoke("saveTextRecords"), "Unicode save failed");
        check(Files.readString(MATERNAL).contains("María 王"), "Unicode round trip failed");

        Files.write(Paths.get("data", "system_data.dat"), new byte[] {0});
        invoke("loadSystemData");
        try (DataOutputStream out = new DataOutputStream(Files.newOutputStream(Paths.get("data", "system_data.dat")))) {
            out.writeInt(-1);
            out.writeInt(0);
        }
        invoke("loadSystemData");
        counts(1, 0);
        System.out.println("PASS: " + checks + " regression assertions");
    }
}
