package enay.desktop;

/** Ordinary launcher avoids JavaFX's special main-class handling on the classpath. */
public final class DesktopLauncher {
    private DesktopLauncher() { }
    public static void main(String[] args) {
        javafx.application.Application.launch(DesktopApplication.class, args);
    }
}
