package enay.view;
import enay.model.MaternalProfile;
import enay.model.ChildProfile;
import java.util.List;

/** User interaction boundary. A future Swing view can implement the same contract. */
public interface RecordView {
    void showMenu();
    String readLine();
    String readId(boolean maternal);
    String readName(String prompt, String field);
    int readAge();
    String readDate(boolean maternal);
    String readChoice(String field, String first, String second);
    void showMessage(String message);
    void showMaternalRecords(List<MaternalProfile> records);
    void showChildRecords(List<ChildProfile> records);
}
