import enay.model.*;
import enay.validation.ValidationUtils;
import enay.exception.InvalidRecordException;
import enay.repository.FileRecordRepository;
import enay.controller.RecordController;
import enay.view.ConsoleView;
import java.io.IOException;
import java.lang.reflect.*;
import java.nio.file.*;
import java.time.LocalDate;
import java.util.Scanner;

/** Failure injection and external-change checks, run only in a temporary folder. */
public class SafetyRegressionTests {
    private static int checks;
    private static final FileRecordRepository repository = new FileRecordRepository(Paths.get("data"));

    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
        checks++;
    }

    private static Object invoke(String name, Class<?>[] types, Object... values) throws Exception {
        Method method = FileRecordRepository.class.getDeclaredMethod(name, types);
        method.setAccessible(true);
        try {
            return method.invoke(repository, values);
        } catch (InvocationTargetException e) {
            throw new AssertionError(name + " failed", e.getCause());
        }
    }

    private static Object invoke(String name) throws Exception {
        return invoke(name, new Class<?>[0]);
    }

    private static void expectIoFailure(Method method, Object... args) throws Exception {
        try {
            method.invoke(repository, args);
            throw new AssertionError("Expected injected I/O failure");
        } catch (InvocationTargetException e) {
            check(e.getCause() instanceof IOException, "Wrong failure type: " + e.getCause());
        }
    }

    public static void main(String[] args) throws Exception {
        Files.createDirectories(Paths.get("data"));
        Path mothers = Paths.get("data", "maternal_records.txt");
        Path children = Paths.get("data", "child_records.txt");
        String first = "M001|Original Mother|28|" + LocalDate.now() + "|Active\n";
        String edited = first.replace("Original Mother", "Edited Mother");
        String child = "C001|Child|Male|" + LocalDate.now() + "|Mother|Active\n";
        Files.writeString(mothers, first);
        Files.writeString(children, child);
        invoke("loadTextRecords");
        Files.writeString(mothers, edited);
        check(!(boolean) invoke("saveTextRecords"), "Save overwrote external edit");
        check(Files.readString(mothers).equals(edited), "External maternal edit lost");
        check(Files.readString(children).equals(child), "Save changed sibling file despite conflict");
        invoke("loadTextRecords");
        check((boolean) invoke("saveTextRecords"), "Reload did not accept new source version");
        Files.delete(children);
        check(!(boolean) invoke("saveTextRecords"), "Save recreated externally deleted file without reloading");
        check(!Files.exists(children), "External deletion ignored");
        invoke("loadTextRecords");
        Files.writeString(children, child.replace("Child|Male", "External Child|Male"));
        check(!(boolean) invoke("saveTextRecords"), "Save overwrote externally created file");
        invoke("loadTextRecords");

        Scanner addition = new Scanner("M002\nUnsaved Mother\n28\n" + LocalDate.now() + "\nActive\n");
        new RecordController(repository, new ConsoleView(addition, System.out)).addMaternalRecord();
        check(!new RecordController(repository, new ConsoleView(new Scanner("No\n"), System.out)).confirmDiscard("Reload"), "Reload ignored refusal to discard");
        check(!new RecordController(repository, new ConsoleView(new Scanner("No\n"), System.out)).confirmDiscard("Exit"), "Exit ignored refusal to discard");
        check((boolean) invoke("saveTextRecords"), "Saving unsaved addition failed");
        check(new RecordController(repository, new ConsoleView(new Scanner(""), System.out)).confirmDiscard("Exit"), "Saved records still require discard confirmation");
        check(Files.readAllLines(mothers).size() == 2, "Unsaved addition was lost");

        Class<?> writerType = Class.forName("enay.repository.FileRecordRepository$FileWriterAction");
        Class<?> moverType = Class.forName("enay.repository.FileRecordRepository$FileMoveAction");
        Class<?> writerArrayType = Array.newInstance(writerType, 0).getClass();
        Method groupSave = FileRecordRepository.class.getDeclaredMethod("replaceFiles", String[].class, writerArrayType, moverType);
        groupSave.setAccessible(true);
        String[] names = {"transaction-first.txt", "transaction-second.txt", "transaction-third.txt"};

        // Failing either the second or third replacement must restore every earlier file.
        for (int failureIndex : new int[] {1, 2}) {
            for (int i = 0; i < names.length; i++) Files.writeString(Paths.get(names[i]), "old-" + i);
            Object writers = writers(writerType, names.length, -1);
            int[] moves = {0};
            Object mover = Proxy.newProxyInstance(moverType.getClassLoader(), new Class<?>[] {moverType},
                    (proxy, method, parameters) -> {
                        if (moves[0]++ == failureIndex) throw new IOException("Injected replacement failure");
                        Files.move((Path) parameters[0], (Path) parameters[1], StandardCopyOption.REPLACE_EXISTING);
                        return null;
                    });
            expectIoFailure(groupSave, names, writers, mover);
            for (int i = 0; i < names.length; i++) {
                check(Files.readString(Paths.get(names[i])).equals("old-" + i), "Rollback lost file " + i);
            }
            noTemporaryFiles();
        }

        // If all targets were absent, rollback removes newly created files.
        for (String name : names) Files.delete(Paths.get(name));
        int[] moves = {0};
        Object failingMover = Proxy.newProxyInstance(moverType.getClassLoader(), new Class<?>[] {moverType},
                (proxy, method, parameters) -> {
                    if (moves[0]++ == 1) throw new IOException("Injected replacement failure");
                    Files.move((Path) parameters[0], (Path) parameters[1], StandardCopyOption.REPLACE_EXISTING);
                    return null;
                });
        expectIoFailure(groupSave, names, writers(writerType, names.length, -1), failingMover);
        for (String name : names) check(!Files.exists(Paths.get(name)), "Rollback left a new saved file");
        noTemporaryFiles();

        // A failure while staging the third file must not change either existing target.
        for (int i = 0; i < names.length; i++) Files.writeString(Paths.get(names[i]), "old-" + i);
        Object mover = Proxy.newProxyInstance(moverType.getClassLoader(), new Class<?>[] {moverType},
                (proxy, method, parameters) -> {
                    throw new AssertionError("Staging failure reached commit");
                });
        expectIoFailure(groupSave, names, writers(writerType, names.length, 2), mover);
        for (int i = 0; i < names.length; i++) {
            check(Files.readString(Paths.get(names[i])).equals("old-" + i), "Staging failure damaged file " + i);
        }
        noTemporaryFiles();
        System.out.println("PASS: " + checks + " additional safety assertions");
    }

    private static Object writers(Class<?> writerType, int count, int failureIndex) {
        Object writers = Array.newInstance(writerType, count);
        for (int i = 0; i < count; i++) {
            final int index = i;
            Array.set(writers, i, Proxy.newProxyInstance(writerType.getClassLoader(), new Class<?>[] {writerType},
                    (proxy, method, parameters) -> {
                        Files.writeString((Path) parameters[0], "new-" + index);
                        if (index == failureIndex) throw new IOException("Injected partial write failure");
                        return null;
                    }));
        }
        return writers;
    }

    private static void noTemporaryFiles() throws IOException {
        try (java.util.stream.Stream<Path> files = Files.walk(Paths.get("."))) {
            check(files.noneMatch(path -> path.toString().endsWith(".tmp")
                    || path.toString().endsWith(".backup")), "Save leaked staging or backup files");
        }
    }
}
