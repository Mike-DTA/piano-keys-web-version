# Keys – piano practice web app

Falling-notes piano trainer for Chrome on Android, using your digital piano over USB MIDI (Web MIDI API).

## Files
| File | What's in it |
|---|---|
| `index.html` | Markup and styles |
| `content.js` | Courses and lessons, skills, learning path |
| `songs.js` | Song library (public domain), loaded only when needed |
| `app.js` | Engine, progress, drills, sessions, screens |
| `sw.js`, `manifest.json`, icons | Install as an app / offline |

To update a hosted copy, upload all files (at least `index.html`, `content.js`, `songs.js`, `app.js`, `sw.js`).

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
- **🎵 Songs:** 35 public-domain pieces (children's songs, folk & hymns, holiday, classical), with search and
  filters by level and category. Each has right- and left-hand parts; pick hands, Wait or Play along, Listen,
  or the speed trainer. Your best score is saved per song. Also links to the song lessons and opens your own `.mid` files.
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

## Adding songs
Add an entry to `SONGS` in `songs.js`:
```
{id:'my-song', title:'My song', by:'Composer, 1850', cat:'folk', level:1, bpm:96, meter:3,
 rh:'E4 E4 G4:2 | ...', lh:'C3:3 | ...'}
```
`rh` and `lh` are the two hands in the notation above; `|` marks bar lines (ignored when playing, but handy for checking
that both hands line up). `bpm` counts the notation's beat unit; for 6/8 or fast pieces write in eighths and set
`pulse` (units per metronome click), e.g. `bpm:180, meter:2, pulse:3`. `level` is 1–3; `cat` is a key of `SONG_CATS`.

**MIDI files:** put them in a `midi/` folder and add `{id, title, by, cat, level, mid:'midi/name.mid'}`. They are
fetched only when opened and cached for offline use by the service worker. Hands are split at middle C (set `split` to change).
Only add files you are allowed to share: the composition being old is not enough, since a MIDI sequence can have its
own copyright (Mutopia Project files marked Public Domain are safe).

## Adding lessons
Add an entry to a course in `COURSES` (content.js) and its id to `PATH`:
```
{id, title, text:[...], tip, src, bpm, mode:'wait'|'play', together:true, metro:true, meter:3, split:60, skills:['chords']}
```
`split` is the MIDI note where the right hand starts (60 = middle C). `skills` come from `SKILLS`
and drive mastery tracking, focus sessions and which drills unlock.

## Tuning (top of app.js)
`LOOK` (seconds visible), `WIN` (hit window), `EARLY` (wait-mode early window), `PASS`, `INTERVALS` (review days).
