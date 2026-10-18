package enay.desktop;

import enay.exception.InvalidRecordException;
import enay.model.ChildProfile;
import enay.model.MaternalProfile;
import enay.validation.ValidationUtils;
import javafx.beans.binding.Bindings;
import javafx.beans.property.ReadOnlyStringWrapper;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.collections.transformation.FilteredList;
import javafx.collections.transformation.SortedList;
import javafx.event.ActionEvent;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.Parent;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.stage.FileChooser;
import javafx.stage.Modality;
import javafx.stage.Stage;
import javafx.util.StringConverter;

import java.nio.file.Path;
import java.time.LocalDate;
import java.time.Period;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.function.Function;

/** JavaFX presentation only. Record ownership and persistence remain in the controller. */
public final class DesktopView {
    public interface Actions {
        void addMaternal(MaternalProfile record);
        void addChild(ChildProfile record);
        void updateMaternal(String originalId, MaternalProfile record);
        void updateChild(String originalId, ChildProfile record);
        void save();
        void reload();
        void exportBackup(Path destination);
        void openDataFolder();
    }

    private static final DateTimeFormatter DISPLAY_DATE = DateTimeFormatter.ofPattern("MMM d, uuuu", Locale.ENGLISH);
    private final Stage stage;
    private final Actions actions;
    private final Path dataDirectory;
    private final BorderPane shell = new BorderPane();
    private final BorderPane workspace = new BorderPane();
    private final StackPane content = new StackPane();
    private final ObservableList<MaternalProfile> maternal = FXCollections.observableArrayList();
    private final ObservableList<ChildProfile> children = FXCollections.observableArrayList();
    private final FilteredList<MaternalProfile> maternalFiltered = new FilteredList<>(maternal);
    private final FilteredList<ChildProfile> childFiltered = new FilteredList<>(children);
    private final TableView<MaternalProfile> maternalTable = new TableView<>();
    private final TableView<ChildProfile> childTable = new TableView<>();
    private final TextField maternalSearch = new TextField();
    private final TextField childSearch = new TextField();
    private final ComboBox<String> maternalStatus = new ComboBox<>();
    private final ComboBox<String> childStatus = new ComboBox<>();
    private final Label maternalResults = new Label();
    private final Label childResults = new Label();
    private final VBox maternalDetail = new VBox(14);
    private final VBox childDetail = new VBox(14);
    private final Label pageTitle = new Label();
    private final Label pageSubtitle = new Label();
    private final Label saveState = new Label("Loading records");
    private final Label footerMessage = new Label("Opening your local registry…");
    private final Label noticeTitle = new Label();
    private final Label noticeDetail = new Label();
    private final VBox notice = new VBox(3);
    private final ProgressIndicator progress = new ProgressIndicator();
    private final Button saveButton = button("Save changes", "primary-button", "save-changes");
    private final Button reloadButton = button("Reload", "secondary-button", "reload-records");
    private final List<Button> navigation = new ArrayList<>();
    private final List<String> diagnostics = new ArrayList<>();
    private Parent maternalPage;
    private Parent childPage;
    private String currentPage = "dashboard";
    private boolean dirty;
    private boolean busy;
    private boolean storageAvailable = true;
    private boolean diagnosticNotice;

    public DesktopView(Stage stage, Actions actions, Path dataDirectory) {
        this.stage = Objects.requireNonNull(stage);
        this.actions = Objects.requireNonNull(actions);
        this.dataDirectory = Objects.requireNonNull(dataDirectory).toAbsolutePath().normalize();
        shell.getStyleClass().add("app-shell");
        java.net.URL css = DesktopView.class.getResource("enay.css");
        if (css != null) shell.getStylesheets().add(css.toExternalForm());
        shell.setLeft(buildSidebar());
        shell.setCenter(workspace);
        workspace.setTop(buildHeader());
        workspace.setCenter(content);
        workspace.setBottom(buildFooter());
        BorderPane.setMargin(content, new Insets(0, 28, 20, 28));
        configureTables();
        maternalPage = buildRecordsPage(true);
        childPage = buildRecordsPage(false);
        navigateTo("dashboard");
    }

    public Parent root() { return shell; }

    public void render(List<MaternalProfile> mothers, List<ChildProfile> kids, boolean unsaved) {
        String motherId = maternalTable.getSelectionModel().getSelectedItem() == null ? null
                : maternalTable.getSelectionModel().getSelectedItem().getProfileId();
        String childId = childTable.getSelectionModel().getSelectedItem() == null ? null
                : childTable.getSelectionModel().getSelectedItem().getChildId();
        maternal.setAll(mothers);
        children.setAll(kids);
        dirty = unsaved;
        updateSaveState();
        filterRecords(true);
        filterRecords(false);
        maternal.stream().filter(r -> r.getProfileId().equals(motherId)).findFirst()
                .ifPresent(r -> maternalTable.getSelectionModel().select(r));
        children.stream().filter(r -> r.getChildId().equals(childId)).findFirst()
                .ifPresent(r -> childTable.getSelectionModel().select(r));
        updateDetails(true);
        updateDetails(false);
        if (currentPage.equals("dashboard") || currentPage.equals("settings")) navigateTo(currentPage);
        if (!busy) footerMessage.setText(idleMessage());
    }

    /** A readable snapshot may still be unsafe to save after a partial or failed load. */
    public void setStorageAvailable(boolean available) {
        storageAvailable = available;
        updateSaveState();
        if (!busy) footerMessage.setText(idleMessage());
    }

    public void setBusy(boolean value, String message) {
        busy = value;
        content.setDisable(value);
        reloadButton.setDisable(value);
        saveButton.setDisable(value);
        progress.setVisible(value);
        progress.setManaged(value);
        if (message != null && !message.isBlank()) footerMessage.setText(message);
        else if (!value) footerMessage.setText(idleMessage());
    }

    /** Persistent, dismissible feedback does not steal focus after every action. */
    public void notifyUser(String title, String detail, boolean error) {
        diagnosticNotice = false;
        noticeTitle.setText(title == null ? "" : title);
        noticeDetail.setText(detail == null ? "" : detail);
        notice.getStyleClass().removeAll("notice-error", "notice-success");
        notice.getStyleClass().add(error ? "notice-error" : "notice-success");
        notice.setVisible(true);
        notice.setManaged(true);
    }

    /** Retains load/save diagnostics for review on the Data & backup screen. */
    public void showDiagnostics(List<String> messages) {
        if (messages == null || messages.isEmpty()) return;
        List<String> displayMessages = messages.stream().map(this::desktopMessage).toList();
        diagnostics.addAll(displayMessages);
        if (diagnostics.size() > 300) diagnostics.subList(0, diagnostics.size() - 300).clear();
        List<String> warnings = displayMessages.stream().filter(message -> {
            String lower = message.toLowerCase(Locale.ROOT);
            return lower.contains("failed") || lower.contains("blocked") || lower.contains("skipping")
                    || lower.contains("skipped") || lower.contains("corrupt") || lower.contains("no valid records")
                    || lower.contains("error reading") || lower.contains("unable to");
        }).toList();
        if (!warnings.isEmpty()) {
            notifyUser("Storage needs attention", warnings.get(0)
                    + (warnings.size() > 1 ? " More details are available in Data & backup." : " See Data & backup for details."), true);
            diagnosticNotice = true;
        } else if (diagnosticNotice && storageAvailable && fullyHealthyLoad(displayMessages)) {
            notice.setVisible(false);
            notice.setManaged(false);
            diagnosticNotice = false;
        }
        if (currentPage.equals("settings")) navigateTo("settings");
    }

    public boolean confirmDiscard(String action) {
        if (!dirty) return true;
        Alert alert = new Alert(Alert.AlertType.CONFIRMATION);
        prepareDialog(alert);
        alert.setTitle("Unsaved changes");
        alert.setHeaderText("Save your changes first?");
        alert.setContentText(action + " will discard changes that have not been saved. Return to the registry and choose Save changes to keep them.");
        ButtonType discard = new ButtonType("Discard and " + action.toLowerCase(Locale.ROOT), ButtonBar.ButtonData.OK_DONE);
        ButtonType cancel = new ButtonType("Keep working", ButtonBar.ButtonData.CANCEL_CLOSE);
        alert.getButtonTypes().setAll(cancel, discard);
        Button discardButton = (Button) alert.getDialogPane().lookupButton(discard);
        discardButton.setDefaultButton(false);
        ((Button) alert.getDialogPane().lookupButton(cancel)).setDefaultButton(true);
        return alert.showAndWait().filter(discard::equals).isPresent();
    }

    public void navigateTo(String page) {
        currentPage = page;
        for (Button button : navigation) {
            button.getStyleClass().remove("nav-selected");
            if (page.equals(button.getUserData())) button.getStyleClass().add("nav-selected");
        }
        switch (page) {
            case "maternal":
                title("Maternal records", "Manage maternal profiles and expected delivery dates.");
                content.getChildren().setAll(maternalPage);
                break;
            case "children":
                title("Child records", "Track child profiles, ages, and monitoring status.");
                content.getChildren().setAll(childPage);
                break;
            case "settings":
                title("Data & backup", "Keep your records safe and review storage activity.");
                content.getChildren().setAll(buildSettings());
                break;
            default:
                currentPage = "dashboard";
                title("Registry overview", "A clear view of the mothers and children in your care.");
                content.getChildren().setAll(buildDashboard());
        }
    }

    private Node buildSidebar() {
        VBox sidebar = new VBox();
        sidebar.getStyleClass().add("sidebar");
        sidebar.setPrefWidth(214);
        Label mark = label("e", "brand-mark");
        VBox brandWords = new VBox(0, label("E-Nay", "brand-name"), label("MATERNAL & CHILD CARE", "brand-caption"));
        HBox brand = new HBox(11, mark, brandWords);
        brand.setAlignment(Pos.CENTER_LEFT);
        brand.getStyleClass().add("brand");
        sidebar.getChildren().addAll(brand, label("WORKSPACE", "sidebar-section"));
        sidebar.getChildren().add(navButton("◫", "Overview", "dashboard", "nav-dashboard"));
        sidebar.getChildren().add(navButton("♡", "Maternal records", "maternal", "nav-maternal"));
        sidebar.getChildren().add(navButton("✧", "Child records", "children", "nav-children"));
        Region spacer = new Region();
        VBox.setVgrow(spacer, Priority.ALWAYS);
        sidebar.getChildren().addAll(spacer, label("REGISTRY TOOLS", "sidebar-section"),
                navButton("▤", "Data & backup", "settings", "nav-settings"));
        VBox local = new VBox(6, label("●  Local workspace", "local-heading"), label("Records stay in your\nproject’s data folder.", "sidebar-note"));
        local.getStyleClass().add("local-card");
        sidebar.getChildren().add(local);
        return sidebar;
    }

    private Button navButton(String symbol, String name, String destination, String id) {
        Button button = button(name, "nav-button", id);
        Label icon = label(symbol, "nav-icon");
        button.setGraphic(icon);
        button.setGraphicTextGap(12);
        button.setMaxWidth(Double.MAX_VALUE);
        button.setUserData(destination);
        button.setOnAction(e -> navigateTo(destination));
        navigation.add(button);
        return button;
    }

    private Node buildHeader() {
        VBox heading = new VBox(7);
        Label eyebrow = label("E-NAY CARE REGISTRY", "eyebrow");
        pageTitle.getStyleClass().add("page-title");
        pageSubtitle.getStyleClass().add("page-subtitle");
        pageSubtitle.setWrapText(true);
        VBox words = new VBox(5, eyebrow, pageTitle, pageSubtitle);
        HBox.setHgrow(words, Priority.ALWAYS);
        saveState.getStyleClass().add("save-state");
        saveState.setId("save-state");
        saveButton.setOnAction(e -> actions.save());
        reloadButton.setOnAction(e -> actions.reload());
        HBox actionsRow = new HBox(9, reloadButton, saveButton);
        actionsRow.setAlignment(Pos.CENTER_RIGHT);
        VBox right = new VBox(10, saveState, actionsRow);
        right.setAlignment(Pos.CENTER_RIGHT);
        HBox top = new HBox(18, words, right);
        top.setAlignment(Pos.CENTER_LEFT);
        heading.getChildren().add(top);
        noticeTitle.getStyleClass().add("notice-title");
        noticeDetail.setWrapText(true);
        noticeDetail.setMaxWidth(Double.MAX_VALUE);
        noticeDetail.getStyleClass().add("notice-detail");
        notice.getStyleClass().add("notice");
        Button close = button("×", "notice-close", "dismiss-notification");
        close.setOnAction(e -> { notice.setVisible(false); notice.setManaged(false); });
        HBox message = new HBox(12, noticeDetail, close);
        message.setAlignment(Pos.TOP_LEFT);
        HBox.setHgrow(noticeDetail, Priority.ALWAYS);
        notice.getChildren().setAll(noticeTitle, message);
        notice.setVisible(false);
        notice.setManaged(false);
        heading.getChildren().add(notice);
        heading.getStyleClass().add("workspace-header");
        return heading;
    }

    private Node buildFooter() {
        progress.setMaxSize(16, 16);
        progress.setPrefSize(16, 16);
        progress.setVisible(false);
        progress.setManaged(false);
        footerMessage.getStyleClass().add("footer-label");
        Region gap = new Region();
        HBox.setHgrow(gap, Priority.ALWAYS);
        Label date = label(LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, MMM d, uuuu", Locale.ENGLISH)), "footer-date");
        HBox footer = new HBox(9, progress, footerMessage, gap, date);
        footer.setAlignment(Pos.CENTER_LEFT);
        footer.getStyleClass().add("footer");
        return footer;
    }

    private Parent buildDashboard() {
        VBox body = new VBox(20);
        long activeMaternal = maternal.stream().filter(r -> r.getStatus().equals("Active")).count();
        long activeChild = children.stream().filter(r -> r.getStatus().equals("Active")).count();
        LocalDate today = LocalDate.now();
        List<MaternalProfile> upcoming = maternal.stream().filter(r -> r.getStatus().equals("Active"))
                .filter(r -> { LocalDate d = LocalDate.parse(r.getExpectedDeliveryDate()); return !d.isBefore(today) && !d.isAfter(today.plusDays(30)); })
                .sorted(Comparator.comparing(MaternalProfile::getExpectedDeliveryDate)).toList();
        long monitoring = children.stream().filter(r -> r.getStatus().equals("Active"))
                .filter(r -> !LocalDate.parse(r.getDateOfBirth()).isBefore(today.minusYears(2))).count();
        HBox cards = new HBox(14,
                statCard("MATERNAL PROFILES", Integer.toString(maternal.size()), activeMaternal + " active · " + (maternal.size() - activeMaternal) + " inactive", "♡", "teal"),
                statCard("CHILD PROFILES", Integer.toString(children.size()), activeChild + " active · " + (children.size() - activeChild) + " inactive", "✧", "blue"),
                statCard("DUE IN 30 DAYS", Integer.toString(upcoming.size()), "Active maternal profiles", "↗", "amber"),
                statCard("AGE 0–24 MONTHS", Long.toString(monitoring), "Active child profiles", "◷", "violet"));
        for (Node node : cards.getChildren()) HBox.setHgrow(node, Priority.ALWAYS);
        body.getChildren().add(cards);

        VBox welcome = new VBox(14);
        welcome.getStyleClass().addAll("panel", "quick-panel");
        welcome.getChildren().addAll(label("Continue caring, with a clearer registry.", "section-title"),
                wrappingLabel("Add a profile, review records, or save your latest updates. Shared validation keeps every entry consistent.", "muted"));
        Button addMother = button("+  Add maternal profile", "primary-button", "dashboard-add-maternal");
        addMother.setOnAction(e -> showMaternalForm(null));
        Button addKid = button("+  Add child profile", "secondary-button", "dashboard-add-child");
        addKid.setOnAction(e -> showChildForm(null));
        applyCapacityState(addMother, true);
        applyCapacityState(addKid, false);
        welcome.getChildren().add(new HBox(10, addMother, addKid));
        body.getChildren().add(welcome);

        VBox deliveryPanel = new VBox(12);
        deliveryPanel.getStyleClass().add("panel");
        HBox deliveryHeading = new HBox(label("Expected deliveries", "section-title"));
        Region stretch = new Region(); HBox.setHgrow(stretch, Priority.ALWAYS);
        Button seeMothers = button("View all →", "text-button", "dashboard-view-maternal");
        seeMothers.setOnAction(e -> navigateTo("maternal"));
        deliveryHeading.getChildren().addAll(stretch, seeMothers);
        deliveryHeading.setAlignment(Pos.CENTER_LEFT);
        deliveryPanel.getChildren().addAll(deliveryHeading, label("Active profiles due within the next 30 days", "muted"));
        if (upcoming.isEmpty()) deliveryPanel.getChildren().add(emptyState("No upcoming deliveries", "Active profiles with a delivery date in the next 30 days will appear here.", null));
        else {
            for (MaternalProfile record : upcoming.stream().limit(5).toList()) {
                VBox names = new VBox(3, label(record.getMotherName(), "row-name"), label(record.getProfileId() + " · Age " + record.getAge(), "muted"));
                HBox.setHgrow(names, Priority.ALWAYS);
                Label due = label(displayDate(record.getExpectedDeliveryDate()), "date-badge");
                HBox row = new HBox(12, avatar(record.getMotherName(), "teal"), names, due);
                row.getStyleClass().add("summary-row"); row.setAlignment(Pos.CENTER_LEFT);
                row.setOnMouseClicked(e -> { navigateTo("maternal"); maternalSearch.clear(); maternalStatus.setValue("All statuses"); maternalTable.getSelectionModel().select(record); });
                deliveryPanel.getChildren().add(row);
            }
        }
        VBox coverage = new VBox(16);
        coverage.getStyleClass().add("panel");
        coverage.getChildren().addAll(label("Registry at a glance", "section-title"), label("Current profile status", "muted"),
                coverageRow("Maternal", activeMaternal, maternal.size()), coverageRow("Child", activeChild, children.size()),
                separator(), wrappingLabel("Historical profiles remain available as dates pass. Change a profile’s status in its edit form when monitoring ends.", "hint"));
        HBox bottom = new HBox(18, deliveryPanel, coverage);
        HBox.setHgrow(deliveryPanel, Priority.ALWAYS);
        deliveryPanel.setMinWidth(390);
        coverage.setPrefWidth(310); coverage.setMinWidth(250);
        body.getChildren().add(bottom);
        return scrolling(body);
    }

    private VBox statCard(String heading, String number, String caption, String icon, String color) {
        VBox card = new VBox(11);
        card.getStyleClass().addAll("stat-card", "stat-" + color);
        HBox top = new HBox(label(heading, "stat-label"));
        Region gap = new Region(); HBox.setHgrow(gap, Priority.ALWAYS);
        top.getChildren().addAll(gap, label(icon, "stat-icon"));
        card.getChildren().addAll(top, label(number, "stat-number"), wrappingLabel(caption, "stat-caption"));
        card.setMaxWidth(Double.MAX_VALUE); card.setMinWidth(145);
        return card;
    }

    private VBox coverageRow(String name, long active, int total) {
        Label number = label(active + " / " + total + " active", "muted");
        Region gap = new Region(); HBox.setHgrow(gap, Priority.ALWAYS);
        HBox heading = new HBox(label(name, "row-name"), gap, number);
        ProgressBar bar = new ProgressBar(total == 0 ? 0 : active / (double) total);
        bar.setMaxWidth(Double.MAX_VALUE); bar.getStyleClass().add("coverage-bar");
        return new VBox(9, heading, bar);
    }

    private void configureTables() {
        maternalSearch.setId("maternal-search"); childSearch.setId("child-search");
        maternalSearch.setPromptText("Search name or profile ID…");
        childSearch.setPromptText("Search name, mother, or child ID…");
        maternalSearch.textProperty().addListener((o, old, value) -> filterRecords(true));
        childSearch.textProperty().addListener((o, old, value) -> filterRecords(false));
        maternalStatus.setId("maternal-status-filter"); childStatus.setId("child-status-filter");
        for (ComboBox<String> filter : List.of(maternalStatus, childStatus)) {
            filter.getItems().setAll("All statuses", "Active", "Inactive");
            filter.setValue("All statuses"); filter.setPrefWidth(138);
        }
        maternalStatus.valueProperty().addListener((o, old, value) -> filterRecords(true));
        childStatus.valueProperty().addListener((o, old, value) -> filterRecords(false));
        maternalTable.setId("maternal-table"); childTable.setId("child-table");
        maternalTable.getColumns().add(column("PROFILE ID", MaternalProfile::getProfileId, 90));
        maternalTable.getColumns().add(column("MOTHER’S NAME", MaternalProfile::getMotherName, 180));
        maternalTable.getColumns().add(column("AGE", r -> Integer.toString(r.getAge()), 58));
        maternalTable.getColumns().add(column("EXPECTED DELIVERY", r -> displayDate(r.getExpectedDeliveryDate()), 150));
        maternalTable.getColumns().add(statusColumn(MaternalProfile::getStatus));
        childTable.getColumns().add(column("CHILD ID", ChildProfile::getChildId, 85));
        childTable.getColumns().add(column("CHILD’S NAME", ChildProfile::getChildName, 160));
        childTable.getColumns().add(column("AGE", r -> childAge(r.getDateOfBirth()), 100));
        childTable.getColumns().add(column("MOTHER’S NAME", ChildProfile::getMotherName, 160));
        childTable.getColumns().add(statusColumn(ChildProfile::getStatus));
        SortedList<MaternalProfile> mothersSorted = new SortedList<>(maternalFiltered);
        mothersSorted.comparatorProperty().bind(maternalTable.comparatorProperty());
        maternalTable.setItems(mothersSorted);
        SortedList<ChildProfile> kidsSorted = new SortedList<>(childFiltered);
        kidsSorted.comparatorProperty().bind(childTable.comparatorProperty());
        childTable.setItems(kidsSorted);
        maternalTable.getSelectionModel().selectedItemProperty().addListener((o, a, b) -> updateDetails(true));
        childTable.getSelectionModel().selectedItemProperty().addListener((o, a, b) -> updateDetails(false));
        maternalTable.setRowFactory(table -> {
            TableRow<MaternalProfile> row = new TableRow<>();
            row.setOnMouseClicked(e -> { if (e.getClickCount() == 2 && !row.isEmpty()) showMaternalForm(row.getItem()); });
            return row;
        });
        childTable.setRowFactory(table -> {
            TableRow<ChildProfile> row = new TableRow<>();
            row.setOnMouseClicked(e -> { if (e.getClickCount() == 2 && !row.isEmpty()) showChildForm(row.getItem()); });
            return row;
        });
        maternalTable.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);
        childTable.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);
        maternalTable.getStyleClass().add("record-table"); childTable.getStyleClass().add("record-table");
        maternalTable.setFixedCellSize(52); childTable.setFixedCellSize(52);
        maternalDetail.getStyleClass().add("detail-panel"); childDetail.getStyleClass().add("detail-panel");
        maternalDetail.setPrefWidth(260); childDetail.setPrefWidth(260);
        maternalDetail.setMinWidth(230); childDetail.setMinWidth(230);
        updateDetails(true); updateDetails(false);
        filterRecords(true); filterRecords(false);
    }

    private Parent buildRecordsPage(boolean isMaternal) {
        TextField search = isMaternal ? maternalSearch : childSearch;
        ComboBox<String> status = isMaternal ? maternalStatus : childStatus;
        Button add = button(isMaternal ? "+  Add maternal profile" : "+  Add child profile", "primary-button", isMaternal ? "add-maternal" : "add-child");
        add.setOnAction(e -> { if (isMaternal) showMaternalForm(null); else showChildForm(null); });
        applyCapacityState(add, isMaternal);
        HBox.setHgrow(search, Priority.ALWAYS);
        search.getStyleClass().add("search-field");
        HBox tools = new HBox(10, search, status, add); tools.setAlignment(Pos.CENTER_LEFT);
        Label count = isMaternal ? maternalResults : childResults;
        count.getStyleClass().add("results-label");
        TableView<?> table = isMaternal ? maternalTable : childTable;
        VBox list = new VBox(12, tools, count, table);
        VBox.setVgrow(table, Priority.ALWAYS); HBox.setHgrow(list, Priority.ALWAYS);
        list.setMinWidth(420);
        add.textProperty().bind(Bindings.when(list.widthProperty().lessThan(620))
                .then(isMaternal ? "+  Add maternal" : "+  Add child")
                .otherwise(isMaternal ? "+  Add maternal profile" : "+  Add child profile"));
        add.setMinWidth(Region.USE_PREF_SIZE);
        ScrollPane detail = scrolling(isMaternal ? maternalDetail : childDetail);
        detail.getStyleClass().add("detail-scroll"); detail.setPrefWidth(260); detail.setMinWidth(230);
        HBox page = new HBox(18, list, detail);
        return page;
    }

    private void filterRecords(boolean isMaternal) {
        String query = (isMaternal ? maternalSearch : childSearch).getText().strip().toLowerCase(Locale.ROOT);
        String status = (isMaternal ? maternalStatus : childStatus).getValue();
        if (isMaternal) {
            maternalFiltered.setPredicate(r -> (status == null || status.equals("All statuses") || r.getStatus().equals(status))
                    && (r.getProfileId().toLowerCase(Locale.ROOT).contains(query) || r.getMotherName().toLowerCase(Locale.ROOT).contains(query)));
            maternalResults.setText(maternalFiltered.size() + " of " + maternal.size() + " maternal profiles  ·  Select a row for details");
            maternalTable.setPlaceholder(emptyState(maternal.isEmpty() ? "No maternal profiles yet" : "No matching profiles",
                    maternal.isEmpty() ? "Add your first maternal profile to start the registry." : "Try a different search or status filter.", null));
        } else {
            childFiltered.setPredicate(r -> (status == null || status.equals("All statuses") || r.getStatus().equals(status))
                    && (r.getChildId().toLowerCase(Locale.ROOT).contains(query) || r.getChildName().toLowerCase(Locale.ROOT).contains(query) || r.getMotherName().toLowerCase(Locale.ROOT).contains(query)));
            childResults.setText(childFiltered.size() + " of " + children.size() + " child profiles  ·  Select a row for details");
            childTable.setPlaceholder(emptyState(children.isEmpty() ? "No child profiles yet" : "No matching profiles",
                    children.isEmpty() ? "Add your first child profile to start the registry." : "Try a different search or status filter.", null));
        }
    }

    private void updateDetails(boolean isMaternal) {
        VBox detail = isMaternal ? maternalDetail : childDetail;
        detail.getChildren().clear();
        detail.getChildren().add(label("PROFILE DETAILS", "eyebrow"));
        if (isMaternal) {
            MaternalProfile record = maternalTable.getSelectionModel().getSelectedItem();
            if (record == null) { detail.getChildren().add(emptyState("Select a profile", "Choose a maternal record to see its details and edit it.", null)); return; }
            detail.getChildren().addAll(avatar(record.getMotherName(), "teal"), wrappingLabel(record.getMotherName(), "detail-name"),
                    label(record.getProfileId(), "detail-id"), statusPill(record.getStatus()), separator(),
                    detailField("AGE", record.getAge() + " years"), detailField("EXPECTED DELIVERY", displayDate(record.getExpectedDeliveryDate())));
            Button edit = button("Edit profile", "secondary-button", "edit-maternal");
            edit.setMaxWidth(Double.MAX_VALUE); edit.setOnAction(e -> showMaternalForm(record));
            detail.getChildren().addAll(separator(), edit, wrappingLabel("Profile IDs stay fixed. You can update details and monitoring status.", "hint"));
        } else {
            ChildProfile record = childTable.getSelectionModel().getSelectedItem();
            if (record == null) { detail.getChildren().add(emptyState("Select a profile", "Choose a child record to see its details and edit it.", null)); return; }
            detail.getChildren().addAll(avatar(record.getChildName(), "blue"), wrappingLabel(record.getChildName(), "detail-name"),
                    label(record.getChildId(), "detail-id"), statusPill(record.getStatus()), separator(),
                    detailField("AGE TODAY", childAge(record.getDateOfBirth())), detailField("DATE OF BIRTH", displayDate(record.getDateOfBirth())),
                    detailField("GENDER", record.getGender()), detailField("MOTHER’S NAME", record.getMotherName()));
            if (LocalDate.parse(record.getDateOfBirth()).isBefore(LocalDate.now().minusYears(2)))
                detail.getChildren().add(wrappingLabel("Historical profile · This child is older than the 24-month registration limit.", "hint"));
            Button edit = button("Edit profile", "secondary-button", "edit-child");
            edit.setMaxWidth(Double.MAX_VALUE); edit.setOnAction(e -> showChildForm(record));
            detail.getChildren().addAll(separator(), edit);
        }
    }

    private Parent buildSettings() {
        VBox body = new VBox(18);
        VBox storage = new VBox(14);
        storage.getStyleClass().add("panel");
        Label path = wrappingLabel(dataDirectory.toString(), "path-label"); path.setId("data-directory");
        Button open = button("Open data folder", "secondary-button", "open-data-folder");
        open.setOnAction(e -> actions.openDataFolder());
        storage.getChildren().addAll(label("Local storage", "section-title"),
                wrappingLabel("Your maternal and child records are stored in this folder. The desktop and console versions use the same data format.", "muted"), path, open);
        VBox backup = new VBox(14);
        backup.getStyleClass().add("panel");
        Button export = button("Export saved backup…", "primary-button", "export-backup");
        export.setOnAction(e -> {
            if (dirty) { notifyUser("Save before exporting", "Save changes first so the backup includes your latest records.", true); return; }
            FileChooser chooser = new FileChooser(); chooser.setTitle("Export E-Nay backup");
            chooser.setInitialFileName("E-Nay-Backup-" + LocalDate.now() + ".zip");
            chooser.getExtensionFilters().add(new FileChooser.ExtensionFilter("ZIP archive", "*.zip"));
            java.io.File file = chooser.showSaveDialog(stage);
            if (file != null) actions.exportBackup(file.toPath());
        });
        backup.getChildren().addAll(label("Backup & recovery", "section-title"),
                wrappingLabel("Export a ZIP copy of the saved registry and keep it in a separate location. Save changes before exporting. Reload reads the data folder and asks before discarding unsaved work.", "muted"), export);
        HBox top = new HBox(18, storage, backup);
        HBox.setHgrow(storage, Priority.ALWAYS); HBox.setHgrow(backup, Priority.ALWAYS);
        storage.setMaxWidth(Double.MAX_VALUE); backup.setMaxWidth(Double.MAX_VALUE);
        storage.setPrefWidth(450); backup.setPrefWidth(450);
        VBox activity = new VBox(12);
        activity.getStyleClass().add("panel");
        activity.getChildren().addAll(label("Storage activity", "section-title"), label("Load and save messages from this session", "muted"));
        if (diagnostics.isEmpty()) activity.getChildren().add(emptyState("No storage messages", "Load and save details will appear here when available.", null));
        else {
            TextArea log = new TextArea(String.join(System.lineSeparator(), diagnostics));
            log.setId("storage-diagnostics"); log.setEditable(false); log.setWrapText(true); log.setPrefRowCount(10);
            log.getStyleClass().add("diagnostics"); activity.getChildren().add(log);
        }
        VBox rules = new VBox(9, label("Entry rules", "section-title"),
                wrappingLabel("Maternal IDs: M + exactly 3 digits. Child IDs: C + exactly 3 digits. Names preserve entered capitalization; extra spacing is cleaned. New maternal dates must be today or later. New child registrations must be 0–24 months old. Existing historical dates can remain unchanged when editing.", "muted"));
        rules.getStyleClass().add("panel");
        body.getChildren().addAll(top, activity, rules);
        return scrolling(body);
    }

    private void showMaternalForm(MaternalProfile original) {
        if (busy) return;
        boolean editing = original != null;
        if (!editing && maternal.size() >= 100) {
            notifyUser("Maternal registry is full", "The registry supports 100 maternal profiles. Existing profiles can still be viewed and edited.", true);
            return;
        }
        FormDialog form = new FormDialog(editing ? "Edit maternal profile" : "Add maternal profile",
                editing ? "Update details or monitoring status. The profile ID stays fixed." : "Enter a maternal profile. Fields are checked before the record is added.");
        Field<TextField> id = form.text("Profile ID", "M001", "maternal-id", editing ? original.getProfileId() : nextId(true), "M followed by exactly 3 digits");
        id.control.setEditable(!editing);
        Field<TextField> name = form.text("Mother’s name", "Full name", "maternal-name", editing ? original.getMotherName() : "", "Capitalization and initials are preserved");
        Field<TextField> age = form.text("Age", "12–60", "maternal-age", editing ? Integer.toString(original.getAge()) : "", "Whole years, from 12 to 60");
        Field<DatePicker> date = form.date("Expected delivery date", "maternal-edd", editing ? original.getExpectedDeliveryDate() : null, editing ? "An unchanged historical date is allowed" : "Today or a future date · YYYY-MM-DD");
        Field<ComboBox<String>> status = form.choice("Status", "maternal-status", List.of("Active", "Inactive"), editing ? original.getStatus() : "Active");
        form.place(id, 0, 0); form.place(age, 1, 0); form.place(name, 0, 1, 2); form.place(date, 0, 2); form.place(status, 1, 2);
        form.onSubmit(() -> {
            form.clearErrors();
            String normalizedId = validate(id, () -> ValidationUtils.profileId(id.control.getText()));
            String normalizedName = validate(name, () -> ValidationUtils.name(name.control.getText(), "Mother’s name"));
            Integer parsedAge = validate(age, () -> ValidationUtils.parseAge(age.control.getText()));
            LocalDate parsedDate = validate(date, () -> {
                LocalDate value = ValidationUtils.date(date.control.getEditor().getText(), "Expected delivery date");
                if (!editing || !value.toString().equals(original.getExpectedDeliveryDate())) ValidationUtils.newEdd(value);
                return value;
            });
            String normalizedStatus = validate(status, () -> ValidationUtils.choice(status.control.getValue(), "Status", "Active", "Inactive"));
            if (!editing && normalizedId != null && maternal.stream().anyMatch(r -> r.getProfileId().equalsIgnoreCase(normalizedId))) id.error("This profile ID already exists. Choose another.");
            if (form.hasErrors()) return false;
            if (!editing && maternal.size() >= 100) { form.showError("The maternal registry is full (100 profiles). This profile was not added."); return false; }
            try {
                MaternalProfile record = new MaternalProfile(normalizedId, normalizedName, parsedAge, parsedDate.toString(), normalizedStatus);
                if (editing) actions.updateMaternal(original.getProfileId(), record); else actions.addMaternal(record);
                return true;
            } catch (InvalidRecordException | RuntimeException ex) { form.showError(ex.getMessage()); return false; }
        });
        form.show();
    }

    private void showChildForm(ChildProfile original) {
        if (busy) return;
        boolean editing = original != null;
        if (!editing && children.size() >= 100) {
            notifyUser("Child registry is full", "The registry supports 100 child profiles. Existing profiles can still be viewed and edited.", true);
            return;
        }
        FormDialog form = new FormDialog(editing ? "Edit child profile" : "Add child profile",
                editing ? "Update details or monitoring status. The child ID stays fixed." : "Register a child up to 24 months old. All fields are required.");
        Field<TextField> id = form.text("Child ID", "C001", "child-id", editing ? original.getChildId() : nextId(false), "C followed by exactly 3 digits");
        id.control.setEditable(!editing);
        Field<ComboBox<String>> gender = form.choice("Gender", "child-gender", List.of("Female", "Male"), editing ? original.getGender() : null);
        Field<TextField> name = form.text("Child’s name", "Full name", "child-name", editing ? original.getChildName() : "", "Capitalization and initials are preserved");
        Field<DatePicker> date = form.date("Date of birth", "child-dob", editing ? original.getDateOfBirth() : null, editing ? "An unchanged historical date is allowed" : "Within the past 24 months · YYYY-MM-DD");
        Field<ComboBox<String>> status = form.choice("Status", "child-status", List.of("Active", "Inactive"), editing ? original.getStatus() : "Active");
        Field<TextField> mother = form.text("Mother’s name", "Full name", "child-mother", editing ? original.getMotherName() : "", "As recorded in the maternal profile, if available");
        form.place(id, 0, 0); form.place(gender, 1, 0); form.place(name, 0, 1, 2); form.place(date, 0, 2); form.place(status, 1, 2); form.place(mother, 0, 3, 2);
        form.onSubmit(() -> {
            form.clearErrors();
            String normalizedId = validate(id, () -> ValidationUtils.childId(id.control.getText()));
            String normalizedName = validate(name, () -> ValidationUtils.name(name.control.getText(), "Child’s name"));
            String normalizedGender = validate(gender, () -> ValidationUtils.choice(gender.control.getValue(), "Gender", "Female", "Male"));
            LocalDate parsedDate = validate(date, () -> {
                LocalDate value = ValidationUtils.date(date.control.getEditor().getText(), "Date of birth");
                if (!editing || !value.toString().equals(original.getDateOfBirth())) ValidationUtils.newDob(value);
                return value;
            });
            String normalizedMother = validate(mother, () -> ValidationUtils.name(mother.control.getText(), "Mother’s name"));
            String normalizedStatus = validate(status, () -> ValidationUtils.choice(status.control.getValue(), "Status", "Active", "Inactive"));
            if (!editing && normalizedId != null && children.stream().anyMatch(r -> r.getChildId().equalsIgnoreCase(normalizedId))) id.error("This child ID already exists. Choose another.");
            if (form.hasErrors()) return false;
            if (!editing && children.size() >= 100) { form.showError("The child registry is full (100 profiles). This profile was not added."); return false; }
            try {
                ChildProfile record = new ChildProfile(normalizedId, normalizedName, normalizedGender, parsedDate.toString(), normalizedMother, normalizedStatus);
                if (editing) actions.updateChild(original.getChildId(), record); else actions.addChild(record);
                return true;
            } catch (InvalidRecordException | RuntimeException ex) { form.showError(ex.getMessage()); return false; }
        });
        form.show();
    }

    private String nextId(boolean isMaternal) {
        for (int number = 1; number <= 999; number++) {
            String value = String.format(Locale.ROOT, "%s%03d", isMaternal ? "M" : "C", number);
            boolean used = isMaternal ? maternal.stream().anyMatch(r -> r.getProfileId().equals(value)) : children.stream().anyMatch(r -> r.getChildId().equals(value));
            if (!used) return value;
        }
        return "";
    }

    private void applyCapacityState(Button button, boolean isMaternal) {
        button.disableProperty().bind(isMaternal ? Bindings.size(maternal).greaterThanOrEqualTo(100)
                : Bindings.size(children).greaterThanOrEqualTo(100));
        button.setTooltip(new Tooltip("The registry supports up to 100 " + (isMaternal ? "maternal" : "child") + " profiles."));
    }

    private String desktopMessage(String message) {
        return message.replace("Reload with option 6", "Use Reload")
                .replace("reload with option 6", "use Reload")
                .replace("option 6", "Reload").replace("option 5", "Save changes");
    }

    private boolean fullyHealthyLoad(List<String> messages) {
        boolean motherLoaded = messages.stream().anyMatch(message -> message.startsWith("Maternal records loaded successfully:") || message.startsWith("No maternal file found;"));
        boolean childLoaded = messages.stream().anyMatch(message -> message.startsWith("Child records loaded successfully:") || message.startsWith("No child file found;"));
        return motherLoaded && childLoaded;
    }

    @FunctionalInterface private interface CheckedValue<T> { T get() throws InvalidRecordException; }
    @FunctionalInterface private interface Submission { boolean submit(); }
    private <T> T validate(Field<?> field, CheckedValue<T> operation) {
        try { return operation.get(); }
        catch (InvalidRecordException | RuntimeException ex) { field.error(ex.getMessage() == null ? "Please check this value." : ex.getMessage()); return null; }
    }

    private final class FormDialog {
        private final Dialog<Void> dialog = new Dialog<>();
        private final GridPane grid = new GridPane();
        private final List<Field<?>> fields = new ArrayList<>();
        private final Label errorSummary = wrappingLabel("", "form-summary");
        private final ButtonType submitType = new ButtonType("Add profile", ButtonBar.ButtonData.OK_DONE);
        FormDialog(String title, String subtitle) {
            prepareDialog(dialog);
            dialog.setTitle(title);
            dialog.setResizable(true);
            DialogPane pane = dialog.getDialogPane(); pane.setPrefWidth(620);
            pane.getStyleClass().add("profile-dialog");
            grid.setHgap(18); grid.setVgap(16);
            ColumnConstraints left = new ColumnConstraints(); left.setPercentWidth(50); left.setHgrow(Priority.ALWAYS);
            ColumnConstraints right = new ColumnConstraints(); right.setPercentWidth(50); right.setHgrow(Priority.ALWAYS);
            grid.getColumnConstraints().setAll(left, right);
            errorSummary.setManaged(false); errorSummary.setVisible(false);
            VBox body = new VBox(19, label(title, "dialog-title"), wrappingLabel(subtitle, "muted"), separator(), grid, errorSummary,
                    wrappingLabel("Changes save automatically after applying. If saving fails, the registry keeps your changes in memory and shows a warning.", "hint"));
            body.setPadding(new Insets(22));
            ScrollPane scroll = scrolling(body); scroll.setPrefViewportHeight(title.contains("child") ? 570 : 485);
            pane.setContent(scroll);
            ButtonType commit = title.startsWith("Edit") ? new ButtonType("Apply changes", ButtonBar.ButtonData.OK_DONE) : submitType;
            pane.getButtonTypes().setAll(ButtonType.CANCEL, commit);
            Node submit = pane.lookupButton(commit); submit.setId("record-submit"); submit.getStyleClass().add("primary-button");
            pane.lookupButton(ButtonType.CANCEL).setId("record-cancel");
        }
        Field<TextField> text(String label, String prompt, String id, String value, String hint) {
            TextField control = new TextField(value); control.setPromptText(prompt); control.setId(id);
            return field(label, control, hint);
        }
        Field<DatePicker> date(String label, String id, String value, String hint) {
            DatePicker control = new DatePicker(); control.setId(id); control.setEditable(true); control.setMaxWidth(Double.MAX_VALUE);
            control.setPromptText("YYYY-MM-DD");
            control.setConverter(new StringConverter<>() {
                public String toString(LocalDate date) { return date == null ? "" : date.toString(); }
                public LocalDate fromString(String value) {
                    try { return value == null || value.isBlank() ? null : LocalDate.parse(value.strip()); }
                    catch (RuntimeException e) { return null; } // Submit displays a field-specific error instead of losing the form.
                }
            });
            if (value != null) control.setValue(LocalDate.parse(value));
            return field(label, control, hint);
        }
        Field<ComboBox<String>> choice(String label, String id, List<String> choices, String value) {
            ComboBox<String> control = new ComboBox<>(FXCollections.observableArrayList(choices));
            control.setId(id); control.setPromptText("Select…"); control.setValue(value); control.setMaxWidth(Double.MAX_VALUE);
            return field(label, control, "");
        }
        private <T extends Control> Field<T> field(String title, T control, String hint) {
            Field<T> result = new Field<>(title, control, hint); fields.add(result); return result;
        }
        void place(Field<?> field, int column, int row) { place(field, column, row, 1); }
        void place(Field<?> field, int column, int row, int width) { grid.add(field.box, column, row, width, 1); }
        void onSubmit(Submission submit) {
            Button button = (Button) dialog.getDialogPane().lookupButton(dialog.getDialogPane().getButtonTypes().get(1));
            button.addEventFilter(ActionEvent.ACTION, event -> {
                if (!submit.submit()) { event.consume(); fields.stream().filter(f -> !f.error.getText().isEmpty()).findFirst().ifPresent(f -> f.control.requestFocus()); }
            });
        }
        void clearErrors() { fields.forEach(Field::clearError); errorSummary.setVisible(false); errorSummary.setManaged(false); }
        boolean hasErrors() { return fields.stream().anyMatch(f -> !f.error.getText().isEmpty()); }
        void showError(String message) { errorSummary.setText(message == null ? "Unable to apply this record." : message); errorSummary.setVisible(true); errorSummary.setManaged(true); }
        void show() { dialog.showAndWait(); }
    }

    private static final class Field<T extends Control> {
        final T control;
        final Label error = wrappingLabel("", "field-error");
        final VBox box = new VBox(6);
        Field(String title, T control, String hint) {
            this.control = control;
            Label caption = label(title + " *", "field-label"); caption.setLabelFor(control);
            control.setMaxWidth(Double.MAX_VALUE);
            error.setId(control.getId() + "-error"); error.setManaged(false); error.setVisible(false);
            box.getChildren().addAll(caption, control);
            if (!hint.isBlank()) box.getChildren().add(wrappingLabel(hint, "field-hint"));
            box.getChildren().add(error);
        }
        void error(String message) { error.setText(message); error.setVisible(true); error.setManaged(true); if (!control.getStyleClass().contains("invalid-field")) control.getStyleClass().add("invalid-field"); }
        void clearError() { error.setText(""); error.setVisible(false); error.setManaged(false); control.getStyleClass().remove("invalid-field"); }
    }

    private void prepareDialog(Dialog<?> dialog) {
        dialog.initOwner(stage); dialog.initModality(Modality.WINDOW_MODAL);
        java.net.URL css = DesktopView.class.getResource("enay.css");
        if (css != null) dialog.getDialogPane().getStylesheets().add(css.toExternalForm());
    }

    private <T> TableColumn<T, String> column(String title, Function<T, String> value, double width) {
        TableColumn<T, String> column = new TableColumn<>(title);
        column.setCellValueFactory(data -> new ReadOnlyStringWrapper(value.apply(data.getValue())));
        column.setPrefWidth(width); column.setMinWidth(55);
        return column;
    }

    private <T> TableColumn<T, String> statusColumn(Function<T, String> value) {
        TableColumn<T, String> column = column("STATUS", value, 104);
        column.setMinWidth(98);
        column.setCellFactory(c -> new TableCell<>() {
            @Override protected void updateItem(String status, boolean empty) {
                super.updateItem(status, empty);
                setText(null); setGraphic(empty || status == null ? null : statusPill(status));
            }
        });
        return column;
    }

    private static Label statusPill(String value) {
        Label pill = label("●  " + value, "status-pill"); pill.getStyleClass().add(value.equals("Active") ? "status-active" : "status-inactive"); return pill;
    }
    private static Label avatar(String name, String color) {
        String[] parts = name.strip().split("\\s+");
        String first = parts.length == 0 || parts[0].isEmpty() ? "?" : new String(Character.toChars(parts[0].codePointAt(0)));
        String second = parts.length > 1 ? new String(Character.toChars(parts[parts.length - 1].codePointAt(0))) : "";
        Label avatar = label((first + second).toUpperCase(Locale.ROOT), "avatar"); avatar.getStyleClass().add("avatar-" + color); return avatar;
    }
    private static VBox detailField(String caption, String value) { return new VBox(5, label(caption, "detail-caption"), wrappingLabel(value, "detail-value")); }
    private static VBox emptyState(String title, String message, Button action) {
        VBox empty = new VBox(9, label("◫", "empty-symbol"), wrappingLabel(title, "empty-title"), wrappingLabel(message, "empty-copy"));
        empty.setAlignment(Pos.CENTER); empty.getStyleClass().add("empty-state");
        if (action != null) empty.getChildren().add(action); return empty;
    }
    private static ScrollPane scrolling(Node node) {
        ScrollPane scroll = new ScrollPane(node); scroll.setFitToWidth(true); scroll.setHbarPolicy(ScrollPane.ScrollBarPolicy.NEVER); scroll.getStyleClass().add("plain-scroll"); return scroll;
    }
    private static Separator separator() { Separator separator = new Separator(); separator.getStyleClass().add("soft-separator"); return separator; }
    private static Label label(String text, String style) { Label label = new Label(text); label.getStyleClass().add(style); return label; }
    private static Label wrappingLabel(String text, String style) { Label label = label(text, style); label.setWrapText(true); label.setMaxWidth(Double.MAX_VALUE); return label; }
    private static Button button(String title, String style, String id) { Button button = new Button(title); button.getStyleClass().add(style); button.setId(id); button.setCursor(javafx.scene.Cursor.HAND); return button; }
    private void title(String title, String subtitle) { pageTitle.setText(title); pageSubtitle.setText(subtitle); }
    private void updateSaveState() {
        saveState.setText(!storageAvailable ? (dirty ? "●  Unsaved · storage needs attention" : "●  Storage needs attention")
                : dirty ? "●  Unsaved changes" : "●  All changes saved");
        saveState.getStyleClass().removeAll("state-dirty", "state-clean", "state-error");
        saveState.getStyleClass().add(!storageAvailable ? "state-error" : dirty ? "state-dirty" : "state-clean");
    }
    private String idleMessage() {
        if (!storageAvailable) return dirty ? "Changes are in memory. Review storage errors before saving." : "Storage needs attention. Review Data & backup before saving.";
        return dirty ? "Changes are in memory. Save before closing." : "Your registry is up to date.";
    }
    private static String displayDate(String value) { return LocalDate.parse(value).format(DISPLAY_DATE); }
    private static String childAge(String value) {
        Period age = Period.between(LocalDate.parse(value), LocalDate.now());
        long months = age.toTotalMonths();
        if (months == 0) return age.getDays() + (age.getDays() == 1 ? " day" : " days");
        if (months < 24) return months + (months == 1 ? " month" : " months");
        return age.getYears() + "y " + age.getMonths() + "m";
    }
}
