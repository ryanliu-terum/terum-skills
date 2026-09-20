# Skill benchmark image sharing

Every dashboard `SkillCard` and loaded skill detail page has an icon-only Share action. On the detail page, the existing external-link icon sits first in the title's action row, beside Favorite/Edit/Install, with the tooltip ‘Share benchmark image’. It remains available with the details rail open or closed. Sharing reads the selected detail through the backend (local folders by exact path, team skills by their tracked reference and current root), renders a PNG, and opens a preview with Square/Horizontal layouts and Light/Dark appearances. The renderer implements selected design 14 with its benchmark-details/link footer removed. It uses the shipped Inter font, Terum mark and theme tokens. It renders in a local canvas, without uploads, external image services or generated editorial copy.

The pass graphic uses `receipt.case_runs` only. Missing metrics remain unavailable; absent evaluations, invalid receipts, partial runs and older evaluated versions are identified. Names, descriptions, bylines and references wrap in full. The image grows to fit the text; Horizontal grows in both dimensions to keep its landscape aspect. Oversized canvases fail explicitly instead of exporting clipped content. Large pass counts use a proportional track instead of subpixel tiles. The light/dark export is 1080 pixels wide. The normal horizontal export is 1800 pixels wide.

## Actions

- Copy image uses the existing PNG clipboard backend.
- Save PNG downloads in a browser; the desktop adapter invokes a native save dialog. Destination paths come from that dialog, never from a webview argument. Cancellation is quiet and write errors remain actionable.
- Reddit and Instagram save the PNG and open the service for manual upload. X and LinkedIn copy the image and open the chosen composer. The UI explicitly tells the user to paste it. These do not claim to attach or publish the image automatically.
- More opens the native file-sharing sheet only when the host's Web Share API supports PNG files. Generation finishes before the click so the share call keeps user activation. Source: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

Native opener permissions add only the four destination URL patterns. No public skill URL is inferred from a private repository. Nothing is posted automatically.

## Verification (2026-09-18)

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 183 files passed, 2,537 tests passed, 102 existing suite skips. No new skipped tests.
- `npm run build`: passed.
- `npm exec -- playwright test e2e/routes/skill-share.spec.ts --workers=1`: 2 passed. Verified all dashboard cards expose sharing, real preview generation, real PNG downloads in all three appearances, background colors/dimensions, cancellation by Escape, long identities, unavailable metrics and partial data. Light/Dark/Horizontal exports visually inspected.
- Design generator and renderer passed after removing card 14's footer and shortening its artboard.
- Native adapter tests cover byte forwarding, unsafe filenames, cancellation and write errors. Rust save-command validation has unit tests, but `cargo test --offline share_image` could not run: this environment has no Cargo/Rust toolchain. A desktop build and native save-dialog check remain required on a configured desktop build host; browser evidence is not a native smoke test.

## Change report

`invariantsTouched`: 1 (backend owns clipboard, native sharing, download and filesystem actions), 5 (design 14, existing mark/icons/tokens), 6 (receipt-backed numbers and missing/partial/stale states), 7 (tests), 8 (checks).

`testsModified`: `TopBar.test.tsx` and `backend/tauri/__tests__/chrome.test.ts` retain exact allowlist assertions, updated for the authorized share destinations. Design `render.cjs` explicitly requires card 14's footer to be absent and permits its shorter height; other reference checks remain active. Added model, sharing, native-save adapter, dialog and browser tests.

`openQuestions`: native compilation/save-dialog execution awaits a Rust-equipped desktop environment. Unattributed local folders say “Author unavailable”; tracked Library folders resolve their author from the team inventory by skill ID, retaining their own description and receipt.

## Spacing, identity and destinations refinement

- Reduced the outer margin from 24 to 12 logical pixels, content inset from 52 to 32, and standard PNG height from 1216 to 1074 pixels. The Terum mark and name now occupy the card header.
- Name, description, author and receipt all come from the selected backend detail. Same-name local folders resolve by exact path. Missing local paths block generation; failed reads and cancellation never render substitute data. Author entities decode consistently with descriptions.
- Primary destinations, in order: Reddit, X, Instagram, LinkedIn. Bundled SVG logos have no runtime network dependency. Save cancellation prevents destination opening; clipboard errors prevent copy destinations opening.
- `testsModified`: browser height assertion now checks the intentionally tighter 1074-pixel output; destination assertions cover all four logos. Exact native URL allowlist tests reflect the new destinations. Added source-identity and save-before-open/cancellation tests.

Final refinement verification: `npm run typecheck`, `npm run lint`, and `npm run build` passed. `npm test -- --maxWorkers=4` passed all 184 files, 2,544 tests, with 102 existing skips. `npm exec -- playwright test e2e/routes/skill-share.spec.ts --workers=1` passed both tests, including all four loaded logos and three real PNG downloads. Light, Dark, Flat and dialog outputs inspected. Initial unrestricted parallel execution timed out; bounded worker runs resolved the contention. New SVG assertions were corrected to compare imported assets because Vite embeds them as data URLs.

## Full images, horizontal format, and tracked identity

- `/desktop/e2e/out/share/index.html` is the current output gallery, regenerated by the sharing browser test. It includes complete PNGs and desktop/mobile sharing-dialog screenshots. `deploy-check-benchmark-flat.png` remains an alias of the horizontal PNG for existing links. The original design gallery also links the latest app exports.
- The preview uses `object-fit: contain`. Exports measure the complete text before sizing their canvas; the browser test checks the final text, every text draw's bounds, and landscape orientation with long names, authors and descriptions.
- The header includes the tracked skill reference, or the selected Library root and skill name for a local folder. Attribution uses recorded people handles, joined by full author email or the skill's authorship record, with unambiguous legacy member data as fallback. It never fabricates a username from an email prefix.
- `testsModified`: the local-detail test now expects the necessary attribution inventory reads. The unknown-author fixture removes both tracked people sources; it still asserts that unavailable attribution is not invented. Browser expectations now cover horizontal dimensions and complete text, replacing the old fixed-height/truncation contract. Added a real-adapter test for author identity collisions and preservation of local content/results.
- Native saving was already implemented. Its TypeScript adapter is tested; the Rust toolchain remains absent, so a packaged native save-dialog check cannot run here.

Final full-image verification: `npm run typecheck`, `npm run lint`, and `npm run build` passed. `npm test -- --maxWorkers=4`: 185 files passed, 2,545 tests passed, 102 existing skips. `npm exec -- playwright test e2e/routes/skill-share.spec.ts --workers=1`: 3 passed, covering desktop/mobile previews, complete text bounds, horizontal orientation, PNG downloads and `/out/share/index.html`. Design `build.py` and `render.cjs` passed, including gallery checks at 1280 and 390 pixels. Native platform execution remains blocked by the absent Rust toolchain; no native success is inferred from browser tests.

## Circular sharing sheet and PNG integrity

- The sheet has circular platform/copy/save actions with accessible names and hover titles, with no explanatory paragraph or visible destination labels. Layout (Square / Horizontal) and appearance (Light / Dark) are independent, producing four formats.
- The reported bottom-edge corruption did not reproduce in the existing files: all PNG checksums and scanlines decoded and the bottom edges displayed intact locally. The export now uses an opaque RGB canvas. The browser check compares the entire decoded PNG byte-for-byte (SHA-256 over pixel data) with its original canvas, verifies every bottom-edge pixel, and tests all four formats.
- Preview artifacts are fully validated before an atomic rename. The output gallery points to files named by content hash, preventing an already-open viewer from reusing a previous image. Truncated PNG input leaves the previous complete file intact. Normal download filenames are preserved.
- `testsModified`: the sharing browser test now checks all four combinations, RGB encoding, exact decoded pixel equality, bottom borders and circular icon controls. A unit test covers retaining Dark when switching to Horizontal. Added artifact tests for truncation and immutable content paths.

Circular-sheet verification: `npm run typecheck`, `npm run lint`, `npm run build` passed. `npm test -- --maxWorkers=4`: 186 files passed, 2,548 tests passed, 102 existing skips. `npm exec -- playwright test e2e/routes/skill-share.spec.ts --workers=1`: 3 passed, including pixel-for-pixel PNG integrity checks for Square Light, Square Dark, Horizontal Light and Horizontal Dark. Previews inspected directly. No new tests are skipped; the viewer-specific corruption remains unconfirmed because the original files decoded correctly locally.


## Detail-page integration and PR verification

- The skill-page trigger reuses the dashboard sharing component and opens with the keyboard as well as a click. A different skill identity remounts the trigger, closing the prior skill's sheet.
- Team detail sharing retains the qualified team reference; local sharing retains the exact source path. The mock resolves only its own canonical team reference and rejects a different team with the same skill name.
- Long skill names are shortened in the download filename only, with space reserved for format suffixes so all four names fit the native 100-character stem limit. The image still contains the full skill name.
- Read/generation failures show an error and retry; export is unavailable until generation succeeds. Copy/save failure or cancellation prevents opening the destination. Native dialog cancellation is quiet. Filesystem errors are surfaced. Unsupported native sharing hides More while Copy/Save remain available.
- The reported viewer is Windows Photos or File Explorer preview. PNG validation and exact canvas-to-file pixel comparisons run in Chromium; Windows viewer behavior cannot be reproduced in this Linux environment. Content-hashed preview files and atomic publishing avoid stale viewer caches and half-written gallery artifacts.
- Browser destination verification uses real PNG downloads and clipboard reads, with destination HTTP requests intercepted locally. It checks the handoff, not logged-in social upload/publishing.
- `testsModified`: source-identity tests now assert a qualified team reference; mock lookup adds a canonical-reference/rejected-team regression; new detail-page integration tests cover local/team sources, both rail states, and read-failure retry. The browser suite adds detail-page downloads/screenshots and real clipboard/save handoffs. Filename limits are tested in both TypeScript and Rust.
- `invariantsTouched`: 1, 5, 6, 7, 8. No generated fixtures/tokens or fidelity tolerances changed.

- Full-route verification exposed a stale `collapse.spec.ts` expectation inherited from `main`: the third tile is now Unpublished and Global contains one known unpublished folder. Updated the exact count from `—` to `1` and added exact tile-label assertions. The checkout's unknown count remains `—`; no product behavior or tolerance changed.


Final local verification for the PR:

- `npm run typecheck`, `npm run typecheck:mirrors`, `npm run lint`, `npm run build`: passed.
- `npm test -- --maxWorkers=4`: 187 files passed, 2,559 tests passed, 102 existing skips.
- `npm exec -- playwright test e2e/routes --workers=2`: all 167 passed.
- `npm exec -- playwright test e2e/routes/skill-share.spec.ts --workers=2`: all 4 passed after adding the Windows pixel manifest and avoiding shared artifact writes between parallel tests.
- `git diff --check`: passed. The desktop workflow parses with the installed `yaml` package. Windows PowerShell's parser accepts `e2e/helpers/check-windows-pngs.ps1`.
- The Windows host refused execution of an unsigned script over the WSL UNC path. Its execution policy was not changed. The Desktop workflow now uploads the four PNGs and their BGRA pixel hashes to a Windows job, where the native WIC decoder must reproduce every pixel exactly. The workflow's existing Rust job checks the native save command. Those platform execution results will be recorded on the PR.
- Remaining manual checks: the packaged native save dialog and the user's specific Photos/File Explorer preview session. No automated check claims to have published a social post or reproduced that viewer session.
