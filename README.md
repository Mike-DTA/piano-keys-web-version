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

## Adding songs
Edit `BUILTIN` in `index.html`. Notation: `NOTE[:beats]`, chords with `+`, `R` for a rest:
`{title:'My song', bpm:90, src:'C4 E4 G4:2 C4+E4+G4:4 R F4'}`

## Tuning
Constants at the top of the script: `LOOK` (seconds visible), `WIN` (hit window), `EARLY` (how early wait mode accepts a note).
# piano-keys-web-version
