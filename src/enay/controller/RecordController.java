package enay.controller;
import enay.model.*;
import enay.exception.InvalidRecordException;
import enay.repository.RecordRepository;
import enay.view.RecordView;
import enay.view.InputClosedException;
import java.util.Objects;

/** Coordinates user actions through view and repository interfaces. */
public class RecordController {
    private final RecordRepository repository;
    private final RecordView view;
    public RecordController(RecordRepository repository, RecordView view) {
        this.repository = Objects.requireNonNull(repository);
        this.view = Objects.requireNonNull(view);
    }
    private void showStorageMessages() { repository.drainMessages().forEach(view::showMessage); }
    public void run() {
        repository.loadRecords();
        showStorageMessages();
        boolean running = true;
        while (running) {
            view.showMenu();
            String raw = view.readLine();
            if (raw == null) { view.showMessage("\nInput stream closed unexpectedly. Exiting E-Nay System..."); break; }
            int choice;
            try { choice = Integer.parseInt(raw.trim()); }
            catch (NumberFormatException e) { view.showMessage("Invalid input! Please enter a number."); continue; }
            try {
                switch (choice) {
                    case 1: addMaternalRecord(); break;
                    case 2: addChildRecord(); break;
                    case 3: view.showMaternalRecords(repository.maternalRecords()); break;
                    case 4: view.showChildRecords(repository.childRecords()); break;
                    case 5: repository.saveAll(); showStorageMessages(); break;
                    case 6:
                        if (confirmDiscard("Reload")) {
                            repository.loadMetadata(); repository.loadRecords(); showStorageMessages();
                        }
                        break;
                    case 7:
                        if (confirmDiscard("Exit")) { running = false; view.showMessage("Exiting E-Nay System..."); }
                        break;
                    default: view.showMessage("Invalid choice. Select between 1 and 7.");
                }
            } catch (InputClosedException e) {
                view.showMessage("\nInput stream closed unexpectedly. Exiting E-Nay System..."); running = false;
            } catch (InvalidRecordException e) {
                view.showMessage("Record was not added: " + e.getMessage());
            } catch (RuntimeException e) {
                view.showMessage("An unexpected error occurred: " + e.getMessage());
                view.showMessage("Returning to the main menu.");
            }
        }
    }
    public boolean confirmDiscard(String action) {
        if (!repository.hasUnsavedChanges()) return true;
        view.showMessage(action + " will discard unsaved records. Choose No to return and save with option 5.");
        return view.readChoice("Continue", "Yes", "No").equals("Yes");
    }
    private String uniqueId(boolean maternal) {
        while (true) {
            String id = view.readId(maternal);
            if (!repository.containsId(id, maternal)) return id;
            view.showMessage("ID already exists. Enter a unique ID.");
        }
    }
    public void addMaternalRecord() throws InvalidRecordException {
        if (repository.maternalFull()) { view.showMessage("Maternal record array is full!"); return; }
        String id = uniqueId(true);
        String name = view.readName("Enter Mother's Name: ", "Mother's name");
        int age = view.readAge();
        String date = view.readDate(true);
        String status = view.readChoice("Status", "Active", "Inactive");
        repository.addMaternal(new MaternalProfile(id, name, age, date, status));
        view.showMessage("Maternal Record added successfully!");
    }
    public void addChildRecord() throws InvalidRecordException {
        if (repository.childFull()) { view.showMessage("Child record array is full!"); return; }
        String id = uniqueId(false);
        String name = view.readName("Enter Child's Name: ", "Child's name");
        String gender = view.readChoice("Gender", "Male", "Female");
        String date = view.readDate(false);
        String mother = view.readName("Enter Mother's Name: ", "Mother's name");
        String status = view.readChoice("Status", "Active", "Inactive");
        repository.addChild(new ChildProfile(id, name, gender, date, mother, status));
        view.showMessage("Child Record added successfully!");
    }
}
