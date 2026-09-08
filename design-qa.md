# HR directory design QA — v1.34.139

Source visual truth: `C:/Windows/TEMP/codex-clipboard-2af17768-79f8-4a2b-8d32-c8bd6c3763e2.png` plus the accepted compact HR proposal in `C:/Users/31175/.codex/visualizations/2026/09/08/01a07e69-5cde-7d82-a8cd-a143c81eb134/hr-directory-plan.html`.

This is an authorized redesign, not a pixel clone of the original broken UI. The source screenshot uses a different employee and business dataset. All implementation screenshots use synthetic records in a dedicated local database; no claim is made that their counts match production.

## Evidence and normalization

- Original screenshot: 2553×1351 pixels. Source CSS viewport/device scale are unknown; normalized to 1702px wide without changing its aspect ratio for composition comparison.
- Implementation desktop: `artifacts/hr-directory-v134139/desktop-final.png`, 1701×901 pixels from the browser's 1702×901 requested viewport (fractional desktop scaling rounds the capture width). Normalized to 1702px wide for the comparison.
- Full-view side-by-side: `artifacts/hr-directory-v134139/comparison-full.png`.
- Focused command/header comparison: `artifacts/hr-directory-v134139/comparison-controls.png`.
- Primary tablet: `artifacts/hr-directory-v134139/tablet-final.png`, requested and DOM-confirmed 1366×1024, reading state.
- Short screen edit/error: `artifacts/hr-directory-v134139/1366x768-edit.png`; DOM-confirmed footer bottom 751.34 within the 768px viewport. The body ends where the footer begins.
- Mobile: `artifacts/hr-directory-v134139/390x844-edit-native.png`, 390×844. Footer bottom 835.34px; content scroll area remains available. Native browser capture was used after raw CDP capture cropped the emulated physical surface. Cropped intermediate images are not acceptance evidence.
- Raw CDP screenshots can be at the host's 1.5 scale; final comparison uses native normalized screenshots, not those intermediate images.

## Findings and iteration history

1. [P1, resolved] Original account-only row and full-height child competed for vertical space. Removed the extra row; the shared HR content now allocates a flex track and the directory/profile each reserve a scrollable body track. At tablet and short-screen sizes all editing controls are visible.
2. [P2, resolved] Original reading mode resembled a disabled form and duplicated the edit action. Read mode now uses label/value sections; only edit/create display inputs and the persistent footer.
3. [P2, resolved] Side panel consumed core editing width. The role/account summary opens on demand in a 400px drawer with Escape, focus return and keyboard containment. Large desktop also uses this on-demand panel; the proposal's optional permanently pinned third column was not needed for the tablet-first release.
4. [P2, resolved] Original blocking browser confirmation could not be exercised reliably in the embedded browser. Internal discard actions now use an accessible in-page dialog. Both continue and discard were exercised. Browser back was retested after removing a stale one-shot navigation bypass; entered data and edit URL are retained when continuing.
5. [P2, resolved] Save errors in a hidden tab could be missed. All errors now appear beside the persistent buttons; name, mobile, hire-date and department validation focus the corresponding tab/field. Actual invalid phone text remained visibly in the input after server rejection; the successful correction/create flow was verified.

Post-fix evidence is in the final screenshots and browser checks described above. No actionable P0/P1/P2 findings remain within the employee-directory and shared-shell scope.

## Required fidelity surfaces

- Typography: existing system icon family retained; explicit Microsoft YaHei/PingFang/system sans-serif stack; 14px form text, 13px field labels, 12px supporting copy, larger employee identity. Chinese labels and actions wrap without overlapping at the checked viewports.
- Spacing/layout: 240px desktop/tablet employee navigation, flexible profile, compact command bar, reserved footer; organization branches are collapsed until selected. The tablet command bar wraps into content-bearing metric/action rows. Desktop fits them on one row. Form fields use two columns on tablet and one on narrow screens.
- Color/tokens: warm orange selected states and primary actions, white surfaces, pale gray background, restrained shadows, existing green employment/attendance states. Shared shell is updated across HR while specialized modules retain their task layouts.
- Images/icons: no raster scene was called for by the HR proposal. Existing Lucide library icons and real employee-name initials remain; no decorative industrial image or fake photo was introduced into the form.
- Copy/content: account management is concise; unavailable WeCom state is omitted unless bound; account policy is collapsible. Dynamic directory data comes from existing APIs. Unmodified responsibility/reference content elsewhere in HR is outside this directory redesign.

## Interaction acceptance

Verified login, profile editing, two-tab updates, persistent data after save, automatic employee-number creation, selected new profile and URL, API validation/error retention, cancel, employee-change discard choices, browser-back protection, missing-field focus, drawer keyboard close, organization collapse, search empty state and inactive roster. Recruitment, attendance, skill, training, organization, responsibilities, approvals and analytics navigation rendered successfully. Training was checked again after its asynchronous load completed. Browser error log was empty on the final tab.

No physical tablet or full mobile keyboard test was performed. Existing business-specific workflows on other HR pages were not exhaustively re-run in the browser; CI and the existing integration suite cover their own regression contracts.

## Published artifact confirmation

The exact `v1.34.139` image from source `2e94aeaf5dfdf2e92b62454cf78544e9256ea4b5` was anonymously pulled by digest and started with a new isolated PostgreSQL database and MinIO. The release browser reproduced the accepted layout and successfully saved/reloaded/restored a synthetic employee. Final evidence: `artifacts/hr-directory-v134139/release-tablet-final.png`, `release-1366x768-edit.png`, `release-container-verification.json` and `release-runtime-smoke.json` (27 HTTP checks, 141 applied existing migrations). The final release tab reported no browser errors.

Reduced-motion emulation disabled the drawer animation, and Tab/Shift+Tab remained within the open panel in the source browser pass. Emulation overrides were cleared after validation.

final result: passed
