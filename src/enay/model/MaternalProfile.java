package enay.model;

import enay.model.*;
import enay.validation.ValidationUtils;
import enay.exception.InvalidRecordException;
public class MaternalProfile {
    private String profileId;
    private String motherName;
    private int age;
    private String expectedDeliveryDate;
    private String status;

    public MaternalProfile(String profileId, String motherName, int age, String expectedDeliveryDate, String status)
            throws InvalidRecordException {
        this.profileId = ValidationUtils.profileId(profileId);
        this.motherName = ValidationUtils.name(motherName, "Mother's name");
        ValidationUtils.age(age);
        this.age = age;
        // A saved delivery date may legitimately be in the past.
        this.expectedDeliveryDate = ValidationUtils.date(expectedDeliveryDate, "Expected delivery date").toString();
        this.status = ValidationUtils.choice(status, "Status", "Active", "Inactive");
    }

    public static MaternalProfile fromTextFormat(String line) throws InvalidRecordException {
        if (line == null || line.trim().isEmpty()) {
            throw new InvalidRecordException("Empty maternal record line.");
        }

        String[] fields = line.split("\\|", -1);
        if (fields.length != 5) {
            throw new InvalidRecordException("Malformed maternal record (expected 5 fields): " + line);
        }

        String profileId = fields[0].trim();
        String motherName = fields[1].trim();
        String ageStr = fields[2].trim();
        String edd = fields[3].trim();
        String status = fields[4].trim();

        if (profileId.isEmpty() || motherName.isEmpty() || edd.isEmpty() || status.isEmpty()) {
            throw new InvalidRecordException("Malformed maternal record (missing field values): " + line);
        }

        int age;
        try {
            age = Integer.parseInt(ageStr);
        } catch (NumberFormatException e) {
            throw new InvalidRecordException("Invalid age value in maternal record: " + line);
        }

        return new MaternalProfile(profileId, motherName, age, edd, status);
    }

    public String toTextFormat() {
        return profileId + "|" + motherName + "|" + age + "|" + expectedDeliveryDate + "|" + status;
    }

    @Override
    public String toString() {
        return "ID: " + profileId + " | Name: " + motherName + " | Age: " + age + 
               " | EDD: " + expectedDeliveryDate + " | Status: " + status;
    }

    // Getters
    public String getProfileId() { return profileId; }
    public String getMotherName() { return motherName; }
    public int getAge() { return age; }
    public String getExpectedDeliveryDate() { return expectedDeliveryDate; }
    public String getStatus() { return status; }
}
