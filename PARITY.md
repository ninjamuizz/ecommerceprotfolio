# PARITY.md — Verification report (Phase 8)

This project has no headless-browser/Playwright MCP tool built in — but this machine has a real
Google Chrome install (`C:\Program Files\Google\Chrome\Application\chrome.exe`), discovered mid-project.
That let this phase do a real screenshot comparison against the live site instead of relying on
source-only analysis, closing out several items earlier phases had flagged as
"UNVERIFIED — needs live browser measurement." A first attempt at this phase (via a background
agent) was cut off mid-way by an account-level API session limit after it had already taken all 12
screenshots and found the most important bug; the rest of this report — diagnosis, fixes, and the
remaining checks — was completed directly in the main session using the screenshots it left behind
plus fresh Chrome runs.

## Screenshot comparison — real bugs found and fixed

Six page/viewport pairs were screenshotted at 1440×900 and 390×844 against the live site
(`reference/screenshots/*.png`, both `-local` "before" and `-local-fixed` "after" versions kept for
the two pairs where a bug was found and fixed):

1. **Body background theme was inverted on 5 of 6 page templates — CONFIRMED and FIXED.**
   The live site sets an inline `style="background:var(--plum|--cream)"` directly on `<body>` per
   page: only the homepage (`/`) is dark (`plum`); every other template — flavor detail, recipe
   detail, `/recipes/`, `/spec-sheets/`, `/404/` — is light (`cream`). This build had hardcoded
   `background: var(--plum)` globally in `src/styles/global.css` with no per-page override, so every
   non-home page rendered dark instead of light. Because `color: var(--ink)` (near-black) was also
   global, this made body text render **near-invisible dark-on-dark** on all five affected templates —
   this is what the verification agent's screenshot caught mid-run ("the H1 title appears completely
   invisible") before it was cut off.
   **Fix:** added a `background?: 'plum' | 'cream'` prop to `BaseLayout.astro` (default `plum`,
   preserving the homepage), rendered as the same inline `style` the source uses; set
   `background="cream"` on the five affected pages; removed the now-dead hardcoded rule from
   `global.css`. Rebuilt and re-screenshotted `/flavors/cane-sugar-syrups/classic-vanilla/` — now
   matches the reference pixel-for-pixel in layout, color, and the sticky dark topbar band (which had
   also looked "missing" in the buggy screenshot — it wasn't a separate bug, just invisible against
   an equally-dark body).

2. **Header logo was a placeholder icon instead of the real wordmark — CONFIRMED and FIXED.**
   `src/components/Header.astro` was still pointing its brand `<img>` at `/favicon.svg` (a small
   shield icon) — a leftover from the Phase 2 scaffold, before real assets existed. The live site (and
   this project's own already-correct `Footer.astro`) uses the real "STIRLING" wordmark image at
   129×26 plus a `Flavors` text span next to it. The wordmark file was already sitting in
   `public/images/site/` (downloaded during the image-localization phase) but nothing referenced it
   from the header. **Fix:** pointed `Header.astro`'s brand `<img>` at
   `/images/site/wordmark-white.webp` (with the 1x/2x `srcset` already present in `Footer.astro`),
   matching the reference markup exactly. Rebuilt and re-screenshotted the homepage — header now
   matches the reference exactly at both 1440 and 390 widths.

3. **Everything else compared (hero layout/copy/gradient/ticker, ingredient lists, product cards,
   recipe layout, mobile reflow at 390px) matched closely** — no other visual deltas were found across
   the 6 page/viewport pairs once the two bugs above were fixed. Font rendering, spacing, button
   pill shapes, and the fluid `clamp()` type scale all held up at both the desktop and mobile
   viewports checked, which is a real (not just source-derived) confirmation that AUDIT.md §1.2's
   breakpoint math renders correctly in an actual browser.

**Update — completed directly in the main session after the above was written:** re-screenshotted
`/recipes/` and `/spec-sheets/` (1440×900) against the live equivalents — **both pixel-identical to
the reference**, confirming the BaseLayout-level fix covers every affected template, not just the one
spot-checked first. Intermediate widths (1920/1280/1024/768/430/360) still weren't captured — only
1440/390 (plus the two 1440-only index-page checks above) — left as a genuine gap, not worth
fabricating.

## Lighthouse

Real scores, run via `npx lighthouse` against the local build with system Chrome
(`lighthouse-reports/*.json`):

| Page | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|
| `/` (home) | 92 | 93 | 100 | 100 |
| `/flavors/cane-sugar-syrups/classic-vanilla/` | 100 | 94 | 100 | 100 |
| `/recipes/toffee-macchiato/` | 100 | 96 | 100 | 100 |

All three pages clear the spec's ≥95 bar on Best Practices and SEO; accessibility is close (93–96)
but under 95 on all three, and home's performance (92) is the only score under 95 anywhere. Home's
accessibility ding and all three pages' minor gaps trace to real audit findings below — none of them
were "fixed" by relaxing the reproduction, since they turned out to be faithful to the live site's own
design choices, not bugs this build introduced (see below).

### What's actually behind the accessibility scores

Ran axe (`@axe-core/puppeteer`) for detail beyond Lighthouse's summary:

- **`color-contrast` (serious, all 3 pages, 147/6/4 nodes respectively):** the overwhelming majority
  on home are the hero's background flavor-name ticker — traced to `reference/assets/index.euLes-BN.css`'s
  own `.ticker{opacity:.42; ...}` rule (confirmed by reading the source rule directly), a deliberately
  faded decorative element behind a `mask-image` fade, not a bug. On flavor/recipe pages, the failing
  nodes are the `.eyebrow` category label and the spec `<dt>` labels (Pack/Bottle/Case/Pallet),
  which use the site's own `--muted`/tinted-accent label color — also traced directly to
  `reference/assets/_flavor_.DQDPvnXO.css`'s `dt{color:var(--muted); font-size:9px}` rule. **Faithful
  reproduction of the live site's own low-contrast micro-copy styling, not something this build should
  unilaterally "fix" away from the source design** (doing so would violate the project's own "1:1
  reproduction" mandate).
- **`image-redundant-alt` (minor, flavor/recipe pages, 6 nodes each):** related-item thumbnail cards
  have both an `alt` on the image and an adjacent visible `.sib-name`/caption with the same text —
  a common, intentional image+caption pattern, ported faithfully from source markup, not introduced by
  this build.
- **Performance (home, 92):** the `<img>` tags across the site use plain `src`/`srcset`, not Astro's
  `<Image>` optimization pipeline (already flagged in NOTES.md from Phase 4/5) — this is the most
  likely driver of the score being under 100, and is a genuine, known simplification versus what a
  fully production-tuned Astro site would do.

## Motion verification — real browser, all passed

Ran directly against the local build with puppeteer + system Chrome:

- **Reduced-motion emulation:** with `prefers-reduced-motion: reduce` emulated, all 7 `[data-reveal]`
  elements on the homepage report `opacity: 1` via `getComputedStyle` — confirms the global CSS rule
  (ported verbatim from source) actually works in a real browser, not just in source.
- **Six-lines autoplay:** the active step (`[data-step][aria-pressed="true"]`) advanced from `0` to
  `1` after 3.2s of real wall-clock time with the module scrolled into view — matches the sourced
  2600ms interval.
- **Pause button:** clicking `[data-playpause]` flips `aria-pressed` from `"true"` to `"false"` —
  confirms the toggle wiring works end-to-end in a real page, not just in the ported script's logic.

## Counts & structural checks — all confirmed

- **Flavors:** 110 total — Cane Sugar Syrups 65, Sugar Free Syrups 15, Tea Concentrates 6, Frappe
  Mixes 8, Gourmet Sauces 6, Shakable Toppings 10. Matches spec exactly.
- **Recipes:** 65 total — Lattes 15, Mochas & Cocoas 7, Frappes 8, Tea & Refreshers 4, Cocktails &
  Mocktails 20, Dirty Sodas & Lemonades 11. Matches spec exactly.
- **Lines:** 6, in order, each with a resolved `railColor`.
- **Spec sheets:** 43 of 110 flavors have a non-null `specSheetPdf` (36 Cane Sugar Syrups + 5 Sugar
  Free Syrups + 2 Shakable Toppings), reconciled two independent ways in Phase 3. The live site's own
  footer notice says "69 of our items don't have a published sheet yet" — the real number is 67
  (110 − 43); this is a genuine inconsistency in the live site's own copy, reproduced verbatim rather
  than silently corrected.
- **Sitemap:** `dist/sitemap-0.xml` vs `reference/sitemap-0.xml` — **178/178 URLs, byte-identical
  diff** (checked via a sorted-path `diff`, zero lines of output).
- **Build:** `npm run build` — 179 pages (178 sitemap-covered routes + `/404/`), zero errors.
- **Placeholder-content grep:** `grep -rliE "lorem ipsum|TODO|placeholder text|example\.com" dist/`
  — zero matches.
- **Images:** 427 real image files downloaded from the live site into `public/images/` (~11 MB total:
  107 flavor bottles + 195 recipe images + 125 site/UI images), all 427 paths referenced in the built
  HTML confirmed to exist on disk (zero broken local image links). 3 flavors (all Shakable Toppings)
  have no image because the live site itself has none for them — reproduced as `null`, not invented.
  Zero remaining external `stirlingflavors.com`/`_astro` image URLs anywhere in `dist/`.

## What's exact vs. approximated — summary

**Exact / directly verified against the live site:**
- All copy, all 110 flavor records, all 65 recipe records, all 6 lines, the sitemap URL set, the
  design tokens (colors/type scale/radii/shadows/easing/breakpoints), the motion timings/keyframes
  (no animation library exists on the real site — it's CSS keyframes + 5 vanilla JS modules, ported
  near-verbatim), the real product/lifestyle photography, and now (post-fix) the visual rendering at
  1440 and 390px on the 3 templates screenshotted.

**Approximated or unverified:**
- Lighthouse/axe scores — not run.
- Real-browser motion verification (autoplay timing, reduced-motion emulation) — confirmed from
  source only, not watched in a live page.
- Intermediate breakpoints (1920/1280/1024/768/430/360) — not screenshotted, only 1440/390.
- `/recipes/` and `/spec-sheets/` — not re-screenshotted after the BaseLayout fix (high confidence
  they're fixed too, since the fix was applied at the shared layout level, but not independently
  confirmed for those two).
- The distributor ZIP-lookup and homepage contact form the original brief described **do not exist on
  the live site** (verified during Phase 4 — the real site uses a plain `mailto:` link for both) — built
  to match reality, not the brief's incorrect assumption.
