# Accountability Club

A small daily tracker for **Arvind, Abhinandh and Sai** — steps, weight, active
minutes, workouts and habits, with a weekly leaderboard so nobody quietly
disappears for three weeks.

No accounts, no app store, no build step. One HTML page, three JS files.

---

## Using it

Open `index.html` — that's it. It works offline and remembers everything in your
browser.

To get it on your phones, turn on GitHub Pages for this repo
(**Settings → Pages → Source: GitHub Actions**) and push. The included workflow
publishes the site, and you'll get a URL like
`https://arvindl1989.github.io/accountability-tracker/`. On iOS, *Share → Add to
Home Screen* makes it behave like an app.

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

## Sharing one board between the three of you (optional)

Out of the box the app is private to your own device. To see each other's
numbers, point all three of you at the same free Supabase project:

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty).
2. In the SQL editor, run:

   ```sql
   create table if not exists public.club_data (
     key        text primary key,
     value      jsonb  not null,
     updated_ms bigint not null default 0
   );

   alter table public.club_data enable row level security;

   create policy "club can read"   on public.club_data for select using (true);
   create policy "club can insert" on public.club_data for insert with check (true);
   create policy "club can update" on public.club_data for update using (true) with check (true);
   ```

3. In **Project Settings → API**, copy the **Project URL** and the **anon public**
   key.
4. Each of you pastes both into **Settings → Shared board** and hits
   *Turn on & sync*.

Then edits sync when you open the app, when you switch back to the tab, and a
moment after you log something. Conflicts resolve by whoever saved last.

**Be aware:** those policies let anyone holding the anon key read and write the
table. That's a deliberate trade for a three-person tracker with no login — but
keep the key in the app's Settings screen, not in this repo, and don't post it
anywhere public.

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
```

No framework, no bundler, no dependencies at runtime. Charts are hand-rolled SVG
drawn at true pixel size after layout so the labels are the right size on a phone
and on a laptop.

The three person colours were checked for colourblind separation and contrast on
both the light and dark surfaces, so nobody's line disappears.

```sh
npm install && npm test   # drives the real page in a headless browser
```

## Adding a fourth person

In `js/store.js`, add to `PEOPLE` (`id`, `name`, `color`, `initials`). Everything
else — cards, leaderboard, charts, the show-up grid — follows from that list.
Pick a colour that stays distinguishable from the other three; the
`dataviz` palette check is what the existing three were chosen with.

Habits and workout types are the `HABITS` and `WORKOUTS` lists in the same file.
