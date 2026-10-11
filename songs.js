'use strict';
/* =====================================================================
   Keys — song library (public-domain music, arrangements written for Keys)
   ---------------------------------------------------------------------
   Loaded on demand the first time the Songs screen (or a song) is needed,
   and each song's notes are only parsed when it is played.

   Fields: id, title, by, cat (see SONG_CATS), level (1 easy · 2 medium · 3 harder),
     bpm (counting units per minute), meter (clicks per bar), pulse (units per
     metronome click, default 1), rh / lh (right / left hand, same notation as
     content.js; "|" bar lines are ignored when playing but checked by tools),
     or mid: 'midi/file.mid' to load a standard MIDI file instead.
   ===================================================================== */

(()=>{
self.SONG_CATS = {
  kids:      '🧸 Children\'s songs',
  folk:      '🌍 Folk, hymns & anthems',
  holiday:   '🎄 Holiday',
  classical: '🎻 Classical',
};

// Bach, Prelude in C (WTC I): each bar is one broken chord, played twice
const prelude = bars => ({
  rh: bars.map(b=>{ const n=b.split(' '), h=`R:2 ${n[2]} ${n[3]} ${n[4]} ${n[2]} ${n[3]} ${n[4]}`; return h+' '+h; }).join(' | ') + ' | E4+G4+C5:16',
  lh: bars.map(b=>{ const n=b.split(' '), h=`${n[0]}~8:1 ${n[1]}~7:7`; return h+' '+h; }).join(' | ') + ' | C2+C3:16',
});
const twice = s => s+' | '+s;

const KOROBEINIKI = 'E5:2 B4 C5 D5:2 C5 B4 | A4:2 A4 C5 E5:2 D5 C5 | B4:3 C5 D5:2 E5:2 | C5:2 A4:2 A4:4 | R D5:2 F5 A5:2 G5 F5 | E5:3 C5 E5:2 D5 C5 | B4:2 B4 C5 D5:2 E5:2 | C5:2 A4:2 A4:4';
const MOUNTAIN_KING = 'B3 C#4 D4 E4 F#4 D4 F#4:2 | F4 C#4 F4:2 E4 C4 E4:2 | B3 C#4 D4 E4 F#4 D4 F#4 B4 | A4 F#4 D4 F#4 A4:4';
const FUR_ELISE_RH = 'E5 D#5 E5 B4 D5 C5 | A4:2 R C4 E4 A4 | B4:2 R E4 G#4 B4 | C5:2 R E4 E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:2 R C4 E4 A4 | B4:2 R E4 C5 B4';
const FUR_ELISE_LH = 'R:6 | A2 E3 A3 R:3 | E2 E3 G#3 R:3 | A2 E3 A3 R:3 | R:6 | A2 E3 A3 R:3 | E2 E3 G#3 R:3';
const CANON = {
  v1: 'F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2',
  v2: 'D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2',
  v3: 'D4 F#4 A4 G4 | F#4 D4 F#4 E4 | D4 B3 D4 A4 | G4 B4 A4 G4',
  bass: 'D3:2 A2:2 | B2:2 F#2:2 | G2:2 D2:2 | G2:2 A2:2',
};
const MOON_1 = 'G#3 C#4 E4 G#3 C#4 E4 G#3 C#4 E4 G#3 C#4 E4';

self.SONGS = [
/* ---------------- Children's songs ---------------- */
{id:'hot-cross-buns', title:'Hot Cross Buns', by:'Traditional (English)', cat:'kids', level:1, bpm:100,
 rh:'E4@3 D4@2 C4@1:2 | E4 D4 C4:2 | C4:.5 C4:.5 C4:.5 C4:.5 D4:.5 D4:.5 D4:.5 D4:.5 | E4 D4 C4:2',
 lh:'C3:4 | C3:4 | C3:2 G2:2 | C3 G2 C3:2'},
{id:'mary-lamb', title:'Mary Had a Little Lamb', by:'Traditional (American)', cat:'kids', level:1, bpm:100,
 rh:'E4@3 D4@2 C4@1 D4 | E4 E4 E4:2 | D4 D4 D4:2 | E4 G4@5 G4:2 | E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:4',
 lh:'C3:4 | C3:4 | G2:4 | C3:4 | C3:4 | C3:4 | G2:4 | C3:4'},
{id:'twinkle', title:'Twinkle, Twinkle, Little Star', by:'Traditional (French)', cat:'kids', level:1, bpm:96,
 rh:'C4@1 C4 G4@5 G4 | A4 A4 G4:2 | F4@4 F4 E4@3 E4 | D4@2 D4 C4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2',
 lh:'C3:4 | F3:2 C3:2 | F3:2 C3:2 | G2:2 C3:2 | C3:2 F3:2 | C3:2 G2:2 | C3:2 F3:2 | C3:2 G2:2 | C3:4 | F3:2 C3:2 | F3:2 C3:2 | G2:2 C3:2'},
{id:'london-bridge', title:'London Bridge Is Falling Down', by:'Traditional (English)', cat:'kids', level:1, bpm:104,
 rh:'G4:1.5 A4:.5 G4 F4 | E4 F4 G4:2 | D4 E4 F4:2 | E4 F4 G4:2 | G4:1.5 A4:.5 G4 F4 | E4 F4 G4:2 | D4:2 G4:2 | E4 C4:3',
 lh:'C3:4 | C3:4 | G2:4 | C3:4 | C3:4 | C3:4 | G2:4 | C3:4'},
{id:'au-clair', title:'Au Clair de la Lune', by:'Traditional (French)', cat:'kids', level:1, bpm:100,
 rh:'C4 C4 C4 D4 | E4:2 D4:2 | C4 E4 D4 D4 | C4:4 | C4 C4 C4 D4 | E4:2 D4:2 | C4 E4 D4 D4 | C4:4 | D4 D4 D4 D4 | A3:2 A3:2 | D4 C4 B3 A3 | G3:4 | C4 C4 C4 D4 | E4:2 D4:2 | C4 E4 D4 D4 | C4:4',
 lh:'C3:4 | C3:2 G2:2 | C3:2 G2:2 | C3:4 | C3:4 | C3:2 G2:2 | C3:2 G2:2 | C3:4 | G2:4 | D3:4 | G2:2 D3:2 | G2:4 | C3:4 | C3:2 G2:2 | C3:2 G2:2 | C3:4'},
{id:'row-boat', title:'Row, Row, Row Your Boat', by:'Traditional', cat:'kids', level:1, bpm:180, meter:2, pulse:3,
 rh:'C4:3 C4:3 | C4:2 D4:1 E4:3 | E4:2 D4:1 E4:2 F4:1 | G4:6 | C5 C5 C5 G4 G4 G4 | E4 E4 E4 C4 C4 C4 | G4:2 F4:1 E4:2 D4:1 | C4:6',
 lh:'C3:6 | C3:6 | C3:3 G2:3 | C3:6 | C3:6 | C3:6 | G2:6 | C3:6'},
{id:'old-macdonald', title:'Old MacDonald Had a Farm', by:'Traditional', cat:'kids', level:1, bpm:112,
 rh:'G4 G4 G4 D4 | E4 E4 D4:2 | B4 B4 A4 A4 | G4:3 D4 | G4 G4 G4 D4 | E4 E4 D4:2 | B4 B4 A4 A4 | G4:3 D4:.5 D4:.5 | G4 G4 G4 D4:.5 D4:.5 | G4 G4 G4:2 | G4:.5 G4:.5 G4 G4:.5 G4:.5 G4 | G4:.5 G4:.5 G4:.5 G4:.5 G4 G4 | G4 G4 G4 D4 | E4 E4 D4:2 | B4 B4 A4 A4 | G4:4',
 lh:'G2:4 | C3:2 G2:2 | G2:2 D3:2 | G2:4 | G2:4 | C3:2 G2:2 | G2:2 D3:2 | G2:4 | G2:4 | G2:4 | G2:4 | G2:4 | G2:4 | C3:2 G2:2 | G2:2 D3:2 | G2:4'},
{id:'three-blind-mice', title:'Three Blind Mice', by:'Traditional (English)', cat:'kids', level:1, bpm:168, meter:2, pulse:3,
 rh:'E4:3 D4:3 | C4:6 | E4:3 D4:3 | C4:6 | G4:3 F4:2 F4:1 | E4:6 | G4:3 F4:2 F4:1 | E4:5 G4:1 | C5:2 C5:1 B4:1 A4:1 B4:1 | C5:2 G4:1 G4:2 G4:1 | C5 C5 C5 B4 A4 B4 | C5:2 G4:1 G4:2 G4:1 | C5 C5 C5 B4 A4 B4 | C5:2 G4:1 G4:2 F4:1 | E4:3 D4:3 | C4:6',
 lh:'C3:3 G2:3 | C3:6 | C3:3 G2:3 | C3:6 | G2:6 | C3:6 | G2:6 | C3:6 | C3:3 G2:3 | C3:6 | C3:3 G2:3 | C3:6 | C3:3 G2:3 | C3:3 G2:3 | C3:3 G2:3 | C3:6'},
{id:'chopsticks', title:'Chopsticks', by:'Euphemia Allen, 1877', cat:'kids', level:1, bpm:160, meter:3,
 rh:'G4 G4 G4 | G4 G4 G4 | G4 G4 G4 | G4 G4 G4 | B4 B4 B4 | B4 B4 B4 | C5 C5 C5 | C5 B4 A4 | G4 G4 G4 | G4 G4 G4 | G4 G4 G4 | G4 G4 G4 | B4 B4 B4 | B4 B4 B4 | C5 C5 C5 | C5:3',
 lh:'F4 F4 F4 | F4 F4 F4 | E4 E4 E4 | E4 E4 E4 | D4 D4 D4 | D4 D4 D4 | C4 C4 C4 | C4 D4 E4 | F4 F4 F4 | F4 F4 F4 | E4 E4 E4 | E4 E4 E4 | D4 D4 D4 | D4 D4 D4 | C4 C4 C4 | C4:3'},
{id:'westminster', title:'Westminster Chimes', by:'Traditional, 1793', cat:'kids', level:1, bpm:80, meter:3,
 rh:'C4 E4 D4 | G3:3 | C4 D4 E4 | C4:3 | E4 C4 D4 | G3:3 | G3 D4 E4 | C4:3 | R:3 | R:3 | R:3 | R:3',
 lh:'R:3 | R:3 | R:3 | R:3 | R:3 | R:3 | R:3 | R:3 | C3:3 | C3:3 | C3:3 | C3:3'},

/* ---------------- Folk, hymns & anthems ---------------- */
{id:'yankee-doodle', title:'Yankee Doodle', by:'Traditional (American)', cat:'folk', level:2, bpm:120,
 rh:'C5 C5 D5 E5 | C5 E5 D5 G4 | C5 C5 D5 E5 | C5:2 B4:2 | C5 C5 D5 E5 | F5 E5 D5 C5 | B4 G4 A4 B4 | C5:2 C5:2 | A4:1.5 B4:.5 A4 G4 | A4 B4 C5:2 | G4:1.5 A4:.5 G4 F4 | E4:2 G4:2 | A4:1.5 B4:.5 A4 G4 | A4 B4 C5 A4 | G4 C5 B4 D5 | C5:2 C5:2',
 lh:'C3:4 | C3:2 G2:2 | C3:4 | C3:2 G2:2 | C3:4 | F3:2 C3:2 | G2:4 | C3:4 | F3:4 | F3:2 C3:2 | C3:4 | C3:4 | F3:4 | F3:4 | G2:4 | C3:4'},
{id:'oh-susanna', title:'Oh! Susanna', by:'Stephen Foster, 1848', cat:'folk', level:2, bpm:112,
 rh:'C4:.5 D4:.5 | E4 G4 G4:1.5 A4:.5 | G4 E4 C4:1.5 D4:.5 | E4 E4 D4 C4 | D4:3 C4:.5 D4:.5 | E4 G4 G4:1.5 A4:.5 | G4 E4 C4:1.5 D4:.5 | E4 E4 D4 D4 | C4:4 | F4:2 F4:2 | A4 A4:2 A4 | G4 G4 E4 C4 | D4:3 C4:.5 D4:.5 | E4 G4 G4:1.5 A4:.5 | G4 E4 C4:1.5 D4:.5 | E4 E4 D4 D4 | C4:3',
 lh:'R:1 | C3:4 | C3:4 | C3:4 | G2:4 | C3:4 | C3:4 | G2:4 | C3:4 | F3:4 | F3:4 | C3:4 | G2:4 | C3:4 | C3:4 | G2:4 | C3:3'},
{id:'clementine', title:'Oh My Darling, Clementine', by:'Traditional (American)', cat:'folk', level:1, bpm:100, meter:3,
 rh:'C4:.5 C4:.5 | C4 G3 E4:.5 E4:.5 | E4 C4 C4:.5 E4:.5 | G4:1.5 F4:.5 E4:.5 D4:.5 | D4:2 D4:.5 E4:.5 | F4 F4 E4:.5 D4:.5 | E4 C4 C4:.5 E4:.5 | D4:1.5 G3:.5 B3:.5 D4:.5 | C4:2 C4:.5 C4:.5 | C4 G3 E4:.5 E4:.5 | E4 C4 C4:.5 E4:.5 | G4:1.5 F4:.5 E4:.5 D4:.5 | D4:2 D4:.5 E4:.5 | F4 F4 E4:.5 D4:.5 | E4 C4 C4:.5 E4:.5 | D4:1.5 G3:.5 B3:.5 D4:.5 | C4:2',
 lh:'R:1 | C3:3 | C3:3 | G2:3 | G2:3 | G2:3 | C3:3 | G2:3 | C3:3 | C3:3 | C3:3 | G2:3 | G2:3 | G2:3 | C3:3 | G2:3 | C3:2'},
{id:'drunken-sailor', title:'What Shall We Do with the Drunken Sailor', by:'Traditional sea shanty', cat:'folk', level:2, bpm:116,
 rh:'A4 A4:.5 A4:.5 A4 A4:.5 A4:.5 | A4 D4 F4 A4 | G4 G4:.5 G4:.5 G4 G4:.5 G4:.5 | G4 C4 E4 G4 | A4 A4:.5 A4:.5 A4 A4:.5 A4:.5 | A4 B4 C5 D5 | C5 A4 G4 E4 | D4:2 D4:2 | A4:2 A4:2 | A4 D4 F4 A4 | G4:2 G4:2 | G4 C4 E4 G4 | A4:2 A4:2 | A4 B4 C5 D5 | C5 A4 G4 E4 | D4:2 D4:2',
 lh:'D3:4 | D3:4 | C3:4 | C3:4 | D3:4 | D3:4 | C3:4 | D3:4 | D3:4 | D3:4 | C3:4 | C3:4 | D3:4 | D3:4 | C3:4 | D3:4'},
{id:'auld-lang-syne', title:'Auld Lang Syne', by:'Traditional (Scottish)', cat:'folk', level:2, bpm:84,
 rh:'G3 | C4:1.5 C4:.5 C4 E4 | D4:1.5 C4:.5 D4 E4 | C4:1.5 C4:.5 E4 G4 | A4:3 A4 | G4:1.5 E4:.5 E4 C4 | D4:1.5 C4:.5 D4 E4 | C4:1.5 A3:.5 A3 G3 | C4:3 A4 | G4:1.5 E4:.5 E4 C4 | D4:1.5 C4:.5 D4 A4 | G4:1.5 E4:.5 E4 G4 | A4:3 C5 | G4:1.5 E4:.5 E4 C4 | D4:1.5 C4:.5 D4 E4 | C4:1.5 A3:.5 A3 G3 | C4:3',
 lh:'R:1 | C3:4 | G2:4 | C3:4 | F3:4 | C3:4 | G2:4 | F3:2 G2:2 | C3:4 | C3:4 | G2:4 | C3:4 | F3:4 | C3:4 | G2:4 | F3:2 G2:2 | C3:3'},
{id:'amazing-grace', title:'Amazing Grace', by:'Traditional hymn (New Britain)', cat:'folk', level:2, bpm:84, meter:3,
 rh:'D4 | G4:2 B4:.5 G4:.5 | B4:2 A4 | G4:2 E4 | D4:2 D4 | G4:2 B4:.5 G4:.5 | B4:2 A4:.5 B4:.5 | D5:3 | D5:2 B4 | D5:2 B4:.5 G4:.5 | B4:2 A4 | G4:2 E4 | D4:2 D4 | G4:2 B4:.5 G4:.5 | B4:2 A4 | G4:3 | G4:2',
 lh:'R:1 | G2:3 | G2:3 | C3:3 | G2:3 | G2:3 | G2:3 | D3:3 | D3:3 | G2:3 | G2:3 | C3:3 | G2:3 | G2:3 | D3:3 | G2:3 | G2:2'},
{id:'greensleeves', title:'Greensleeves', by:'Traditional (English)', cat:'folk', level:3, bpm:100, meter:3,
 rh:'A4 | C5:2 D5 | E5:1.5 F5:.5 E5 | D5:2 B4 | G4:1.5 A4:.5 B4 | C5:2 A4 | A4:1.5 G#4:.5 A4 | B4:2 G#4 | E4:2 A4 | C5:2 D5 | E5:1.5 F5:.5 E5 | D5:2 B4 | G4:1.5 A4:.5 B4 | C5:1.5 B4:.5 A4 | G#4:1.5 F#4:.5 G#4 | A4~6:3 | R:3 | '+
    'G5:3 | G5:1.5 F#5:.5 E5 | D5:2 B4 | G4:1.5 A4:.5 B4 | C5:2 A4 | A4:1.5 G#4:.5 A4 | B4:2 G#4 | E4:3 | G5:3 | G5:1.5 F#5:.5 E5 | D5:2 B4 | G4:1.5 A4:.5 B4 | C5:1.5 B4:.5 A4 | G#4:1.5 F#4:.5 G#4 | A4~5:3 | R:2',
 lh:'R:1 | A3:3 | C3:3 | G3:3 | E3:3 | A3:3 | A3:3 | E3:3 | E3:3 | A3:3 | C3:3 | G3:3 | E3:3 | A3:3 | E3:3 | A3:3 | A3:3 | '+
    'C3:3 | G3:3 | G3:3 | E3:3 | A3:3 | A3:3 | E3:3 | E3:3 | C3:3 | G3:3 | G3:3 | E3:3 | A3:3 | E3:3 | A3:3 | A3:2'},
{id:'god-save-the-king', title:'God Save the King / My Country, \'Tis of Thee', by:'Traditional anthem', cat:'folk', level:2, bpm:88, meter:3,
 rh:'G4 G4 A4 | F#4:1.5 G4:.5 A4 | B4 B4 C5 | B4:1.5 A4:.5 G4 | A4 G4 F#4 | G4:3 | D5 D5 D5 | D5:1.5 C5:.5 B4 | C5 C5 C5 | C5:1.5 B4:.5 A4 | B4 C5:.5 B4:.5 A4:.5 G4:.5 | B4:1.5 C5:.5 D5 | E5:.5 C5:.5 B4 A4 | G4:3',
 lh:'G2:3 | D3:3 | G2:3 | G2:3 | D3:3 | G2:3 | G2:3 | G2:3 | D3:3 | D3:3 | G2:3 | G2:3 | C3 D3:2 | G2:3'},
{id:'sakura', title:'Sakura Sakura', by:'Traditional (Japanese)', cat:'folk', level:2, bpm:72,
 rh:'A4 A4 B4:2 | A4 A4 B4:2 | A4 B4 C5 B4 | A4 B4:.5 A4:.5 F4:2 | E4 C4 E4 F4 | E4 E4:.5 C4:.5 B3:2 | A4 B4 C5 B4 | A4 B4:.5 A4:.5 F4:2 | E4 C4 E4 F4 | E4 E4:.5 C4:.5 B3:2 | A4 A4 B4:2 | A4 A4 B4:2 | E4 F4 B4:.5 A4:.5 F4 | E4:4',
 lh:'A2+E3:4 | A2+E3:4 | A2+E3:4 | D3+A3:4 | A2+E3:4 | E2+B2:4 | A2+E3:4 | D3+A3:4 | A2+E3:4 | E2+B2:4 | A2+E3:4 | A2+E3:4 | D3+A3:4 | E2+B2:4'},
{id:'korobeiniki', title:'Korobeiniki', by:'Traditional (Russian)', cat:'folk', level:2, bpm:220, meter:4, pulse:2,
 rh:twice(KOROBEINIKI),
 lh:twice('E3:8 | A2:8 | E3:8 | A2:8 | D3:8 | C3:8 | E3:8 | A2:8')},

/* ---------------- Holiday ---------------- */
{id:'jingle-bells', title:'Jingle Bells (chorus)', by:'James Lord Pierpont, 1857', cat:'holiday', level:1, bpm:120,
 rh:'E4 E4 E4:2 | E4 E4 E4:2 | E4 G4 C4:1.5 D4:.5 | E4:4 | F4 F4 F4:1.5 F4:.5 | F4 E4 E4 E4:.5 E4:.5 | E4 D4 D4 E4 | D4:2 G4:2 | E4 E4 E4:2 | E4 E4 E4:2 | E4 G4 C4:1.5 D4:.5 | E4:4 | F4 F4 F4:1.5 F4:.5 | F4 E4 E4 E4:.5 E4:.5 | G4 G4 F4 D4 | C4:4',
 lh:'C3:4 | C3:4 | C3:4 | C3:4 | F3:4 | C3:4 | D3:4 | G2:4 | C3:4 | C3:4 | C3:4 | C3:4 | F3:4 | C3:4 | G2:4 | C3:4'},
{id:'silent-night', title:'Silent Night', by:'Franz Xaver Gruber, 1818', cat:'holiday', level:2, bpm:150, meter:2, pulse:3,
 rh:'G4:3 A4:1 G4:2 | E4:6 | G4:3 A4:1 G4:2 | E4:6 | D5:4 D5:2 | B4:6 | C5:4 C5:2 | G4:6 | A4:4 A4:2 | C5:3 B4:1 A4:2 | G4:3 A4:1 G4:2 | E4:6 | A4:4 A4:2 | C5:3 B4:1 A4:2 | G4:3 A4:1 G4:2 | E4:6 | D5:4 D5:2 | F5:3 D5:1 B4:2 | C5:6 | E5:6 | C5:3 G4:1 E4:2 | G4:3 F4:1 D4:2 | C4~12:6 | R:6',
 lh:'C3:6 | C3:6 | C3:6 | C3:6 | G2:6 | G2:6 | C3:6 | C3:6 | F3:6 | F3:6 | C3:6 | C3:6 | F3:6 | F3:6 | C3:6 | C3:6 | G2:6 | G2:6 | C3:6 | C3:6 | C3:6 | G2:6 | C3:6 | C3:6'},
{id:'joy-to-the-world', title:'Joy to the World', by:'Lowell Mason after Handel, 1839', cat:'holiday', level:2, bpm:100,
 rh:'C5:2 B4:1.5 A4:.5 | G4:3 F4 | E4:2 D4:2 | C4:3 G4 | A4:3 A4 | B4:3 B4 | C5:3 C5 | C5 B4 A4 G4 | G4:1.5 F4:.5 E4 C5 | C5 B4 A4 G4 | G4:1.5 F4:.5 E4 E4 | E4 E4 E4 E4:.5 F4:.5 | G4:3 F4:.5 E4:.5 | D4 D4 D4 D4:.5 E4:.5 | F4:3 E4:.5 D4:.5 | C4 C5:2 A4 | G4:1.5 F4:.5 E4 F4 | E4:2 D4:2 | C4:4',
 lh:'C3:4 | C3:2 F3:2 | G2:4 | C3:4 | F3:4 | G2:4 | C3:4 | C3:4 | C3:4 | C3:4 | C3:4 | C3:4 | C3:4 | G2:4 | G2:4 | C3:2 F3:2 | C3:2 G2:2 | G2:4 | C3:4'},
{id:'we-wish-you', title:'We Wish You a Merry Christmas', by:'Traditional (English)', cat:'holiday', level:2, bpm:132, meter:3,
 rh:'G4 | C5 C5:.5 D5:.5 C5:.5 B4:.5 | A4 A4 A4 | D5 D5:.5 E5:.5 D5:.5 C5:.5 | B4 G4 G4 | E5 E5:.5 F5:.5 E5:.5 D5:.5 | C5 A4 G4:.5 G4:.5 | A4 D5 B4 | C5:2 G4 | C5 C5 C5 | B4:2 B4 | C5 B4 A4 | G4:2 D5 | E5 D5 C5 | G5 G4 G4:.5 G4:.5 | A4 D5 B4 | C5:2',
 lh:'R:1 | C3:3 | F3:3 | D3:3 | G2:3 | E3:3 | A2:3 | F2 G2:2 | C3:3 | C3:3 | G2:3 | F3:3 | C3:3 | C3:3 | C3:3 | F2 G2:2 | C3:2'},
{id:'deck-the-halls', title:'Deck the Halls', by:'Traditional (Welsh)', cat:'holiday', level:2, bpm:112,
 rh:'G4:1.5 F4:.5 E4 D4 | C4 D4 E4 C4 | D4:.5 E4:.5 F4:.5 D4:.5 E4:1.5 D4:.5 | C4 B3 C4:2 | G4:1.5 F4:.5 E4 D4 | C4 D4 E4 C4 | D4:.5 E4:.5 F4:.5 D4:.5 E4:1.5 D4:.5 | C4 B3 C4:2 | D4:1.5 E4:.5 F4 D4 | E4:1.5 F4:.5 G4 D4 | E4:.5 F#4:.5 G4 A4:.5 B4:.5 C5 | B4 A4 G4:2 | G4:1.5 F4:.5 E4 D4 | C4 D4 E4 C4 | A4:.5 A4:.5 A4:.5 A4:.5 G4:1.5 F4:.5 | E4 D4 C4:2',
 lh:'C3:4 | C3:4 | G2:2 C3:2 | G2:2 C3:2 | C3:4 | C3:4 | G2:2 C3:2 | G2:2 C3:2 | G2:4 | C3:2 G2:2 | C3:2 D3:2 | G2:4 | C3:4 | C3:4 | F3:2 C3:2 | G2:2 C3:2'},
{id:'good-king-wenceslas', title:'Good King Wenceslas', by:'Traditional (Piae Cantiones, 1582)', cat:'holiday', level:1, bpm:108,
 rh:'G4 G4 G4 A4 | G4 G4 D4:2 | E4 D4 E4 F#4 | G4:2 G4:2 | G4 G4 G4 A4 | G4 G4 D4:2 | E4 D4 E4 F#4 | G4:2 G4:2 | D5 C5 B4 A4 | B4 A4 G4:2 | E4 D4 E4 F#4 | G4:2 G4:2 | D4 D4 E4 F#4 | G4 G4 A4:2 | D5 C5 B4 A4 | G4:2 C5:2 | G4:4',
 lh:'G2:4 | G2:2 D3:2 | C3:2 D3:2 | G2:4 | G2:4 | G2:2 D3:2 | C3:2 D3:2 | G2:4 | G2:2 D3:2 | G2:4 | C3:2 D3:2 | G2:4 | D3:4 | G2:2 D3:2 | G2:2 D3:2 | E3:2 C3:2 | G2:4'},

/* ---------------- Classical ---------------- */
{id:'ode-to-joy', title:'Ode to Joy', by:'Ludwig van Beethoven, 1824', cat:'classical', level:1, bpm:100,
 rh:'E4@3 E4 F4@4 G4@5 | G4 F4 E4 D4@2 | C4@1 C4 D4 E4 | E4:1.5 D4:.5 D4:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:.5 C4:2 | D4 D4 E4 C4 | D4 E4:.5 F4:.5 E4 C4 | D4 E4:.5 F4:.5 E4 D4 | C4 D4 G3:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:.5 C4:2',
 lh:'C3:4 | G2:4 | C3:4 | C3:2 G2:2 | C3:4 | G2:4 | C3:4 | G2:2 C3:2 | G2:4 | G2:2 C3:2 | G2:4 | C3:2 G2:2 | C3:4 | G2:4 | C3:4 | G2:2 C3:2'},
{id:'brahms-lullaby', title:'Lullaby (Wiegenlied)', by:'Johannes Brahms, 1868', cat:'classical', level:2, bpm:76, meter:3,
 rh:'E4:.5 E4:.5 | G4:2 E4:.5 E4:.5 | G4:2 E4:.5 G4:.5 | C5 B4:1.5 A4:.5 | A4 G4 D4:.5 E4:.5 | F4 D4 D4:.5 E4:.5 | F4:2 D4:.5 F4:.5 | B4:.5 A4:.5 G4 B4 | C5:2 C4:.5 C4:.5 | C5:2 A4:.5 F4:.5 | G4:2 E4:.5 C4:.5 | F4 G4 A4 | G4:2 C4:.5 C4:.5 | C5:2 A4:.5 F4:.5 | G4:2 E4:.5 C4:.5 | F4 E4 D4 | C4:3',
 lh:'R:1 | C3:3 | C3:3 | C3:3 | G2:3 | G2:3 | G2:3 | G2:3 | C3:3 | F3:3 | C3:3 | F3:3 | C3:3 | F3:3 | C3:3 | G2:3 | C3:3'},
{id:'going-home', title:'Largo "Going Home" (New World Symphony)', by:'Antonín Dvořák, 1893', cat:'classical', level:1, bpm:56,
 rh:'E4:1.5 G4:.5 G4:2 | E4:1.5 D4:.5 C4:2 | D4 E4 G4 E4 | D4:4 | E4:1.5 G4:.5 G4:2 | E4:1.5 D4:.5 C4:2 | D4 E4 D4 C4 | C4:4',
 lh:'C3:4 | C3:4 | G2:4 | G2:4 | C3:4 | C3:4 | G2:4 | C3:4'},
{id:'fur-elise', title:'Für Elise (theme)', by:'Ludwig van Beethoven, 1810', cat:'classical', level:3, bpm:200, meter:3, pulse:2,
 rh:'E5 D#5 | '+FUR_ELISE_RH+' | A4:2 R:2 E5 D#5 | '+FUR_ELISE_RH+' | A4:6',
 lh:'R:2 | '+FUR_ELISE_LH+' | A2 E3 A3 R:3 | '+FUR_ELISE_LH+' | A2 E3 A3:4'},
{id:'canon-in-d', title:'Canon in D', by:'Johann Pachelbel, c. 1680', cat:'classical', level:2, bpm:60,
 rh:[CANON.v1, CANON.v2, CANON.v3, CANON.v1, 'F#4+A4+D5:4'].join(' | '),
 lh:[CANON.bass, CANON.bass, CANON.bass, CANON.bass, 'D2+D3:4'].join(' | ')},
{id:'prelude-in-c', title:'Prelude in C (first section)', by:'J. S. Bach, 1722', cat:'classical', level:3, bpm:280, meter:4, pulse:4,
 ...prelude(['C4 E4 G4 C5 E5','C4 D4 A4 D5 F5','B3 D4 G4 D5 F5','C4 E4 G4 C5 E5','C4 E4 A4 E5 A5','C4 D4 F#4 A4 D5','B3 D4 G4 D5 G5','B3 C4 E4 G4 C5',
             'A3 C4 E4 G4 C5','D3 A3 D4 F#4 C5','G3 B3 D4 G4 B4','G3 Bb3 E4 G4 C#5','F3 A3 D4 A4 D5','F3 Ab3 D4 F4 B4','E3 G3 C4 G4 C5','E3 F3 A3 C4 F4',
             'D3 F3 A3 C4 F4','G2 D3 G3 B3 F4','C3 E3 G3 C4 E4'])},
{id:'mountain-king', title:'In the Hall of the Mountain King', by:'Edvard Grieg, 1875', cat:'classical', level:2, bpm:200, meter:4, pulse:2,
 rh:twice(MOUNTAIN_KING),
 lh:twice('B2:4 F#2:4 | B2:4 F#2:4 | B2:4 F#2:4 | B2:4 F#2:4')},
{id:'moonlight', title:'Moonlight Sonata (opening)', by:'Ludwig van Beethoven, 1801', cat:'classical', level:2, bpm:150, meter:4, pulse:3,
 rh:[MOON_1, MOON_1, 'A3 C#4 E4 A3 C#4 E4 A3 D4 F#4 A3 D4 F#4', 'G#3 C4 F#4 G#3 C#4 E4 G#3 C#4 D#4 F#3 C4 D#4', 'G#3+C#4+E4:12'].join(' | '),
 lh:['C#2+C#3:12', 'B1+B2:12', 'A1+A2:6 F#1+F#2:6', 'G#1+G#2:12', 'C#2+C#3:12'].join(' | ')},
{id:'mozart-40', title:'Symphony No. 40 (theme)', by:'W. A. Mozart, 1788', cat:'classical', level:3, bpm:112,
 rh:'Eb5:.5 D5:.5 | D5 Eb5:.5 D5:.5 D5 Eb5:.5 D5:.5 | D5 Bb5 R Bb5:.5 A5:.5 | G5 G5:.5 F5:.5 Eb5 Eb5:.5 D5:.5 | C5 C5 R D5:.5 C5:.5 | C5 D5:.5 C5:.5 C5 D5:.5 C5:.5 | C5 A5 R A5:.5 G5:.5 | F#5 F#5:.5 Eb5:.5 D5 D5:.5 C5:.5 | Bb4 Bb4 R',
 lh:'R:1 | G2:4 | G2:4 | C3:4 | D3:4 | D3:4 | D3:4 | D3:4 | G2:3'},
];
})();
