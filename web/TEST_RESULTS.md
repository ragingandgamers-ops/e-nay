# Browser edition verification

Verified 18 October 2026 on Windows and Node.js with Microsoft Edge 155 and Chromium 151 via Playwright 1.62.1. All records used in testing were fictional and isolated in disposable browser contexts. No live patient files were modified.

- **23 core tests passed:** normalization, ID length and duplicate handling, name capitalization, numeric/date rules, calendar age boundaries, historical edits, malformed-row recovery, UTF-8 BOM, capacity, quota/permission failures, corrupt-store recovery, stale writes, clinical links, and complete backup round-trip.
- **69 browser assertions passed:** landing-page section navigation, keyboard skip navigation, actual add/edit forms, inline retry without losing input, case-only duplicate rejection, search reset, care notes, vaccination due status, growth chart, low-stock flag, backup download, reviewed mixed-validity import, all-invalid import preservation, matching profile-field preservation, corrupt storage blocking and explicit restore, fixed edit IDs, and no uncaught JavaScript errors.
- The browser was put **offline**, an uncached network probe was verified to fail, the page reloaded from its service-worker cache, a profile was created without a network, and a further reload preserved it. Supplementary external links displayed an offline message. The test explicitly controls both request blocking and Chromium's reported network state; Playwright's legacy emulation command alone did not retain navigator.onLine=false across reloads in Chromium 151.
- Two simultaneous tabs were exercised: a stale open form could not overwrite the other tab's saved change.
- Nine workspace sections were checked for horizontal page overflow at **320, 390, 768, and 1440 CSS pixels**. Desktop/mobile landing pages, a populated workspace, records, and a phone form were captured and visually inspected. Phone/tablet testing here is viewport emulation, not physical iPhone/Android device testing.
- The cached app entry is served immediately on a weak connection; complete versioned shell caching is required before the “Offline ready” status appears. There are no third-party runtime libraries, remote fonts, analytics calls, or CDN image requests from the app.

Commands from repository root:

The Cloudflare hosting regression (`node web/tests/service-worker.test.mjs`) also passed on 18 October 2026. A local server reproduces Cloudflare's `/index.html` to `/` redirect. The legacy worker reproduces `net::ERR_FAILED`; the corrected worker passes repeat visits, HTML-alias and query-string visits, offline navigation, and recovery through `/start` without deleting saved localStorage. These checks run in disposable profiles and do not inspect the user's browser records.

```sh
node --test web/tests/core.test.mjs
# Start the server before the browser run:
python -m http.server 8765 --bind 127.0.0.1 --directory web/dist
node web/tests/browser.test.mjs
node web/tests/service-worker.test.mjs
```

The existing Java sources were not changed by the web work. Their prior recorded results remain in the repository-level TEST_RESULTS.txt. The web and Java workflows run separately on GitHub.

Scope limits: no clinical diagnostic validation has been performed. Built-in immunization schedules, automated WHO growth-standard interpretation, native phone packaging, encrypted storage, and device synchronization are not implemented. See README.md for the supported manual workflows and deployment requirements.

The presentation suite adds 16 passing assertions for scroll reveals, photo movement, workspace entry, initial and changed reduced-motion preferences, an embedded browser without the offline API, Safari installation guidance, and record entry in that browser. Functional browser checks use reduced motion for stable screenshots; the presentation suite separately exercises motion. Phone checks use Chromium viewport/touch emulation, not a physical iPhone or Safari. Decorative SVG and the mobile help notice were visually inspected.
