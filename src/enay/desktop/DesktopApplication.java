package enay.desktop;

import enay.Main;
import enay.repository.FileRecordRepository;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.control.Alert;
import javafx.stage.Stage;
import java.io.IOException;
import java.nio.channels.*;
import java.nio.file.*;

/** Desktop composition root. Holds the same folder lock as the console application. */
public final class DesktopApplication extends Application {
    private FileChannel channel;
    private FileLock lock;
    private DesktopController controller;

    @Override public void start(Stage stage) {
        Path data = getParameters().getNamed().containsKey("data-dir")
                ? Paths.get(getParameters().getNamed().get("data-dir")).toAbsolutePath().normalize()
                : Main.resolveDataDirectory();
        try {
            Files.createDirectories(data);
            channel = FileChannel.open(data.resolve(".enay.lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
            lock = channel.tryLock();
            if (lock == null) throw new IOException("Another E-Nay instance is already using this data folder. Close it first.");
        } catch (IOException | OverlappingFileLockException e) {
            releaseLock();
            Alert alert = new Alert(Alert.AlertType.ERROR);
            alert.setTitle("E-Nay could not start");
            alert.setHeaderText("Unable to open local records");
            alert.setContentText(e.getMessage());
            alert.showAndWait();
            javafx.application.Platform.exit();
            return;
        }
        controller = new DesktopController(new FileRecordRepository(data), data,
                path -> getHostServices().showDocument(path.toUri().toString()));
        DesktopView view = new DesktopView(stage, controller, data);
        controller.attach(view);
        Scene scene = new Scene(view.root(), 1320, 850);
        stage.setScene(scene);
        stage.setTitle("E-Nay | Maternal & Child Care");
        stage.setMinWidth(1000);
        stage.setMinHeight(680);
        stage.setOnCloseRequest(event -> {
            if (controller.isBusy()) {
                event.consume();
                view.notifyUser("Operation in progress", "Please wait for the current save or load to finish.", false);
            } else if (!view.confirmDiscard("Exit")) {
                event.consume();
            }
        });
        stage.show();
        controller.initialize();
    }

    @Override public void stop() {
        if (controller != null) controller.shutdown(this::releaseLock);
        else releaseLock();
    }

    private void releaseLock() {
        try { if (lock != null && lock.isValid()) lock.release(); }
        catch (IOException ignored) { /* the OS releases locks on process exit */ }
        try { if (channel != null) channel.close(); }
        catch (IOException ignored) { /* process is exiting */ }
    }
}
