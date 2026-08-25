# UI layout design QA — v1.34.46

**Findings**

- No actionable P0, P1, or P2 visual findings remain after the responsive-layout fixes.
- [P3] The reference captures contain live production rows while the isolated QA environment contains only seeded empty/sample states. This changes content density but not the measured grid, command-bar, panel, or responsive behavior. A post-deployment observation with live data is still useful, but it is not a blocker for the image release.

**Comparison target**

- Source visual truth:
  - `C:/Users/31175/Documents/WXWork/1688857307751020/Cache/Image/2026-08/企业微信截图_17876217453074.png` — production, 2453 × 1531 px.
  - `C:/Users/31175/Documents/WXWork/1688857307751020/Cache/Image/2026-08/企业微信截图_17876218326956.png` — planning, 2439 × 1393 px.
  - `C:/Users/31175/Documents/WXWork/1688857307751020/Cache/Image/2026-08/企业微信截图_17876218837585.png` — drawing library, 2454 × 1407 px.
  - `C:/Users/31175/Documents/WXWork/1688857307751020/Cache/Image/2026-08/企业微信截图_17876220515316.png` — warehouse, 2449 × 1405 px.
  - `C:/Users/31175/Documents/WXWork/1688857307751020/Cache/Image/2026-08/企业微信截图_17876221888613.png` — messages, 2549 × 1407 px.
- Browser-rendered implementation:
  - `output/playwright/ui-layout-v13446/production-tablet-1366x1024.png`
  - `output/playwright/ui-layout-v13446/planning-tablet-1366x1024.png`
  - `output/playwright/ui-layout-v13446/drawing-tablet-1366x1024.png`
  - `output/playwright/ui-layout-v13446/warehouse-tablet-1366x1024.png`
  - `output/playwright/ui-layout-v13446/messages-tablet-1366x1024.png`
- Primary CSS viewport: 1366 × 1024 at device pixel ratio 1. Implementation screenshots are 1366 × 1024 px, so no density resampling was required for browser assertions.
- Additional responsive viewports: 1920 × 1080 and 1180 × 900 at device pixel ratio 1.
- State: authenticated global administrator; current production week; empty or seeded work lists; a selected drawing record for the persistent desktop file panel; empty notification state.
- Normalization: full-view comparison images scale both source and implementation to 860 px high without changing aspect ratio. Focused header/workspace comparisons crop each source and implementation to the same 3.75:1 content aspect and normalize both to 1200 px wide. The production reference browser chrome was removed from the focused crop with a 90 px top offset.

**Full-view comparison evidence**

- `output/playwright/ui-layout-v13446/comparison-production.png`
- `output/playwright/ui-layout-v13446/comparison-planning.png`
- `output/playwright/ui-layout-v13446/comparison-drawing.png`
- `output/playwright/ui-layout-v13446/comparison-warehouse.png`
- `output/playwright/ui-layout-v13446/comparison-messages.png`

The comparisons show that the implementation preserves the existing orange production design system while removing the annotated collisions and dead gutters. The browser-rendered pages use the available content width, retain the left platform rail, and keep their main action hierarchy readable.

**Focused region comparison evidence**

- `output/playwright/ui-layout-v13446/focused-comparison-production.png`
- `output/playwright/ui-layout-v13446/focused-comparison-planning.png`
- `output/playwright/ui-layout-v13446/focused-comparison-drawing.png`
- `output/playwright/ui-layout-v13446/focused-comparison-warehouse.png`
- `output/playwright/ui-layout-v13446/focused-comparison-messages.png`

Focused comparisons were required because the command bars, header buttons, drawing file panel, and warehouse collaboration links are too small to judge reliably in the full-view composites.

**Required fidelity surfaces**

- Fonts and typography: the existing Chinese system-font stack, weights, line heights, and compact workbench hierarchy were preserved. At all three widths, labels remain legible and do not collide; secondary production commands collapse into a named menu instead of shrinking into unreadable text.
- Spacing and layout rhythm: production no longer reserves a second row for a healthy reconciliation banner; planning keeps four readiness indicators in equal tracks and gives them their own row below 1240 px; drawing uses a stable desktop three-column grid and a responsive file drawer; warehouse related-module links sit with the collaboration panel; messages fill the workbench instead of centering a fixed 1240 px canvas.
- Colors and visual tokens: the existing orange, navy, green, warning red, border, radius, and shadow tokens remain unchanged. No unrelated palette or elevation system was introduced.
- Image quality and asset fidelity: no source image, product image, logo, or illustration was replaced. Existing Lucide icons and the warehouse background treatment remain sharp at device pixel ratio 1; no custom SVG, emoji, CSS illustration, or placeholder graphic was added.
- Copy and content: new labels are short and operational — `更多`, `文件列表`, `跟进`, `计划`, and the compact unread badge. Existing business terminology and navigation targets remain intact.
- Icons and controls: icon sizes and stroke family remain consistent with existing Lucide controls. The production menu, drawing drawer close control, and compact warehouse links have visible focusable semantic controls.
- Responsiveness and accessibility: all 15 page/viewport combinations reported document width equal to viewport width and no page-level horizontal overflow. Wide tables and production metric tracks remain inside their intended internal scroll regions. Playwright accessibility snapshots exposed buttons, menus, links, regions, expanded state, and labels correctly.

**Primary interactions and runtime checks**

- Production `更多` opens a semantic menu containing weekly plan, personnel exception, and batch operations.
- Production healthy reconciliation state is hidden; non-aligned/error states are still rendered by the component and are not covered by the `.aligned` rule.
- Drawing file list is persistently visible at 1366/1920 widths; at 1180 it is opened from `文件列表`, presents a scrim, and moves focus to the close button.
- Warehouse `跟进` and `计划` links render inside the collaboration header rather than competing with filters.
- Pages were loaded at 1366 × 1024, 1920 × 1080, and 1180 × 900. No navigation console errors or page errors were recorded.
- Static regression, TypeScript, lint, 875 unit tests, and production build passed. The three lint warnings are pre-existing `<img>` optimization warnings in unrelated components.

**Comparison history**

1. Source/reported pass identified the following actionable findings:
   - P1 production header crowding and a redundant healthy reconciliation row.
   - P1 fixed-width message canvas causing large empty gutters.
   - P2 planning current/next-week/readiness blocks colliding at tablet widths.
   - P2 drawing file count/actions crowding the preview header and no stable desktop file-list column.
   - P2 warehouse related-module navigation competing with filter controls.
2. Fixes applied:
   - Grouped secondary production commands behind `更多` below 1680 px, moved the side-panel control into the view toolbar, and hid only the healthy reconciliation banner.
   - Replaced the fixed message canvas with a fluid frame and moved unread count beside the title.
   - Rebuilt planning readiness as four equal tracks with a two-row tablet fallback.
   - Added the desktop third column, responsive drawer, `文件列表` trigger, and a compact `更多` action menu to drawing library.
   - Moved warehouse module links into `仓库协同台`.
3. Post-fix evidence:
   - All five full-view and focused comparison pairs listed above.
   - `output/playwright/ui-layout-v13446/production-more-menu-1366x1024.png`
   - `output/playwright/ui-layout-v13446/drawing-drawer-compact-1180x900.png`
   - Final DOM measurements found no page-level horizontal overflow and no console errors in 15 route/viewport runs.

**Open Questions**

- None blocking. Live production content was intentionally not modified during QA; the final image should receive a read-only post-deployment observation after the operator chooses to deploy it.

**Implementation Checklist**

- [x] Fix all five annotated layout areas without replacing the existing design system.
- [x] Keep core navigation and controls functional at tablet, wide, and compact widths.
- [x] Add static responsive-layout regression coverage.
- [x] Capture browser evidence and compare reference/implementation in combined images.
- [x] Confirm no P0/P1/P2 findings remain.

**Follow-up Polish**

- P3: After production cutover, observe one dense live-data state at 1366 × 1024 to confirm that real row counts preserve the same internal-scroll behavior.

final result: passed
