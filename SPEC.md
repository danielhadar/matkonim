# מתכונים — Spec v0.1

A self-use, Hebrew (RTL) recipes web app for Daniel & wife. Browsed on an iPad in the kitchen (and occasionally on phones). Deployed under `danielhadar.com`, GitHub acts as the database.

---

## 1. Skills to use when building

Based on a quick survey of the ecosystem, here's my recommendation and why:

### Install these (one-time, on the dev machine)

**Anthropic `frontend-design`** — the core creative-direction skill. Pushes past generic "AI slop" aesthetics; mandates a committed aesthetic direction, distinctive typography, bold color, and intentional motion. This is the main skill I'll lean on for the overall look & feel.
- Install: `/plugin marketplace add anthropics/claude-code` then `/plugin install frontend-design@anthropics`

**Owl-Listener `ui-design`** — 9 skills covering layout-grid, color-system, typography-scale, responsive-design, visual-hierarchy, spacing-system, dark-mode-design. Most relevant here: `typography-scale` (Hebrew-first sizing), `responsive-design` (iPad + phone), `spacing-system` (kitchen-readable rhythm).
- Install: `/plugin marketplace add Owl-Listener/designer-skills` then `/plugin install ui-design@designer-skills`

**Owl-Listener `interaction-design`** — 7 skills covering micro-interactions, gesture-patterns, loading-states, feedback-patterns, error-handling-ux. Most relevant here: `gesture-patterns` (iPad touch, swipe-back, tap targets), `feedback-patterns` (save confirmations in admin), `loading-states` (thin but not zero — network latency when committing to GitHub).
- Install: `/plugin install interaction-design@designer-skills`

### Skipped (not worth the overhead for this project)
- `design-systems`, `design-research`, `ux-strategy`, `prototyping-testing`, `design-ops`, `designer-toolkit` — these plugins target larger team / product work. Overkill for a two-person kitchen app.

### Alternatives I considered
- `ui-ux-pro-max-skill` (nextlevelbuilder) — a single mega-skill with 50+ UI style presets. Useful as a mood-board helper, but less opinionated about execution. I'd rather commit to frontend-design's "pick a bold direction" approach.

---

## 2. Product

**One line:** a quiet, beautiful Hebrew recipe index — read on the iPad, edited from any device after entering a PIN.

### Personas
- **Reader** (both of you, all the time): browse, search, read. Zero friction.
- **Editor** (you, occasionally): add, edit, delete. Light friction OK.

### Non-goals
- No social / sharing. No comments. No photos (first version). No meal planning. No grocery list. No print layout. No measurement conversions. No timers.

---

## 3. Screens & flows

### 3.1 Home / Recipe list (reader)
- Tall search input pinned to the top (auto-focused? debatable — see open questions)
- Below: a vertical list of recipe cards
  - Each card: recipe title only
  - Tapping the card opens the recipe
- Sort: alphabetical by title (Hebrew collation).

### 3.2 Recipe view (reader)
- Big title at top (serif, display-weight)
- Two sections, RTL:
  - **מצרכים** — bulleted list.
  - **הוראות הכנה** — numbered list. Each step has generous spacing; large, readable body font.
- Back button (top-right in RTL) returns to list

### 3.3 Search (reader)
- Live filter as you type (debounced ~100ms)
- Searches across: `title` + all ingredients + all instructions (case-insensitive, Hebrew-normalized)
- Matches highlight the term within the card subtitle
- Empty state: "אין מתכונים תואמים"

### 3.4 Admin — PIN lock
- Route: `/admin` (no link from the reader UI)
- Single screen: 4 large digit pads, 4-dot PIN display
- Correct PIN → unlocks admin for the session (localStorage flag, 30-day sliding expiry)
- First-ever entry also prompts for a GitHub Personal Access Token (scoped to one repo, `contents:write`). Stored in localStorage, never transmitted anywhere except to `api.github.com`.

### 3.5 Admin — Recipe list
- Same list as reader, plus:
  - Floating "+ מתכון חדש" action button (bottom-right in RTL = bottom-left visually)
  - Each card has edit + delete affordances (swipe-left to reveal, or a small kebab menu)

### 3.6 Admin — Add / Edit recipe
- Three fields:
  1. **כותרת** — single-line input
  2. **מצרכים** — a large textarea. One item per line. Empty lines ignored. No bullet characters needed — the app formats them.
  3. **הוראות הכנה** — large textarea. One step per line. Auto-numbered on render.
- Live preview panel below (or alongside on wide screens): shows exactly how the recipe will render for the reader.
- Save button commits to GitHub (with a loading state ~1-2s). Success → toast "נשמר ✓".
- Cancel button with unsaved-changes confirm.

### 3.7 Admin — Delete
- Long-press or delete button → confirm sheet: "למחוק את '…'? אי אפשר לשחזר." → commits a delete to GitHub.

---

## 4. Architecture

### 4.1 Hosting
- **GitHub Pages** serving a static site from the repo
- Custom domain: `matkonim.danielhadar.com` (CNAME record pointing to `danielhadar.github.io`)
- HTTPS via GitHub's Let's Encrypt (free, auto)

### 4.2 "Database" = a file in the repo
- Single file: `data/recipes.json`
- Reader reads it via `fetch('/data/recipes.json?v=' + Date.now())` to bust CDN cache
- Writer (admin) uses the GitHub Contents API:
  - `GET /repos/danielhadar/matkonim/contents/data/recipes.json` → returns content + SHA
  - `PUT` same endpoint with updated content + SHA → commits
- Each commit message: `"recipe: add/edit/delete — <title>"` — yields a nice git log as a free changelog

### 4.3 Data model
```json
{
  "recipes": [
    {
      "id": "c7a4...",           // uuid v4
      "title": "חומוס של אמא",
      "category": "mains",       // enum — see below
      "ingredients": ["1 ק\"ג גרגרי חומוס", "..."],
      "instructions": ["משרים לילה שלם במים", "..."],
      "createdAt": "2026-04-20T08:12:00Z",
      "updatedAt": "2026-04-20T08:12:00Z"
    }
  ]
}
```

`category` is a required string, one of a fixed enum. Each recipe belongs to exactly one category.

| Value | Hebrew label |
|---|---|
| `salads` | סלטים |
| `soups` | מרקים |
| `starters` | מנות ראשונות |
| `mains` | עיקריות |
| `baked` | מאפים ולחמים |
| `desserts` | קינוחים |
| `breakfast` | ארוחת בוקר |
| `sauces` | רטבים |

No schema versioning needed; if it ever changes we migrate by hand.

### 4.4 Per-device state (localStorage, not synced)
```
matkonim.adminUnlocked  → isoTimestamp (30d sliding)
matkonim.githubToken    → string (PAT, only on admin devices)
```

### 4.5 PIN security — honest notes
A 4-digit PIN is a **speedbump, not a lock**. Real security:
- The `/admin` URL is unlisted (no link from reader).
- The PAT is the actual write credential, scoped to just this repo.
- If an iPad is lost, revoke the PAT in GitHub settings — attackers can no longer write.
- The data is non-sensitive (recipes), so this tradeoff is correct.

---

## 5. Tech stack

- **Vanilla HTML + CSS + JS modules.** No framework. For this scope a build step is pure overhead.
- Served from a single `index.html` that does light client-side routing (`#/`, `#/r/:id`, `#/admin`).
- **Fonts:** Google Fonts — `Frank Ruhl Libre` (display/headings, elegant Hebrew serif) + `Heebo` (body, clean Hebrew sans). Loaded with `font-display: swap`, preconnect to fonts.gstatic.com.
- **Icons:** Lucide (via CDN) — small, clean SVG set with good RTL behavior.
- **No analytics. No cookies. No tracking.**

### Why vanilla and not React/Svelte?
- Total app logic: list + detail + search + one form. ~300-600 lines of JS.
- Zero build step means easier edits directly on GitHub if needed.
- iPad Safari is fast with vanilla; framework startup is noticeable on older devices.
- If the app grows (filters, photos, versions), we can migrate later.

---

## 6. Visual direction (aesthetic commitment)

Per `frontend-design` — pick a bold, specific direction and execute with precision. My proposal:

**"ספר מתכונים של נייר" — a paper recipe book.**

- **Palette:** warm cream paper `#F7F2E8` · deep ink `#1C1A16` · one saffron accent `#C8863C` for interactive states. No purple gradients. No grey. Optional sepia on image-less recipe headers.
- **Typography:**
  - Display: Frank Ruhl Libre 700 for titles (Hebrew serif with real character)
  - Body: Heebo 400/500, generous 1.7 line-height for kitchen readability
  - Base size: **18px** on mobile, **20px** on iPad, instructions at **22px** (kitchen-readable from half a meter)
- **Texture:** subtle paper-grain noise overlay on the page background (~3% opacity SVG). Optional deckle-edge dividers between recipe sections.
- **Motion:** almost none. A soft 180ms cross-fade when navigating between list and recipe. Checkbox strike-through animates. Search results re-order with FLIP transitions.
- **Spacing:** generous. Think magazine margins, not app-dense.

This aesthetic is on purpose boring in a refined way — you're cooking; the app should get out of the way. Elegance by restraint.

---

## 7. iPad / kitchen-specific details (from `interaction-design` + `ui-design`)

- **Touch targets:** minimum 48×48px, list rows 72px tall, admin digit pads 80×80px
- **Tap, not hover:** no hover-dependent UI
- **Safe areas:** `env(safe-area-inset-*)` respected
- **Prevent accidental zoom:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` (no `user-scalable=no` — accessibility)
- **Sticky fingers:** no small close-X buttons; full-width bottom sheets where possible
- **Orientation:** both portrait & landscape supported; reading pane uses max-width ~680px so landscape iPad has breathing room
- **Keyboard:** on admin forms, `inputmode="text"`, Hebrew-keyboard-friendly; PIN pad uses `inputmode="numeric"` or a custom on-screen pad
- **Back gesture:** browser back works (hash routing). Swipe-from-edge on iPad native-back works too.

---

## 8. Non-functional

- **Performance:** initial load under 50KB JS, under 20KB CSS. Fonts are the heaviest asset (~100KB gzipped). Recipes JSON fetched separately so it can cache aggressively.
- **Offline:** the reader will work offline for already-loaded recipes as long as the browser serves the cached JSON (no explicit service worker in v1).
- **Accessibility:** sufficient contrast (AAA on ink/cream), focus rings, keyboard navigable, `lang="he" dir="rtl"` on `<html>`.
- **Backups:** the whole thing *is* a git repo — every edit is a versioned commit, restorable.

---

## 9. Build plan (rough)

1. Scaffold the repo: `index.html`, `styles.css`, `app.js`, `admin.js`, `data/recipes.json` (empty seed)
2. Reader: list → detail → search → last-opened ordering
3. Admin: PIN lock → list with edit/delete → add/edit form with live preview → GitHub API commit layer
4. Visual polish per §6 aesthetic
5. Hook up `matkonim.danielhadar.com` (DNS + GH Pages CNAME)
6. Seed with ~3 real recipes end-to-end, verify on an iPad
7. You migrate the rest of your recipes

I'd deliver it in this order, with a preview after step 3 (fully functional, no polish) and again after step 4 (polished).

---

## 10. Open questions for your review

1. **Repo name / URL.** `matkonim.danielhadar.com` + repo `danielhadar/matkonim` OK? Or `recipes.danielhadar.com`?
2. **Search auto-focus.** On iPad, auto-focusing search pops the keyboard — great for search-first flow, annoying if you just want to browse. My instinct: **don't** auto-focus. Browse first, tap to search.
3. **Ingredient check-off (§3.2).** Worth it in v1, or defer?
4. **Dark mode.** Skip for v1 (kitchen is bright), or add an auto toggle that respects `prefers-color-scheme`?
5. **Recipe length.** Any outliers? Very long recipes might need a jump-to-instructions affordance.
6. **Fonts.** Frank Ruhl Libre + Heebo — OK, or want to nominate different Hebrew fonts (e.g., Rubik, Assistant, Secular One, Alef)?
7. **PAT management.** Happy to generate a fine-grained PAT yourself and paste it in once per admin device? Or prefer an OAuth GitHub App flow (more work to build, one-click to use)?
8. **Seeding.** Any existing Google Doc / Notes / email threads with recipes you want me to migrate, or start fresh?

---

Reply inline or just say "go" and I'll build it to the spec above.
