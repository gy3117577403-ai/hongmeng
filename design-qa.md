# Homepage design QA — v1.34.136

final result: passed

## Source and comparison

- Source visual truth: user attachment `C:/Windows/TEMP/codex-clipboard-63bf512f-11ef-43fb-b03a-51287db6b6d7.png` (1672 × 941 pixels, normalized to the 1673 × 941 comparison canvas). The first attachment is the previous homepage, not the visual target.
- Rendered implementation: authenticated `/home` at `http://127.0.0.1:3106`, Windows in-app Chromium, light theme, isolated fixture account. No production data was used.
- Desktop CSS viewport: 1673 × 941, device scale factor 1.5; native capture 2510 × 1412, normalized to 1673 × 941. Evidence: `artifacts/home-industrial-v134136/desktop-final-1673x941.png`.
- Tablet CSS viewport: 1366 × 1024, device scale factor 1.5; native capture 2049 × 1536, normalized to 1366 × 1024. Evidence: `artifacts/home-industrial-v134136/tablet-final-1366x1024.png`.
- Full comparison places normalized source and implementation together: `artifacts/home-industrial-v134136/design-comparison-full.png`.
- Focused comparison puts each scene side by side at native CSS scale: `artifacts/home-industrial-v134136/design-comparison-scene.png`. Typography, card surfaces, central instrument, icons, and illustration were inspected in this larger crop.
- Mobile CSS viewport: 390 × 844. Full document capture `artifacts/home-industrial-v134136/mobile-controls-final-native.png`; the 561-pixel content capture excludes the scrollbar. No horizontal overflow. Both message filters remain labelled and have 44-pixel targets.
- State differs intentionally: the reference has an empty inbox and illustrative values; the implementation shows real API data from 24 disposable work orders, five pending notifications and three completed notifications. Exact numeric and message matching is not claimed. Existing navigation names and access rules are retained.

## Findings and iteration history

1. [P2, fixed] Initial card pseudo-elements covered the complete surface in gray. The bottom layer is now limited to 14 pixels; desktop and tablet final captures show opaque white cards with a thin foundation.
2. [P2, fixed] Initial footer included a seventh narrow analytics entry and cramped the primary action. Six tracks now hold the weekly plan, four actual-data metrics and the workbench action. Metric buttons themselves open details.
3. [P2, fixed] Dimming unselected cards made the illustration show through their content. Their opacity now stays at one; borders and shadows communicate focus. Rechecked in material focus and default views.
4. [P2, fixed] Mobile inherited CSS hid the unread filter and filter labels. The final scoped overrides restore both controls. Browser inspection and the final mobile capture confirm the labels, 44-pixel height and working unread toggle.
5. [P2, fixed] Competing Ctrl+K listeners caused an unwanted navigation/search reopening; the shared header skips its shortcut on the homepage. Search Escape now returns focus to its launch button. Drawers close before search opens.
6. [P2, fixed] Unknown data could open drawers or metrics containing fallback zeroes. Error-state controls and open handlers now prevent those transitions; nullable issue totals carry an explicit unknown explanation.

## Required fidelity surfaces

- Fonts and typography: Chinese system UI fallback remains consistent across navigation, cards and inbox. Dark blue titles, readable secondary labels, tabular numeric hierarchy, and explicit truncation were checked in the focused comparison. The implementation uses slightly stronger small text than the pale reference to retain readability on a working tablet.
- Spacing and layout: left navigation, search header, approximately two-thirds scene, right inbox and bottom metrics follow the target composition. Cards include separate task and navigation controls, increasing their content height intentionally. No obstructed controls or horizontal overflow at either desktop or tablet size.
- Colors and tokens: white/cool gray surfaces, orange action accents, navy text, teal neutral states, amber attention and red unresolved issues form a consistent system. State text accompanies colors. Selection retains solid card backgrounds.
- Image quality: two generated raster assets match the pale isometric factory direction. The floor and separate orange electronics workcell were inspected for crop and readability. Assets total 114,988 bytes as WebP. The workcell has a white background with multiply blending, not simulated transparency. A checkerboard first generation was rejected. UI, text and business numbers remain live DOM/SVG controls, never embedded in artwork.
- Copy and content: weekly completion and non-overdue labels match their actual periods/formulas. Drawing totals describe work orders awaiting confirmation, not file counts; open issues use an aggregate rather than the preview length. No fabricated trends or machine telemetry are displayed. Existing module names intentionally differ from the conceptual reference.

## Interaction evidence

- Material/quality module selection highlights the corresponding node and filters the related message category; switching from completed history resets conflicting filters to the selected pending category.
- Message completion updates pending/completed totals and history; restoration returns the message and totals. Read/unread and search were exercised against isolated API data.
- Task drawer opens actual preview rows and business routes; Tab/Shift+Tab stay inside, Escape restores the trigger. Ctrl+K closes overlays and focuses global search without changing the home URL; Escape returns to the search launch control.
- Global search resolves a fixture work order. Account/more menus have keyboard navigation and focus return logic.
- Standard selected-line animation is `hm-industrial-focus-breathe`, 2.8 seconds; quiet mode computes `animation-name: none`. Emulated reduced-motion preference also disables scene animations. Nonselected lines remain static and carry no process-flow direction.
- Coarse-pointer emulation was verified and module controls operated without hover. The browser backend does not support native touch-event dispatch; physical tablet hardware was not tested. Do not describe this as hardware acceptance.
- Desktop and tablet screenshots were visually checked; mobile controls were rechecked after the responsive fix. Browser error log on the completed page was empty.
- Captures made with a mismatched browser density produced partial/duplicated frames and were rejected. Only the named final evidence above is used for acceptance.

## Implementation checklist and residual gaps

- [x] Compare source and implementation in a combined full view and readable scene crop.
- [x] Fix and recheck card depth, footer density, focus states and mobile filters.
- [x] Exercise primary interaction and message state lifecycle in the browser.
- [x] Check motion preferences, coarse-pointer behavior, keyboard and responsive layout.
- [x] Record accepted differences in labels, data and navigation.
- Physical tablet hardware, production-scale account data and production deployment are outside this local visual run. Exact-image acceptance is recorded separately by the release scripts; this file does not claim Sealos cutover.

No actionable P0/P1/P2 findings remain in the inspected scope.

## Published image confirmation

The immutable v1.34.136 image was independently pulled anonymously from the domestic mirror and started at `http://127.0.0.1:3107/home`. Runtime revision is `ca87258b08607021d16e3ad772b9a473cf512f53`; manifest digest is `sha256:8b15d36f6ec23d3b54bf7be5c887b7b8bcc5a1a6004b493f3b86c516c6e437f4`.

After login, the actual image displayed the expected industrial homepage and 25% fixture completion. Material selection filtered its message, the pending drawer opened, Ctrl+K closed it and focused search without navigation, and Escape returned to the launch control. The settled page's browser error log was empty. Evidence: `artifacts/home-industrial-v134136/release-homepage-final.jpg` (native browser output 1663 × 941, CSS viewport reported 1673 × 941); the browser output excludes part of the outer viewport edge, so earlier normalized captures remain the precise source-comparison evidence. The saved file itself was reopened and visually inspected. Temporary device overrides were reset.

The first disposable image start rejected a generated seed password containing the test username. Its database and failed container were retained; a different empty database was used for successful acceptance. This was corrected in the QA tool as a separate source change, without changing the published tag or business image. Runtime evidence records 141 applied migrations and 23 successful HTTP checks. The CI mirror probe had returned 502; the later independent local manifest/blob verification, anonymous pull and runtime evidence establish domestic mirror acceptance separately.
