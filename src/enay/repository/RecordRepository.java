package enay.repository;
import enay.model.MaternalProfile;
import enay.model.ChildProfile;
import enay.exception.InvalidRecordException;
import java.util.List;

/** Boundary used by the controller; alternate storage can implement this interface. */
public interface RecordRepository {
    List<MaternalProfile> maternalRecords();
    List<ChildProfile> childRecords();
    boolean maternalFull();
    boolean childFull();
    boolean containsId(String id, boolean maternal);
    boolean hasUnsavedChanges();
    void addMaternal(MaternalProfile record) throws InvalidRecordException;
    void addChild(ChildProfile record) throws InvalidRecordException;
    void loadRecords();
    void loadMetadata();
    boolean saveAll();
    List<String> drainMessages();
}
