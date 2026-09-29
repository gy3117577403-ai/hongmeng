# Production and sample bulk import — v1.34.259

Final result: passed

Scope: approved drawing-library association, distinct order handling, removal of fixture decisions from import, and internal-scroll review dialogs. Production data and Sealos deployment are outside this acceptance environment. Previous review-module QA is preserved in Git history and output/import-v134258/previous-design-qa-v134257.md.

## Source visual truth

Directory: C:/Users/31175/.codex/generated_images/01a0b0a4-7f03-7f10-8cb8-39e12c3eb52f/

- Mass import: exec-2780107c-e32b-4bd3-b3ec-7b38f283fa4d.png
- Drawing archive picker (corrected selection target): exec-b3d8d93a-9b1a-4248-9efe-972a93bd9949.png
- Sample import: exec-60f892ba-0e7b-49e6-9883-8e416cfb909f.png

Sources are 1536 × 1024 pixels. Source pixel density is unspecified. Final implementation comparisons use 1536 × 1024 CSS pixels, device scale 1. Additional landscape-tablet acceptance uses 1366 × 1024 and 1366 × 768 CSS pixels. Application navigation, test customer names, number of records and isolated QA drawings intentionally differ from generated examples; this is not a pixel-identical data comparison.

## Iteration history

1. Candidate 36589208961: import was clicked before initial plan metadata was ready. The production entry now remains disabled until a target week and the initial data are loaded. The browser waits for the visible ready status before using the entry.
2. Candidate 36590639943, commit 51330105: actual source PDF rendered, but the nested picker used z-index 1500 below the parent modal at 2001. SOP switching was intercepted by the parent search input. This is a P0 interaction failure. Fixed with the shared modal token plus 50, below the orientation confirmation layer. Browser verification must click SOP, change its file, close the picker and retain all import rows.
3. The first mass screenshot was compared together with the approved source. At 1366 × 1024 the extra file/target row and five-line archive cells limited visible table content. This P2 density issue is fixed by a single source/target strip and a three-line archive cell with counts and actions on the same row. Metadata was enlarged and an orange header icon added. Post-fix same-viewport comparison passed.
4. Sample detail styles overrode the import title with 13px metadata styling. An import-specific selector and matching document icon restore the 23px heading. The revised sample screenshot was recaptured and compared with the approved source; P2 resolved.
5. Candidate API assertions initially omitted the Secure session cookie on loopback HTTP; the browser imports succeeded. The test now forwards the issued cookie explicitly and waits for the result table to finish loading. No application authentication was weakened. Candidate 36596539002 passed all import and existing regression steps.
6. Formal run 36597585079 reached import browser acceptance after earlier shared-fixture regressions. It correctly displayed “关联差异 4”, but the browser script incorrectly waited for “数据已对齐” as a loading signal. The screenshot confirms the plan table and import menu were already loaded. The test now waits for the import action's existing enabled state through Playwright actionability. Reconciliation is not a prerequisite for importing. Application behavior is unchanged. A new immutable release tag v1.34.259 records this test correction.

## Required fidelity surfaces

Typography, layout rhythm, semantic colors, real drawing-preview sharpness and app copy will be assessed from the revised screenshots. Source design-preview labels are deliberately excluded from production. Only current drawing/SOP files stored in the isolated S3 service are shown. No order identifier is substituted for a drawing-library archive.

## Final visual and interaction acceptance

Application commit: 64ddb6536ede1121eba6aa0e1c7205325d963464.
Candidate run: https://github.com/gy3117577403-ai/hongmeng/actions/runs/36596539002 (success).
Evidence: output/import-v134258/candidate-64ddb653/.

The three source images and their matching implementation views were opened together for comparison at 1536 × 1024: mass review (04-mass-reference-size.png), sample review (05-sample-reference-size.png), and archive selection with search results (02c-drawing-selection-reference-size.png). These are actual browser captures, not generated implementation previews.

| Surface | Result |
| --- | --- |
| Layout and density | Fixed title, compact target/file strip, internal table scroll and persistent footer. Extra metadata does not displace the primary actions. |
| Typography | Dark product identity and 23px import titles; secondary customer/time metadata has a distinct lighter hierarchy. Sample heading override corrected. |
| Color and state | Orange primary actions and selection; green ready state; orange missing resources; blue pending selection. States also use text and icons. |
| Document selection | Left archive candidates and right actual S3 PDF/SOP viewer; exact customer/spec can be linked; similar revisions can only be viewed. Current counts include multiple SOP files. |
| Layering and return | Picker is above the parent import; SOP/file switching works. Return and Escape preserve import rows and close only the top dialog. |
| Tablet | 1366 × 1024 and 1366 × 768 checks keep actions visible and avoid page-wide horizontal overflow. The table contains overflow. |
| Import completion | Mass 16-row commit, new archive lookup, sample two-type commit and result navigation passed. Existing 24-row sample flow, pagination, detail return and CSV export also passed. |
| Data and access | Existing files, current versions and fixture choice preserved; new fixture choice remains unknown; old same-spec order not silently continued. Read-only import rejection and technical archive read verified. |

Intentional production differences: existing application navigation is retained; source mockup labels and fictitious approval stamps are omitted. Test customers, row counts and the portrait verification PDF differ from the illustrative mockup. The customer is fixed to the imported row to prevent cross-customer association. New archives are created by a confirmed import, not by a separate unreviewed action in the picker.

No open P0/P1/P2 visual or interaction issues remain in the validated scope. Optional P3: richer total-hours selection summaries can be considered later; current row calculations and result totals are functional.

This report approves the design and candidate runtime. Published-image and Hangzhou mirror verification remain separate release gates and must pass before image handoff. Sealos production is not changed by this QA run.
