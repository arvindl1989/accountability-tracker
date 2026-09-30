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

1. In this repo: **Settings → Pages → Source: GitHub Actions**. This is the one
   step I can't do for you — it needs repo admin.
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
| **Settings** | Per-person goals, kg/lb, theme, sharing, backup. |

Pick who you are with the name buttons at the top right. Anyone can log from any
device — useful when one of you is nagging the other two.

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

55 checks across three suites: the UI, the WhatsApp share text, and a two-device
sync test that runs both browsers against a stand-in for Supabase's REST API.
That mock keeps rows in memory by default so the suite runs anywhere. To exercise
`supabase/schema.sql` itself, point it at a real Postgres that has the schema
applied:

```sh
SYNC_TEST_PG=1 PGHOST=/path/to/socket PGPORT=5432 npm test
```

## Adding a fourth person

In `js/store.js`, add to `PEOPLE` (`id`, `name`, `color`, `initials`). Everything
else — cards, leaderboard, charts, the show-up grid — follows from that list.
Pick a colour that stays distinguishable from the other three; the
`dataviz` palette check is what the existing three were chosen with.

Habits and workout types are the `HABITS` and `WORKOUTS` lists in the same file.
