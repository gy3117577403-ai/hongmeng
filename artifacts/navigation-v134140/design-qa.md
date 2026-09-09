# Grouped platform navigation QA — v1.34.140

Reference: the user's long dark sidebar screenshot and accepted grouped-menu proposal. The chosen design intentionally replaces the flat list with six accordion groups and a light surface consistent with the redesigned home and HR workspaces. This is an authorized navigation redesign, not a screenshot clone.

## Checked surfaces

- Shared typography: primary rows 15px, secondary rows 14px; primary 48px and child minimum 44px; consistent Lucide icons and orange selection.
- Layout: 264px expanded desktop sidebar, 72px rail; 64px rail on narrow screens; middle scrolling with separately bounded footer.
- Compact operation: click opens a right-side panel; Escape returns focus to its parent, and outside click closes it. Technology's seven-child panel fits 1366×768 and 320×640 viewports.
- Existing routes: 32 manifest entries passed authenticated route rendering, with the Reports entry's existing canonical redirect preserved. Five deep/sample URLs also passed.
- Permissions: a drawing reader sees its available groups, no HR or System group, and the existing HR route protection still redirects to its landing page. No new permissions were added.
- HR integration: the page previously reserved a rail without mounting the shared sidebar. It now has global navigation while retaining its internal tabs. Expanded navigation does not hide the profile save footer; no horizontal page overflow at 1366×768.

## Evidence

- `home-expanded-1366x1024.png`: quality grouping on the redesigned home.
- `home-technology-1366x768.png`: long group and bounded footer.
- `hr-edit-navigation-1366x768.png`: shared HR navigation and visible Save/Cancel actions.
- `mobile-expanded-390x844.png`: overlay, scrollable group and fixed footer.
- `dev-runtime-smoke.json`: 44 checks using isolated synthetic fixtures.

Viewport emulation does not establish physical device/soft-keyboard acceptance. Browser and exact-image release checks are recorded separately; local rendering alone is not mirror delivery.

## Final v1.34.141 navigation protection

The shared HR navigation and Ctrl+K now wait for its existing unsaved-draft confirmation. Browser acceptance exercised Continue Editing without losing input and Discard followed by the intended quality-data route, using both compact and expanded menus. Evidence: additional-browser-checks.json and unsaved-navigation-v141.png. Reduced-motion animation disabling and narrow-screen Tab/Shift+Tab containment also passed. The initial v1.34.140 workflow was cancelled before image publication; final image identity is v1.34.141.
