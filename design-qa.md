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
