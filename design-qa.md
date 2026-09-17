# Finished goods v1.34.188 design QA

Final result: passed.

## Reference and scope

Selected reference: `C:/Users/31175/.codex/generated_images/01a09c04-b600-7040-a09d-8b14cee44d09/exec-d6e14a1d-1fb0-4a1e-90e4-1ed4400d5404.png` (1586 × 992).

The existing authenticated finished-goods application was updated in place. The orange theme, application navigation, compact rows and existing icon assets are retained. No new visual assets or substitute static application were introduced.

## Visual verification

The reference and the actual application were inspected at the same 1586 × 992 viewport. Actual screenshot: `output/finished-goods-v188/04-main-reference-size.png`.

At the product target of 1366 × 1024, the table width and its containing region both measure 1266 px. Twenty-four rows are visible; there is no table horizontal overflow. The specification column measures 295 px and a long specification wraps to two lines without clipping. Evidence: `output/finished-goods-v188/01-main-1366.png`.

Five reviewed surfaces: compact receipt/shipment list; partial-stock and held-stock quantity cells; shipment confirmation dialog; continuous-processing panel; source-lot detail with inventory breakdown and receipt/shipment timestamps. Dialog and panel screenshots: `02-ship-dialog.png`, `03-continuous.png` in the same output directory.

Table header, numeric alignment, full specification text, units, orange primary actions, blue inventory quantities and compact timestamps match the approved hierarchy. Tracking-number fields and missing-tracking workflow are absent from the daily UI, export and simplified printout. Wider screens intentionally give remaining width to specifications. Real fixture values, sort order after transactions and the existing account-dependent navigation differ from the illustrative reference; these differences do not change the approved warehouse interaction.

## Interaction and data verification

- Received 8 of 20: pending 12, in stock 8, shipped 0.
- Dispatched 3: pending 12, in stock 5, cumulative shipped 3, actual shipment time recorded.
- Held 10 from stock 55: physical stock stayed 55 while available stock fell from 55 to 45; releasing restored available 55.
- Batch received 10 and 8 into two source lots; each quantity updated independently.
- Received and immediately shipped 2: pending fell by 2, physical stock remained 0, cumulative shipped became 2.
- Enter saved the quantity draft without dispatching. Continuous processing opened an explicit confirmation before mutation.
- Main workbench deduplicates source lots; dispatch history retains each real dispatch. Lifetime shipped quantities do not change with the selected day.
- Existing logistics values remain in historical data; routine edits do not erase them.
- Browser console errors: none.

## Checks

Local PostgreSQL integration: 23 passed. Unit suite: 1212 passed, 199 database-dependent tests skipped in that unit-only invocation, zero failures. Dedicated authenticated HTTP acceptance: 72 passed. Production build and final TypeScript check passed. Exact published-image and independent clean-runtime checks are performed by the release workflow before final image handoff.
