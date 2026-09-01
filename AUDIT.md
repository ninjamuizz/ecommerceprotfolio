# Stirling Flavors — Forensic Audit (Phase 1)

Source: https://www.stirlingflavors.com/ — fetched 2026-08-27 via `curl` (no headless browser available this pass; see `NOTES.md` for what needs live-browser follow-up).

Raw sources are stashed in `reference/`:
- `reference/home.html`, `reference/pages/*.html` — raw page HTML
- `reference/assets/*.css` — every CSS bundle referenced by the pages fetched
- `reference/module-script-*.js` — the five inline `<script type="module">` blocks from the homepage (full source, not truncated)
- `reference/sitemap-index.xml`, `reference/sitemap-0.xml`, `reference/urls.txt`, `reference/robots.txt`

---

## 1.1 Stack

**Framework: Astro, static output, no client-side islands.**

Evidence:
- CSS bundles are hashed under `/_astro/` (`Layout.BT1pusgH.css`, `index.euLes-BN.css`, `_flavor_.DQDPvnXO.css`, `_recipe_.DlH3u8fZ.css`, `index.DxBoO9dy.css`) — the `_flavor_` / `_recipe_` naming with underscores is Astro's file-based dynamic-route naming convention (`[slug].astro` → `_slug_`).
- Every component root carries a scoped-style hash attribute, e.g. `data-astro-cid-nen7h5rs` (header), `data-astro-cid-ge2uvauf` (hero), `data-astro-cid-q4otqnx5` (lines module), `data-astro-cid-ck4adeeb` (flavor explorer), `data-astro-cid-4jvhbjz3` (recipes teaser), `data-astro-cid-jow3qlqj` (contact/rep section), `data-astro-cid-gakqr736` (testimonials), `data-astro-cid-jo6i4kqk` (footer), `data-astro-cid-l2tax4p3` (flavor detail template), `data-astro-cid-67vdtt2k` (recipe detail template), `data-astro-cid-74q4p6xh` (spec-sheets page), `data-astro-cid-ibpinaeu` (404 page), `data-astro-cid-nyqrpfod` (recipes index). This is Astro's `data-astro-cid-*` CSS-scoping mechanism — confirms Astro, one `data-astro-cid` per `.astro` component.
- Images use Astro's built-in `<Image />`/assets pipeline: `data-image-component="true"`, generated `width`/`height`, `srcset` with both density (`1x, 2x`) and width (`120w, 240w`) descriptors depending on context, `loading="lazy"`/`"eager"`, `decoding="async"`, all output as `.webp`. `Layout.BT1pusgH.css` also ships an `@layer astro.images { [data-astro-image-fit=...] ... }` block — this is Astro's stable/experimental **responsive images** feature (object-fit/object-position variants driven by `data-astro-image-fit`/`data-astro-image-pos` attributes), which points at **Astro 5.x** (this feature line stabilized there). **Exact patch version could not be pinned** — no build comment, no generator meta tag, no astro-island runtime script present to fingerprint (there are zero client islands on any page fetched — no `<astro-island>` tags, no `astro:page-load`/`astro:transitions`, no view-transitions). Treat "Astro 5.x" as high-confidence, exact version as UNVERIFIED.
- No client-side framework runtime at all. All interactivity (mobile-nav toggle, lines auto-player, flavor search/filter, testimonial carousel, scroll-reveal) is vanilla inline `<script type="module">` — five such blocks on the homepage, extracted verbatim to `reference/module-script-1.js`…`5.js`. No React/Vue/Svelte/Preact hydration markers anywhere.

**Animation/scroll libraries: NONE found.** Explicitly searched the homepage HTML and all downloaded CSS/JS for GSAP, ScrollTrigger, Lenis, locomotive-scroll, framer-motion, embla, swiper, three.js/THREE, ogl, ScrollMagic — zero hits (one incidental match on the substring "ogl" was inside `maps.google.com`, a false positive, confirmed by inspecting context). The one library-shaped term found, `matchMedia`/`IntersectionObserver`, are native browser APIs, not libraries. **Conclusion: 100% hand-rolled vanilla JS + CSS transitions/keyframes + native `IntersectionObserver`, no animation library, no scroll library, no WebGL.** This should simplify Phase 6 significantly — the "motion system" is CSS keyframes + IO-triggered class toggles, not GSAP timelines.

**Hosting: Amazon S3 + CloudFront**, not Netlify/Vercel. `curl -I` on the homepage returns `Server: AmazonS3`, `x-amz-version-id`, `x-amz-server-side-encryption: AES256`, `Via: ... (CloudFront)`, `X-Amz-Cf-Pop`, `X-Cache: Hit/Miss/RefreshHit from cloudfront`. No `x-vercel-*` / `x-nf-*` headers present. `Cache-Control: public,max-age=0,must-revalidate` on HTML, `public,max-age=31536000,immutable` on hashed `/_astro/` assets (checked on `Layout.BT1pusgH.css`) — standard "immutable hashed asset, revalidate the HTML" pattern, consistent with a static Astro build deployed to S3 behind CloudFront.

**Trailing slash behavior:** Both `/flavors/cane-sugar-syrups/american-strawberry` (no slash) and `.../american-strawberry/` (with slash) return `200 OK` directly with byte-identical `Content-Length: 11256` and the same `ETag` — **no 301/302 redirect either way**. This means the origin has both key variants resolvable (typical of Astro `trailingSlash: 'always'` static output plus S3/CloudFront serving `key` and `key/index.html` equivalently, or a CloudFront function normalizing). Sitemap URLs are all written **with** a trailing slash, so treat that as canonical; the no-slash form working too is a hosting-layer nicety, not something to rely on to differ.

**robots.txt:** `User-agent: *` / `Allow: /` / `Sitemap: https://www.stirlingflavors.com/sitemap-index.xml` — no disallow rules at all.

**Sitemap:** `sitemap-index.xml` → single child `sitemap-0.xml` → **178 URLs total**: 1 homepage + 110 flavor detail pages + 66 recipes-path URLs (65 recipe detail pages + the `/recipes/` index itself) + 1 `/spec-sheets/` page. Flavor category breakdown from the sitemap matches the brief exactly: Cane Sugar Syrups 65, Sugar Free Syrups 15, Shakable Toppings 10, Frappe Mixes 8, Tea Concentrates 6, Gourmet Sauces 6 = 110. Recipe URLs are **flat** — `/recipes/{slug}/`, no category segment in the URL (category is a data field, not a route segment). Confirms there is **no** `/flavors/` index route and **no** `/flavors/{category}/` index route in the live sitemap — the flavor explorer/search+filter grid lives only on the homepage (`#flavors` section); individual flavor pages and the homepage explorer are the only ways in.

**Structured data confirmed:**
- Flavor pages carry `Product` JSON-LD, e.g. (from `/flavors/cane-sugar-syrups/classic-vanilla/`): `{"@context":"https://schema.org","@type":"Product","name":"Stirling Classic Vanilla Cane Sugar Syrup","sku":"STIR701","category":"Cane Sugar Syrups","description":"...","brand":{"@type":"Brand","name":"Stirling Flavors"},"manufacturer":{"@type":"Organization","name":"Stirling Flavors"}}`.
- Recipe pages carry `Recipe` JSON-LD, e.g. (from `/recipes/toffee-macchiato/`): `{"@context":"https://schema.org","@type":"Recipe","name":"Toffee Macchiato","recipeCategory":"Lattes","recipeIngredient":[...],"recipeInstructions":"...","author":{"@type":"Organization","name":"Stirling Flavors"}}`. Note `recipeInstructions` is a single flat string here, not an `HowToStep` array — replicate as-is per page rather than upgrading the schema.
- Homepage has `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `twitter:card=summary_large_image`, `theme-color: #1B0F22`, canonical link — but **no `og:image` tag at all** (checked case-insensitively, confirmed absent). Do not invent one for parity; if later phases add one that's a deliberate improvement, not a reproduction.

**Spec sheets:** PDFs live at `/spec-sheets/{SKU}-{slug}-spec-sheet.pdf` (e.g. `/spec-sheets/STIR800-american-strawberry-spec-sheet.pdf`), linked with a plain `download` attribute (not `target=_blank`). `/spec-sheets/` page groups by category with an inline color swatch matching that category's brand color, and explicitly states in its footer note: *"69 of our items don't have a published sheet yet. Email us for any of them and we'll send it the same day."* — matches the brief's "69 items" figure exactly. Counted PDF links on that page: 43 (36 Cane Sugar Syrups + Sugar Free Syrups + Shakable Toppings groups combined, not independently re-verified per category — flag for Phase 3 content extraction to recount precisely per group).

---

## 1.2 Design Tokens

All from `reference/assets/Layout.BT1pusgH.css`, the `:root{...}` block (shared across every page/template fetched — homepage, flavor detail, recipe detail, recipes index, spec-sheets, 404):

**Color tokens:**
| Token | Value |
|---|---|
| `--gold` | `#c1a12e` |
| `--purple` | `#673165` |
| `--pink` | `#e64784` |
| `--red` | `#e02926` |
| `--blue` | `#1b449c` |
| `--navy` | `#002554` |
| `--green` | `#009d4e` |
| `--orange` | `#f5841f` |
| `--plum` | `#1b0f22` (also used directly as `body` background) |
| `--card-dark` | `#26152e` |
| `--card-dark-hover` | `#321d3c` |
| `--cream` | `#fbf6ec` |
| `--cream-card` | `#f6efe6` |
| `--ink` | `#1b0f22` |
| `--body-on-cream` | `#3a2c33` |
| `--secondary` | `#6b5f66` |
| `--muted` | `#9c8fa0` |
| `--on-dark` | `#ffffffb3` (white 70% alpha) |
| `--on-dark-muted` | `#ffffff6b` (white 42% alpha) |

Each of the six product lines/category "rail" colors observed as **inline per-instance overrides** (`style="--rail:#..."`) rather than named tokens — six distinct values seen on the homepage: `#C1A12E`, `#002554`, `#009D4E`, `#F5841F`, `#673165`, `#E64784` — these are exactly the six token values above (`gold, navy, green, orange, purple, pink`), confirming each of the 6 lines maps 1:1 to one root color token. **The exact line→color assignment order was not fully re-derived in this pass** (my targeted regex against the "lines" module markup didn't match on first try and I did not re-attempt — mark as UNVERIFIED, needs a quick manual read of the homepage HTML's `.lines` section in Phase 3, but the six colors themselves are certain). Individual flavor cards also get a per-item `--flavor:#hex` inline accent (82 distinct hex values seen across the homepage's card grid sample) — these are presumably per-flavor art-direction values, not part of the fixed token set; Phase 3 will need to capture all 110 from each flavor's own page/data.

**Typography:**
- Font: `Gabarito Variable` (variable font, two `@font-face` cuts — `-latin-` and `-latin-ext-` subsets — `font-weight: 400 900`, `font-display: swap`, `woff2-variations` format, self-hosted at `/_astro/gabarito-latin-wght-normal.ZpvQqcqY.woff2` and `/_astro/gabarito-latin-ext-wght-normal.C-_vgDbo.woff2`). Body stack falls back to `Gabarito, system-ui, -apple-system, "Segoe UI", sans-serif`. **This is the only font family used anywhere** — confirmed by grepping `font-family` across every downloaded CSS file; no secondary/monospace/serif face exists.
- Body: `font-size:17px; line-height:1.65`.
- Fluid type scale (all `clamp()`):
  - `--display: clamp(44px, 6.4vw, 176px)` — hero H1
  - `--h2: clamp(38px, 5.2vw, 84px)`
  - `--h3: clamp(24px, 2.4vw, 34px)`
  - `.lead { font-size:19px; line-height:1.68 }`
  - `.eyebrow { font-size:11px; font-weight:600; letter-spacing:.3em; text-transform:uppercase }`
  - `.h2 { letter-spacing:-.045em; font-weight:900; line-height:.88 }`
  - `.h3 { letter-spacing:-.03em; font-weight:900; line-height:1.05 }`
  - Per-template h1 sizes differ from the shared `--display` token: flavor detail `h1{font-size:clamp(36px,5vw,72px)}`, recipe detail `h1{font-size:clamp(32px,4.4vw,60px)}` — these are template-local overrides, not the homepage hero token.

**Radii:** `--r-sm:14px; --r-md:18px; --r-lg:20px; --r-xl:24px; --pill:9999px`.

**Shadows:**
- `--shadow-product: 0 18px 30px #00000073`
- `--shadow-glass: 0 22px 44px #1b0f2257, inset 0 1px 0 #ffffff24`
- `--shadow-light: 0 1px 3px #0000000d`
- Card hover states additionally use ad-hoc shadows not tokenized, e.g. `0 16px 30px #1b0f222e` (flavor cards, related cards, sheet rows) and `0 14px 26px #1b0f2229` (spec-sheet rows, 404 links) — these repeat identically across templates so should probably be promoted to their own tokens in the rebuild even though the source doesn't tokenize them.

**Easing / timing:**
- `--ease-out: cubic-bezier(.22, 1, .36, 1)` — the only custom easing curve defined anywhere in the CSS (grepped for every `cubic-bezier(...)` across all bundles, exactly one hit).
- `--t-hover: .15s ease`
- `--t-card: .26s var(--ease-out)`
- `--t-reveal: .7s var(--ease-out)`

**Layout tokens:** `--header-h:70px; --page-max:1280px; --gutter:clamp(20px, 4vw, 56px)`.

**Breakpoints** (all raw `@media`, no custom-property breakpoints; site uses the modern `(width<=Npx)` / `(width>=Npx)` range syntax, not `max-width:`), collected across every CSS file: `900px`, `940px`/`941px` (header nav ↔ mobile toggle swap pair), `860px`, `640px`, `520px`. No breakpoints above 941px were found in any downloaded CSS — **there is no explicit desktop-only ≥1280px or ≥1440px rule; layout above ~941px is driven entirely by `clamp()`/`auto-fit` grids, not media queries.** Flag this for Phase 7's 1920/1440/1280 responsive-parity pass — don't expect a breakpoint jump there, expect continuous fluid scaling.

---

## 1.3 Motion Inventory

**No animation library of any kind is used** (see 1.1). Every effect below is CSS `@keyframes`/`transition`, plus five small vanilla-JS controllers, all captured verbatim in `reference/module-script-1.js`…`5.js`.

**Keyframes defined** (all in `Layout.BT1pusgH.css`, so global/shared):
| Name | Definition |
|---|---|
| `marquee-left` | `0%{translate(0)} → 100%{translate(-50%)}` |
| `marquee-right` | `0%{translate(-50%)} → 100%{translate(0)}` |
| `column-up` | `0%{translateY(0)} → 100%{translateY(-50%)}` |
| `column-down` | `0%{translateY(-50%)} → 100%{translateY(0)}` |
| `drift-a` | `translate(-6%,-4%) scale(1)` ↔ `translate(10%,8%) scale(1.18)` at 50%, back at 100% |
| `drift-b` | `translate(8%,6%) scale(1.1)` ↔ `translate(-8%,-8%) scale(.92)` at 50% |
| `drift-c` | `translateY(10%) scale(.95)` ↔ `translate(-12%,-6%) scale(1.25)` at 50% |
| `pour-bar` | `0%{translateY(-100%) scaleY(.6)} → 60%{translateY(0) scaleY(1)} → 100%{translateY(100%) scaleY(.6)}` |
| `syrup-stream` | `0%{opacity:0, translateY(-62%) scaleY(.5) scaleX(1.35)} → 14%{opacity:1} → 55%{opacity:1, translateY(0) scaleY(1) scaleX(1)} → 100%{opacity:.85, translateY(52%) scaleY(1.18) scaleX(.72)}` |
| `syrup-bead` | `0%{opacity:0, translateY(-6px) scale(.5,.9)} → 20%{opacity:1} → 78%{opacity:1, translateY(34px) scaleY(1.25)} → 100%{opacity:0, translateY(50px) scale(.7)}` |
| `grain-fall` | `0%{opacity:0, translateY(-6px) rotate(0)} → 14%{opacity:1} → 88%{opacity:1} → 100%{translate(var(--dx,0px),110px) rotate(260deg), opacity:0}` |

**Where each is applied, with exact durations:**
- **Statement marquee band** (`.band`/`.track`, `data-astro-cid-543bmuqs`): `animation: 50s linear infinite marquee-left`.
- **Hero background "shelf" ticker columns** (`.shelf-col[data-direction=up/down]`, `data-astro-cid-ge2uvauf`): `column-up`/`column-down var(--duration) linear infinite`, where `--duration` is set **per-column inline** and randomized — observed values `29s, 34s, 38s, 43s, 47s` across the 5 columns.
- **Hero flavor-name ticker** (`.ticker-col.up/.down`, same component): fixed `46s linear infinite column-up` / `52s linear infinite column-down` — different (slower, fixed) pace than the shelf-image columns.
- **Hero ambient background glows** (`.glow-a/b/c`, `data-astro-cid-ge2uvauf`): `drift-a 30s`, `drift-b 26s`, `drift-c 34s`, all `ease-in-out infinite`.
- **Distributors-section glows** (`.glow-blue/.glow-gold`, `data-astro-cid-lsleewa2`): `drift-b 30s`, `drift-c 34s ease-in-out infinite` (reuses the hero's keyframes with different durations/colors).
- **Hero eyebrow "pour bar"** (`.pour-bar:after`, `data-astro-cid-ge2uvauf`): `pour-bar 2.4s var(--ease-out) infinite` — a small decorative gold tick animating like a pouring stream next to the eyebrow label.
- **Six-lines module "pour" animation** (`.stream-body`/`.stream-bead`, `data-astro-cid-q4otqnx5`): `syrup-stream 1.5s var(--ease-out) infinite` and `syrup-bead 1.5s var(--ease-out) infinite`, plus `.grains span { animation: 1.6s linear infinite grain-fall; animation-delay: var(--d) }` (per-particle stagger via inline `--d`). The bottle "tips" via `rotate` transition on the pourer image: `transition: rotate .9s var(--ease-out)`, animating from `128deg` (idle) to `150deg` (active), with **per-bottle pivot points** set inline via `--tip-x`/`--tip-y` custom properties (sampled values: `0.5/0.028`, `0.49/0.034`, `0.541/0.124`, `0.424/0.123`, etc.) — i.e. every product bottle image has a hand-placed rotation origin so the pour looks physically correct; not a single shared value. The cup fill uses `.layer.is-filled { height: calc(var(--h) * var(--layer-scale)) }` with `transition: height .9s var(--ease-out)` and `--layer-scale: .92`.
- **Scroll-reveal** (`[data-reveal]`, global): base state `opacity:0; transform:translateY(26px); transition: opacity var(--t-reveal), transform var(--t-reveal)` (i.e. `.7s cubic-bezier(.22,1,.36,1)`), triggered by adding `.is-revealed` (→ `opacity:1; transform:none`). Driven by `module-script-5.js`: an `IntersectionObserver` with `rootMargin:"0px 0px -10% 0px", threshold:.05`, one-shot (`unobserve` after first trigger), and a **per-element stagger**: `transitionDelay = min(dataset.reveal, 8) * 90ms` — i.e. up to 8 steps of 90ms (720ms max stagger) keyed off a `data-reveal="N"` index attribute per element.
- **Card hover lifts:** `transform: translateY(-7px)` on flavor cards / related-flavor tiles / distributor "glass" cards (`transition: var(--t-card)` = `.26s cubic-bezier(.22,1,.36,1)`), `translateY(-4px)` on the flavor-detail spec-sheet CTA row, `translateY(-3px)` on spec-sheet list rows and 404 link rows, `translateY(3px)` (rightward — actually `translate(3px)`, horizontal) on the 404 row's arrow glyph on hover.
- **Testimonials carousel** (`module-script-4.js` + `.quote{transition:opacity .5s}`): autoplay every `8000ms` (`8e3`), each transition first fades the current quote out then, after a fixed `480ms` delay (`window.setTimeout(...,480)`), swaps `.is-active` to the next — so the visible crossfade timing is a 480ms-offset opacity swap, not a true crossfade animation. Autoplay is suppressed entirely (not just paused) when `prefers-reduced-motion: reduce` matches; manual dot-clicks still work either way.
- **Six-lines module autoplay** (`module-script-2.js`): steps advance every `2600ms` via `setInterval`; **starts/stops based on viewport visibility** — `IntersectionObserver({threshold:.25})` triggers play/pause as the module scrolls in/out, in addition to a manual pause button (`[data-playpause]`) that toggles the label text between "Play"/"Pause" and toggles `aria-pressed`. Reduced-motion: autoplay never starts, module stays static on step 0.
- **Mobile nav drawer:** hamburger→X icon morph via `transform`/`opacity` on the three `<span>` bars: `transition: transform .2s var(--ease-out), opacity .15s ease`; top bar `translateY(7px) rotate(45deg)`, middle `opacity:0`, bottom `translateY(-7px) rotate(-45deg)` when `[aria-expanded=true]`.

**Reduced-motion handling — confirmed global fallback exists and it's correctly "end state," not just "off":**
```css
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,:before,:after{transition-duration:1ms!important;animation-duration:.001ms!important;animation-iteration-count:1!important}
  [data-reveal]{opacity:1;transform:none}
}
```
(from `Layout.BT1pusgH.css`) — this collapses all transitions/animations to ~0 and forces revealed content to its final visible state, satisfying Phase 0 rule 4 by construction; a straight port of this rule is the right move rather than reinventing it. Additionally: hero shelf columns hide overflow images (`nth-child(n+8){display:none}`) under reduced motion so the (now-static) ticker doesn't show an obviously-cut-off infinite loop; 404-page hover lifts are separately neutralized (`transition:none` on `.row`/`.row-arrow` hover under reduced motion, redundant with the global rule but present anyway — copy faithfully).

**No scroll-scrubbed/pinned sections, no parallax-on-scroll (the "parallax" look in the hero is autoplaying `column-up`/`column-down` CSS animation, not scroll-linked), no page-transition system, no WebGL/canvas anywhere** in any of the six pages fetched.

---

## 1.4 Assets

- **Image format:** 100% `.webp` for photographic/product imagery (185 `<img>` tags on the homepage alone, all `.webp`; zero `.avif`, `.png`, or `.jpg` found in the homepage `<img>` tags — one `.svg` used, for `/favicon.svg` only). All images are served from Astro's own asset pipeline under `/_astro/{original-name}.{hash}_{variant-hash}.webp` — meaning **the rebuild should also run source images through Astro's `<Image>`/asset pipeline** to reproduce this pattern rather than hand-writing `<img>` tags.
- **Responsive image attributes:** Two distinct patterns observed —
  1. Density-based (`1x, 2x`) for small fixed-size UI images like the wordmark logo: `srcset="wordmark...FqNK3.webp 1x, wordmark...ZEN0w0.webp 2x"`.
  2. Width-based (`Nw`) for content imagery, e.g. hero shelf product bottles: `srcset="...120w, ...240w" sizes="120px"`, and larger cards seen with `180w/220w/360w/440w` variants elsewhere. All carry explicit `width`/`height` attributes (typically the intrinsic `500x500` for product bottle renders) plus `loading="lazy"` (default) or `loading="eager"` (used for the hero's above-the-fold shelf images) and `decoding="async"` throughout.
- **Favicon:** `/favicon.svg` (`type="image/svg+xml"`), plus `theme-color: #1B0F22` (matches `--plum`). No apple-touch-icon or additional favicon sizes were found in the `<head>` of the homepage — flag for Phase 7 SEO parity (don't add extras that don't exist).
- **PDFs:** spec sheets at `/spec-sheets/{SKU}-{slug}-spec-sheet.pdf`, linked with a plain `download` attribute (forces download rather than inline view). 43 PDF links found on `/spec-sheets/` in this pass, grouped under three category headings actually rendered there (Cane Sugar Syrups, Sugar Free Syrups, Shakable Toppings) — **Phase 3 should do the full recount per category since the brief's figures (35+/5/2) don't exactly reconcile with my raw count of 43 and I didn't cross-tab it by group; treat my "43" as a rough total, not authoritative.**
- **External links noted (not assets, but worth carrying forward verbatim):** the header/footer "Customer Login" points to `https://books.zohosecure.com/portal/stirlingflavors/signin` (Zoho Books customer portal, external, `target="_blank" rel="noopener noreferrer"`) — this is a real third-party integration, not a placeholder; keep it as an outbound link, don't fake a login flow.
- **Contact details found in footer/rep-contact markup** (for later copy-accuracy checks, not re-typed as final content here): `mailto:info@stirlingflavors.com`, physical address `19220 64th Ave S, Kent, Washington 98032`, linked out to `https://maps.google.com/?q=19220%2064th%20Ave%20S%2C%20Kent%2C%20Washington%2098032`.

---

## Templates confirmed to differ (bundle-per-template, tokens shared)

| Page fetched | CSS bundles loaded |
|---|---|
| `/` (home) | `Layout.BT1pusgH.css` + `index.euLes-BN.css` |
| `/flavors/cane-sugar-syrups/classic-vanilla/` | `Layout.BT1pusgH.css` + `_flavor_.DQDPvnXO.css` |
| `/recipes/toffee-macchiato/` | `Layout.BT1pusgH.css` + `_recipe_.DlH3u8fZ.css` |
| `/recipes/` | `Layout.BT1pusgH.css` + `index.DxBoO9dy.css` (different `index.*.css` hash than the homepage's — confirms per-route CSS chunking, not a single shared "index" bundle) |
| `/spec-sheets/` | `Layout.BT1pusgH.css` only, plus a **page-specific inline `<style>` block** (not a separate `/_astro/*.css` file) |
| a nonexistent path (404 test) | `Layout.BT1pusgH.css` only, plus its own inline `<style>` block |

All six share the same `:root` token file (`Layout.BT1pusgH.css`) — confirms the design-token layer in Phase 2's `src/styles/tokens.css` should be a single global file imported everywhere, with each route/component owning its own scoped rules on top, matching the source's per-route chunking (Astro's default behavior, nothing custom).
