package enay.model;

import enay.model.*;
import enay.validation.ValidationUtils;
import enay.exception.InvalidRecordException;
import java.time.LocalDate;

public class ChildProfile {
    private String childId;
    private String childName;
    private String gender;
    private String dateOfBirth;
    private String motherName;
    private String status;

    public ChildProfile(String childId, String childName, String gender, String dateOfBirth, String motherName, String status)
            throws InvalidRecordException {
        this.childId = ValidationUtils.childId(childId);
        this.childName = ValidationUtils.name(childName, "Child's name");
        this.gender = ValidationUtils.choice(gender, "Gender", "Male", "Female");
        LocalDate dob = ValidationUtils.date(dateOfBirth, "Date of Birth");
        ValidationUtils.dob(dob);
        // Preserve historical records after a child ages out of monitoring.
        this.dateOfBirth = dob.toString();
        this.motherName = ValidationUtils.name(motherName, "Mother's name");
        this.status = ValidationUtils.choice(status, "Status", "Active", "Inactive");
    }

    public static ChildProfile fromTextFormat(String line) throws InvalidRecordException {
        if (line == null || line.trim().isEmpty()) {
            throw new InvalidRecordException("Empty child record line.");
        }

        String[] fields = line.split("\\|", -1);
        if (fields.length != 6) {
            throw new InvalidRecordException("Malformed child record (expected 6 fields): " + line);
        }

        String childId = fields[0].trim();
        String childName = fields[1].trim();
        String gender = fields[2].trim();
        String dobStr = fields[3].trim();
        String motherName = fields[4].trim();
        String status = fields[5].trim();

        if (childId.isEmpty() || childName.isEmpty() || gender.isEmpty() || dobStr.isEmpty()
                || motherName.isEmpty() || status.isEmpty()) {
            throw new InvalidRecordException("Malformed child record (missing field values): " + line);
        }

        return new ChildProfile(childId, childName, gender, dobStr, motherName, status);
    }

    public String toTextFormat() {
        return childId + "|" + childName + "|" + gender + "|" + dateOfBirth + "|" + motherName + "|" + status;
    }

    @Override
    public String toString() {
        return "ID: " + childId + " | Name: " + childName + " | Gender: " + gender + 
               " | DOB: " + dateOfBirth + " | Mother: " + motherName + " | Status: " + status;
    }

    // Getters
    public String getChildId() { return childId; }
    public String getChildName() { return childName; }
    public String getGender() { return gender; }
    public String getDateOfBirth() { return dateOfBirth; }
    public String getMotherName() { return motherName; }
    public String getStatus() { return status; }
}
