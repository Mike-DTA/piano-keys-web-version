# Keys – piano practice web app

Falling-notes piano trainer for Chrome on Android, using your digital piano over USB MIDI (Web MIDI API).

## Run it on your phone
Web MIDI needs a secure context (https or localhost).

**Option A – host it (easiest):** push this folder to a GitHub repo, enable GitHub Pages, open the URL in Chrome on your phone, then menu → *Add to Home screen* / *Install app*.

**Option B – local dev over USB:**
```
npx serve .              # serves on :3000
adb reverse tcp:3000 tcp:3000
```
Then open `http://localhost:3000` in Chrome on the phone (localhost counts as secure). Debug via `chrome://inspect` on your computer.

Connect the piano with a USB-OTG cable, tap **Connect piano**, and allow MIDI access.

## Modes
- **Wait for me** – song pauses at each note/chord until you play it (Simply Piano style).
- **Play along** – song keeps going; notes within ±0.25 s count as hits.
- **Listen** – demo playback with the target keys lit up.

Orange notes = below middle C (left hand), blue = right hand.
Open any `.mid` file and pick which tracks to practice.

## Learn mode
Tap **🎓 Learn** for three courses: *The basics* (8 lessons), *Chords* (8) and *Two hands* (7).
Each lesson has a short explanation, a mini keyboard showing the keys and finger numbers, and a *Listen first* option.
Score 80% to complete a lesson (★ 80%, ★★ 90%, ★★★ 97%). Progress is saved in the browser.
In chord lessons, all the keys of a chord must be held down together.
**Hands: Right / Left** practises one hand while the app plays the other (also works for songs and MIDI files). Only a both-hands run completes a two-hand lesson.

## Adding songs
Edit `BUILTIN` in `index.html`. Notation: tokens separated by spaces; a token is notes joined with `+`, then optional `:beats` to advance (default 1). `R` = rest.
Each note is `NAME[@finger][~beats]`: `@3` = finger number, `~4` = this note's own length (e.g. a held bass note).
`{title:'My song', bpm:90, src:'C4@1+C3@5~4 E4@3 G4@5:2 C4+E4+G4:4 R F4'}`

## Adding lessons
Add an entry to a course in `COURSES`: `{id, title, text:[...], tip, src, bpm, mode:'wait'|'play', together:true, split:60}`.
`split` is the MIDI note where the right hand starts (60 = middle C).

## Tuning
Constants at the top of the script: `LOOK` (seconds visible), `WIN` (hit window), `EARLY` (how early wait mode accepts a note).
