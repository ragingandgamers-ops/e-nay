import enay.desktop.DesktopController;
import enay.desktop.DesktopView;
import enay.model.ChildProfile;
import enay.model.MaternalProfile;
import enay.repository.FileRecordRepository;
import javafx.application.Platform;
import javafx.scene.Node;
import javafx.scene.Parent;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.image.WritableImage;
import javafx.stage.Stage;
import javafx.stage.Window;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;

/** Uses actual JavaFX controls and controller background tasks, never live data. */
public final class DesktopWorkflowTests {
    private static int checks;
    private static Stage stage;
    private static DesktopView view;
    private static DesktopController controller;
    private static FileRecordRepository repository;
    private static Path shots;

    private static <T> T fx(Callable<T> action) throws Exception {
        CompletableFuture<T> result = new CompletableFuture<>();
        Platform.runLater(() -> {
            try { result.complete(action.call()); }
            catch (Throwable e) { result.completeExceptionally(e); }
        });
        return result.get(15, TimeUnit.SECONDS);
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
    }
    private static Node lookup(String id) {
        List<Window> windows = new ArrayList<>(Window.getWindows());
        for (int i = windows.size() - 1; i >= 0; i--) {
            Scene scene = windows.get(i).getScene();
            if (scene != null) {
                scene.getRoot().applyCss();
                Node node = scene.lookup("#" + id);
                if (node != null) return node;
            }
        }
        throw new AssertionError("Control not found: " + id);
    }
    private static boolean exists(String id) {
        try { lookup(id); return true; } catch (AssertionError e) { return false; }
    }
    private static void click(String id) throws Exception {
        fx(() -> { ((Button) lookup(id)).fire(); return null; });
    }
    private static void openForm(String id, String field) throws Exception {
        Platform.runLater(() -> ((Button) lookup(id)).fire());
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (!fx(() -> exists(field))) {
            if (System.nanoTime() > deadline) throw new AssertionError("Form did not open: " + id);
            Thread.sleep(30);
        }
    }
    private static void text(String id, String value) throws Exception {
        fx(() -> { ((TextField) lookup(id)).setText(value); return null; });
    }
    private static void date(String id, String value) throws Exception {
        fx(() -> { DatePicker picker = (DatePicker) lookup(id); picker.getEditor().setText(value); return null; });
    }
    @SuppressWarnings("unchecked")
    private static void choice(String id, String value) throws Exception {
        fx(() -> { ((ComboBox<String>) lookup(id)).setValue(value); return null; });
    }
    private static void idle() throws Exception {
        fx(() -> controller.whenIdle()).toCompletableFuture().get(20, TimeUnit.SECONDS);
        fx(() -> null);
    }
    private static int rows(String id) throws Exception {
        return fx(() -> ((TableView<?>) lookup(id)).getItems().size());
    }
    private static void screenshot(String name, Scene scene) throws Exception {
        WritableImage image = fx(() -> { scene.getRoot().applyCss(); scene.getRoot().layout(); return scene.snapshot(null); });
        int width = (int) image.getWidth(), height = (int) image.getHeight();
        BufferedImage png = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) png.setRGB(x, y, image.getPixelReader().getArgb(x, y));
        ImageIO.write(png, "png", shots.resolve(name + ".png").toFile());
    }

    public static void main(String[] args) throws Exception {
        Path data = Paths.get(args[0]);
        shots = Paths.get(args[1]);
        Files.createDirectories(data);
        Files.createDirectories(shots);
        CountDownLatch started = new CountDownLatch(1);
        Platform.startup(started::countDown);
        started.await(15, TimeUnit.SECONDS);
        Platform.setImplicitExit(false);
        try {
            fx(() -> {
                repository = new FileRecordRepository(data);
                stage = new Stage();
                controller = new DesktopController(repository, data, path -> { });
                view = new DesktopView(stage, controller, data);
                controller.attach(view);
                stage.setScene(new Scene(view.root(), 1320, 850));
                stage.show();
                controller.initialize();
                return null;
            });
            idle();
            check(repository.maternalRecords().isEmpty() && repository.childRecords().isEmpty(), "Fake records appeared at startup");
            check(!fx(() -> controller.isBusy()), "Initial load left UI busy");
            screenshot("overview-empty", fx(stage::getScene));

            click("nav-maternal");
            check(rows("maternal-table") == 0, "Maternal empty state wrong");
            openForm("add-maternal", "maternal-id");
            text("maternal-id", "M0001");
            text("maternal-name", "Demo 123");
            text("maternal-age", "61");
            date("maternal-edd", "2026-02-30");
            click("record-submit");
            check(fx(() -> ((Label) lookup("maternal-id-error")).isVisible()), "Long ID had no inline error");
            check(fx(() -> ((Label) lookup("maternal-name-error")).isVisible()), "Invalid name had no inline error");
            check(fx(() -> ((Label) lookup("maternal-age-error")).isVisible()), "Invalid age had no inline error");
            check(fx(() -> ((Label) lookup("maternal-edd-error")).isVisible()), "Invalid date had no inline error");
            check(repository.maternalRecords().isEmpty(), "Invalid form created a record");
            screenshot("maternal-form-validation", fx(() -> lookup("record-submit").getScene()));
            text("maternal-id", " m001 ");
            text("maternal-name", "  Demo   McDonald  ");
            text("maternal-age", "28");
            date("maternal-edd", LocalDate.now().plusDays(12).toString());
            click("record-submit");
            idle();
            check(repository.maternalRecords().size() == 1, "Valid maternal form failed");
            check(!repository.hasUnsavedChanges(), "Successful auto-save left changes unsaved");
            check(Files.readString(data.resolve("maternal_records.txt")).startsWith("M001|Demo McDonald|28|"), "Normalized maternal row not saved");
            check(rows("maternal-table") == 1, "Table did not refresh after save");
            text("maternal-search", "not-a-match");
            check(rows("maternal-table") == 0, "Search did not filter table");
            text("maternal-search", "mcdonald");
            check(rows("maternal-table") == 1, "Name search failed");
            text("maternal-search", "");
            fx(() -> { ((TableView<?>) lookup("maternal-table")).getSelectionModel().select(0); return null; });
            screenshot("maternal-records", fx(stage::getScene));

            openForm("edit-maternal", "maternal-id");
            check(!fx(() -> ((TextField) lookup("maternal-id")).isEditable()), "Editing allowed changing ID");
            choice("maternal-status", "Inactive");
            click("record-submit");
            idle();
            check(repository.maternalRecords().get(0).getStatus().equals("Inactive"), "Status change failed");
            choice("maternal-status-filter", "Active");
            check(rows("maternal-table") == 0, "Active filter included archived record");
            choice("maternal-status-filter", "Inactive");
            check(rows("maternal-table") == 1, "Inactive filter failed");
            choice("maternal-status-filter", "All statuses");

            openForm("add-maternal", "maternal-id");
            text("maternal-id", "m001");
            text("maternal-name", "Demo Duplicate"); text("maternal-age", "28");
            date("maternal-edd", LocalDate.now().toString());
            click("record-submit");
            check(fx(() -> ((Label) lookup("maternal-id-error")).isVisible()), "Duplicate ID bypassed form validation");
            check(repository.maternalRecords().size() == 1, "Duplicate ID changed repository");
            click("record-cancel");

            click("nav-children");
            openForm("add-child", "child-id");
            text("child-id", "c001"); text("child-name", "Demo Child"); text("child-mother", "Demo McDonald");
            choice("child-gender", "Female");
            date("child-dob", LocalDate.now().plusDays(1).toString());
            click("record-submit");
            check(fx(() -> ((Label) lookup("child-dob-error")).isVisible()), "Future DOB accepted");
            date("child-dob", LocalDate.now().minusMonths(6).toString());
            click("record-submit"); idle();
            check(repository.childRecords().size() == 1, "Child form failed");
            check(Files.readString(data.resolve("child_records.txt")).startsWith("C001|Demo Child|Female|"), "Child not saved");
            text("child-search", "mcdonald");
            check(rows("child-table") == 1, "Search by mother failed");
            text("child-search", "");
            fx(() -> { ((TableView<?>) lookup("child-table")).getSelectionModel().select(0); return null; });
            screenshot("child-records", fx(stage::getScene));
            openForm("edit-child", "child-id");
            choice("child-status", "Inactive"); click("record-submit"); idle();
            check(repository.childRecords().get(0).getStatus().equals("Inactive"), "Child archive failed");

            Path archive = data.getParent().resolve("registry-backup.zip");
            fx(() -> { controller.exportBackup(archive); return null; }); idle();
            check(Files.isRegularFile(archive), "Backup export failed");
            try (var zip = new java.util.zip.ZipFile(archive.toFile())) {
                check(zip.size() == 4, "Export did not contain records and instructions");
            }
            click("nav-settings");
            check(fx(() -> ((Label) lookup("data-directory")).getText().equals(data.toAbsolutePath().toString())), "Wrong storage directory displayed");
            screenshot("data-and-backup", fx(stage::getScene));
            click("nav-dashboard");
            screenshot("overview", fx(stage::getScene));

            FileRecordRepository reopened = new FileRecordRepository(data);
            reopened.loadRecords();
            check(reopened.maternalRecords().size() == 1 && reopened.childRecords().size() == 1, "Saved UI records did not reload");
            check(reopened.childRecords().get(0).getStatus().equals("Inactive"), "Child edit not persisted");

            // External edits cause an honest unsaved state, never a false success.
            String external = Files.readString(data.resolve("maternal_records.txt")).replace("Demo McDonald", "External Demo");
            Files.writeString(data.resolve("maternal_records.txt"), external);
            fx(() -> {
                controller.addMaternal(new MaternalProfile("M002", "Unsaved Demo", 31,
                        LocalDate.now().plusDays(30).toString(), "Active"));
                return null;
            });
            idle();
            check(repository.hasUnsavedChanges(), "Failed auto-save lost unsaved state");
            check(fx(controller::hasUnsavedChanges), "Controller hid failed auto-save");
            check(Files.readString(data.resolve("maternal_records.txt")).equals(external), "Failed auto-save overwrote external data");
            check(fx(() -> ((Label) lookup("save-state")).getText().contains("Unsaved")), "UI claimed failed save succeeded");
            check(!fx(controller::isBusy), "Save failure left UI frozen");
            screenshot("unsaved-warning", fx(stage::getScene));

            // Reject export of unsaved state without writing a ZIP or changing live data.
            Path unsavedBackup = data.getParent().resolve("unsaved-backup.zip");
            fx(() -> { controller.exportBackup(unsavedBackup); return null; }); idle();
            check(!Files.exists(unsavedBackup), "Unsaved backup was exported");
            check(Files.readString(data.resolve("maternal_records.txt")).equals(external), "Export overwrote live source");

            Platform.runLater(controller::reload);
            clickDialog("Keep working");
            idle();
            check(repository.maternalRecords().size() == 2, "Canceling reload discarded unsaved record");
            Platform.runLater(controller::reload);
            clickDialog("Discard and reload");
            idle();
            check(repository.maternalRecords().size() == 1 && !repository.hasUnsavedChanges(), "Confirmed reload failed");

            // A backup must preserve malformed source bytes rather than rewriting accepted rows.
            String mixed = external + "BROKEN|ROW\n";
            Files.writeString(data.resolve("maternal_records.txt"), mixed);
            fx(() -> { controller.reload(); return null; }); idle();
            Path mixedBackup = data.getParent().resolve("mixed-backup.zip");
            fx(() -> { controller.exportBackup(mixedBackup); return null; }); idle();
            check(Files.readString(data.resolve("maternal_records.txt")).equals(mixed), "Backup cleaned malformed live rows");
            try (var zip = new java.util.zip.ZipFile(mixedBackup.toFile())) {
                check(new String(zip.getInputStream(zip.getEntry("maternal_records.txt")).readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).equals(mixed), "Backup omitted malformed saved bytes");
            }
            Files.writeString(data.resolve("maternal_records.txt"), "BROKEN|ROW\n");
            fx(() -> { controller.reload(); return null; }); idle();
            check(fx(() -> ((Label) lookup("save-state")).getText().contains("Storage needs attention")), "Failed load claimed all changes saved");
            check(repository.maternalRecords().size() == 1, "Failed load cleared existing table");
            Files.writeString(data.resolve("maternal_records.txt"), external);
            fx(() -> { controller.reload(); return null; }); idle();

            fx(() -> { stage.setWidth(1000); stage.setHeight(680); view.navigateTo("children"); return null; });
            Thread.sleep(300); // Let the native window manager deliver the resize pulse.
            check(fx(() -> stage.getScene().getWidth()) <= 1000, "Compact test window failed to resize");
            check(!fx(() -> ((Button) lookup("add-child")).getText()).contains("profile"), "Compact add action did not shorten");
            screenshot("compact-child-records", fx(stage::getScene));
            verifyShutdownOrdering(data.getParent().resolve("shutdown-probe"));
            System.out.println("PASS: " + checks + " real JavaFX workflow assertions");
        } finally {
            fx(() -> {
                for (Window window : new ArrayList<>(Window.getWindows())) window.hide();
                if (controller != null && !controller.isBusy()) controller.close();
                return null;
            });
            Platform.exit();
        }
    }

    private static void clickDialog(String text) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (true) {
            boolean clicked = fx(() -> {
                for (Window window : new ArrayList<>(Window.getWindows())) {
                    if (window == stage || window.getScene() == null) continue;
                    for (Node node : window.getScene().getRoot().lookupAll(".button")) {
                        if (node instanceof Button button && button.getText().equals(text)) {
                            button.fire(); return true;
                        }
                    }
                }
                return false;
            });
            if (clicked) return;
            if (System.nanoTime() > deadline) throw new AssertionError("Dialog button not found: " + text);
            Thread.sleep(30);
        }
    }

    private static void verifyShutdownOrdering(Path data) throws Exception {
        Files.createDirectories(data);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch cleaned = new CountDownLatch(1);
        FileRecordRepository delegate = new FileRecordRepository(data);
        enay.repository.RecordRepository slow = (enay.repository.RecordRepository) java.lang.reflect.Proxy.newProxyInstance(
                enay.repository.RecordRepository.class.getClassLoader(),
                new Class<?>[] {enay.repository.RecordRepository.class}, (proxy, method, args) -> {
                    if (method.getName().equals("loadRecords")) {
                        entered.countDown();
                        if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Shutdown probe timed out");
                    }
                    try { return method.invoke(delegate, args); }
                    catch (java.lang.reflect.InvocationTargetException e) { throw e.getCause(); }
                });
        DesktopController probe = fx(() -> {
            DesktopController result = new DesktopController(slow, data, path -> { });
            result.attach(new DesktopView(new Stage(), result, data));
            result.initialize();
            return result;
        });
        try {
            check(entered.await(10, TimeUnit.SECONDS), "Background probe did not start");
            fx(() -> { probe.shutdown(cleaned::countDown); return null; });
            check(cleaned.getCount() == 1, "Shutdown released resources while work was still running");
        } finally {
            release.countDown();
        }
        check(cleaned.await(10, TimeUnit.SECONDS), "Shutdown never released resources after work completed");
    }
}
