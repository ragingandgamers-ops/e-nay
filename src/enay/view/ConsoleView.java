package enay.view;
import enay.model.*;
import enay.validation.ValidationUtils;
import enay.exception.InvalidRecordException;
import java.io.PrintStream;
import java.time.LocalDate;
import java.util.*;

/** Owns terminal prompts and rendering; never reads or writes record files. */
public class ConsoleView implements RecordView {
    private final Scanner input;
    private final PrintStream output;
    public ConsoleView(Scanner input, PrintStream output) {
        this.input = Objects.requireNonNull(input);
        this.output = Objects.requireNonNull(output);
    }
    @Override public void showMenu() {
        output.println("\n==============================");
        output.println("         E-NAY SYSTEM         ");
        output.println("==============================");
        output.println("1. Add Maternal Record");
        output.println("2. Add Child Record");
        output.println("3. Display Maternal Records");
        output.println("4. Display Child Records");
        output.println("5. Save All Data");
        output.println("6. Load All Data");
        output.println("7. Exit");
        output.print("Select an option: ");
    }
    @Override public String readLine() {
        try { return input.nextLine(); }
        catch (NoSuchElementException | IllegalStateException e) { return null; }
    }
    private String requireLine() {
        String value = readLine();
        if (value == null) throw new InputClosedException();
        return value;
    }
    @Override public void showMessage(String message) { output.println(message); }
    @Override public String readId(boolean maternal) {
        while (true) {
            output.print(maternal ? "Enter Profile ID (M + exactly 3 digits, e.g., M001): "
                    : "Enter Child ID (C + exactly 3 digits, e.g., C001): ");
            try { return maternal ? ValidationUtils.profileId(requireLine()) : ValidationUtils.childId(requireLine()); }
            catch (InvalidRecordException e) { showMessage(e.getMessage()); }
        }
    }
    @Override public String readName(String prompt, String field) {
        while (true) {
            output.print(prompt);
            try { return ValidationUtils.name(requireLine(), field); }
            catch (InvalidRecordException e) { showMessage(e.getMessage()); }
        }
    }
    @Override public int readAge() {
        while (true) {
            output.print("Enter Age (12-60): ");
            try { return ValidationUtils.parseAge(requireLine()); }
            catch (InvalidRecordException e) { showMessage(e.getMessage()); }
        }
    }
    @Override public String readDate(boolean maternal) {
        while (true) {
            output.print(maternal ? "Enter Expected Delivery Date (YYYY-MM-DD): " : "Enter Date of Birth (YYYY-MM-DD): ");
            try {
                LocalDate date = ValidationUtils.date(requireLine(), maternal ? "Expected delivery date" : "Date of Birth");
                if (maternal) ValidationUtils.newEdd(date); else ValidationUtils.newDob(date);
                return date.toString();
            } catch (InvalidRecordException e) { showMessage(e.getMessage()); }
        }
    }
    @Override public String readChoice(String field, String first, String second) {
        while (true) {
            output.print("Enter " + field + " (" + first + "/" + second + "): ");
            try { return ValidationUtils.choice(requireLine(), field, first, second); }
            catch (InvalidRecordException e) { showMessage(e.getMessage()); }
        }
    }
    @Override public void showMaternalRecords(List<MaternalProfile> records) {
        if (records.isEmpty()) { showMessage("No maternal records found."); return; }
        showMessage("\n--- Maternal Records ---");
        records.forEach(record -> showMessage(record.toString()));
    }
    @Override public void showChildRecords(List<ChildProfile> records) {
        if (records.isEmpty()) { showMessage("No child records found."); return; }
        showMessage("\n--- Child Records ---");
        records.forEach(record -> showMessage(record.toString()));
    }
}
