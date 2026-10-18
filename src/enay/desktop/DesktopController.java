package enay.desktop;

import enay.model.ChildProfile;
import enay.model.MaternalProfile;
import enay.repository.RecordRepository;
import enay.service.BackupExporter;
import javafx.application.Platform;
import java.nio.file.Path;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Event-driven controller. All repository work is serialized away from the FX thread. */
public final class DesktopController implements DesktopView.Actions, AutoCloseable {
    private final RecordRepository repository;
    private final Path dataDirectory;
    private final Consumer<Path> folderOpener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "enay-storage");
        // Finish an in-flight save even if JavaFX exits programmatically.
        thread.setDaemon(false);
        return thread;
    });
    private DesktopView view;
    private boolean busy;
    private boolean dirty;
    private boolean closed;
    private CompletableFuture<Void> idle = CompletableFuture.completedFuture(null);

    public DesktopController(RecordRepository repository, Path dataDirectory, Consumer<Path> folderOpener) {
        this.repository = Objects.requireNonNull(repository);
        this.dataDirectory = Objects.requireNonNull(dataDirectory);
        this.folderOpener = Objects.requireNonNull(folderOpener);
    }

    public void attach(DesktopView view) { this.view = Objects.requireNonNull(view); }
    public boolean isBusy() { return busy; }
    public boolean hasUnsavedChanges() { return dirty; }
    public CompletionStage<Void> whenIdle() { return idle; }

    public void initialize() {
        perform("Loading records", () -> { repository.loadRecords(); return null; });
    }

    @Override public void addMaternal(MaternalProfile record) {
        perform("Saving maternal record", () -> {
            repository.addMaternal(record);
            return saveAfterChange("Maternal record saved");
        });
    }

    @Override public void addChild(ChildProfile record) {
        perform("Saving child record", () -> {
            repository.addChild(record);
            return saveAfterChange("Child record saved");
        });
    }

    @Override public void updateMaternal(String originalId, MaternalProfile record) {
        perform("Saving maternal changes", () -> {
            repository.updateMaternal(originalId, record);
            return saveAfterChange("Maternal changes saved");
        });
    }

    @Override public void updateChild(String originalId, ChildProfile record) {
        perform("Saving child changes", () -> {
            repository.updateChild(originalId, record);
            return saveAfterChange("Child changes saved");
        });
    }

    private String saveAfterChange(String success) throws PersistenceFailure {
        if (!repository.saveAll()) {
            throw new PersistenceFailure("Your changes remain in this session but could not be saved. "
                    + "Review Storage messages before reloading or closing.");
        }
        return success;
    }

    @Override public void save() {
        perform("Saving all records", () -> saveAfterChange("All records saved"));
    }

    @Override public void reload() {
        if (busy || closed || !view.confirmDiscard("Reload")) return;
        perform("Reloading records", () -> { repository.loadMetadata(); repository.loadRecords(); return null; });
    }

    @Override public void exportBackup(Path destination) {
        perform("Exporting backup", () -> {
            if (repository.hasUnsavedChanges()) {
                throw new PersistenceFailure("Save your unsaved changes before exporting a saved backup.");
            }
            // Copy the saved bytes as they are: exporting must never clean or rewrite live files.
            BackupExporter.export(dataDirectory, destination);
            return "Backup exported to " + destination.getFileName();
        });
    }

    @Override public void openDataFolder() {
        try { folderOpener.accept(dataDirectory); }
        catch (RuntimeException e) { view.notifyUser("Unable to open folder", e.getMessage(), true); }
    }

    private void perform(String label, Callable<String> operation) {
        if (!Platform.isFxApplicationThread()) throw new IllegalStateException("Desktop actions must start on the FX thread.");
        if (busy || closed) return;
        busy = true;
        view.setBusy(true, label);
        CompletableFuture<Void> completion = new CompletableFuture<>();
        idle = completion;
        worker.execute(() -> {
            String success = null;
            Exception failure = null;
            try { success = operation.call(); }
            catch (Exception e) { failure = e; }
            Snapshot snapshot = new Snapshot(repository.maternalRecords(), repository.childRecords(),
                    repository.hasUnsavedChanges(), repository.canSave(), repository.drainMessages());
            String notice = success;
            Exception problem = failure;
            Platform.runLater(() -> {
                try {
                    busy = false;
                    if (!closed) {
                        dirty = snapshot.dirty();
                        view.render(snapshot.mothers(), snapshot.children(), dirty);
                        view.setStorageAvailable(snapshot.canSave());
                        view.showDiagnostics(snapshot.messages());
                        view.setBusy(false, "");
                        if (problem != null) view.notifyUser("Action needs attention", problem.getMessage(), true);
                        else if (notice != null) view.notifyUser(label.startsWith("Export") ? "Backup ready" : "Saved locally", notice, false);
                    }
                    completion.complete(null);
                } catch (RuntimeException | LinkageError e) {
                    completion.completeExceptionally(e);
                }
            });
        });
    }

    @Override public void close() {
        if (busy) throw new IllegalStateException("Wait for the current operation before closing.");
        shutdown(() -> { });
    }

    /** Queue lock/resource release after all accepted work, without waiting on FX callbacks. */
    public void shutdown(Runnable afterWork) {
        if (closed) return;
        closed = true;
        worker.execute(Objects.requireNonNull(afterWork));
        worker.shutdown();
    }

    private record Snapshot(List<MaternalProfile> mothers, List<ChildProfile> children,
            boolean dirty, boolean canSave, List<String> messages) { }

    private static final class PersistenceFailure extends Exception {
        private static final long serialVersionUID = 1L;
        private PersistenceFailure(String message) { super(message); }
    }
}
