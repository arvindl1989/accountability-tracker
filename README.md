# Accountability Club

A small daily tracker for **Arvind, Abhinandh and Sai** — steps, weight, active
minutes, workouts and habits, with a weekly leaderboard so nobody quietly
disappears for three weeks.

No accounts, no app store, no build step. One HTML page, four small JS files.

---

## Going live

Two independent things, in this order. The first gets you a URL; the second is
what makes the board shared. Neither needs the other.

### 1. Put it on the web (5 minutes, no database)

1. In this repo: **Settings → Pages → Source: GitHub Actions**.

   **This is mandatory and nothing works without it.** Until it's done, every
   deploy fails on its first step with *"Get Pages site failed"* and the site
   serves nothing at all. It can't be automated: creating a Pages site needs
   admin rights that the Actions token is never granted, so the workflow gets
   *"Resource not accessible by integration"* if it tries.
2. Push anything, or run the **Deploy to GitHub Pages** workflow by hand from
   the Actions tab.
3. You'll get `https://arvindl1989.github.io/accountability-tracker/`. On your
   phone, *Share → Add to Home Screen* makes it behave like an app.

At this point all three of you can use it — but each on your own device, with
your own data. That's already usable.

*Optional tidy-up:* this repo's default branch is currently
`claude/gallant-brahmagupta-wf1kip`. **Settings → Branches** lets you rename it
to `main`; the deploy workflow is set up to work either way.

### 2. Make it a shared board (Postgres)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the whole of
   [`supabase/schema.sql`](supabase/schema.sql), and run it. It ends by printing
   the table, so you'll see it worked. Re-running it later is safe.
3. **Project Settings → API**: copy the **Project URL** and the **anon public**
   key.
4. Each of you pastes both into **Settings → Shared board** in the app and taps
   *Turn on & sync*.

Everyone's edits then merge on open, on tab focus, and shortly after you log
something. The newest write wins.

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

### A plain Postgres is not enough

The app talks to `/rest/v1/club_data` over HTTPS — that's **PostgREST**, the
HTTP layer Supabase puts in front of Postgres. It does not speak the Postgres
wire protocol and cannot open a database connection from a browser, because no
browser can.

So a `DATABASE_URL` from Railway, Neon, RDS or anywhere else won't work on its
own, however healthy the database is. Either use Supabase, which bundles
PostgREST, or run PostgREST yourself in front of your own Postgres and point the
app at that.

**What the schema does beyond creating a table:** it constrains keys to the
three shapes the app writes, caps each row at 4 KB, clamps the merge clock to
the server's (a phone with its date set to 2099 would otherwise win every merge
forever), and grants no DELETE at all — so even someone holding the key can't
erase your history.

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
supabase/       schema.sql for the shared board
```

No framework, no bundler, no dependencies at runtime. Charts are hand-rolled SVG
drawn at true pixel size after layout so the labels are the right size on a phone
and on a laptop.

The three person colours were checked for colourblind separation and contrast on
both the light and dark surfaces, so nobody's line disappears.

```sh
npm install && npm test   # drives the real page in a headless browser
```

104 checks across five suites: the UI, sign-in / sign-out and personal links,
the WhatsApp share text, a two-device sync test that runs both browsers against
a stand-in for Supabase's REST API, and the connection diagnostic against each
way the shared board actually fails.
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
