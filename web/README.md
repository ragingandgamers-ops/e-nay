# E-Nay browser edition

Responsive web/mobile PWA for a single barangay clinic, with separate patient and staff accounts, Cloudflare D1 sharing, and encrypted account-specific offline copies. Java console and JavaFX applications remain separate. Real licensed photography only; see [ASSETS.md](ASSETS.md).

## Run locally

Use Node.js 24 or later from the repository root:

```sh
node web/server/dev-server.mjs
```

Open http://127.0.0.1:8765/. This serves both the website and its account API. A static Python server or opening index.html directly cannot provide accounts or sharing. Local clinic state is stored in ignored data/local-web/clinic.sqlite; it is separate from production and Java data. No account is created by default. The database owner must approve staff access.

For automated tests only, start with --test. This uses an in-memory database and fictional test.staff, test.patient and other.patient accounts with the password in tests/session.mjs. These fixtures are never included in the production deployment and must not be used as real credentials.

## Language and local context

The English interface keeps welcoming Filipino phrases; an English / Filipino control switches the full interface without a network request. Filipino copy covers the public pages, accounts, family and staff screens, forms, review prompts, guidance, and expected validation/session errors. The preference is stored separately in enay.language.v1 localStorage and is available offline. If preference storage is blocked, switching still works for the current page.

Only explicitly marked UI literals, labels and message templates are translated. Patient names, entered notes, usernames, IDs, vaccine names, exported files, and canonical option values are unchanged. Switching updates existing DOM text and accessible labels instead of rerendering forms, preserving unsaved fields, search/filter selections, chosen import files and review confirmations. The workspace keeps language and appearance in My profile; the redundant top bar is hidden at every workspace width and record dialogs have no language bar. Linked patient access and server permissions are independent of language. Dates follow the selected locale. External source pages and browser-native date/file/validation controls use their own language settings.

The photographs are documented as taken in Manila and Cagayan Valley; credits and licenses are in ASSETS.md and the footer. No AI-generated imagery is used.

## Accounts and privacy

Public registration asks Mother or Father / companion and always creates a patient-role account. A mother supplies her maternal details and current pregnancy status during registration: account creation, exactly one personal maternal record and its ownership link commit atomically. There is no extra Add maternal profile action for an established mother account. A father supplies no maternal details and starts on a pairing screen. Only a trusted database owner can approve a staff account; the public API cannot promote accounts. Staff manage clinical profiles, visits, vaccination dates, growth measurements, vaccine inventory, imports and clinic backups. Staff link verified patients/guardians to existing maternal or child profiles through Patient access. Mothers can update their personal maternal record, add child records, and directly edit their authorized checkup notes and child measurements. New child forms preselect the account’s maternal record. Existing accounts choose their own already-linked maternal record through Set up my personal profile; records are never guessed by name, merged or deleted. A maternal record can be the personal record of only one account. Existing unclassified accounts may create a first maternal record, but cannot create a second one. For vaccinations they can submit, edit or withdraw only pending requests; approved appointments and administered-dose records are staff-controlled. New profiles are linked to their creator automatically; staff can link existing clinic profiles after verifying identity. The clinic staff workspace shows every family’s synchronized records. Patients cannot replace the clinic snapshot, manage inventory, assign account links or access other families. Updated records show whether the last editor was a patient or staff; a staff label is not a clinical verification claim. All private API calls check the current account role on the server. Changing a URL or hiding/showing controls does not grant access.

Passwords are salted scrypt hashes (N=32768, r=8, p=3); plaintext passwords are not stored. API access requires both an HttpOnly Secure SameSite cookie and a separate proof kept in per-tab sessionStorage for reload continuity; it is never placed in localStorage. The device cookie alone grants no access. Sessions expire after 12 hours. Refreshing the same tab restores the original session without extending that expiry. Online restoration checks the current account and authorized records before displaying them; rejection or a changed role requires sign-in again. Sign-out synchronously removes the tab continuation, clears the private screen and in-memory key/proof, and revokes the online session when reachable. Auth attempts are rate-limited. Mutations require the exact same origin.

The first staff account is provisioned by the trusted Cloudflare owner after its holder registers and confirms the username. No default staff password, public role picker, or first-visitor takeover exists. There is currently no self-service password reset, email verification, MFA, or multi-clinic separation; account recovery requires a trusted owner workflow.

## Offline use and synchronization

Sign in online first on each device. Compatible browsers cache the public app shell and short guides. IndexedDB stores only an AES-GCM encrypted authorized snapshot, using a non-extractable key derived from the password with PBKDF2-SHA256 (600,000 iterations). The password and raw vault key are never persisted. To keep an unlocked tab usable after refresh, a random per-tab wrapping secret in sessionStorage protects a wrapped copy of the vault key in a separate IndexedDB store. AES-GCM binds that wrapped key to the account, role, session ID and original expiry; restored keys remain non-extractable. No clinical records go into Web Storage. This is same-tab continuity, not a permanent “remember me” login; a fresh independent tab requires sign-in. Browser tab duplication/session recovery may retain sessionStorage, so always sign out on shared devices. As with the active page, same-origin script compromise could expose the tab continuation; it is not an XSS defense. Account metadata and a random salt/nonce are stored outside the ciphertext; the account ID, username and role are authenticated as additional data. A copied or modified role label cannot decrypt another role’s snapshot.

Wait for both Offline ready and confirmation of an encrypted device copy. Within the valid tab session, offline refresh unlocks the encrypted copy automatically. After sign-out, expiry or losing the tab session, unlock the same account with its password when offline. An incorrect online password never falls back to offline unlock. If storage APIs are unavailable, the session can operate online only; failed network saves retain the form. Messenger’s embedded browser may lack offline APIs: open the site in Safari/Chrome and install from there. This is a PWA, not an APK or App Store package.

Patient and staff saves persist the encrypted device copy before acknowledging an offline change. Ordinary saves use immutable per-change receipt IDs and original-record comparisons. Independent record edits merge into the current clinic copy; stale edits to the same record are rejected and remain encrypted on the device. Server-assigned M/C IDs avoid collisions between offline families, and dependent notes/measurements are remapped with their profiles. Retries after lost responses do not duplicate records or consume stock twice. Staff imports and legacy pending snapshots still use a full-workspace revision comparison. IndexedDB transactions also compare the local generation to reject stale editing tabs. A password unlock performed entirely offline has no server proof; sign in online to reconnect it. A valid previously online tab session retains its proof through refresh. Use Sync / refresh to load accepted cloud changes. Updates are not pushed live to other devices. Connected father views also check for current access on focus/reconnection and every 30 seconds while visible, when no dialog or pending edit would be interrupted.

Offline authorization reflects the last downloaded role and links. Revoking access stops future server reads/writes immediately, but cannot erase a previously downloaded offline copy. Offline edits after revocation remain local drafts that the server rejects. Account holders must protect their device and password. Downloaded JSON/text backups are unencrypted and need private storage. Cloudflare/the trusted database owner can access cloud records; this is not end-to-end encryption of the server database.

Old enay.workspace.v1 localStorage records are preserved and never uploaded automatically. Staff may choose Data & backup > Review records from the previous app, inspect the result, then explicitly confirm import. A confirmed clinic import clears patient account links, personal record assignments and companion connections, requiring staff identity verification and linking again. Account types remain intact. Removed maternal records also invalidate their personal assignments and companion connections so a reused ID cannot reveal an unrelated family. Stale/rejected imports leave current links intact. Damaged or all-invalid sources cannot silently blank clinic records. Java imports remain profile-only; complete web backups include contacts, barangay and all care types.

## Mother identity and father companion access

A mother opens **My profile > Companion access > Create pairing code** and gives the code privately to the father. The father enters it in his account. The 96-bit random code expires after 15 minutes, is stored only as a SHA-256 digest, and is redeemed once in an atomic transaction. Creating a new code invalidates the old invitation. Attempts are rate-limited by account and IP. One father can be connected to one mother, and a mother has one companion at a time. Staff cannot assign profiles directly to father accounts. Father accounts are excluded from the staff patient-link editor.

A paired father can view that mother’s personal maternal record and the child records already linked to her account, with their checkups, measurements and vaccinations. He cannot create, edit, request, approve, administer, change stock or replace a workspace; API checks enforce read-only access even with a forged request. Unpaired fathers see the invitation screen with other record navigation hidden. Mothers can disconnect from the same menu. Revocation stops subsequent server reads immediately; a connected father’s view clears on its next successful refresh. A previously downloaded encrypted offline copy cannot be erased remotely. No real production patients are paired by the developer during verification.

The schema upgrade uses new IF NOT EXISTS tables only; it does not rewrite existing accounts or medical records. New API version: password-recovery-v1. The public shell is enay-shell-v25.

## Linked family profiles, appearance and staff tasks

Child creation offers an existing maternal-profile selector, showing names and IDs to distinguish people with the same name. Selecting a profile saves `motherId` and uses its canonical name. Manual mother-name entry remains available when no profile exists; old name-only records still load without guessed links. Staff can select any clinic maternal profile, while patients can select only authorized profiles. Linking a relationship does not grant account access to either record. A child-only account can keep an existing maternal link without receiving the maternal record. Authorized family records link both ways. Children created from a mother’s record start with that mother selected. Offline operations remap maternal IDs in children along with profile IDs; complete backups retain relationships, while Java text exports retain the name only. Legacy whole-snapshot saves preserve existing relationship metadata.

Homepage entry buttons read **Sign in / Sign up** when signed out, **Go to clinic dashboard** for staff and **Go to my dashboard** for patients. Labels update on sign-in, restoration, language changes and sign-out.

Appearance is available on the public language bar and under **My profile**. **Use device setting** is the default, with explicit **Light mode** and **Dark mode** overrides. A small public script applies the saved/system theme before styles; theme colors also cover dialogs, account pages, guides, tables, charts and native controls. Only the preference is stored in `enay.theme.v1`, independently of private records and sessions. Blocked preference storage still allows changes for the current page. Public theme assets are part of the offline shell.

The staff summary has six clickable task queues: requests awaiting review, overdue approved vaccinations, today’s approved vaccinations, follow-ups due, unresolved growth review flags and stock requiring action. Profile totals are secondary links. Each queue opens the relevant records and an appropriate action; a due follow-up can start a visit for the selected patient. Follow-ups use the latest visit per patient. Growth flags use the latest recorded assessment, leaving a flag unresolved until a later assessed entry clears it. Empty expired batches are excluded from stock action; remaining expired doses and low/unavailable stock remain visible. Completed, cancelled and declined vaccination records do not become missed appointments. Counts use the authorized current clinic copy and Philippine dates; they refresh with normal clinic synchronization and do not implement a medical triage score.

## Clinic-authored care guides

Care guides now has a separate **From your clinic** library above the bundled general guides. Staff can write an article, add a topic and short description, optionally supply a Filipino title/article/description, identify its clinic/source, and link an HTTPS article, PDF or video. Preview preserves unsaved editor values and can display either supplied language. Article text is plain text with paragraphs; HTML is escaped. Materials are links, not file uploads, and external files are not downloaded for offline use.

New articles start as **Draft**. Staff explicitly publish an article to share it with every patient account in this clinic; a patient does not need a linked family profile to read it. Only staff can create, edit, publish or archive articles, enforced in record operations on both the device and API. Drafts and archived guides are excluded from patient API responses and encrypted patient copies. Archiving preserves the staff record and removes it from connected patients after their next successful sync. A disconnected device retains its previously downloaded version until it reconnects. This remains a single-clinic deployment, not separate tenants for multiple barangays.

Article text joins the encrypted account copy, complete JSON backups and conflict-safe record synchronization. Offline staff edits/publication are marked pending until accepted by the clinic API. Patients can read downloaded article text offline; external materials need internet. Switching language uses the supplied Filipino article, or visibly falls back to the original English version. Entered article text and source names are not machine-translated. Old backups/device copies without the optional guides collection still load; old whole-snapshot clients and pre-guide imports preserve the current clinic articles.

## Working clinical features and proposal gaps

Implemented: validated maternal/child profiles; contact and barangay; search/filters; visit notes, symptoms, diet notes, blood pressure/follow-up; patient vaccination requests, staff approval/reservations and administered-dose status labels; child measurements and a weight chart; manual assessment flags; stock batches/thresholds/expiry alerts; static sourced care guides; reviewed backups and Java text compatibility. Mothers’ records include checkups and notes; children’s records include growth, notes and vaccinations. Each profile opens its own history. The compact mobile header opens a profile menu for account details, sync/refresh, installation, language and sign-out.

Patients request a vaccine for a family profile, optionally adding a preferred date, dose label and message. The request stays in a separate Pending verification queue and does not reserve stock. Staff verify eligibility and availability, choose a matching batch, enter the dose and approved appointment date, then explicitly approve. Approval deducts one available dose as a reservation. Recording administration changes that allocation to administered without deducting twice. Staff cancellation of an unused approved appointment returns the reservation; an administered record cannot be cancelled. Declining a request requires a reason visible to the patient and has no stock effect. Patients cannot approve, change clinic dates, administer a dose, or modify an approved record through the UI or direct API. Staff may separately record external vaccination history without consuming clinic stock.

Existing unreserved appointments and patient-reported history remain preserved for staff review instead of being silently approved or charged against inventory. New requests stay separate from approved appointments/history. Empty/expired batches, mismatched vaccines, backdated new reservations and concurrent attempts to reserve the last dose fail atomically. Duplicate active requests are blocked; a suspected stale duplicate is rechecked against the clinic before rejecting a new request.

Clinic decisions refresh on vaccination navigation, returning to the tab and reconnection when no pending edits would be overwritten. If staff review a request while a patient edits offline, the patient can download an authorized private pending copy and explicitly replace local edits with the clinic decision. Approval made offline is shown as awaiting sync until accepted by the server. Patient vaccine catalogs expose names only, without batch IDs or stock counts. Dates use Asia/Manila in browsers and Cloudflare.

The user approved shared Cloudflare storage as a change from the original single-device proposal. This release implements access and sharing, but it does not finish the remaining clinical proposal modules: built-in approved vaccine schedules, pregnancy/development timelines, automatic growth/nutrition screening, independent daily symptom/food logs, monthly reviews and rule-selected guidance. Manual entries/flags are not represented as those clinical algorithms. JavaFX is also not a Swing rewrite of the proposed Java design. No AI diagnosis or SMS/email system is included.

## Deploy on Cloudflare Pages

Production: https://e-nay-care.pages.dev/ . Direct Upload is independent of GitHub pushes.

1. Create an empty D1 database and bind it as DB in the production Pages project.
2. Use compatibility date 2026-10-18 and nodejs_compat.
3. Run node web/server/build-worker.mjs. This deterministic dependency-free build emits dist/_worker.js from the maintained server/core sources.
4. ZIP the contents of dist/ at the archive root, including _worker.js, and use Pages Direct Upload. Do not upload local databases, test fixtures, passwords or environment files.
5. Verify /api/status returns ready:true and unauthenticated /api/workspace returns 401. The API initializes the empty schema with an atomic D1 batch; no production accounts are seeded.

The service worker caches only the public shell, never private /api responses. Bump its version after frontend changes and keep its module list aligned. The canonical ./ entry avoids Cloudflare’s /index.html redirect-cache ERR_FAILED issue. Existing users can open /start#workspace while connected to update without deleting old records. An old worker may require a second normal reload after installation.

## Conditional due dates and vaccination form requirements

A mother selects Pregnant or Not pregnant. Expected delivery date is required only for Pregnant; other mothers can leave it blank in registration, existing-account setup and record editing. A supplied date must be a real calendar date. Older records without a pregnancy status retain their saved date and are shown as Not recorded; the app does not infer pregnancy from a historical date. Complete JSON backups retain pregnancy status and blank due dates. The older Java text format requires a date, so maternal text export explains that a complete JSON backup is needed instead of emitting invalid rows.

Form labels derive their asterisks and optional markers from each live required/disabled/readonly constraint. Clinic approval marks batch, dose and scheduled date required; declining marks the staff response required. External history does not require a clinic batch. Filipino article title/body requirements also update together. English and Filipino labels keep the same canonical values.

Opening a staff vaccination form refreshes clinic records when online with no pending edits. Every inventory batch is listed, with matching request names first; empty/expired batches are disabled unless already allocated to that record. A refresh control updates stock choices without clearing other form values. Differently worded patient requests no longer hide every batch: selecting a different inventory name requires an explicit staff verification checkbox, enforced by the API. The original requested vaccine name is preserved separately from the chosen canonical inventory name. Approval still reserves exactly one dose and administration does not deduct it again. Patient permissions remain request-only.

## Companion capacity

A mother can invite at most 3 read-only companions. Each companion still connects to one mother. Every invitation is single-use and expires after 15 minutes; creating a new invitation replaces the previous unredeemed code. The Companion access screen lists connected names/usernames and individual Disconnect controls, shows the current count, and disables invitations at capacity. The server checks the limit when issuing and redeeming codes; the redemption count check runs inside the insertion statement so concurrent requests cannot overfill the final slot.

Existing pairings migrate from the older unique-mother table in one transactional batch without changing accounts or care records. Individual removal preserves the other companions; an older client that omits a companion ID cannot remove multiple people at once. Disconnecting cancels the current invitation. Previously downloaded authorized offline copies cannot be remotely erased. English and Filipino screens share the same permissions and limit.

## Dated child measurements

Add measurement remains the starting action. After choosing a child and date, the form loads an existing entry for that date and uses Update measurement, or presents blank fields with Save new measurement for a new date. Previous dated weight/height are shown separately. Measured again—values are unchanged explicitly copies only those two numbers; assessment and clinical notes are not copied. Changing child/date prompts before discarding unsaved values. Original saved dates remain in the growth chart/history. Existing legacy duplicate rows are preserved with a selector so staff can review each one.

The device and record API reject a new measurement on an already-used child/date, including collisions after offline ID remapping. Concurrent saves are protected by the workspace revision transaction and immutable receipts. A rejected offline change stays encrypted and visible with recovery controls: download the authorized pending copy, then explicitly load the clinic copy. The server never silently overwrites the accepted measurement.

## Staff deletion and health archives

Staff can select individual records or batches of up to 100 accounts, profiles and care records. The archive/delete review shows account and record counts, linked children, released profile IDs and vaccine stock effects. Confirmation requires typing ARCHIVE. Deleting a mother account removes its login and personal family from active use while preserving the medical snapshot in a staff-only, read-only Health archive. Related child profiles, visits, measurements and vaccination history are retained there. Other guardian/companion accounts are disconnected, not deleted. Legacy Trash entries can be moved into the Health archive to release their reserved IDs. There is no health-archive purge endpoint.

The active workspace, history archive, account/session/link removal, ID release and stock adjustments commit atomically. A failed transaction leaves all previous data intact. The smallest free M### or C### can be reused; archived snapshots have independent UUID identities and are never attached to the new patient. Prior Trash versions and patient identity snapshots are retained too. Reissuing the same deletion operation cannot delete a newly reused ID or refund stock twice. Current-account and final-staff guards also apply to batches.

Unused reserved doses are returned once; administered doses are not refunded. An inventory batch referenced by an active vaccination cannot be removed. Keep in Trash remains an explicit reversible alternative and keeps profile IDs reserved. Health archive listings use server-side search and pagination; only clinic staff can read historical details. Ordinary patient snapshots and offline caches never include other people's archives. Active JSON backups do not contain the separate Health archive tables: retain the D1 database backup for full history.

Archival deletion changes a synchronization generation. Older queued/offline edits, stale snapshot saves and old access-link selections are rejected until the current clinic copy is loaded; this prevents history being attached to reused IDs. Pending edits remain available for backup and explicit recovery. Re-creating a deleted username starts a new encrypted device copy without carrying the former account's data or pending changes forward. Previously downloaded copies on other devices cannot be remotely erased.

## Responsive record forms

Native date controls are constrained to minmax(0,1fr) grid columns. Phone forms use a single column; larger screens retain two columns. The record dialog header stays outside its independently scrolling form, keeping Close visible. Browser tests check 320, 390, 768, 1024 and 1440px widths, including dark Filipino vaccination forms. Chromium covers encrypted offline refresh; Windows WebKit covers the family workflow and date-field geometry but its offline-navigation driver fails internally, so that part remains Chromium-only. Physical iPhone/iPad Safari still needs a device check.

## Checks

From the repository root, with the disposable --test server running for browser suites:

```sh
node --test web/tests/core.test.mjs web/tests/accounts.test.mjs
node --test web/tests/dashboard.test.mjs
cd web
npm install
npx playwright install chromium
cd ..
node web/tests/browser.test.mjs
node web/tests/presentation.test.mjs
node web/tests/account-browser.test.mjs
node web/tests/family-workflow.test.mjs
node web/tests/vaccination-request-browser.test.mjs
node web/tests/care-guides-browser.test.mjs
node web/tests/usability-browser.test.mjs
node web/tests/session-browser.test.mjs
node web/tests/language-browser.test.mjs
node web/tests/service-worker.test.mjs
```

The suites cover bilingual navigation and forms, literal record preservation, offline language switching, four-width Filipino layouts, core validation/recovery, API authorization and role revocation, family-only patient reads/edits, automatic ownership, all-clinic staff reads, vaccine-stock concurrency, dependent offline profile ID remapping, lost-response retry, offline encrypted unlock, online/offline refresh, continuation expiry/tampering, unavailable storage, wrong passwords, sign-out, malformed imports, stale tabs/devices, idempotent saves, mobile layouts, reduced motion and hosting-cache recovery. Browser screenshots go to ignored test-output/web/. BROWSER_BIN, PLAYWRIGHT_MODULE and ENAY_URL may select local testing dependencies/URL. Tests use fictional records only; physical iPhone/Safari has not been tested.

## Visual design

The 19 October revision applies the Asklepios reference with the supplied Hygieia Red palette, local Plus Jakarta Sans typography, rounded components and outline navigation icons. [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) records tokens, attribution, font licensing and component conventions. The font is cached with the public shell for offline use. No AI-generated imagery is used.

## Browsing and capacity

Patient access is a searchable, sortable directory of collapsed accounts, with 10 accounts per page. Profile choices are created when an account is expanded; searches, filters, pagination and collapse preserve its selections until Save patient access. These draft selections stay in the current view only and grant no access until saved. Family and other record tables sort before pagination, show 10 rows per page, and search all authorized records. Maternal and child lists include status and barangay filters. Patient views still contain only their authorized family records.

These are browsing improvements, not a storage-capacity increase. The current validators allow 100 maternal profiles, 100 child profiles, 200 clinic guides and 5,000 entries per other record type; the API also rejects workspace payloads near 1.5 MB. Staff account listing and clinic synchronization currently fetch complete authorized snapshots. Larger clinic deployments need indexed record tables, server-side search and cursor pagination, and incremental authorized offline synchronization before these limits can safely be raised. Never delete care history just to make a list shorter.

## Forgot password and clinic-assisted recovery

The sign-in page offers Forgot password? with Request clinic help and I have a recovery code. Active and unknown usernames receive the same public response. Requests do not lock an account or change its password. Staff can filter Accounts & archive to password help requests, check identity using the clinic’s process, then re-enter their own password to issue a single-use 128-bit code valid for 15 minutes. The code is shown only at issuance and stored only as a hash. Reissuing replaces the older code. Patients cannot issue codes; staff cannot issue one to themselves. A staff account needs another signed-in staff member; if all staff are locked out, the clinic owner must assist through the trusted account administration process.

The account owner enters the code and confirms their new 12–128 character password. Redemption is atomic, account-bound, throttled, and guarded against stale issuer credentials/roles and simultaneous reuse. A successful reset preserves roles, profiles and clinical records, revokes existing online sessions, cancels outstanding invitations and recovery codes issued by the recovered account, and returns to normal sign-in. Login checks cannot establish a new session from an old password if credentials change during hashing. Recovery never accepts a username alone as proof of identity, and no email/SMS delivery is claimed.

Saved device copies are encrypted with a key derived from the password. Resetting a cloud password cannot decrypt an older offline copy or remotely erase a copy already downloaded. On the next online sign-in, the app keeps an unopenable old copy intact. A remembered previous password preserves pending changes and re-encrypts the vault under the new password; otherwise the user can download the exact encrypted old generation, explicitly acknowledge the replacement, then load the actual clinic copy. The encrypted backup still needs the previous password. It is a preservation artifact for assisted recovery, not an ordinary readable clinical JSON import. Other tabs cannot silently replace a newer saved generation. No genuine production account password is reset by automated tests.

Recovery checks: node --test web/tests/recovery.test.mjs and node web/tests/recovery-browser.test.mjs. The browser suite runs in Chromium and WebKit, including English/Filipino mobile forms, code issuance, normal sign-in, encrypted old-copy preservation and optional replacement. Unsynced offline recovery is exercised in Chromium; Windows WebKit navigation while offline remains a driver limitation.
