# 出勤日历设计 QA

## 对照证据

- source visual truth path: `C:\Windows\TEMP\codex-clipboard-e93552f4-ee0a-468f-a35d-736fae0e073f.png`
- implementation screenshot path: `C:\Users\31175\Desktop\鸿蒙软件\output\playwright\attendance-calendar-v13450\attendance-calendar-1366x1024.png`
- full-view comparison path: `C:\Users\31175\Desktop\鸿蒙软件\output\playwright\attendance-calendar-v13450\design-qa-comparison.png`
- focused region comparison path: `C:\Users\31175\Desktop\鸿蒙软件\output\playwright\attendance-calendar-v13450\design-qa-calendar-focus.png`
- calendar rule dialog path: `C:\Users\31175\Desktop\鸿蒙软件\output\playwright\attendance-calendar-v13450\attendance-calendar-rule-dialog-1366x1024.png`
- holiday acknowledgement path: `C:\Users\31175\Desktop\鸿蒙软件\output\playwright\attendance-calendar-v13450\attendance-calendar-holiday-ack-1366x1024.png`
- viewport: 1366 x 1024 CSS px, deviceScaleFactor 1, light theme, zh-CN, Asia/Shanghai
- source pixels: 2532 x 1388
- implementation pixels: 1366 x 1024
- density normalization: source was bicubic-downsampled to 1366 x 749 for the full-view comparison; implementation remained at its native 1366 x 1024 capture. The focused comparison used source content from y=390 to the bottom, normalized to 1366 px width, and implementation content from y=375 to the bottom at native width.
- state: authenticated administrator, production-department attendance score, August 2026; Sundays are weekly rest, August 15 is a holiday override retaining historical records, and August 30 is a temporary workday override.

## Findings

- No actionable P0, P1, or P2 visual findings remain.
- The change from a flat sequence of daily cards to a Monday-through-Sunday month grid is intentional and follows the requested calendar information architecture. The product header, orange/blue/green tokens, type hierarchy, card radii, borders, and status colors remain consistent with the source screen.
- Six-week months extend below the initial fold at 1366 x 1024, as the source daily-card screen also did. The entire month remains in one calendar panel with normal vertical document scrolling and no horizontal overflow, so this is not treated as a viewport defect.

## Required fidelity surfaces

- Fonts and typography: retained the existing Microsoft YaHei/system sans-serif stack, compact report scale, bold metric hierarchy, and legible state labels. Date numerals and weekday/status labels preserve clear optical hierarchy without wrapping or truncating required actions.
- Spacing and layout rhythm: the seven equal calendar columns align consistently; Monday-through-Sunday headers line up with date cards; gaps, 10 px radii, card padding, and report-panel spacing follow the existing report center. Controls remain reachable at 1366 x 1024.
- Colors and visual tokens: existing report orange remains the primary action color, blue remains the reporting/accent color, green denotes fully confirmed days, red/pink denotes excluded weekly rest or holiday states, and amber denotes temporary workdays. Contrast is sufficient in the captured states.
- Image quality and asset fidelity: the screen does not depend on raster imagery. Existing Lucide icon assets remain sharp and consistent; no placeholder, handcrafted SVG, emoji, or CSS-art substitute was introduced.
- Copy and content: copy explicitly states that only confirmed attendance is valid, weekly rest and holidays are excluded from the denominator, temporary weekend work must be enabled first, and retained historical records are not deleted.
- Accessibility and interaction: date cells are native buttons with descriptive `aria-label` values and visible focus treatment; the dialog has a semantic role/name; form fields have labels; destructive statistical exclusion requires a separate acknowledgement when records already exist.

## Primary interactions tested

- Opened the August 2026 month view and verified 31 date controls under Monday-through-Sunday headers.
- Switched to July 2026 historical month and returned to August.
- Set Sunday August 30 to temporary workday with name and remark.
- Set August 15 to holiday and verified the second acknowledgement for 6 retained confirmed records.
- Opened the attendance workbench for Sunday August 23 and verified the weekly-rest notice plus disabled generation/edit/confirmation actions.
- Verified report/API consistency: Sunday and holiday rows have zero required records and zero effective hours; August 25 counts 3 confirmed records and excludes 3 drafts.
- Browser console errors checked: 0.
- Browser page errors checked: 0.

## Full-view comparison evidence

The combined full-view artifact shows that the implementation preserves the existing report-center frame, navigation density, metric-card hierarchy, and color system while replacing the old date-card flow with the requested calendar structure. There is no overlap, clipped persistent control, horizontal overflow, broken icon, or unreadable status at the target viewport.

## Focused region comparison evidence

The focused artifact makes the date-area change legible: weekday headers align to seven columns, Sundays consistently occupy the final red-tinted column, holiday and temporary-workday states are visually distinct, confirmed days retain green progress treatment, and future/draft states remain identifiable. A separate modal capture verifies that default, holiday, and temporary-workday choices are all presented as real controls.

## Comparison history

- Pass 1: compared the normalized source and the final browser-rendered implementation. No P0/P1/P2 mismatch was identified. The structural calendar change is the explicit product requirement rather than design drift, so no visual correction iteration was required.
- Evidence-only recapture: an earlier temporary-workday screenshot caught the report loading state immediately after saving. The Playwright evidence wait was corrected and the state was recaptured after the calendar re-rendered; this was a capture-timing issue, not a product visual defect.

## Residual test gaps

- No separate mobile layout was required because the project target is the 1366 x 1024 horizontal tablet. Responsive CSS remains in place for narrower widths, but it was not used as the acceptance viewport for this request.

final result: passed

---

# Material Library Image-Fit Repair v1.34.58 — Design QA

Date: 2026-08-27
Release candidate: v1.34.58
Tablet acceptance viewport: 1366 × 1024
Reference-comparison viewport: 2048 × 1177

## Evidence

- User-reported source: `C:\Windows\TEMP\codex-clipboard-0d428b77-0802-459d-b92a-78f2cfb6b1c9.png` (2421 × 1391)
- Tablet implementation: `artifacts/material-library-v13458/qa/implementation-1366x1024.png`
- Same-aspect implementation: `artifacts/material-library-v13458/qa/implementation-2048x1177.png`
- Source and implementation in one comparison input: `artifacts/material-library-v13458/qa/reference-implementation-2048x1177.png`
- State: authenticated local QA administrator, material `MAT-000001`, three S3-backed photographs with landscape and persisted 90° rotation cases.

The supplied screenshot and browser-rendered implementation were inspected together in one combined comparison image. The source was normalized from 2421 × 1391 to the same 2048 × 1177 aspect and viewport used for the implementation capture; no content crop was applied.

## Confirmed root cause and repair

- The old viewer mixed CSS image fitting with a transform applied to the image itself. After persisted 90° rotation, layout dimensions, transformed dimensions and the scale calculation no longer described the same coordinate space. The result was the large blank upper area and the cropped photograph shown in the source.
- The viewer now decodes the browser's real `naturalWidth` and `naturalHeight`, measures the live stage through `ResizeObserver`, computes a rotation-aware contain scale, and applies transform to a centered canvas inside an independent positioner.
- New uploads store display-oriented width and height for EXIF orientations 5–8 while retaining the original bytes in S3-compatible object storage. Existing records remain compatible because the browser-decoded dimensions are authoritative in the viewer.

## Required fidelity surfaces

- Layout and spacing: passed. At 1366 × 1024 and 2048 × 1177, the active photograph is centered within the evidence stage, the filmstrip remains below it, and the context panel stays independently readable. No page-level horizontal overflow or overlapping persistent control was observed.
- Image quality and asset fidelity: passed. The original image URL is rendered without screenshot rasterization, artificial crop or stretched aspect ratio. Landscape, portrait-equivalent 90° rotation and a third image all fit within the stage with preserved proportions.
- Typography, colors and surfaces: passed. Existing Chinese system typography, navy navigation, orange active/action states, compact 2.5D controls, borders, radii and shadows are unchanged outside the bounded viewer repair.
- Icons and controls: passed. Previous/next, zoom, fit, 1:1, left/right rotation, full-screen and download actions remain aligned and expose their existing semantic names.
- Accessibility and resilience: passed. Disabled controls remain disabled until real image dimensions are known; loading and failure states are announced; touch pan/pinch, double-click fit and keyboard full-screen exit remain available. The target tablet viewport and the wider source viewport both have zero body overflow.

## Interaction and geometry checks

- Landscape fit: decoded 1448 × 1086 source rendered 547 × 410.25 inside a 584.67 × 691.67 stage.
- Persisted 90° fit: rendered 490.5 × 654 inside the same stage; left, right, top and bottom containment checks all returned true.
- 1:1 mode: rendered the rotated source at 1086 × 1448 and intentionally allowed stage clipping for pixel inspection; restoring `自适应` returned the complete 490.5 × 654 view.
- Rotation: 90° → 180° → 90° was exercised, with both fitted states contained; the original persisted rotation was restored after the check.
- CSS full-screen: stage expanded to 1294.67 × 866.67, the image remained fully contained, and exit restored the 584.67 × 691.67 stage.
- Multi-image navigation: filmstrip selection changed the counter from 1 / 3 to 2 / 3 and loaded the correct rotated record.
- Runtime: browser console errors 0. One Next.js LCP optimization warning was observed on an existing thumbnail and does not affect viewer geometry or interaction.

## Comparison history and severity review

- Pass 1: reproduced the reported visual state from the supplied screenshot and isolated the fit/rotation coordinate mismatch.
- Pass 2: compared the final implementation with the source in one combined input. The source's blank upper region and lower crop are absent; the repaired photograph is fully visible and centered while the surrounding material-library hierarchy remains consistent.
- P0: none
- P1: none
- P2: none

final result: passed

# Quality Management Three-Page Top-Spacing — Design QA

Date: 2026-08-26
Release candidate: v1.34.55 (same verified UI plus bounded mirror-release handling)
Target viewport: 1366 × 1024 horizontal tablet, device scale factor 1

## Source and implementation evidence

- Quality overview source: `C:\Windows\TEMP\codex-clipboard-01da8397-ea37-42e0-8b9d-28611c0ec3fe.png` (2557 × 1395)
- Quality overview implementation: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-layout-v13454\overview-2557x1395.png`
- Internal-risk source: `C:\Windows\TEMP\codex-clipboard-3b849470-1467-419d-9e3f-1e3c15e20c69.png` (2557 × 1462, including browser chrome)
- Internal-risk implementation: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-layout-v13454\internal-risks-2557x1462.png`
- 8D source: `C:\Windows\TEMP\codex-clipboard-8dbccb02-f332-4996-bb3b-912874283e90.png` (2548 × 1402)
- 8D implementation: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-layout-v13454\eight-d-2548x1402.png`
- Tablet captures: `overview-1366x1024.png`, `internal-risks-1366x1024.png`, and `eight-d-1366x1024.png` in the same artifact directory.
- State: authenticated local QA administrator against isolated PostgreSQL and S3-compatible MinIO fixtures. Fixture counts differ from the production screenshots and are not treated as visual drift.

All three source images and all three implementation captures were inspected together in one comparison input. Focused crop evidence was not required because the reported defect is the full-width top spacer and its boundary is directly visible in every full-view pair; DOM geometry measurements provide the focused verification.

## Root cause and intended visual change

- Confirmed root cause: all three screens hide the shared workbench header, but only `InternalQualityRiskShell` opted into the `hm-cockpit-root` layout contract that zeros the hidden-header reservation. `QualityManagementShell` and `EightDArchiveShell` therefore retained the shared 64 px top padding.
- Intended change: apply the same `hm-cockpit-root` contract to all three quality shells. No page-specific negative margin, duplicate CSS rule, or unrelated visual redesign was introduced.
- Measured result at 1366 × 1024: all three main roots start at y=0 with computed `padding-top: 0px`; command bars start at y=8, y=6, and y=8 respectively.

## Required fidelity surfaces

- Layout and spacing: passed. The command bar now begins directly below the browser viewport on all three routes, the quality-module tab bar follows consistently, and panel grids retain their existing widths, gaps, borders, radii, and scroll boundaries.
- Typography: passed. Existing Chinese system-font stack, heading scale, status numerals, muted descriptions, and compact workbench density are unchanged.
- Colors and tokens: passed. Navy navigation, orange active/action states, neutral panel surfaces, severity colors, and border tokens remain consistent with the supplied screens.
- Icons and assets: passed. Existing icon-library assets remain sharp; no placeholder or replacement asset was introduced.
- Copy and content: passed. Screen labels, search placeholders, status categories, recovery rules, and quality-management navigation copy remain intact.
- Responsive target: passed at 1366 × 1024. No horizontal page overflow, clipped command action, overlapping tab, or detached panel edge was observed.

## Interaction and accessibility checks

- Passed: links between quality overview, internal risks, and 8D archive resolve to the correct routes.
- Passed: internal-risk global search remains visible and product, source-issue, and work-order selectors open as semantic combobox/dialog/listbox controls.
- Passed: product search for `EHPS`, source-issue search for `ISS-000004`, and work-order search for `F260826004` each reduce the visible options to the matching row plus the explicit unrestricted option.
- Passed: 8D product and quality-issue list searches return the expected `EHPS-4-4L616A-610` and `ISS-000004` rows.
- Passed: all three routes expose the shared module navigation and hidden workbench header contract through the DOM.
- Passed: browser console errors/warnings during the three-page pass: 0.

## Comparison history and severity review

- Pass 1: reproduced the discrepancy in source evidence and traced it to inconsistent root-class adoption rather than deployment cache or three separate page bugs.
- Pass 2: compared all three final captures with all three sources. The highlighted top blank space is gone on overview and 8D, while the already-correct internal-risk page remains aligned. No unintended P0, P1, or P2 visual mismatch remains.
- P0: none
- P1: none
- P2: none

final result: passed

---

# Standalone Material Library Version 3 — Design QA

Date: 2026-08-26
Release candidate: v1.34.56
Desktop target: 1366 × 1024 horizontal tablet
Mobile capture target: 390 × 844

## Evidence

- Selected visual reference: `C:\Users\31175\.codex\generated_images\01a03791-4813-7aa3-ab3d-06de901ce204\exec-8a66f17e-48fd-46a6-8984-a60bb76eb6a2.png`
- Reference and implementation comparison: `artifacts/material-library-v13456/qa/reference-vs-implementation.png`
- Desktop live capture: `artifacts/material-library-v13456/qa/desktop-live-1366x1024-v2.png`
- Desktop archived item: `artifacts/material-library-v13456/qa/desktop-archived-1366x1024.png`
- Desktop library: `artifacts/material-library-v13456/qa/desktop-library-1366x1024.png`
- Permanent QR modal: `artifacts/material-library-v13456/qa/desktop-qr-modal-1366x1024.png`
- Mobile capture: `artifacts/material-library-v13456/qa/mobile-capture-390x844.png`

The selected version-3 reference and the final 1366 × 1024 implementation were combined into one comparison image and inspected together. The implementation retains the established navy navigation, orange actions, compact workbench density and light 2.5D elevation while adapting the concept to the existing authenticated application shell.

## Layout and visual fidelity

- Passed: the material library is a standalone navigation module and is not nested under quality management.
- Passed: the session command bar and capture progress occupy separate rows, preserving control clarity at the tablet target.
- Passed: the central evidence area uses a stable 2 × 2 photo grid with a dedicated preview surface instead of a compressed thumbnail strip.
- Passed: item list, category rail, photo preview and inspection form preserve explicit scroll boundaries without page-level horizontal overflow.
- Passed: the 390 × 844 capture page keeps camera actions, editable inspection fields and the archive action usable without horizontal clipping.
- Passed: the first comparison pass found an over-dominant preview and compressed progress header; both were corrected before the final pass.

## Interaction and accessibility

- Passed: quality users can create and edit material records, search by code, name, model, specification, supplier or batch, and filter by custom category or warning state.
- Passed: administrators can soft-delete material records, inspect the recycle state and restore archived records; object evidence remains retained according to the archive lifecycle.
- Passed: temporary QR codes enforce expiry and one completed use, while permanent QR codes remain reusable and open a new incoming-inspection session after the prior session is archived.
- Passed: the mobile route supports direct camera capture or gallery selection, uploads one image at a time to object storage, and synchronizes the live session to the desktop workbench.
- Passed: desktop staff can preview, rotate, enlarge, download, mark a cover photo, remove an active-session mistake and complete the remaining specification, material, supplier and warning details.
- Passed: warning state requires a traceable reason for defective material, and completion requires at least one retained photo.
- Passed: QR creation, copy, revoke and close controls expose semantic labels; mobile form fields and capture actions retain explicit labels and focusable native controls.

## Runtime and data checks

- Passed: three representative incoming-inspection photos were uploaded to the isolated S3-compatible MinIO bucket and previewed from object-backed content routes.
- Passed: PostgreSQL retained material metadata, categories, QR links, capture sessions and photo metadata; no uploaded photo is permanently stored on local application disk.
- Passed: all 101 Prisma migrations applied to a fresh PostgreSQL database.
- Passed: concurrent permanent-QR scans are serialized per material item; the observed PostgreSQL transaction-conflict boundary was reproduced and converted to a stable single-active-session contract.
- Passed: the permanent QR was reused after archive and created a distinct next inspection session.
- Passed: TypeScript, lint, 921 unit tests and the optimized production build completed with zero failures. The only lint output was three pre-existing image-optimization warnings outside this module.

## Severity review

- P0: none
- P1: none
- P2: none

final result: passed

---

# Internal Quality Risk Search UI — Design QA

Date: 2026-08-26
Release candidate: v1.34.53
Target viewport: 1366 × 1024 horizontal tablet
Reference comparison viewport: 2555 × 1401

## Evidence

- Reference: `C:\Windows\TEMP\codex-clipboard-c8d94a69-ab89-4cbe-84a6-65a54b35db27.png`
- Reference detail: `C:\Windows\TEMP\codex-clipboard-1582fb04-a504-4591-9f2f-ad26d1a49029.png`
- Implementation overview: `artifacts/quality-risk-search-v13453/implementation-1366x1024.png`
- Implementation at reference size: `artifacts/quality-risk-search-v13453/implementation-2555x1401.png`
- Search interaction: `artifacts/quality-risk-search-v13453/source-issue-search-1366x1024.png`

The 2555 × 1401 reference and implementation were inspected together in one comparison pass. The implementation intentionally differs by removing the highlighted top spacer, replacing the three native association selects with search-enabled controls, and displaying isolated QA fixture data.

## Layout and visual fidelity

- Passed: the hidden workbench header no longer reserves 64 px; the command bar starts at the top edge beside the navigation rail.
- Passed: command bar, quality module tabs, status rail, filter column, result queue and detail panel retain the existing orange workbench language.
- Passed: the left filter column remains compact and fully visible at 1366 × 1024.
- Passed: search triggers preserve the prior 34 px control height, borders, radius and neutral/orange selected states.
- Passed: the search popover stays above the workbench panels, uses a bounded scroll region, and does not clip inside the filter column.
- Passed: no cropped labels, unwanted horizontal page scroll, overlapping controls or broken panel edges were observed.

## Interaction and accessibility

- Passed: product search matches specification, product name, customer name and customer code.
- Passed: source issue search matches issue number, title, linked work order and status.
- Passed: work order search matches display code, internal code, business code, product, specification and customer.
- Passed: each selector retains an explicit “全部” option, shows the selected value, and participates in the existing global “清空” action.
- Passed: keyboard navigation supports Up/Down and Enter; Escape/outside focus closes through the shared portal layer.
- Passed: combobox, dialog, listbox, option, expanded and selected semantics are exposed in the DOM.
- Passed: selecting an exact source issue or work order refreshes the report queue to the matching report.

## Runtime checks

- Passed: implementation rendered against a clean PostgreSQL database with all 100 Prisma migrations.
- Passed: isolated S3-compatible MinIO bucket was available.
- Passed: browser console contained 0 errors and 0 warnings during open, search and selection flows.
- Passed: focused UI and release tests passed; production build completed.

## Severity review

- P0: none
- P1: none
- P2: none

final result: passed

---

# Material Library v1.34.57 Design QA

## Scope

- Selected reference: `C:\Users\31175\.codex\generated_images\01a03791-4813-7aa3-ab3d-06de901ce204\exec-23a187d8-c96f-4606-9d56-c13cb6139288.png`
- Implementation route: `/workspace/material-library`
- Tablet target: 1366 x 1024
- Mobile capture target: 390 x 844

## Visual comparison

- Same-viewport reference and implementation comparison: `artifacts/material-library-v13457/qa/reference-implementation-1366x1024.png`
- Final desktop evidence: `artifacts/material-library-v13457/qa/desktop-final-1366x1024.png`
- Permanent-QR mobile evidence: `artifacts/material-library-v13457/qa/mobile-permanent-390x844.png`
- The implementation preserves the established application navigation and orange theme while matching the selected v3 hierarchy: command bar, category and material rail, immersive evidence viewer, 2.5D floating controls, filmstrip, contextual facts, warning state, and fixed action area.
- Differences from the concept image are intentional: the real shell keeps the platform navigation, the evidence uses real QA records rather than decorative placeholders, and the number and aspect ratios of photographs reflect uploaded files.

## Interaction checks

- Search covers material code, name, manufacturer model, specification, supplier, supplier part number, and batch.
- Supplier variants are reusable and the primary variant can carry a current supplier specification document.
- Photo viewer supports previous/next, filmstrip selection, wheel/button zoom, 1:1, fit, left/right rotation, CSS full-screen overlay, Escape to exit, and original-file download.
- Temporary and permanent QR modes were exercised through the real signed-link route.
- Mobile flow was exercised at 390 x 844: login, scan entry, immediate multi-photo upload, batch input, quality state, warning reason, conclusion, and archive.
- A permanent QR starts each incoming-inspection session with an empty batch, normal current quality state, and empty conclusion while still displaying the material's historical warning.
- Supplier specification files and photographs use S3-compatible object storage; PostgreSQL stores metadata; soft-delete paths remain available.

## Findings resolved during QA

1. Native browser full-screen permission was rejected in the embedded browser. Replaced it with an application-controlled full-screen overlay and keyboard exit.
2. A reusable permanent QR initially copied the prior batch warning and conclusion into a new session. The scan transaction now carries only stable master and supplier-variant facts; batch facts are reset for every inspection.
3. The mobile permanent-QR page now separates historical risk from the current inspection state so inspectors are warned without pre-judging the new lot.

## Result

final result: passed
