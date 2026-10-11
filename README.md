# Keys – piano practice web app

Falling-notes piano trainer for Chrome on Android, using your digital piano over USB MIDI (Web MIDI API).

## Files
| File | What's in it |
|---|---|
| `index.html` | Markup and styles |
| `content.js` | All songs, courses and lessons, skills, learning path (edit this to add content) |
| `app.js` | Engine, progress, drills, sessions, screens |
| `sw.js`, `manifest.json`, icons | Install as an app / offline |

To update a hosted copy, upload all files (at least `index.html`, `content.js`, `app.js`, `sw.js`).

## Run it on your phone
Web MIDI needs a secure context (https or localhost).

**Option A (host it):** push this folder to a GitHub repo, enable GitHub Pages, open the URL in Chrome on your phone, then menu → *Install app*.

**Option B (local dev over USB):**
```
npx serve .              # serves on :3000
adb reverse tcp:3000 tcp:3000
```
Then open `http://localhost:3000` in Chrome on the phone. Debug via `chrome://inspect`.

Connect the piano with a USB-OTG cable and allow MIDI access.

## What's in the app
- **🏠 Home:** level & XP, day streak, daily-goal ring, *Today's practice*, continue learning, review.
- **🎓 Lessons:** 48 lessons in 6 courses: Basics, Rhythm, Chords, Scales & keys, Two hands, Songs.
  Pass with 80% (★ 80, ★★ 90, ★★★ 97). Chord lessons require all chord keys held together.
- **🏋 Practice**
  - *Mixed session* (5–45 min): warm-up → new lessons → review and drills interleaved → a song,
    with a short countdown between exercises and a summary at the end.
  - *Focus session*: same, limited to one topic (basics, rhythm, chords, scales, two hands, ear, songs).
  - *Review*: spaced repetition, so lessons come back after 1, 2, 4, 7, 14, 30, 60 days (sooner if you slip).
  - *Drills*: randomly generated each time: note finder, chord changes, rhythm reading, scale runs,
    hand coordination, play by ear (notes hidden; key shown after 2 misses). Wait or play-along mode.
  - *Speed trainer*: play-along starting slow; each run ≥ 90% speeds up until your goal speed.
- **📈 Progress:** XP/levels, streaks, practice minutes (14-day chart), per-course stars,
  per-skill accuracy, 26 achievements, recent activity, daily goal setting.
  **Export/Import backup** moves progress between devices (stored in the browser otherwise).
- **Keyboard view:** hands (practise one hand while the app plays the other), speed, 🥁 metronome
  (accent on beat 1, count-in), sound, note names/fingers, fullscreen, open `.mid` files.

## Notation (content.js)
Tokens separated by spaces; a token is notes joined with `+`, then optional `:beats` to advance (default 1). `R` = rest.
Each note is `NAME[@finger][~beats]`; prefix a token with `[Am]` to show a chord name.
```
{title:'My song', bpm:90, src:'[C]C4@1+C3@5~4 E4@3 G4@5:2 C4+E4+G4:4 R F4'}
```

## Adding lessons
Add an entry to a course in `COURSES` (content.js) and its id to `PATH`:
```
{id, title, text:[...], tip, src, bpm, mode:'wait'|'play', together:true, metro:true, meter:3, split:60, skills:['chords']}
```
`split` is the MIDI note where the right hand starts (60 = middle C). `skills` come from `SKILLS`
and drive mastery tracking, focus sessions and which drills unlock.

## Tuning (top of app.js)
`LOOK` (seconds visible), `WIN` (hit window), `EARLY` (wait-mode early window), `PASS`, `INTERVALS` (review days).
