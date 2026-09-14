# First inspection and patrol archive design QA — v1.34.172

Scope: implement the approved first-inspection workbench and mobile flow, and the date-based paper patrol archive. This is a functional redesign using synthetic records in a dedicated PostgreSQL/MinIO environment. No production records were modified.

## Visual evidence

Source: `output/previews/quality-paper-archive-20260914/screenshots/first-inspection-20260915/01-workbench.png`, `02-register.png`, `06-mobile-screen.png`, and `output/previews/quality-paper-archive-20260914/screenshots/01-patrol-desktop.png`.

Implementation: `output/quality-paper-v172/screenshots/first-tablet.png`, `first-editor.png`, `patrol-tablet.png`, `first-mobile.png`, `process-picker.png`, `ordinary-process.png`. Desktop comparisons use 1366×1024 screenshots; mobile uses 390×844. Source and implementation were viewed together in the same comparison input. The demo ribbon is intentionally absent from the actual product; model names, dates, counts and sample personnel differ because the database fixture includes 36 real process rows.

- Preserved the narrow platform navigation, product/date list, process/report list and fixed reading panel. Existing platform navigation and authenticated APIs replace prototype navigation.
- Preserved orange actions, white cards, pale gray surfaces, restrained status colors, shared Lucide icons and the system Chinese font stack.
- Kept real date/search/export/recycle controls for record retrieval. The shared file reader adds saved public orientation and original-download controls; it does not overwrite the evidence image.
- The prototype's paper specimens remain clearly marked demonstration material and were uploaded only to the isolated test environment.

## Findings and resolution

1. Resolved: native date edits could revert after another field changed. Date input handlers now update state for both native input and change events. A patrol record was edited from September 15 to September 14, then another field was changed; the saved record and date-group counts correctly moved to September 14.
2. Resolved: shared image controls overlaid the paper. The toolbar now reserves its own top row; desktop rotation controls share a compact line while narrow screens wrap. Zoom, fullscreen, rotation/save and restored-file reading were exercised.
3. Resolved: native confirmation dialogs were unreliable inside the embedded browser. Form discard and whole-record delete/restore now use in-page controls. Continue retains typed text; discard closes the editor; delete/restore requires a reason.
4. Resolved: switching ordinary/first processes could lose an unsaved first form. Visited forms retain their own state; a 36-process fixture was searched by sequence, switched to ordinary cutting and back, and the first-inspection note was preserved. The ordinary process has no first-inspection fields.
5. Resolved: the recent first-record entry must open that record, and refreshing its photo order must not collapse the detail. Mobile receives the selected record directly and preserves the active detail when refreshing its list.
6. Resolved: recycled records must display a deleted badge even when their prior status was submitted. The list now prioritizes the deletion state.

## Functional acceptance

Real browser flow: login, desktop first-photo upload and result save into process 05, separate untouched same-name processes 16/31, batch upload of two patrol photos, date correction, preview/zoom/fullscreen, saved orientation, record recycle and restore with both originals retained, edit/close protection, mobile search/switch/draft retention, and absence of patrol from the QR type list. Browser console errors were empty on the final checked tab.

Backend evidence: `output/quality-paper-v172/integration.log` (4 integration tests), `unit.log` (1189 passing unit tests, no failures; database-gated cases run separately), `http-base.json` (108 quality HTTP checks), `http-paper.json` (34 paper-inspection HTTP checks), `release-contract.log` (4 version/release checks). New HTTP checks cover scope, access, idempotency, result/evidence validation, real object uploads, rotation revision conflicts, original SHA, export contents, ordering and restore. The release workflow repeats HTTP acceptance for source and anonymously pulled Hangzhou images with separate clean databases.

Physical camera permissions, real WeChat devices and mobile keyboard behavior were not tested on physical hardware. Camera uses the existing browser file capture mechanism; album multi-selection was exercised in the browser.

final result: passed

---
# HR directory design QA — v1.34.139

Source visual truth: `C:/Windows/TEMP/codex-clipboard-2af17768-79f8-4a2b-8d32-c8bd6c3763e2.png` plus the accepted compact HR proposal in `C:/Users/31175/.codex/visualizations/2026/09/08/01a07e69-5cde-7d82-a8cd-a143c81eb134/hr-directory-plan.html`.

This is an authorized redesign, not a pixel clone of the original broken UI. The source screenshot uses a different employee and business dataset. All implementation screenshots use synthetic records in a dedicated local database; no claim is made that their counts match production.

## Evidence and normalization

- Original screenshot: 2553×1351 pixels. Source CSS viewport/device scale are unknown; normalized to 1702px wide without changing its aspect ratio for composition comparison.
- Implementation desktop: `artifacts/hr-directory-v134139/desktop-final.png`, 1701×901 pixels from the browser's 1702×901 requested viewport (fractional desktop scaling rounds the capture width). Normalized to 1702px wide for the comparison.
- Full-view side-by-side: `artifacts/hr-directory-v134139/comparison-full.png`.
- Focused command/header comparison: `artifacts/hr-directory-v134139/comparison-controls.png`.
- Primary tablet: `artifacts/hr-directory-v134139/tablet-final.png`, requested and DOM-confirmed 1366×1024, reading state.
- Short screen edit/error: `artifacts/hr-directory-v134139/1366x768-edit.png`; DOM-confirmed footer bottom 751.34 within the 768px viewport. The body ends where the footer begins.
- Mobile: `artifacts/hr-directory-v134139/390x844-edit-native.png`, 390×844. Footer bottom 835.34px; content scroll area remains available. Native browser capture was used after raw CDP capture cropped the emulated physical surface. Cropped intermediate images are not acceptance evidence.
- Raw CDP screenshots can be at the host's 1.5 scale; final comparison uses native normalized screenshots, not those intermediate images.

## Findings and iteration history

1. [P1, resolved] Original account-only row and full-height child competed for vertical space. Removed the extra row; the shared HR content now allocates a flex track and the directory/profile each reserve a scrollable body track. At tablet and short-screen sizes all editing controls are visible.
2. [P2, resolved] Original reading mode resembled a disabled form and duplicated the edit action. Read mode now uses label/value sections; only edit/create display inputs and the persistent footer.
3. [P2, resolved] Side panel consumed core editing width. The role/account summary opens on demand in a 400px drawer with Escape, focus return and keyboard containment. Large desktop also uses this on-demand panel; the proposal's optional permanently pinned third column was not needed for the tablet-first release.
4. [P2, resolved] Original blocking browser confirmation could not be exercised reliably in the embedded browser. Internal discard actions now use an accessible in-page dialog. Both continue and discard were exercised. Browser back was retested after removing a stale one-shot navigation bypass; entered data and edit URL are retained when continuing.
5. [P2, resolved] Save errors in a hidden tab could be missed. All errors now appear beside the persistent buttons; name, mobile, hire-date and department validation focus the corresponding tab/field. Actual invalid phone text remained visibly in the input after server rejection; the successful correction/create flow was verified.

Post-fix evidence is in the final screenshots and browser checks described above. No actionable P0/P1/P2 findings remain within the employee-directory and shared-shell scope.

## Required fidelity surfaces

- Typography: existing system icon family retained; explicit Microsoft YaHei/PingFang/system sans-serif stack; 14px form text, 13px field labels, 12px supporting copy, larger employee identity. Chinese labels and actions wrap without overlapping at the checked viewports.
- Spacing/layout: 240px desktop/tablet employee navigation, flexible profile, compact command bar, reserved footer; organization branches are collapsed until selected. The tablet command bar wraps into content-bearing metric/action rows. Desktop fits them on one row. Form fields use two columns on tablet and one on narrow screens.
- Color/tokens: warm orange selected states and primary actions, white surfaces, pale gray background, restrained shadows, existing green employment/attendance states. Shared shell is updated across HR while specialized modules retain their task layouts.
- Images/icons: no raster scene was called for by the HR proposal. Existing Lucide library icons and real employee-name initials remain; no decorative industrial image or fake photo was introduced into the form.
- Copy/content: account management is concise; unavailable WeCom state is omitted unless bound; account policy is collapsible. Dynamic directory data comes from existing APIs. Unmodified responsibility/reference content elsewhere in HR is outside this directory redesign.

## Interaction acceptance

Verified login, profile editing, two-tab updates, persistent data after save, automatic employee-number creation, selected new profile and URL, API validation/error retention, cancel, employee-change discard choices, browser-back protection, missing-field focus, drawer keyboard close, organization collapse, search empty state and inactive roster. Recruitment, attendance, skill, training, organization, responsibilities, approvals and analytics navigation rendered successfully. Training was checked again after its asynchronous load completed. Browser error log was empty on the final tab.

No physical tablet or full mobile keyboard test was performed. Existing business-specific workflows on other HR pages were not exhaustively re-run in the browser; CI and the existing integration suite cover their own regression contracts.

## Published artifact confirmation

The exact `v1.34.139` image from source `2e94aeaf5dfdf2e92b62454cf78544e9256ea4b5` was anonymously pulled by digest and started with a new isolated PostgreSQL database and MinIO. The release browser reproduced the accepted layout and successfully saved/reloaded/restored a synthetic employee. Final evidence: `artifacts/hr-directory-v134139/release-tablet-final.png`, `release-1366x768-edit.png`, `release-container-verification.json` and `release-runtime-smoke.json` (27 HTTP checks, 141 applied existing migrations). The final release tab reported no browser errors.

Reduced-motion emulation disabled the drawer animation, and Tab/Shift+Tab remained within the open panel in the source browser pass. Emulation overrides were cleared after validation.

final result: passed
