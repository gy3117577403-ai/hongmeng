# Document return treatment and joint review — v1.34.257

Final result: passed

This report covers the approved return-treatment UI and its actual application workflow. It does not assert production cutover or production data repair. Previous QA content is preserved in output/review-v134256/previous-design-qa.md and Git history.

## Source and implementation evidence

Approved image sources are under C:/Users/31175/.codex/generated_images/01a0b0a4-7f03-7f10-8cb8-39e12c3eb52f/:

- Main review page: exec-0c1a3212-6c1c-496d-9f48-661be4cb06a0.png.
- Technical treatment: exec-71bddfe8-18f3-4d98-8816-78c96f890eb6.png.
- Joint review: exec-e7e0f8a2-7429-4b80-9f55-eb36c6b19a49.png.

Implementation evidence is the real Next application, PostgreSQL records, S3-compatible object storage and authenticated document viewer in candidate run 36541762968, commit 4cc014df4cb90e8bf3dd0be222076030b09911b3. QA users, issues and documents are isolated fixtures; they are not customer production records. The final release repeats these checks against the built image and the published Hangzhou mirror.

Screenshots are in output/review-v134256/candidate-36541762968/review-candidate-4cc014df4cb90e8bf3dd0be222076030b09911b3/browser/:

- 09-main-reference-aspect.png, 10-treatment-reference-aspect.png and 11-review-reference-aspect.png: approximately the approved source aspect ratio, captured at 1715 x 917 CSS pixels, scale 1.
- 04-return-workbench.png, 05-technical-treatment.png, 07-review-with-document.png and 08-closed-history.png: target landscape tablet, 1366 x 1024 CSS pixels, scale 1.
- 06-short-tablet-treatment.png: 1366 x 768 CSS pixels, scale 1, lower-height regression.
- 01-recovered-current-review.png, 02-resubmitted-return.png and 03-dual-review-complete.png: recovery and review closure states.

Source and implementation were opened together in the same comparison inputs for all three screens, including the final reference-aspect captures. The original source main page is 1715 x 917 pixels; technical and review sources are each 1713 x 918 pixels. Source CSS density is unspecified; implementations are each 1715 x 917 physical pixels at scale 1, so no density downsampling is needed. This is a composition and usability comparison, not a pixel-identical claim. Important labels, original reason, technical result and fixed actions are readable in the full-resolution inputs, so separate crops were unnecessary.

## Findings resolved and comparison history

- P1, history navigation: starting a new review round removed the return-history entry because its visibility used only the current round's evidence. Added a separate product-wide documentReturnCount while retaining current-round filtering for approval. A database regression and browser check now prove that closed history opens immediately and cannot expose approval actions for a different current round. Evidence: 08-closed-history.png and browser-runtime.txt.
- P1, concurrent review state: current joint-review actions must depend on the selected issue belonging to the current review package. Separated historical selected-round signatures from current pending-review availability; preserved an explicit entry to the current review. The browser checks old history, changed files, stopped rounds and independent supervisor/quality signatures.
- P2, action clarity: saved responses now display an explicit result receipt rather than leaving the user inside an undifferentiated form. The primary action becomes Save and process next, Save and submit review, Submit joint review or role-specific confirmation. A failed submit after a successful save preserves the saved result and exposes retry. Evidence: 05-technical-treatment.png, 07-review-with-document.png and real browser checks.
- P2, state continuity: per-issue drafts survive issue changes; an uploaded replacement is selected from the original file's lineage; dirty close requires a leave decision. A newly replaced file cannot be incorrectly saved as retaining its superseded original. Evidence: actual storage upload, response/version assertions and browser draft checks.
- P2, constrained viewport: technical and review content scroll inside the wide dialog while header, close control and action footer remain visible. Evidence: 06-short-tablet-treatment.png and measured fixed-control assertions.
- Capture-only issue: an earlier screenshot caught an in-progress CSS transition and a hover on another issue. Stable recapture moves the pointer away and waits for finite animations. Final 05 and 10 show a single selected issue and an orange primary action; no product styling fix was inferred from the intermediate frame.

Final small guards remove a non-functional return-to-saved-result link when that issue has unsaved edits, align the optional location field with the server's 200-character limit, and remove a redundant completion action when the current-review entry is present. Lint and whitespace checks pass; exact release-image acceptance repeats the workflow.

Visual states have no remaining actionable P0/P1/P2 findings. The PDF cleanup correction below has also passed the updated real application browser acceptance.

## Runtime finding from the v1.34.256 mirror

The exact source image passed, but the second, Hangzhou runtime caught an intermittent P1 during file replacement: `Worker was terminated` from PDF.js initialization. All business assertions had completed, but the uncaught-error gate correctly failed; v1.34.256 is not the accepted handoff.

Inspection found both loadingTask.destroy() and document.destroy() on the same owner, plus cleanup during an unfinished loading task. The installed PDF.js document destroy delegates to that loading task. A standalone local HTTP/PDF.js control, output/review-v134256/reproduce-old-pdf-cleanup.mjs, reproduced the exact unhandled error with the original early-destroy behavior.

The fix releases each owner once after its load promise settles, prevents initialization after unmount, and stops unnecessary TOC extraction in ordinary document previews. The same ownership correction applies to the SOP PDF editor. Four local regressions pass, including real delayed HTTP 200 and 404 PDF sources; cleanup failures still reach the caller. Browser acceptance now switches away from three intentionally delayed real PDF requests, keeps the active drawing usable, and retains the strict zero-uncaught-error assertion. No global exception filter or weakened assertion was added.

Candidate 36547889072, commit f87e2329ecc5a115cc4786f1d7b2e99e66b20030, passes 65 related unit/PostgreSQL regressions (0 failures, 0 skips) and 92 browser checks with errors: []. It includes the three delayed PDF switches and the entire treatment/review/history flow. New screenshots and browser-runtime.txt are in output/review-v134257/candidate/browser/. The existing composition is unchanged; post-fix screenshots show the same target controls and a rendered document. This resolves the runtime finding for design acceptance. The immutable v1.34.257 image and its Hangzhou runtime must still independently pass before image handoff.

## Required fidelity surfaces and intentional differences

- Typography: retain the application's Chinese sans-serif stack and actual brand mark. Product, issue, reason and action hierarchy is clear; actor, role, timestamp and version are secondary. The implementation retains compact operational font sizes rather than copying the larger text in the generated proposal. Long filenames wrap without covering actions. No claim of identical antialiasing is made across image generation and browser rendering.
- Layout and rhythm: preserve left product list, right document preview and compact task summary. The technical dialog uses a narrower issue list to reserve space for treatment; the reviewer gets issue list, treatment evidence and document side by side. Rounded surfaces, shallow elevation and fixed action areas follow the approved direction. The existing version/fixture controls and two-signature main-page footer remain because they operate real product state. They replace the proposal's decorative process strip rather than adding another strip.
- Color and tokens: orange primary action and selected controls, warm original-return evidence, green saved treatment, blue submission state and muted metadata. Glass blur is confined to the backdrop; document and form text sit on readable surfaces. Disabled buttons reflect actual missing confirmation, not a rendering failure.
- Images and assets: existing application mark and Lucide icons are reused; no UI is a generated raster. The preview is a labelled fixture PDF served through the real authenticated storage endpoint. Its portrait content differs from the reference landscape customer drawing, so document scale/content is not used as a fidelity claim. No decorative substitute asset is introduced.
- Copy and content: original return identity includes role, name, time, reason and source file/version. Technical treatment includes actual responder, time, explanation and replacement. Review shows the selected round's two signatures; old history remains distinct. Repeated instructional paragraphs and large empty workflow cards are removed. Progress counts and action labels are derived from actual server state.

State differences in the three comparison pairs are intentional: technical capture shows the explanation mode while the proposal illustrates replacement; replacement is exercised separately through real upload. Reviewer capture shows both signatures pending and an unchecked review confirmation; the proposal shows one signer complete. Both signing orders and final closure are tested. These are not represented as pixel-matched states.

## Workflow and runtime acceptance

Candidate run 36541762968 passes 61 related unit/PostgreSQL integration tests, full lint, migration/build and the real browser flow. browser-runtime.txt reports passed: true with errors: [].

The browser verifies legacy stranded-round recovery; one-time resubmission; replacement during pending review; preservation of the prior signature; rejection of stale approval; real PDF access and S3 upload; draft retention; multi-issue editing and save receipts; close-context preservation; short-height fixed actions; failed-submit retry; original return role/name/time; repeated return history; both joint-review signing orders; closure reflected in plan/print state; read-only boundaries; and history availability across newer rounds. One deliberate HTTP 503 is injected only to test submit retry; successful business operations use real application endpoints.

## Implementation checklist

- [x] Make original return and the next permitted action visible together.
- [x] Keep treatment, saved result, submission and joint review distinguishable.
- [x] Preserve response drafts, original evidence, replacement lineage and previous signatures.
- [x] Retain the originating product/filter context when closing.
- [x] Keep main controls visible at target tablet and short desktop heights.
- [x] Validate actual application screenshots and database/storage/browser behavior separately.
- [x] Preserve history independently from current review authorization.

Release handoff must still name the immutable image, digest, final release workflow and mirror runtime result. A passed design review or candidate build alone is not that handoff.
