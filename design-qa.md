# 首页智能工厂指挥舱 Design QA

## Comparison target

- source visual truth path: `C:\Users\31175\.codex\visualizations\2026\08\29\01a04b69-5239-7921-b42a-30c1b60984f5\homepage-redesign-v2-five-concepts\homepage-redesign-v2-1.png`
- implementation URL: `http://127.0.0.1:3500/home`
- implementation screenshot path: `C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13476\implementation-final-1366x1024.png`
- viewport: `1366 x 1024` CSS px
- source pixels: `1366 x 1024`
- implementation pixels: `1366 x 1024`
- CSS size: `1366 x 1024`
- device pixel ratio: `1.0` (browser reported `1.0000000298023224`)
- density normalization: full-view source and implementation were compared at native 1:1 dimensions. Focused crops were resized only to equal comparison canvases and were not used for pixel-level typography measurements.
- state: authenticated administrator on an isolated PostgreSQL/MinIO QA stack; `/home`; light theme; categorized message inbox populated with isolated QA notifications; no production or Sealos data used.

## Evidence

- full-view comparison: `C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13476\comparison-final.png`
- focused operations comparison: `C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13476\comparison-focus-operations.png`
- focused inbox comparison: `C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13476\comparison-focus-inbox.png`
- initial implementation: `C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13476\implementation-initial-1366x1024.png`
- tablet evidence: `C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13476\implementation-tablet-1024x768.png`
- mobile evidence: `C:\Users\31175\Desktop\鸿蒙软件\output\home-command-center-v13476\implementation-mobile-390x844.png`

Focused comparisons were required because full-view scaling made the message-toolbar labels and small operational-node typography too small to judge reliably.

## Required fidelity surfaces

- Fonts and typography: the implementation uses the product's existing CJK system-font stack because the generated source visual does not expose font metadata. Heading/body hierarchy, compact numeric emphasis, weights, line heights, truncation, and one-line message rows match the source intent. The visible duplicate search label found in pass 2 was removed.
- Spacing and layout rhythm: the 60/40 operations-to-inbox composition, slim platform rail, compact greeting band, six-node operating canvas, persistent category rail, and bottom insight strip are preserved. The implementation keeps the existing product header and platform navigation as an intentional product constraint. At `1366 x 1024`, document and viewport are both exactly `1366 x 1024` with no overflow.
- Colors and visual tokens: navy, warm white, orange action, teal normal, amber warning, and red urgent states map to scoped `--hcc-*` tokens. Borders, shadows, active states, and focus rings retain sufficient contrast without changing the established orange brand.
- Image quality and asset fidelity: the source contains no reusable photography, logo illustration, or non-standard icon asset. Existing product branding and the Lucide icon family were retained. The operational surface remains native interactive UI, with the repository's existing industrial background asset used at low opacity and semantic UI elevation added without rasterizing the page.
- Copy and content: fixed labels follow the source information architecture (`生产协同总览`, `消息提醒`, business categories, `今日洞察`). Dynamic counts, dates, usernames, and `--` empty metrics intentionally come from live application data instead of copying the concept's fabricated sample values.
- Icons and controls: every visible control uses the existing icon family, semantic links/buttons, accessible labels, focus-visible treatment, and reduced-motion support.

## Primary interactions tested

- Business category selection: `生产异常` selected and reduced the visible list to the two production messages.
- Search: `610` reduced the active category to `工单交付风险 · 610`.
- Unread filter: `仅看未读` changed the active list and exposed its pressed state.
- Snooze: `1小时后提醒` persisted through a full page reload and removed the notification from active summary counts until its scheduled return.
- Mark all read: `全部已读` cleared the header unread badge and remained cleared after reload.
- Responsive structure: `1024 x 768` reported `scrollWidth = 1024`; `390 x 844` reported no horizontal overflow and retained all six category controls.
- Console errors checked: final browser pass returned no warning or error entries.

## Findings

No actionable P0, P1, or P2 findings remain.

Accepted differences:

- The concept's sample operating metrics and notification counts are not copied into production code. The implementation displays real API data and explicit `--` empty states.
- The existing application header and complete platform navigation remain visible because removing them would regress established product navigation.

## Comparison history

### Pass 1 — blocked

- [P2] Operational numbering and visual depth drifted from the chosen concept.
  - Evidence: `comparison-initial.png` showed quality numbered `03` while occupying the source's `05` position; the center lacked the source's execution ring; node platforms were flatter.
  - Fix: reordered the semantic nodes to plan, drawing, production, material, quality, labor; added the data-bound execution ring; strengthened stepped 2.5D bases, grid depth, elevation, and flow treatment.
  - Post-fix evidence: `comparison-focus-operations.png` and `comparison-final.png` show the corrected `01–06` sequence and the restored central ring/plinth hierarchy.

### Pass 2 — blocked

- [P2] Search assistive text was visible and wrapped inside the compact inbox toolbar.
  - Evidence: the first `comparison-focus-inbox.png` showed `搜索消息` stacked beside the real placeholder.
  - Fix: removed the unscoped visible `sr-only` span and placed the accessible name directly on the input with `aria-label`.
  - Post-fix evidence: the current `comparison-focus-inbox.png` shows one compact search field with no duplicate or wrapped label.

### Pass 3 — passed

- Full-view and both focused comparisons were re-opened after the fixes.
- Typography, spacing, colors, image/asset treatment, content, controls, interaction states, accessibility treatment, and responsive breakpoints contain no remaining actionable P0/P1/P2 issue.

## Follow-up polish

- [P3] When production data is available, the center execution ring and insight strip will gain the richer numeric density visible in the concept automatically; this is a data-state difference, not a layout blocker.

## Implementation checklist

- [x] Match the selected 1366×1024 composition and information hierarchy.
- [x] Preserve existing platform navigation and real business routes.
- [x] Add business classification, unread filtering, search, mark-read, read-all, and persistent snooze.
- [x] Verify core interactions against an isolated real database.
- [x] Verify 1366×1024, 1024×768, and 390×844 browser layouts.
- [x] Check the final browser console.
- [x] Recompare source and final implementation in the same combined images.

final result: passed
