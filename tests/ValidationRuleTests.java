import enay.model.*;
import enay.validation.ValidationUtils;
import enay.exception.InvalidRecordException;
import enay.repository.FileRecordRepository;
import enay.controller.RecordController;
import enay.view.ConsoleView;
import java.time.LocalDate;
import java.util.Locale;

/** E-Nay validation rules and normalization checks. */
public class ValidationRuleTests {
    private static int checks;

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
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
        for (String id : new String[] {"M000", "M001", "M999", " m012 "}) {
            check(ValidationUtils.isValidProfileId(id), "Valid maternal ID rejected: " + id);
            check(ValidationUtils.profileId(id).matches("M[0-9]{3}"), "ID normalization failed");
        }
        for (String id : new String[] {"C000", "C001", "C999", " c012 "}) {
            check(ValidationUtils.isValidChildId(id), "Valid child ID rejected: " + id);
            check(ValidationUtils.childId(id).matches("C[0-9]{3}"), "ID normalization failed");
        }
        for (String id : new String[] {null, "", "M01", "M0001", "M1234", "M12345", "C001", "001", "M00A", "M１２３"}) {
            check(!ValidationUtils.isValidProfileId(id), "Bad maternal ID accepted: " + id);
            invalid(() -> ValidationUtils.profileId(id));
        }
        for (String id : new String[] {null, "", "C01", "C0001", "C1234", "C12345", "M001", "001", "C00A", "C１２３"}) {
            check(!ValidationUtils.isValidChildId(id), "Bad child ID accepted: " + id);
            invalid(() -> ValidationUtils.childId(id));
        }
        for (String name : new String[] {"McDonald", "J. P. Santos", "O'Neill", "O’Neill", "Anne-Marie", "de la Cruz",
                "José", "Prince Dimalanta Jr.", "John Santos III", "王小明", "𐐀 Smith"}) {
            check(ValidationUtils.isValidName(name), "Valid name rejected: " + name);
            check(ValidationUtils.name(name, "Name").equals(name), "Legitimate capitalization changed: " + name);
        }
        check(ValidationUtils.name(" \tMcDonald\u00A0  J. P.  ", "Name").equals("McDonald J. P."), "Whitespace cleanup failed");
        check(ValidationUtils.name("Jose\u0301", "Name").equals("José"), "Combining accent not normalized");
        check(ValidationUtils.name("pRiNce", "Name").equals("pRiNce"), "Name capitalization was guessed");
        for (String name : new String[] {null, "", "   ", "\u00A0\u2003", "...", "---", "1234", "Maria 1234",
                "Joseph the 3rd", "Name|Other", "Name\nOther", "Name\rOther", "Name@Other", "😀", "\u0301"}) {
            check(!ValidationUtils.isValidName(name), "Bad name accepted");
            invalid(() -> ValidationUtils.name(name, "Name"));
        }
        for (String bad : new String[] {null, "", "abc", "2147483648", "28.5"}) {
            check(ValidationUtils.safeParseInt(bad) == null, "Bad integer accepted");
            invalid(() -> ValidationUtils.parseAge(bad));
        }
        check(ValidationUtils.parseAge(" 12 ") == 12, "Lower age boundary rejected");
        check(ValidationUtils.parseAge("60") == 60, "Upper age boundary rejected");
        invalid(() -> ValidationUtils.parseAge("11"));
        invalid(() -> ValidationUtils.parseAge("61"));
        for (String bad : new String[] {"2026/10/15", "2026-1-01", "2026-02-30", "2025-02-29", "0000-01-01"}) {
            invalid(() -> ValidationUtils.date(bad, "Date"));
        }
        check(ValidationUtils.date("2024-02-29", "Date").equals(LocalDate.of(2024, 2, 29)), "Leap date rejected");

        LocalDate today = LocalDate.now();
        String maternal = "M001|McDonald J. P.|28|" + today + "|Active";
        MaternalProfile mother = MaternalProfile.fromTextFormat(" m001 |  McDonald   J. P. |28|" + today + "|aCtIvE");
        check(mother.toTextFormat().equals(maternal), "Maternal parser/model normalization differs");
        ChildProfile child = ChildProfile.fromTextFormat(" c001 |  O'Neill  Jr. |mAlE|" + today + "| McDonald  J. P. |INACTIVE");
        check(child.toTextFormat().equals("C001|O'Neill Jr.|Male|" + today + "|McDonald J. P.|Inactive"), "Child normalization differs");
        invalid(() -> new MaternalProfile("M1000", "Mother", 28, today.toString(), "Active"));
        invalid(() -> new ChildProfile("C1000", "Child", "Male", today.toString(), "Mother", "Active"));
        invalid(() -> MaternalProfile.fromTextFormat("M1000|Mother|28|" + today + "|Active"));
        invalid(() -> ChildProfile.fromTextFormat("C1000|Child|Male|" + today + "|Mother|Active"));

        Locale original = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"));
            check(ValidationUtils.choice("INACTIVE", "Status", "Active", "Inactive").equals("Inactive"), "Locale affected status");
            check(ValidationUtils.capitalizeFirstLetter("INACTIVE").equals("Inactive"), "Locale affected capitalization");
            check(ValidationUtils.profileId("m001").equals("M001"), "Locale affected ID");
            check(ValidationUtils.normalizeName("McDonald III").equals("McDonald III"), "Locale affected name");
        } finally {
            Locale.setDefault(original);
        }
        System.out.println("PASS: " + checks + " validation assertions");
    }
}
