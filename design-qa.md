# 重大异常协同中心 Design QA

## Comparison target

- Source visual truth: `C:\Windows\TEMP\codex-clipboard-d4b8d962-b8ee-4f6e-a51b-7b7c35f5931a.png`
- Secondary A4 source visual: `C:\Windows\TEMP\codex-clipboard-c2113d3b-1ec8-48c7-bf76-608933bcc663.png`
- Rendered implementation: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-anomaly-v13459\collaboration-processing-1366x1024.png`
- Post-fix drawing-library warning state: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-anomaly-v13459\drawing-warning-1366x1024-v2.png`
- Planning warning state: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-anomaly-v13459\planning-warning-1366x1024.png`
- Production warning state: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-anomaly-v13459\production-warning-1366x1024.png`
- Print packet state: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-anomaly-v13459\print-warning-1366x1024.png`
- Full-view comparison: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-anomaly-v13459\source-implementation-comparison.png`
- Focused comparison: `C:\Users\31175\Desktop\鸿蒙软件\artifacts\quality-anomaly-v13459\source-implementation-detail-comparison.png`

## Normalization and state

- Intended CSS viewport: 1366 × 1024, device scale factor 1.
- Source pixels: 1672 × 941 at 72 dpi. The source is a 16:9 concept, while the product contract is a 4:3 horizontal tablet. It was proportionally contained on a 1366 × 1024 white canvas; no stretching was used.
- Implementation pixels: 1366 × 1024 at 72 dpi, captured from the authenticated local application.
- Compared state: an active high-risk exception in department collaboration, with the item selected and the workflow, coverage, warning policy, and archive progression visible.
- The implementation deliberately retains the existing product shell, left navigation, orange token system, and quality-module information architecture rather than replacing the whole platform with the concept image's independent navigation.

## Full-view comparison evidence

The combined image confirms the same principal hierarchy: command bar and primary action, status summary, filter rail, prioritized exception list, selected exception workspace, workflow progression, product/work-order coverage, warning policy, and supporting metadata. The implementation is denser vertically because it targets 1366 × 1024 and preserves the existing platform shell, but the task hierarchy remains visible without horizontal overflow or hidden persistent controls.

## Focused region comparison evidence

The focused image compares the exception list and selected-detail work area. The implementation keeps the source's selected-card emphasis, orange workflow rail, structured summary cards, and clear next action. It replaces illustrative dashboard imagery with real application data and Lucide icons; there are no placeholder pictures, CSS-drawn icons, or fake visible assets. A focused comparison was required because list typography and process-stage labels are too small to judge reliably in the full-view image.

## Required fidelity surfaces

- Fonts and typography: Microsoft YaHei/system fallbacks are consistent with the existing Chinese product. Heading, label, status, and data weights remain distinct; long exception text wraps in detail areas and truncates only in list summaries.
- Spacing and layout rhythm: three-pane tablet layout remains stable at 1366 × 1024. The selected workspace uses 8–12 px internal rhythm, compact radii, and shallow 2.5D elevation consistent with adjacent modules.
- Colors and tokens: orange is reserved for current state and action; red, amber, green, and blue retain semantic meaning. Surface contrast is sufficient and disabled states remain distinguishable.
- Image quality and assets: the primary collaboration screen does not require decorative or product imagery. Evidence images, when present, use real S3-backed files. Standard icons come from the existing Lucide icon family.
- Copy and content: labels describe the actual workflow—quality initiation, containment, department collaboration, verification, archive publication, warning synchronization, acknowledgement, revocation, recycle, restore, and purge conditions.
- Interaction and accessibility: tabs, filters, workflow actions, task operations, warning acknowledgement, print mode, recycle/revoke confirmations, and primary links use semantic controls and visible selected/disabled states. Core states were exercised with real QA data.

## Comparison history

### Iteration 1 — blocked

- [P1] Drawing-library warning detail was compressed into a narrow third column because the normal file-category panel remained visible in warning mode. This caused control text to wrap excessively and weakened the warning hierarchy.
- Fix: added an explicit `quality-warning-mode` workspace state, removed the unrelated file panel in that state, expanded the warning workspace to two columns, and switched warning controls to two columns at the 1366 px target.
- Post-fix evidence: `drawing-warning-1366x1024-v2.png`. Warning summary, mandatory actions, inspection method, frequency, acceptance criteria, stop conditions, applicable process, and escalation contact are all readable without collision.

### Iteration 2 — passed

- No actionable P0, P1, or P2 visual findings remain at the target viewport.
- The source concept's separate KPI-card row is treated as an intentional structural difference: the implemented command bar provides the same live counts while preserving the established platform shell and more vertical workspace for a 4:3 tablet.
- The in-app browser's native PDF plug-in did not paint blob-PDF pages into the automated screenshot. This is an environment capture limitation, not a packet-generation failure: the authenticated packet request returned HTTP 200, reported two pages, and the rendered source contains both the traveler page and the fixed A4 warning page. Physical/browser print rendering remains covered by the generated PDF and automated packet tests.

## Primary interactions tested

- Searchable product, source-problem, and work-order filters.
- Select active and archived exception records.
- Task collaboration and workflow transition controls.
- Archived warning projection into the drawing library.
- Plan-order warning badge with required-print marker.
- Production-execution warning detail and independent acknowledgement.
- Print-readiness validation and generation of a traveler plus fixed A4 warning packet.
- Browser console inspected: no application error entries were present during the tested flow.

## Follow-up polish

- [P3] A future dashboard iteration could optionally add the concept image's larger KPI cards when there is enough historical data to make trends meaningful. This is not required for the current operational workflow.

## Implementation checklist

- [x] Preserve existing shell and orange theme.
- [x] Keep core collaboration workflow usable at 1366 × 1024.
- [x] Resolve warning-detail compression in the drawing library.
- [x] Verify plan and production warning states with real relational data.
- [x] Verify fixed A4 warning packet generation.
- [x] Check browser runtime errors.

final result: passed
