# Accountability Club

A small daily tracker for **Arvind, Abhinandh and Sai** — steps, weight, active
minutes, workouts and habits, with a weekly leaderboard so nobody quietly
disappears for three weeks.

No accounts, no app store, no build step. One HTML page, four small JS files.

---

## Going live

Two things: somewhere to serve it from, and somewhere to keep the data. On
Railway they're the same service.

### 1. Put it on the web

**The live site runs on Railway.** `npm start` runs `server.js`, which serves the
app and its data from one process — so hosting and the shared board are the same
step, covered below.

Check **Railway → your service → Settings → Source** is pointing at the branch
you actually push to. A service pinned to a branch that never moves will serve
the same build forever no matter how much you commit.

`railway.json` pins the start command and points Railway's healthcheck at
`/rest/v1/health`, so a deploy that fails to come up is marked failed instead of
quietly going live. The healthcheck deliberately passes even with no database —
the app still serves, and the shared board reports its own state separately.

#### "The train has not arrived at the station"

Railway's own 404. It means nothing is routed to a running service, and it is
almost never the app:

1. **No public domain.** A service has no public URL until you make one:
   **Settings → Networking → Public Networking → Generate Domain**. If it asks
   which port, the app listens on `PORT`, which Railway sets.
2. **No successful deployment.** Check the **Deployments** tab — if the newest
   one is red, the old build is not still serving; nothing is.
3. **Crashed on boot.** The deploy log shows the check summary above. No summary
   at all means the process never started.

#### "Application failed to respond"

Different error, different cause: the platform reached the service but got no
answer on the port. The app opens its port before doing anything with the
database, and answers in about 100ms even with no database at all, so a slow or
missing database is not the cause. Check the port the domain targets matches the
`PORT` the app is given, and that the deployment is actually running rather than
merely built.

The app binds to every interface, so this is not a case of it listening only on
localhost.

*Static hosting instead?* There's a GitHub Pages workflow in
`.github/workflows/pages.yml`, but it's **manual-only** and switched off by
default: Pages has to be enabled by hand first (**Settings → Pages → Source:
GitHub Actions** — the Actions token isn't allowed to do it), and a static host
can only serve the front end, so the shared board would need Supabase. On
Railway you need neither.

### 2. Make it a shared board (Postgres)

Two ways. Pick one.

#### On Railway — one service, your own database

`npm start` runs `server.js`, which serves the app **and** its data from the
same process. The browser never touches the database; the server does the SQL
using `DATABASE_URL`, which stays server-side where a password belongs.

1. In your Railway project, add a **Postgres** service. Railway sets
   `DATABASE_URL` on your app automatically.
2. Add one variable of your own: **`CLUB_KEY`**, any long random string. This is
   what the three of you paste into the app. Without it the data API stays
   switched off, so the server is never unintentionally open.
3. Deploy. On boot the server applies `supabase/schema.sql` itself — no SQL
   editor, no migration step.
4. Open the app, go to **Settings → Shared board**. It will tell you the site is
   its own club server; tap **Use this server**, paste your `CLUB_KEY`, and
   **Turn on & sync**.

Nothing else to sign up for. The anon-key trade-off from the Supabase route
disappears too, because there is no anon key — just `CLUB_KEY`, which you choose
and can change whenever you like.

Make sure Railway is deploying the branch you're actually pushing to, under
**Settings → Source**. A service pinned to a branch that never changes will
happily serve a months-old build forever.

#### On static hosting — Supabase

If you'd rather host the files somewhere static (GitHub Pages, Netlify), the
browser has to reach a database directly, so it needs an HTTP layer in front of
one. That's what Supabase provides.

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql),
   run it. Re-running it later is safe.
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
4. Each of you pastes both into **Settings → Shared board** and taps
   *Turn on & sync*.

Here the key does travel to the browser, so anyone holding it can read and write
the table. That's the deliberate trade for static hosting with no login, and the
reason the schema grants no DELETE at all.

### Either way

Everyone's edits merge on open, on tab focus, and shortly after you log
something. The newest write wins.

### Checking it works

The app says so itself. When the site is its own club server and something is
wrong, a banner on **Today** names it: no database attached, no `CLUB_KEY` set,
or the shared board simply not switched on for this device. No banner means
either everything is fine or the site is on static hosting.



Two places tell you, and both name the actual problem:

**The deploy log.** Every boot prints a summary:

```
---- accountability club ----
  ok  DATABASE_URL is set
  ok  database reachable
  ok  club_data table present (14 records)
  ok  CLUB_KEY is set
      shared board is ready
-----------------------------
```

A FAIL on any line is the thing to fix, and the line under it says why.

**`/rest/v1/health`** on the live site — open it in a browser, no key needed:

```json
{"club":true,"configured":true,"locked":true,"database":true,"schema":true}
```

`configured` is DATABASE_URL present, `database` is the server actually reaching
it, `schema` is the table existing, `locked` is CLUB_KEY set. All four true means
the board is ready. Add your key as an `apikey` header and it also reports how
many records are stored.

**If nothing is reaching the database**, hit **Test connection** in Settings. It
walks the same path a real sync takes — reach the server, read, write, read back
— and names the first thing that fails. The usual answers:

| What it says | What it means |
|---|---|
| Sync is off | The commonest one. Nothing is being sent anywhere until you paste the URL and key and turn it on. The app is happily local until then. |
| Could not reach that address | Wrong URL, the app opened as a `file://` path, or it isn't a Supabase endpoint. **A plain Postgres connection string will never work** — see below. |
| Refused the key | Right server, wrong key. Copy the *anon public* one from Project Settings → API. |
| No club_data table | Right server, schema not run. Paste `supabase/schema.sql` into the SQL editor. |
| Readable but not writable | The policies or grants are missing. Re-running `supabase/schema.sql` fixes both. |

### Why a `DATABASE_URL` alone is never enough

No browser can open a Postgres connection — it's a TCP wire protocol, not HTTP.
So a connection string on its own can never be what the app talks to, however
healthy the database is. Something has to sit in front and speak HTTP. That is
`server.js` on the Railway route, and Supabase's own REST layer on the static
route.

It also means a `DATABASE_URL` must never be handed to the browser: it contains
your password. On Railway it stays in the server process and is never sent to
the page — there's a test asserting no connection string appears in the HTML.

**What the schema does beyond creating a table:** it constrains keys to the
three shapes the app writes, caps each row at 4 KB, clamps the merge clock to
the server's (a phone with its date set to 2099 would otherwise win every merge
forever), and grants no DELETE at all. The same file applies to both setups —
the Supabase-only grants are skipped when there's no `anon` role.

**Be aware:** the anon key lets anyone holding it read and write your table.
That's the deliberate trade for a three-person tracker with no login. The key
lives in each of your browsers, not in this repo — keep it out of anywhere
public. If you ever want it properly locked down, the upgrade is Supabase
magic-link auth plus a policy keyed on `auth.uid()`, which costs each of you a
one-time sign-in.

## The four tabs

| Tab | What's there |
|---|---|
| **Today** | Log the day — steps, weight, active minutes, workout, habit chips, a note. Scroll the date strip to fix up a day you missed. Below it, what all three of you did today. |
| **Board** | The weekly leaderboard, a 4-week show-up grid, and 30-day consistency. Arrow back through past weeks. |
| **Trends** | Daily steps or active minutes as grouped bars against your goal, and everyone's weight over 30 days / 90 days / a year. Every chart has a table view. |
| **Settings** | Who you're signed in as, per-person goals, kg/lb, theme, sharing, backup. |

## Signing in

Opening the app shows a login screen: **Select who you are to record your
data**, and the three of you. Pick yourself and you're in — steps, weight,
workouts and habits are all filed against whoever is signed in.

**Stay signed in on this device** is ticked by default, so you do this once per
phone. Untick it and you're signed in for that browser session only; close it
and the login screen is back. Settings shows who you are and has a **Sign out**
button.

Signing out only forgets who you are on that device. **Every logged day stays
exactly where it is** — the data belongs to the club, not to the browser.

**Personal links.** Settings gives each of you a link ending `?me=arvind`,
`?me=abhinandh` or `?me=sai`. Opening yours signs you straight in, which is the
quick way to set up a new phone. Add *your* link to your home screen and the
icon opens as you. The link signs you in once and then drops out of the address
bar, so a URL copied from there afterwards won't hand your identity to whoever
you send it to. An unrecognised `?me=` falls back to the login screen rather
than silently picking someone.

**This is selection, not authentication.** There is no password, so anyone with
the app can sign in as anyone, and anyone with the anon key can still write to
the table. It stops accidents, not people. If you want the three of you
genuinely unable to edit each other's days, that's Supabase magic-link auth with
policies keyed on `auth.uid()` — a bigger job, and a clean one now that identity
is a single well-defined thing in the code.

## How the points work

Per person, per day:

| | Points |
|---|---|
| Logged anything at all | 2 |
| Hit your step goal | 10 |
| Hit your active-minutes goal | 10 |
| Weighed in | 5 |
| Each habit ticked | 3 |

That's **42 a day**, 294 a week. Showing up is worth more than any single big
number, which is the point — the tracker rewards consistency, not heroics.

A **streak** counts consecutive days with anything logged. It survives until the
day is actually over, so logging tomorrow morning doesn't cost you yesterday.

## WhatsApp

**Today → Share day** and **Board → Share the board** open WhatsApp with the text
already written; you pick the group and hit send. Nothing is sent automatically
and nothing leaves the app until you tap send.

```
*🏆 Accountability Club*
_week of Sep 14 – Sep 20_

🥇 *Sai* · 147 pts
     6/7 days · 65,185 steps · 🔥6
🥈 *Abhinandh* · 143 pts
     5/7 days · 60,685 steps · 🔥2
🥉 *Arvind* · 104 pts
     4/7 days · 27,473 steps · 🔥1

153,343 steps between us, 15/21 days logged.
```

The `⧉` button beside each one copies the same text instead, for anywhere that
isn't WhatsApp. If the app is hosted (not opened from a local file), the board
share includes a link back to it.

### What about a bot that logs for us automatically?

Possible, but it costs more than it looks. Meta's **WhatsApp Groups API** (2026)
does support this — a bot number in the group gets a webhook for every message a
participant sends, so "14k steps, 84.2" could post itself into the tracker.
Groups cap at 8 participants including the bot, so three friends fit fine.

What it would take:

- The group must be **created by the bot** through the API; people join by an
  invite link it generates. An existing group chat can't be adopted.
- An **always-on server** for the webhook. GitHub Pages only serves files — this
  would be a Supabase Edge Function writing to the same `club_data` table.
- A **dedicated phone number** (not a personal WhatsApp) on an Official Business
  Account. Groups aren't available on WhatsApp Business *app* numbers.
- **Per-message billing**, including service messages since 1 Oct 2026.

Unofficial bridges (Baileys and friends) work in an existing group with none of
that setup, but they violate WhatsApp's terms and the number can be banned.

## Your data

Everything lives in your browser's `localStorage` under `ac.club.v1`, and in your
own Supabase project if you turn sharing on. Nothing is sent anywhere else.

**Settings → Your data** exports the lot as JSON and imports a file someone sends
you — imports merge rather than overwrite, keeping whichever copy of each day was
saved most recently. Worth exporting occasionally; clearing site data in your
browser wipes local records.

## Development

```
index.html      markup and the script tags
css/styles.css  design tokens, layout, both themes
js/store.js     records, dates, scoring, streaks, Supabase sync
js/charts.js    the SVG line and bar charts, tooltips, table view
js/share.js     composes the WhatsApp summaries
js/app.js       views, rendering, events
server.js       serves the app and its data; used by `npm start`
supabase/       schema.sql, applied by the server on boot or pasted into Supabase
```

No framework, no bundler, no dependencies at runtime. Charts are hand-rolled SVG
drawn at true pixel size after layout so the labels are the right size on a phone
and on a laptop.

The three person colours were checked for colourblind separation and contrast on
both the light and dark surfaces, so nobody's line disappears.

```sh
npm install && npm test   # drives the real page in a headless browser
```

132 checks across six suites: the UI, sign-in / sign-out and personal links, the
WhatsApp share text, a two-device sync test, the connection diagnostic against
each way the shared board fails, and an end-to-end run of the real `server.js`
against a real Postgres with two browsers talking to it.
That mock keeps rows in memory by default so the suite runs anywhere. To exercise
`supabase/schema.sql` itself, point it at a real Postgres that has the schema
applied:

```sh
./tests/db-fresh.sh                              # throwaway local Postgres, schema applied
SYNC_TEST_PG=1 PGHOST=/tmp/acdb/sock PGPORT=55432 npm test
./tests/db-fresh.sh --stop
```

`db-fresh.sh` also takes a connection string, so you can apply the schema to a
real database without opening the Supabase editor. It only ever creates; add
`--reset` if you also want the rows truncated.

```sh
./tests/db-fresh.sh "$DATABASE_URL"
./tests/db-fresh.sh "$DATABASE_URL" --reset      # wipes club_data first
```

## Adding a fourth person

In `js/store.js`, add to `PEOPLE` (`id`, `name`, `color`, `initials`). Everything
else — cards, leaderboard, charts, the show-up grid — follows from that list.
Pick a colour that stays distinguishable from the other three; the
`dataviz` palette check is what the existing three were chosen with.

Habits and workout types are the `HABITS` and `WORKOUTS` lists in the same file.
