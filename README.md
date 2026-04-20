# מתכונים

A private Hebrew (RTL) recipe site for Daniel & wife. Static HTML/CSS/JS, no build step, hosted on GitHub Pages at `matkonim.danielhadar.com`.

## Project files

```
index.html          main app shell (reader + admin)
styles.css          all styles — aesthetic: "נייר" (paper)
app.js              router, store, GitHub I/O, render functions
data/recipes.json   the "database" — read by reader, written by admin
CNAME               tells GH Pages which domain to serve
.nojekyll           disables Jekyll processing
SPEC.md             design spec (reference, can leave in repo or delete)
demo-aesthetics.html  the original three-option mockup (reference)
```

## Local preview

The app needs a tiny HTTP server because `fetch('./data/recipes.json')` won't work from `file://`. From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

If you open `index.html` directly (double-click), the app falls back to a hardcoded seed recipe so you can still see the UI — but the admin save won't work locally anyway.

## Deploy

### 1. Push to GitHub

Create a new repo **`matkonim`** under `danielhadar`. Push everything in this folder to `main`.

```bash
cd ~/Documents/Claude/Projects/Matkonim
git init
git add .
git commit -m "matkonim v0"
git branch -M main
git remote add origin git@github.com:danielhadar/matkonim.git
git push -u origin main
```

### 2. Enable GitHub Pages

Repo → Settings → Pages → Source: **Deploy from a branch**, Branch: **main / root**.

Wait ~1 min for the first deploy. You'll see the URL at the top of the Pages panel.

### 3. Custom domain

Already in the `CNAME` file: `matkonim.danielhadar.com`.

In your DNS provider for `danielhadar.com`, add a **CNAME record**:

```
matkonim   CNAME   danielhadar.github.io
```

Back in the Pages settings, toggle on "Enforce HTTPS" once the cert is ready (can take a few minutes after DNS propagates).

### 4. Create the admin token

Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.

- **Token name**: `matkonim-admin` (or whatever)
- **Expiration**: pick anything; 1 year is fine
- **Repository access**: *Only select repositories* → `matkonim`
- **Permissions → Repository → Contents**: **Read and write**
- Leave everything else untouched

Click "Generate token". Copy the `github_pat_…` string.

### 5. First admin unlock on your iPad

1. Open `matkonim.danielhadar.com/#/admin`
2. App asks you to set a **4-digit PIN** — pick one you'll remember (and tell your wife if she wants admin too).
3. App then asks for **owner / repo / token** — paste the PAT from step 4. Owner `danielhadar`, repo `matkonim`.
4. You're in. Tap the `+` button to add a recipe.

Repeat step 5 on each admin device (the token is stored per-device, never synced).

### Wife's iPad

Just open `matkonim.danielhadar.com` — no setup, no PIN, no token needed. She only needs those if she wants to edit recipes too (then she does step 5).

## How it works

### Reader
- Fetches `data/recipes.json` directly from GH Pages (CDN-cached, cache-busted per load).
- Sorts by `lastOpened[id]` from `localStorage`, falling back to `updatedAt`/`createdAt`.
- Tapping a recipe opens it and updates that device's `lastOpened`.
- Search filters live across title + ingredients + instructions. Nikud-insensitive.

### Admin
- Gated by a 4-digit PIN (client-side only — a speedbump, not crypto).
- After PIN unlock, admin reads & writes `data/recipes.json` via the GitHub Contents API using the PAT.
- Save = one commit to `main`. You can see the full edit history under the repo's Commits tab.
- Conflict handling: if someone else saved between your load and save, you get a "טען מחדש ונסה שוב" toast — reload the page and retry.

### What's in `localStorage`
```
matkonim.lastOpened       — { recipeId: iso-timestamp } per device, never synced
matkonim.pin              — the 4-digit PIN (plain)
matkonim.unlockedUntil    — ms timestamp, 30-day sliding expiry
matkonim.gh.owner         — "danielhadar"
matkonim.gh.repo          — "matkonim"
matkonim.gh.token         — your PAT
```

"איפוס" on the lock screen wipes all of the above. You'd then need to re-enter token on next admin visit.

### Revoke a lost device

Go to github.com/settings/tokens → find the token → **Revoke**. Now that device cannot write anymore (even if someone else picks up the iPad).

## Routes

```
#/              home (recipe list)
#/r/:id         recipe detail
#/admin         admin (PIN gate → token gate → list)
#/admin/new     new recipe form
#/admin/r/:id   edit / delete existing recipe
```

## Troubleshooting

- **"שגיאה 409"** on save: someone saved between your load and save. Reload & retry.
- **"שגיאה 401"**: PAT expired or revoked. Generate new one, tap "איפוס" on the PIN screen, redo step 5.
- **"שגיאה 404"** on save: owner/repo wrong, or repo became private without the token having access.
- **Fonts don't load in the kitchen with no wi-fi**: the app still works (falls back to system fonts). You probably want the iPad on your home wi-fi anyway.
- **Recipes not updating for wife**: her browser cache. Pull-to-refresh on Safari solves it.

## Future (not in v0)

- Photos per recipe
- Categories / tags
- Import/bulk migration tool (separate task — see SPEC.md §10.8)
- Ingredient check-off with persistence
- Dark mode
- PWA / offline
