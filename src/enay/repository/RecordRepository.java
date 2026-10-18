package enay.repository;
import enay.model.MaternalProfile;
import enay.model.ChildProfile;
import enay.exception.InvalidRecordException;
import java.util.List;
import java.nio.file.Path;

/** Boundary used by the controller; alternate storage can implement this interface. */
public interface RecordRepository {
    List<MaternalProfile> maternalRecords();
    List<ChildProfile> childRecords();
    boolean maternalFull();
    boolean childFull();
    boolean containsId(String id, boolean maternal);
    boolean hasUnsavedChanges();
    /** Whether the last record loads permit saving; saveAll also checks external edits. */
    boolean canSave();
    Path dataDirectory();
    void addMaternal(MaternalProfile record) throws InvalidRecordException;
    void addChild(ChildProfile record) throws InvalidRecordException;
    /** Replace an existing record without changing its ID. Unchanged historical dates are retained. */
    void updateMaternal(String originalId, MaternalProfile record) throws InvalidRecordException;
    void updateChild(String originalId, ChildProfile record) throws InvalidRecordException;
    void loadRecords();
    void loadMetadata();
    boolean saveAll();
    List<String> drainMessages();
}
