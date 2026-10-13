# Sample planning documents and deletion — v1.34.267

Final result: passed

Scope: local disposable sample-planning runtime. Earlier bulk-import QA remains in Git history and output/sample-documents-v134267/previous-design-qa-v134259.md. This is not Sealos deployment acceptance.

## Visual truth and comparison

Source directory: C:/Users/31175/.codex/visualizations/2026/09/17/01a0b0a4-7f03-7f10-8cb8-39e12c3eb52f/
Sources: sample-plan-drawing-refresh.html, sample-plan-list.jpg, sample-plan-replace.jpg, sample-plan-delete.jpg.
Implementation: output/sample-documents-v134267/actual-list.png, actual-replace.png, actual-delete.png, actual-history.png.

Browser viewport and implementation PNGs: 1366 x 1024 CSS/pixels, scale 1. Source replacement/list: 1366 x 1024 pixels. Source deletion: 1068 x 871 including presentation padding. Modal contents were compared, not the differently padded outer presentation frames. Test fixtures intentionally differ from illustrative mock data.

The list source/actual pair and both modal pairs were opened together. Final updated deletion and replacement captures were inspected again. Focused modal text is readable at the original capture size, so no additional crop was needed. Real weekly filters and whole-filter totals are retained beyond the simplified source design.

## Findings and comparison history

1. P1: deleting a focused order retained the task focus and showed a deleted-task error. Matching focus, detail and URL state are now cleared and the row removed immediately. A second browser delete returned a valid empty list and zero quantity/hours. Restore returned the same order, 5 units, 1 planned hour and V1.1.
2. P2: initial deletion modal omitted the source's quantity summary and quick reasons. Added real plan quantity, completed quantity and planned hours plus three reason shortcuts. Final actual-delete.png has all actions and footer visible.
3. P3: a small PDF rounded to 0.00 MB. B/KB/MB formatting now shows 1.1 KB in the final replacement capture.
4. History icon now opens drawing files and replacement records directly.

No actionable P0/P1/P2 visual findings remain in the validated scope.

## Required fidelity surfaces

| Surface | Review |
| --- | --- |
| Fonts and typography | Existing system Chinese stack, dark 23px headings and 19px specifications, compact 11–14px control/metadata hierarchy. Long filenames wrap within cards. |
| Spacing/layout | Fixed headers and footers; 810px two-panel replacement, 580px deletion, bounded internal body scrolling. Plan table contains overflow. |
| Colors/tokens | Orange primary actions, pale warm file selection, neutral translucent dialogs, blurred backdrop, separate red destructive action. States also use text/icons. |
| Image quality | Actual isolated-S3 PDFs render in the existing viewer. Standard Lucide icons retained; no generated substitute drawing imagery. |
| Copy/content | Uploaded/missing and actual count/version replace drawing approval. Per-order scope, retained records, recoverable trash and reason are explicit. No design-preview labels enter product UI. |

Intentional adaptations: retain real navigation and week/date filters; support SOP; retain existing access boundaries; label calculated hours as planned hours rather than actual reported labor; require deletion reason and a stop/switch acknowledgement during production.

## Interaction and runtime evidence

Actual browser: create test order; upload PDF; replace; verify V1.1; open history and old V1.0; delete; verify quantity/hour refresh; restore; verify identical order and documents; select reason shortcut and inspect final deletion metrics.

Database tests cover isolation, replay, stale versions, completion/stock preservation, warehouse reopening and reference retention. HTTP/S3 smoke covers real content bytes, invalid files, cross-order file denial and deletion/restore.

Runtime request review found success on final upload/replace/restore paths. Earlier deleted-focus 404 was fixed and retested. A late attempt to dismiss the native unsaved-file confirmation stalled the IAB automation channel; final console retrieval and automatic dismissal were not completed. This is a browser-automation coverage gap and is not claimed as a passed unsaved-navigation test.

## Checklist

- [x] Sample drawing approval removed from list, operations and print.
- [x] Sample collected-data and production drawing review preserved.
- [x] Per-order replacement, actual file history, deletion and restore.
- [x] 1366 x 1024 actual rendered evidence.
- [x] Type, local production build, related database and HTTP regressions.
- [ ] Published-image CI/mirror acceptance is a separate release gate.
