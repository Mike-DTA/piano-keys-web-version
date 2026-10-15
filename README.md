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
| `fonts/` | Bravura music font for the staff (SIL Open Font License) |

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
- **👥 Players:** several people can share one device (e.g. a tablet by the piano). Each player has their own
  lessons, song scores, XP, streak, daily goal and settings. With more than one player the app opens on
  *Who's playing?* (and asks again after 20 minutes away); switch any time from the name button in the menu
  or the avatar in the keyboard bar. Add, rename (with an avatar) or delete players there.
- **🏠 Home:** level & XP, day streak, daily-goal ring, *Today's practice*, continue learning, review.
- **🎓 Lessons:** 58 lessons in 7 courses: Basics, Rhythm, Chords, Scales & keys, Music theory, Two hands, Songs.
  Pass with 80% (★ 80, ★★ 90, ★★★ 97). Chord lessons require all chord keys held together.
  The Lessons screen has a search that also looks inside the lessons, so topics like "waltz" or "F sharp" find them.
  Every lesson intro has **Learn more**: the theory behind it, how to practise, and common mistakes. Reopen it any time
  with **📖 Read lesson** on the result card or the book button in the top bar.
  The **📘 Music theory** course covers the musical alphabet, half/whole steps, intervals, building major scales,
  key signatures and the circle of fifths, how chords are built, Roman numerals, time signatures (6/8),
  the harmonic minor and cadences, each with an exercise.
- **🎵 Songs:** 71 public-domain pieces (children's songs, folk & hymns, holiday, classical — including 30 piano originals from the Mutopia Project), with search and
  filters by level and category, plus a search box per category. Each has right- and left-hand parts; pick hands, Wait or Play along, Listen,
  or the speed trainer. Your best score is saved per song. Also links to the song lessons and the pop chord drills.
- **📁 My songs:** import your own MIDI (`.mid`) or MusicXML (`.musicxml`, `.xml`, `.mxl`) files, e.g. scores you've
  bought or downloaded from MuseScore. They're stored on the device (IndexedDB), shared by all players, with
  per-player scores. MusicXML is the better choice: its two staves set the hands exactly and its fingerings show up.
  For MIDI, two tracks become right and left hand (higher one on the right), otherwise notes split at middle C.
  Pick which parts to play, rename or remove a song from its card. Repeats in MusicXML are played once, as written.
  Imported files never leave the device, so nothing copyrighted gets published with the app.
- **🏋 Practice**
  - *Mixed session* (5–45 min): warm-up → new lessons → review and drills interleaved → a song,
    with a short countdown between exercises and a summary at the end.
  - *Focus session*: same, limited to one topic (basics, rhythm, chords, scales, two hands, ear, songs).
  - *Review*: spaced repetition, so lessons come back after 1, 2, 4, 7, 14, 30, 60 days (sooner if you slip).
  - *Drills*: randomly generated each time: note finder, chord changes, rhythm reading, scale runs,
    hand coordination, play by ear (notes hidden; key shown after 2 misses), pop chords. Wait or play-along mode.
  - *Read the note* (🎼): notes on a real grand staff (treble and bass clef) scroll past a playhead. Find each one
    without hints: a wrong key shows as a red note on the staff, after two tries the key lights up, and played notes
    turn green with their name. Levels: treble C position, treble white keys, bass C position, bass white keys,
    both clefs, sharps and flats. In this view the keyboard can be hidden with the keyboard button in the top bar.
  - *Pop chords*: the progressions behind countless hits (I–V–vi–IV, '50s, vi–IV–I–V, three-chord rock,
    Andalusian, 12-bar blues) with right-hand chords and a left-hand bass note, in a random style each time:
    held, four beats, pop rhythm 3+3+2 or broken chords. Shows well-known songs that use each progression.
  - *Speed trainer*: play-along starting slow; each run ≥ 90% speeds up until your goal speed.
- **📈 Progress:** XP/levels, streaks, practice minutes (14-day chart), per-course stars,
  per-skill accuracy, 26 achievements, recent activity, daily goal setting.
  **Export/Import backup** moves the current player's progress between devices (stored in the browser otherwise).
- **Playback controls:** a timeline under the top bar you can drag (the notes glide along and snap into place
  when you let go), back to start, ±5 seconds (also ← / →, Home), play/pause. Starting partway through is a
  practice run: it doesn't count toward stars or best scores, and its result offers to start from the same spot again.
- **🔖 Saved parts:** save labelled spots in a song or lesson (per player), shown as ticks on the timeline. The 🔖
  button in the top bar opens a quick menu to jump to a part, loop it (until the next saved part), rename or
  delete it. All saved parts are listed on the Songs screen and on each song's card, to start right there.
- **Search:** case and accents don't matter ("fur elise" finds Für Elise), words can be in any order, and
  "F sharp", "F#" and "F♯" mean the same. Song searches also match composer, category, level and saved-part names.
- **📊 Where you make mistakes:** every song card and lesson intro has a heatmap of the song, about one slice per bar,
  coloured by how many mistakes you make there (wrong keys, and missed notes in Play along). Recent plays count most,
  so parts you've fixed cool down. Tap a slice or one of the top trouble spots to loop that part. The heat also tints
  the timeline while you play. Kept per player.
- **🎙 Recordings:** press the record button in the top bar to record yourself, in a song (it starts the song)
  or in free play. Stopping (or the song ending) saves the take for the current player on this device. Replay it
  with the same timing and touch: keys light up green/red as you played them, and in a song the notes move just
  as they did (including Wait-for-me pauses), with the playback controls to pause and scrub. Recordings are listed
  under Songs → Your recordings, and can be downloaded as `.mid` files.
- **Keyboard view:** hands (practise one hand while the app plays the other), speed, 🥁 metronome
  (accent on beat 1, count-in), sound, note names/fingers with adjustable size (Aa off/S/M/L/XL, saved per player), fullscreen.

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
fetched only when opened and cached for offline use by the service worker. Hands are split at middle C (set `split` to change), or
set `hands:'tracks'` when the file has one track per staff (as Mutopia files do) so the upper staff is the right hand.
The metronome clicks quarter notes; for other beat units set `pulse` in quarters, e.g. `meter:2, pulse:1.5` for 6/8.
Only add files you are allowed to share: the composition being old is not enough, since a MIDI sequence can have its
own copyright (Mutopia Project files marked Public Domain are safe).

## Sending songs to Keys by link
Another web app (e.g. a MIDI converter) can hand a song to Keys with a link. Keys imports it into **My songs**
and opens it (after *Who's playing?* if that's showing). Opening the same file again opens the existing copy.

```
https://mike-dta.github.io/piano-keys-web-version/#midi=<the .mid file, base64 or base64url>&title=Song%20name
https://mike-dta.github.io/piano-keys-web-version/#midi=https%3A%2F%2Fexample.com%2Fsong.mid&title=Song%20name
```
Use `#`, not `?`, for file data: the part after `#` is never sent to a server, so links can be long (whole songs)
and nothing is hosted. A file URL only works if its host allows cross-origin downloads (GitHub Pages and
raw.githubusercontent.com do). MusicXML works the same way.

From JavaScript, with the MIDI file as a `Uint8Array`:
```js
function openInKeys(bytes, title){
  let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
  const data=btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');   // base64url
  window.open('https://mike-dta.github.io/piano-keys-web-version/#midi='+data+'&title='+encodeURIComponent(title), 'keys');
}
```
Passing the name `'keys'` reuses the same Keys tab for every song.

## Adding lessons
Add an entry to a course in `COURSES` (content.js), its id to `PATH`, and its theory to `THEORY`
(`{learn:[…], practice:[…], watch:[…]}`, shown under Learn more):
```
{id, title, text:[...], tip, src, bpm, mode:'wait'|'play', together:true, metro:true, meter:3, split:60, skills:['chords']}
```
`split` is the MIDI note where the right hand starts (60 = middle C). `skills` come from `SKILLS`
and drive mastery tracking, focus sessions and which drills unlock.

## Tuning (top of app.js)
`LOOK` (seconds visible), `WIN` (hit window), `EARLY` (wait-mode early window), `PASS`, `INTERVALS` (review days).
