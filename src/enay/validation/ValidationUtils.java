package enay.validation;

import enay.model.*;
import enay.validation.ValidationUtils;
import enay.exception.InvalidRecordException;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Locale;

/**
 * Centralized validation and normalization helpers for the E-Nay System.
 *
 * Keeping this logic in one utility class (instead of scattering checks across
 * main() and individual model classes) means both MaternalProfile and
 * ChildProfile - and the interactive Main menu - enforce the exact same rules
 * for IDs, names, and dates.
 */
public class ValidationUtils {

    // --- Regex patterns for structured fields -------------------------------
    // Profile ID: "M" followed by exactly 3 digits (e.g., M001)
    public static final String PROFILE_ID_REGEX = "^M\\d{3}$";

    // Child ID: "C" followed by exactly 3 digits (e.g., C001)
    public static final String CHILD_ID_REGEX = "^C\\d{3}$";

    // Date format: strict YYYY-MM-DD shape (does not by itself guarantee the
    // date is a real calendar date - LocalDate.parse still handles that check)
    public static final String DATE_FORMAT_REGEX = "^\\d{4}-\\d{2}-\\d{2}$";

    private ValidationUtils() {
        // Utility class; no instances needed.
    }

    public static boolean isValidProfileId(String id) {
        return id != null && normalizeId(id).matches(PROFILE_ID_REGEX);
    }

    public static boolean isValidChildId(String id) {
        return id != null && normalizeId(id).matches(CHILD_ID_REGEX);
    }

    public static boolean isValidDateFormat(String date) {
        return date != null && date.trim().matches(DATE_FORMAT_REGEX);
    }

    /** Validate Unicode letters/accents and common name punctuation; no digits. */
    public static boolean isValidName(String name) {
        if (name == null || name.indexOf('|') >= 0 || name.indexOf('\n') >= 0 || name.indexOf('\r') >= 0) return false;
        String normalized = normalizeName(name);
        boolean hasLetter = false;
        boolean previousLetterOrMark = false;
        for (int offset = 0; offset < normalized.length();) {
            int c = normalized.codePointAt(offset);
            offset += Character.charCount(c);
            if (Character.isLetter(c)) {
                hasLetter = true;
                previousLetterOrMark = true;
            } else if ((Character.getType(c) == Character.NON_SPACING_MARK
                    || Character.getType(c) == Character.COMBINING_SPACING_MARK) && previousLetterOrMark) {
                // Keep accents which do not compose into a single letter.
            } else if (Character.isWhitespace(c) || Character.isSpaceChar(c)
                    || c == '-' || c == '\'' || c == '\u2019' || c == '.') {
                previousLetterOrMark = false;
            } else return false;
        }
        return hasLetter;
    }

    /** Clean whitespace and Unicode composition without changing name capitalization. */
    public static String normalizeName(String name) {
        return Normalizer.normalize(clean(name).replaceAll("(?U)\\s+", " "), Normalizer.Form.NFC);
    }

    /**
     * Capitalizes only the first letter of a single token (used for values
     * like "Active"/"Inactive" or "Male"/"Female").
     */
    public static String capitalizeFirstLetter(String value) {
        String trimmed = clean(value);
        if (trimmed.isEmpty()) {
            return trimmed;
        }
        return trimmed.substring(0, 1).toUpperCase(Locale.ROOT) + trimmed.substring(1).toLowerCase(Locale.ROOT);
    }

    /**
     * Safely parses an integer, returning null instead of throwing so callers
     * can present a clear, specific message rather than crashing the flow.
     */
    public static Integer safeParseInt(String value) {
        if (value == null) {
            return null;
        }
        try {
            return Integer.parseInt(clean(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("(?U)^\\s+|\\s+$", "");
    }

    public static String normalizeId(String value) {
        return clean(value).toUpperCase(Locale.ROOT);
    }

    public static String text(String value, String field) throws InvalidRecordException {
        if (value == null || clean(value).isEmpty()) throw new InvalidRecordException(field + " cannot be blank.");
        if (value.indexOf('|') >= 0 || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0)
            throw new InvalidRecordException(field + " cannot contain pipes or line breaks.");
        return clean(value);
    }

    public static String profileId(String value) throws InvalidRecordException {
        String id = normalizeId(text(value, "Profile ID"));
        if (!id.matches(PROFILE_ID_REGEX)) throw new InvalidRecordException("Profile ID must be M followed by exactly 3 digits (e.g., M001).");
        return id;
    }

    public static String childId(String value) throws InvalidRecordException {
        String id = normalizeId(text(value, "Child ID"));
        if (!id.matches(CHILD_ID_REGEX)) throw new InvalidRecordException("Child ID must be C followed by exactly 3 digits (e.g., C001).");
        return id;
    }

    public static String name(String value, String field) throws InvalidRecordException {
        String normalized = normalizeName(text(value, field));
        if (!isValidName(normalized)) throw new InvalidRecordException(field + " must contain letters; only spaces, hyphens, apostrophes, and periods are allowed with letters. Digits are not allowed.");
        return normalized;
    }

    public static String choice(String value, String field, String first, String second) throws InvalidRecordException {
        String cleaned = text(value, field);
        if (cleaned.equalsIgnoreCase(first)) return first;
        if (cleaned.equalsIgnoreCase(second)) return second;
        throw new InvalidRecordException(field + " must be " + first + " or " + second + ".");
    }

    public static int parseAge(String value) throws InvalidRecordException {
        Integer parsed = safeParseInt(value);
        if (parsed == null) throw new InvalidRecordException("Please enter a valid numeric age.");
        age(parsed);
        return parsed;
    }

    public static void age(int value) throws InvalidRecordException {
        if (value < 12 || value > 60) throw new InvalidRecordException("Age must be between 12 and 60.");
    }

    public static LocalDate date(String value, String field) throws InvalidRecordException {
        String cleaned = text(value, field);
        if (!isValidDateFormat(cleaned)) throw new InvalidRecordException(field + " must use YYYY-MM-DD format.");
        try {
            LocalDate parsed = LocalDate.parse(cleaned);
            if (parsed.getYear() == 0) throw new InvalidRecordException(field + " year must be at least 0001.");
            return parsed;
        } catch (DateTimeParseException e) {
            throw new InvalidRecordException(field + " must be a valid date in YYYY-MM-DD format.");
        }
    }

    public static void newEdd(LocalDate value) throws InvalidRecordException {
        if (value.isBefore(LocalDate.now())) throw new InvalidRecordException("Expected delivery date must be today or in the future.");
    }

    public static void dob(LocalDate value) throws InvalidRecordException {
        if (value.isAfter(LocalDate.now())) throw new InvalidRecordException("Date of Birth cannot be in the future.");
    }

    public static void newDob(LocalDate value) throws InvalidRecordException {
        dob(value);
        if (value.isBefore(LocalDate.now().minusYears(2))) throw new InvalidRecordException("E-Nay only monitors children up to 2 years old (24 months).");
    }
}
