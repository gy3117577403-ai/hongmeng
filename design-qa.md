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
