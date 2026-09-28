# Sample unified workbench v1.34.222 — 2026-09-22

Final result: passed for requested UI and browser interactions. Production data counts and Sealos deployment are outside this UI acceptance.

## Source, implementation, and intentional changes

- Source: output/sample-plan-ui-next/01-user-sample-plan.png (2557 x 1368). This is the user-marked starting screen, not a target to reproduce unchanged. Approved direction: one plan page, overlay trial workbench, no owner controls, completed history visible, deferred duplicate-parameter handling.
- Implementation: actual React application components bundled in a local fixture harness at http://127.0.0.1:3396. API responses in this browser harness are synthetic and are not database verification or production counts. Real HTTP/PostgreSQL/S3 acceptance passed separately in run 35720273401; final commit reruns the same acceptance.
- Target tablet: 1366 x 1024 CSS pixels, device ratio approximately 1. Screenshots 01-plan-1366.png, 02-trial-modal-1366.png, 03-completed-history-1366.png, 04-parameter-comparison-1366.png, 05-capture-form-1366.png, 06-drawing-modal-1366.png under output/sample-unified-v134221.
- Combined comparison: source-normalized.png and 08-plan-reference-aspect.png were opened together, followed by detail-source-toolbar-table.png and detail-toolbar-table.png. Source was downsampled to 1366 x 731 for composition comparison; its original CSS density is unknown, so no pixel-exact font claim is made. Runtime used 1366 x 731 for this comparison and 1366 x 1024 for tablet acceptance. Screenshot transport is JPEG despite local .png suffixes.
- Wide layout DOM checked at 2557 x 1368: body scrollWidth equals viewport width. Wide screenshot transport produced a stale-scale/cropped image and is excluded from visual acceptance; the normalized comparison was recaptured after reload.

## Findings resolved and post-fix evidence

- P1: global app header covered the parameter comparison dialog. Raised the direct body overlay above app chrome, retained photo overlay ordering, and recaptured 04-parameter-comparison-1366.png. Header, close control, comparison and confirmation remain visible.
- P2: embedded capture retained the phone-only 430 px layout. Scoped desktop override expands it to 1120 px inside the trial modal, uses static form header and sticky form footer. Measured width 1120, body width 1366; screenshot 05 confirms three measurement inputs on one row.
- P2: underlying trial modal could receive Escape while a photo viewer was open. Hide the base modal while its higher-order photo viewer is active, matching existing edit/QR/return handling.
- P2: a REPEAT fixture carrying stale pending-submission counts could open an unavailable review tab. Main row action now branches on task type before pending count. Post-fix old-product dialog shows only overview, drawing review, completion/warehouse; no capture or package review.
- P2: final item on a paged conflict queue could leave an empty page after resolution. API clamps page after count and UI applies the returned page.

Final route compatibility check also preserves the former production/business audience for the samples branch only. Bulk planning remains restricted as before; regression assertions cover both boundaries.

No remaining actionable P0/P1/P2 visual findings in tested states.

## Required fidelity surfaces

- Typography: existing Chinese application stack retained; distinct product title, operational labels, and quieter metadata. Long connector and product names remain readable through appropriate wrapping/title hints. Owner column and member-based search copy removed. Snapshot transport softness is not treated as font-rendering evidence.
- Layout: compact title, primary task-status tabs, week strip, filters, then a continuous data table. Tablet shows eight full rows; footer remains in view. Trial dialog approximately 94vw x 92vh, inner content scrolls; header/tabs/actions remain separate. Intentional deviation from old page: no separate execution window, expanded record work area.
- Colors/tokens: orange primary action and selected state, pale cool surface, restrained warm gradient and shallow shadow for 2.5D depth. Blue in-progress, green approved, amber attention, red returned retained. Glass applied to overlay/backdrop, not document text.
- Assets/image quality: original application mark and Lucide icons reused. No generated UI raster substituted for components. Document viewer uses a synthetic labelled PDF for QA only; it fits the available canvas.
- Copy/content: completed tab explicitly means all historical records of the current sample type, including no-week and archived samples. Candidate comparison says current and sample values, replacement scope, and no second warehouse transfer. Historical comparison retains original baseline instead of relabelling the new current value as the old one.

## Browser evidence

- Completed tab shows 8 seeded historical completed NEW samples, including no-week and archived rows. Week/search/date constraints clear for direct history access. This does not assert the production count.
- Trial opens as a dialog without leaving the plan route. Close/reopen at the last row preserves scrollTop 324 and one selected checkbox.
- New plan/edit flow has no owner selector. REPEAT dialog has no capture/photo/SOP requirement.
- Actual embedded capture component supports sections, multi-row stripping parameters and retained local draft. Switching tab or closing with unsaved data displays a leave/retain-draft decision; leave then opens the requested drawing tab.
- Drawing preview fits the modal; version, fixture choice, review controls and close control do not overlap.
- Candidate deletion moves one seeded item out of pending. Replacement similarly updates the queue; processed-history comparison is read-only. Real transaction/idempotency behavior is covered by PostgreSQL and HTTP tests, not inferred from the fixture UI.
- Browser console: no captured warnings/errors during the final tablet interaction checks.

## Implementation checklist

- [x] Preserve completed/no-week/archived records in history query.
- [x] Remove owner-facing UI while preserving stored audit/source data.
- [x] Use a single desktop trial modal with draft protection and context retention.
- [x] Complete samples independently of deferred parameter differences; preserve evidence/history.
- [x] Verify tablet composition, focus/close, old-product branch, and real HTTP/storage workflow separately.

---

## Prior QA history retained below

# Sample planning and manual warehouse kitting - v1.34.220

Final result: passed for the changed pages and interactions. No remaining actionable P0/P1/P2 findings.

## Scope and evidence boundaries

The accepted source visuals are the two generated UI references in C:/Users/31175/.codex/generated_images/01a0b0a4-7f03-7f10-8cb8-39e12c3eb52f/ (exec-8c62c6ab-062d-4047-aa7c-2b5c21428d31.png and exec-39150c62-8e42-4ab9-a62b-9f59ba64a2f4.png). They express layout, not live business totals.

The browser loaded the actual React components and application styles using an isolated local fixture harness. All example models, counts, drawings and actions in screenshots are synthetic QA data; no production business data was changed. Separate real HTTP, PostgreSQL, Prisma migration and S3 tests passed in preflight run 35700228903 at eabbf27. The final release pipeline additionally tests the immutable image.

Artifacts: output/sample-planning-warehouse-v134220/ui/.

## Visual comparison

Full-page reference and implementation were opened together at 1672 x 941. Tablet acceptance used 1366 x 1024. Body measurements were exactly viewport size with no outer horizontal or vertical overflow. The planning table begins at y=257 at tablet size and shows eight complete rows; the table owns scrolling and keeps its header and selection footer visible.

Preserved composition: compact title and NEW/REPEAT switch, week navigation, filters, inline counts/status filters, full-width plan table. Warehouse is a separate queue/detail page; it shows only manually reported shortages, with no inferred BOM or full-material requirements list.

Intentional differences from generated previews:
- Existing application Chinese fonts, Lucide icons, permission-aware navigation, approved status vocabulary and import/export actions are retained.
- The warehouse queue uses 260 px at tablet size / 290 px desktop to give shortage details more room.
- The glass shortage form is a centered, focus-trapped modal rather than a fixed side card. This supports multiple shortage lines with internal scrolling while keeping the 1366 px viewport usable.
- The table separates internal planned-completion and customer due dates into distinct columns; there is no implied quantity-based material demand calculation.

Visual issues resolved during review: title switch drifting away from title, redundant status strip consuming table height, clipped native date field, required-field asterisks wrapping onto separate lines, misleading empty-shortage text after all shortages were resolved. The final form keeps labels and required marks together. Glass dialogs overlay the page without changing the main layout.

## Interaction acceptance

- NEW and REPEAT planning tables render separate data; REPEAT has no capture/photo/package-review requirements.
- A REPEAT row opens the wide drawing dialog. The drawing defaults to fit, the PDF preview has the main area, and supervisor/quality review actions remain visible. Closing with Escape restores the table.
- Selecting plans exposes batch scheduling. An empty adjustment reason disables submission. The next-week shortcut changed 10 sample fixtures from current week to next week; current-week count became 0 and next-week count 12. Internal completion date 09-24 and customer due date 09-25 were preserved.
- Warehouse links open the independent sample-kitting page focused on the selected sample.
- A multi-line shortage report accepted PURCHASED and CUSTOMER sources, including a blank optional quantity. The new records appeared in the shortage table; completing kitting stayed disabled while any shortage remained open.
- Warehouse arrival confirmation resolves one shortage at a time. Resolving the last row returns to pending; an explicit Confirm complete action marks kitting completed and records actor/time.
- Operation history displays creation, individual arrivals and final kitting confirmation.
- Floating notifications do not move content. Modals support Escape, focus containment and disabled duplicate-submit controls.
- Browser console showed no errors during the exercised flows.

## Validation

- TypeScript: passed.
- Lint: passed with pre-existing warnings.
- Full local unit suite: 1442 tests, 1229 passed, 213 database-gated skipped, 0 failed.
- Core preflight: passed PostgreSQL integration, actual HTTP/object-storage flows and build.
- Final release image and anonymous Hangzhou pull acceptance are recorded separately in the release delivery report.

---

# Planning Center compact scroll acceptance

- source visual truth: C:/Users/31175/.codex/generated_images/01a09c04-b600-7040-a09d-8b14cee44d09/exec-f9ac2963-b235-4c97-b474-73ea56f192ba.png
- implementation: output/planning-v189/planning-source-size.png
- target tablet capture: output/planning-v189/planning-1366.png
- detail capture: output/planning-v189/hours-drawer.png
- source and comparison capture: 1448 x 1086 pixels; implementation viewport 1448 x 1086 CSS px, device scale approximately 1. Target viewport also tested at 1366 x 1024, captured at matching pixels. No device chrome in either comparison.
- state: authenticated isolated PostgreSQL test environment with 96 current batches, 55 next-week batches, 12 historical unfinished drafts; fixture totals are not production totals.

## Findings and comparison history

P1 resolved: the inherited production-control stylesheet fixed the notes column at right 140 px, overlapping flow status after the action column was narrowed. Added a more specific compact-table override (notes right 78 px and actions width 78 px). Post-fix DOM measurement confirms right 78 px; final full capture shows separate flow, notes and operation columns.

P2 resolved: first-load failure needed to remain distinct from an empty plan after removing the former summary. Summary now shows loading or unavailable as appropriate; existing resilience regression passes. The old WIP banner assertion now points to the independent WIP drawer, preserving the branch contract.

No remaining actionable P0/P1/P2 findings.

## Full-view and focused comparison

The selected structure is preserved: compact title/navigation, week navigation and context actions, search/tools, inline workload strip, then a continuous table and a slim count/selection footer. At 1366 x 1024 the table starts at y=208.67 and 12 complete 60 px rows fit before the footer. There are no page numbers or page-size controls. At the exact source size, 13 complete rows fit; this extra density is intentional.

Focused review covered the toolbar labels, workload strip, full specification text, independent SOP availability/lifecycle chips, and the three rightmost columns. Native existing brand and Lucide icons were retained. Source screenshot uses example data; implementation uses isolated fixture records and existing live status semantics.

- Fonts / typography: existing application Chinese font stack retained; 21 px title, 13 px wrapping specification, 12 px operational fields and 10–11 px supporting metadata. Full specification wraps; quantity and date remain readable. More compact type than the generated reference is intentional for the tablet data density.
- Spacing / layout: 6 px section gaps, 48 / 48 / 44 / 42 px top rows, fixed table header, 60 px rows, 32 px footer. Detail panels overlay from the right and do not change table height.
- Colors / tokens: original orange action palette, pale blue table/header, green ready, amber attention, purple WIP retained. Selection and hover are visibly distinct.
- Image quality: reused existing logo and icon assets; no new placeholder or reconstructed raster assets. Browser screenshots are the rendered app, not generated UI previews.
- Copy / content: original plan and current process standard remain separately labelled; unknown standard keeps partial-known notice and suppresses total numeric difference. Hidden verbose information remains available in details. Actual context and counts follow selected filters.

## Functional evidence

- 96 DOM batch rows available in one scroll region. Wheel scroll reaches row 96; final row bottom and footer boundary both y=928 with the selection bar present. Header remains y=208.67.
- Open/close the final batch drawer: scrollTop stays 5074.6665; prior checkbox selection remains.
- Nested production-control note edited and saved in the isolated DB; updated note appeared in the row and drawer.
- Product-time navigation and Return to original planning position: selection restored (1 batch), scrollTop restored exactly 2373.3333.
- Customer filter: 16 rows and matching 16-batch workload subset; switching weeks shows 55 next-week rows and restores current week.
- Workload drawer shows missing-standard count and calculation details; reconciliation drawer shows 96 / 96 / 96; historical drawer lists all 12 historical drafts.
- Export menu opens the existing full export preview; UI request returned 200. Independent download was parsed with ExcelJS and contains both the first and last source orders; artifact output/planning-v189/weekly-plan.xlsx. The browser download-event listener did not report an event, so acceptance relies on the successful response and parsed file.
- Browser console: no error messages captured after interactions.
- Type check passed; lint has only existing unrelated warnings. Unit suite: 1212 pass, 199 database-gated skip, 0 fail. Planning PostgreSQL integration: 6 pass, 0 skip.

## Implementation checklist

- [x] Replace stacked banners with four compact rows.
- [x] Keep entire selected-week table continuously scrollable.
- [x] Preserve detail, print, production controls, import/export, readiness and navigation.
- [x] Verify scroll, focus return, selection restore, filtering, and real data export.
- [x] Compare full view and focused regions against selected reference.

final result: passed


# Terminal tooling v1.34.250 — implementation QA

Source: the user's four-position editor screenshot and the approved terminal-tooling previews. Implemented in the existing application and existing permissions, with no separate product scaffold.

## Visual and interaction acceptance

- Desktop: 1366 × 1024; document dimensions exactly 1366 × 1024. Records and detail scroll internally. Sticky action controls remain visible.
- Mobile: 390 × 844; separate mobile route with no desktop sidebar. Home, timer, blade lookup, records and account navigation tested.
- Start dialog: selecting terminal 10023 loads its published combination and box 007. Replacing upper-inner blade with another model selects box 008 independently.
- Timing: start on desktop, pause, open mobile, resume and finish all persisted. Work and pause durations remain separate. A discovered final-second display discrepancy was fixed by using the closed server timestamp.
- Finish dialog: each blade can return home, return to another box, remain on equipment or enter maintenance. The upper-inner blade retained on equipment stays in use after job completion.
- Inventory: registered two sets in box 017, yielding eight physical components. Unknown stock is displayed as pending count. Mobile rows were changed to cards so box numbers appear directly.
- Blade editor: four independent positions remain visible above desktop footer. Changing dimension A updates only that position's specification; custom specification is explicitly selectable. Original leading zeros retained.
- Navigation: mobile detail back returns to the prior work screen. Closing dialogs restores the underlying page.
- Export: downloaded an actual weekly CSV and checked its two work records and exact formatted durations.
- Browser console: no uncaught errors observed.

## Data and access acceptance

- PostgreSQL integration covers replayed commands, last-kit concurrency, active-task uniqueness, blade replacement, device retention, return location, historical snapshots, cross-day correction, precise shared-hours reconciliation, assembly/disassembly/movement/retirement and invalid box rejection.
- Local HTTP acceptance: 34 checks, including actual persisted image-contract workflows.
- Anonymous endpoints return 401. Technology READ can view the mobile page/catalog; both mutation endpoints return 403. COLLABORATE reaches business validation and can operate.
- Full local unit suite: 1,306 passed, 222 database/runtime-gated cases skipped, zero failures. Database cases for the changed module run separately.
- Reference screenshots and HTTP evidence are under output/terminal-worklog-v134250. All depicted records are disposable QA fixtures.

## Verification boundary

Real iOS and Android WeChat hardware is unavailable in this environment. Mobile layout and workflows were verified in Chromium at phone size; no physical-WeChat certification is claimed. Published image acceptance is recorded separately by the release workflow, including clean PostgreSQL/MinIO startup and anonymous Hangzhou image pull.

### v1.34.251 散刀入口复核
- 单独上内刀型号自动使用散刀与实际可用刀位，不允许误登记整套。浏览器完成 2 把上内刀登记到 023 号盒并核对实物记录。
- 在端子资料新增型号后直接切换刀片库存，自动刷新可见，无需另点刷新。
- 截图：output/terminal-worklog-v134250/desktop-loose-inventory-v251.png。
- v1.34.250 在镜像发布前主动停止，修正用独立 v1.34.251 标签交付。
