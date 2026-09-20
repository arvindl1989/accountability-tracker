# Tests

End-to-end checks that drive the real page in a headless browser: logging a day,
autosave not stealing your caret, charts rendering, the leaderboard, export.

```sh
npm install          # installs playwright
npm test             # serves the app and runs the checks
```

`seed.js` generates ~6 weeks of plausible data so the charts have something to draw.
