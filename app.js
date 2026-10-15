'use strict';
/* =====================================================================
   Keys — app: engine, progress, drills, sessions, screens
   Needs content.js (SKILLS, COURSES, PATH, CH) loaded first; songs.js is loaded on demand.
   ===================================================================== */

/* ---------- Config ---------- */
const LEAD = 2.5;      // seconds of song-time before the first note
const LOOK = 3;        // seconds of song-time visible above the keyboard
const WIN = 0.25;      // play-along hit window (song seconds, either side)
const EARLY = 1.0;     // wait mode: how early a note may be played
const CHORD_SLACK = 0.1;   // wait mode: notes this soon after a chord (MIDI files from a real performance) count as part of it
const PASS = 80;       // % needed to complete a lesson
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SPEEDS = [0.25,0.4,0.5,0.6,0.7,0.8,0.9,1,1.1,1.25,1.5];
const INTERVALS = [1,2,4,7,14,30,60];          // review intervals in days
const TITLES = ['Beginner','Novice','Apprentice','Player','Performer','Musician','Virtuoso','Maestro'];
/* Title tests: every title after Beginner is earned by playing a real piece from the song library: the whole song,
   both hands, in Play along at full speed, with TEST_PASS% or more. The profile card offers each test from its level
   (each step one level longer than the last: 3, 6, 10, 15 …); at the bottom of Songs they can be played any time,
   and passing one early counts too. A title, once earned, is never lost. */
const TEST_PASS = 90;
const TESTS = [
  {song:'bach-minuet-a-minor', level:3},     // Novice
  {song:'burgmuller-arabesque', level:6},    // Apprentice
  {song:'traumerei', level:10},              // Player
  {song:'kuhlau-sonatina', level:15},        // Performer
  {song:'fur-elise-full', level:21},         // Musician
  {song:'rondo-alla-turca', level:28},       // Virtuoso
  {song:'maple-leaf-rag', level:36},         // Maestro
].map((t,i)=>({...t, id:'test:'+t.song, rank:i+1, title:TITLES[i+1]}));

/* ---------- Notation ---------- */
function nameToMidi(s){
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(s);
  if(!m) throw new Error('Bad note: '+s);
  let pc = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]];
  if(m[2]==='#') pc++; if(m[2]==='b') pc--;
  return (parseInt(m[3],10)+1)*12 + pc;
}
function parseNotation(src,bpm){
  const spb = 60/bpm, out=[]; let beat=0;
  out.bars=[];   // times of the | bar lines, for sheet music
  for(let tok of src.trim().split(/\s+/)){
    if(tok==='|'){ out.bars.push(+(beat*spb).toFixed(4)); continue; }
    let label=null; const lm=/^\[([^\]]+)\]/.exec(tok);
    if(lm){ label=lm[1]; tok=tok.slice(lm[0].length); }
    const ci = tok.lastIndexOf(':');
    const body = ci>=0 ? tok.slice(0,ci) : tok, adv = ci>=0 ? parseFloat(tok.slice(ci+1)) : 1;
    if(body!=='R') body.split('+').forEach((part,i)=>{
      const m = /^([A-G][#b]?-?\d)(?:@(\d))?(?:~([\d.]+))?$/.exec(part);
      if(!m) throw new Error('Bad note: '+part);
      const len = m[3] ? parseFloat(m[3]) : adv;
      const n = {midi:nameToMidi(m[1]), name:m[1], start:beat*spb, dur:len*spb*0.92, finger:m[2]?+m[2]:undefined};
      if(label && i===0) n.label=label;
      out.push(n);
    });
    beat += adv;
  }
  return out;
}
function prep(d){
  if(!d.notes){
    const main=parseNotation(d.rh||d.src, d.bpm);
    if(d.rh){ main.forEach(n=>n.hand='R'); d.notes=[...main, ...(d.lh ? parseNotation(d.lh,d.bpm).map(n=>Object.assign(n,{hand:'L'})) : [])]; }
    else d.notes=main;
    if(main.bars.length) d.bars=main.bars;
  }
  if(d.bpm && !d.q) d.q=60/d.bpm*(d.pulse===3?2:(d.pulse||1));   // seconds per quarter note (6/8 is written in eighths, fast pieces in eighths or sixteenths)
  d.mode=d.mode||'wait'; d.skills=d.skills||[];
  const sp=d.split||60, hd=n=>n.hand||(n.midi<sp?'L':'R');
  d.both = d.notes.some(n=>hd(n)==='L') && d.notes.some(n=>hd(n)==='R');
  return d;
}

/* ---------- Standard MIDI file parser ---------- */
function parseMidiFile(buf){
  const v = new DataView(buf); let p = 0;
  const u8=()=>v.getUint8(p++), u16=()=>{const x=v.getUint16(p);p+=2;return x}, u32=()=>{const x=v.getUint32(p);p+=4;return x};
  const str=n=>{let s='';for(let i=0;i<n;i++)s+=String.fromCharCode(v.getUint8(p+i));p+=n;return s};
  const vlq=()=>{let x=0,b;do{b=u8();x=(x<<7)|(b&0x7f)}while(b&0x80);return x};
  if(str(4)!=='MThd') throw new Error('Not a MIDI file');
  const hlen=u32(); u16(); const ntr=u16(), div=u16(); p = 8+hlen;
  if(div & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  const tempos=[{tick:0,usq:500000}], raw=[], tracks=[], marks=[]; let ts=null, keySig=null;
  for(let ti=0; p+8<=v.byteLength && tracks.length<ntr; ti++){
    const id=str(4), len=u32(), end=Math.min(p+len, v.byteLength);
    if(id!=='MTrk'){ p=end; continue; }
    let tick=0, run=0, name='', count=0; const open={};
    while(p<end){
      tick += vlq();
      let st = v.getUint8(p);
      if(st & 0x80){ p++; if(st<0xf0) run=st; } else st = run;
      if(st===0xff){
        const type=u8(), l=vlq();
        if(type===0x03 && !name){ name=str(l).replace(/[^\x20-\x7e]/g,'').trim(); continue; }
        if(type===0x58 && !ts) ts={n:v.getUint8(p), d:2**v.getUint8(p+1)};
        if(type===0x59 && keySig==null) keySig=v.getInt8(p);   // key signature: sharps (+) or flats (−)
        if(type===0x51) tempos.push({tick, usq:(v.getUint8(p)<<16)|(v.getUint8(p+1)<<8)|v.getUint8(p+2)});
        if(type===0x06) marks.push({tick, label:new TextDecoder().decode(new Uint8Array(buf,p,Math.min(l,end-p))).replace(/\0/g,'').trim().slice(0,40)||'Marker'});   // marker: becomes a saved part
        if(type===0x7f && l===8 && String.fromCharCode(...new Uint8Array(buf,p,5))==='\x7dMCBM'){   // MIDI-Creator bookmark color for the marker just before it
          const m=marks[marks.length-1]; if(m && m.tick===tick) m.c='#'+[5,6,7].map(i=>v.getUint8(p+i).toString(16).padStart(2,'0')).join('');
        }
        p += l;
      } else if(st===0xf0 || st===0xf7){ p += vlq(); }
      else {
        const c=st&0xf0, ch=st&0x0f, d1=u8(), d2=(c===0xc0||c===0xd0)?0:u8();
        if(ch===9) continue; // skip drums
        const key=ch*128+d1;
        if(c===0x90 && d2>0) (open[key]||(open[key]=[])).push(tick);
        else if(c===0x80 || c===0x90){ const s=open[key]&&open[key].shift(); if(s!==undefined){ raw.push({track:tracks.length,midi:d1,s,e:tick}); count++; } }
      }
    }
    p=end; tracks.push({index:tracks.length, name:name||('Track '+(tracks.length+1)), count});
  }
  tempos.sort((a,b)=>a.tick-b.tick);
  const seg=[]; let acc=0;
  tempos.forEach((tp,i)=>{ if(i) acc += (tp.tick-tempos[i-1].tick)*tempos[i-1].usq/1e6/div; seg.push({tick:tp.tick,usq:tp.usq,sec:acc}); });
  const toSec=tk=>{let s=seg[0]; for(const x of seg){ if(x.tick<=tk) s=x; else break; } return s.sec+(tk-s.tick)*s.usq/1e6/div;};
  let notes = raw.map(n=>{const st=toSec(n.s); return {track:n.track, midi:n.midi, start:st, dur:Math.max(0.06,toSec(n.e)-st)}});
  const first = notes.length ? Math.min(...notes.map(n=>n.start)) : 0;
  notes.forEach(n=>n.start-=first);
  const t0 = tempos.filter(t=>t.tick===0).pop();
  const barTicks=div*4*(ts?ts.n/ts.d:1), lastTick=raw.reduce((m,n)=>Math.max(m,n.e),0), bars=[];
  for(let tk=0; tk<=lastTick+barTicks && bars.length<5000; tk+=barTicks){ const b=toSec(tk)-first; if(b>0.01) bars.push(+b.toFixed(4)); }
  return {tracks:tracks.filter(t=>t.count>0), notes, beat:t0.usq/1e6, ts, keySig, bars, lead:first,
          marks:cleanMarks(marks.map(m=>({t:toSec(m.tick), label:m.label, c:m.c})), first)};
}
/* Bookmarks from MIDI-Creator (markers in the file, or &bm= in the link) are in seconds from the start of the file;
   songs start at their first note, so they move back by that much. */
function cleanMarks(list, lead=0){
  return (Array.isArray(list)?list:[]).filter(m=>m && isFinite(m.t) && m.t>=0)
    .map(m=>Object.assign({t:+Math.max(0,m.t-lead).toFixed(2), label:String(m.label==null?'Bookmark':m.label).trim().slice(0,40)||'Bookmark'},
                          /^#[0-9a-f]{6}$/i.test(m.c) ? {c:m.c.toLowerCase()} : {}))
    .sort((a,b)=>a.t-b.t);
}

/* ---------- Content index ---------- */
const ALL_LESSONS = COURSES.flatMap(c=>c.lessons.map((l,i)=>Object.assign(l,{course:c, idx:i})));
const LESSON = Object.fromEntries(ALL_LESSONS.map(l=>[l.id,l]));
ALL_LESSONS.forEach(l=>{ Object.assign(l, THEORY[l.id]||{}); prep(l); });   // learn / practice / watch from content.js

/* =====================================================================
   Progress store
   ===================================================================== */
const PKEY='keys.progress.v1', IKEY='keys.profiles.v1';
/* Players: everyone has their own progress. The first player keeps the original key, so existing progress carries over. */
const progKey=id=>id==='p1' ? PKEY : PKEY+'.'+id;
function loadProfiles(){
  try{ const x=JSON.parse(localStorage.getItem(IKEY)); if(x && x.list && x.list.length) return x; }catch(e){}
  return {active:'p1', list:[{id:'p1', name:'Player 1', emoji:'🎹'}]};
}
let profiles=loadProfiles();
if(!profiles.list.some(p=>p.id===profiles.active)) profiles.active=profiles.list[0].id;
const me=()=>profiles.list.find(p=>p.id===profiles.active);
function saveProfiles(){ try{ localStorage.setItem(IKEY, JSON.stringify(profiles)); }catch(e){} }
function blankProg(){ return {v:1, xp:0, lessons:{}, songs:{}, tests:{}, marks:{}, heat:{}, days:{}, skills:{}, ach:{}, counts:{drills:0,ear:0,sessions:0,runs:0,trainer:0,bestCombo:0}, history:[], bestDays:0, settings:{goal:10, sessionMin:10, drillMode:'wait'}, created:Date.now()}; }
function loadProg(id=profiles.active){
  try{ const p=JSON.parse(localStorage.getItem(progKey(id))); if(p && p.v){ const b=blankProg(); return Object.assign(b,p,{counts:Object.assign(b.counts,p.counts), settings:Object.assign(b.settings,p.settings)}); } }catch(e){}
  const p=blankProg();
  if(id==='p1') try{ for(const l of ALL_LESSONS){ const old=+(localStorage.getItem('keys.lesson.'+l.id)||0); if(old) p.lessons[l.id]={best:old, reps:0, plays:1, last:Date.now()}; } }catch(e){}   // migrate v2
  return p;
}
let prog = loadProg();
function saveProg(){ try{ localStorage.setItem(progKey(profiles.active), JSON.stringify(prog)); }catch(e){} }

const dkey=(d=new Date())=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const day=(k=dkey())=>prog.days[k]||(prog.days[k]={sec:0,xp:0,runs:0});
const dayOK=(k,p=prog)=>p.days[k] && p.days[k].sec>=60;
function streak(p=prog){ const d=new Date(); if(!dayOK(dkey(d),p)) d.setDate(d.getDate()-1); let n=0; while(dayOK(dkey(d),p)){ n++; d.setDate(d.getDate()-1); } return n; }
const totalSec=()=>Object.values(prog.days).reduce((s,d)=>s+d.sec,0);
const lvlNeed=L=>50*L*(L-1);
function levelInfo(xp){ let L=1; while(xp>=lvlNeed(L+1)) L++; return {L, cur:xp-lvlNeed(L), need:lvlNeed(L+1)-lvlNeed(L)}; }
const testPassed=(T,p=prog)=>!!(p.tests&&p.tests[T.id]&&p.tests[T.id].passed);
const titleRank=(p=prog)=>TESTS.reduce((r,T)=>testPassed(T,p)?Math.max(r,T.rank):r,0);   // the highest test passed
const titleOf=(p=prog)=>TITLES[titleRank(p)];
const aTitle=t=>(/^(<b>)?[AEIOU]/.test(t)?'an ':'a ')+t;   // "an Apprentice", "a Novice"
const testOpen=T=>levelInfo(prog.xp).L>=T.level;
// the next title to aim for, above the one held (a test can be passed before its level, so a pro can skip ahead)
const nextTest=()=>TESTS.find(T=>T.rank>titleRank());
const starsFor=acc=> acc>=97?3 : acc>=90?2 : acc>=PASS?1 : 0;
const starStr=n=>'★'.repeat(n)+'☆'.repeat(3-n);
const best=id=>(prog.lessons[id]&&prog.lessons[id].best)||0;
const passed=id=>best(id)>=PASS;
const nPassed=()=>ALL_LESSONS.filter(l=>passed(l.id)).length;
const nSongs=()=>Object.values(prog.songs).filter(r=>r.best>=PASS).length;
function dueness(id){ const r=prog.lessons[id]; if(!r||r.best<PASS) return 0; return (Date.now()-r.last)/(INTERVALS[r.reps||0]*864e5); }
const dueLessons=()=>ALL_LESSONS.filter(l=>dueness(l.id)>=1).sort((a,b)=>dueness(b.id)-dueness(a.id));
const nextInPath=(match=()=>true)=>PATH.map(id=>LESSON[id]).find(l=>!passed(l.id)&&match(l));
function learnedSkills(){ const s=new Set(); for(const l of ALL_LESSONS) if(passed(l.id)) l.skills.forEach(x=>s.add(x)); if(prog.counts.ear) s.add('ear'); return s; }

let pendSec=0;
function flushTime(){
  if(pendSec<=0) return;
  const d=day(), goal=prog.settings.goal*60, before=d.sec;
  d.sec+=pendSec; pendSec=0;
  if(before<goal && d.sec>=goal) toast('🎯 Daily goal reached!');
  prog.bestDays=Math.max(prog.bestDays||0, streak());
  checkAch(); saveProg();
}
function addXP(n){
  if(n<=0) return;
  const before=levelInfo(prog.xp).L;
  prog.xp+=n; day().xp+=n;
  const after=levelInfo(prog.xp);
  if(after.L>before){
    const T=TESTS.find(T=>T.level>before && T.level<=after.L && T.rank>titleRank());   // (not one passed early)
    toast(T ? `⬆️ Level ${after.L}! 🎓 You can attempt ${T.title} now, from your profile card` : `⬆️ Level ${after.L}!`);
  }
}
function updSkill(tag,acc){ const s=prog.skills[tag]||(prog.skills[tag]={m:0,n:0}); s.m = s.n ? Math.round(s.m*0.7+acc*0.3) : acc; s.n++; }
function updateLesson(id,acc){
  const r=prog.lessons[id]||(prog.lessons[id]={best:0,reps:0,plays:0,last:0});
  const wasPassed=r.best>=PASS, oldStars=starsFor(r.best), due=dueness(id);
  r.plays++;
  const res={firstPass:!wasPassed && acc>=PASS, prevBest:r.best};
  if(acc>r.best) r.best=acc;
  res.newStars = starsFor(r.best)-oldStars;
  if(acc>=PASS){ if(wasPassed && acc>=90 && due>=0.5) r.reps=Math.min(INTERVALS.length-1,(r.reps||0)+1); r.last=Date.now(); }
  else if(wasPassed){ r.reps=Math.max(0,(r.reps||0)-1); r.last=Date.now()-INTERVALS[r.reps]*864e5; }   // failed review: due again now
  return res;
}

/* ---------- Achievements ---------- */
const ACH = [
  {id:'first', i:'🌱', n:'First steps', d:'Complete your first lesson', t:()=>nPassed()>=1},
  {id:'l10', i:'📚', n:'Bookworm', d:'Complete 10 lessons', t:()=>nPassed()>=10},
  {id:'l25', i:'🎓', n:'Scholar', d:'Complete 25 lessons', t:()=>nPassed()>=25},
  {id:'all', i:'👑', n:'Graduate', d:'Complete every lesson', t:()=>nPassed()>=ALL_LESSONS.length},
  ...COURSES.map(c=>({id:'course_'+c.id, i:c.icon, n:c.title+' mastered', d:`Complete the ${c.title} course`, t:()=>c.lessons.every(l=>passed(l.id))})),
  {id:'s3', i:'🔥', n:'Warming up', d:'Practise 3 days in a row', t:()=>prog.bestDays>=3},
  {id:'s7', i:'🔥', n:'One week strong', d:'Practise 7 days in a row', t:()=>prog.bestDays>=7},
  {id:'s30', i:'🏆', n:'Habit formed', d:'Practise 30 days in a row', t:()=>prog.bestDays>=30},
  {id:'goal7', i:'🎯', n:'Goal getter', d:'Reach your daily goal on 7 days', t:()=>Object.values(prog.days).filter(d=>d.sec>=prog.settings.goal*60).length>=7},
  {id:'t60', i:'⏱', n:'First hour', d:'Practise 60 minutes in total', t:()=>totalSec()>=3600},
  {id:'t600', i:'⏳', n:'Ten hours', d:'Practise 10 hours in total', t:()=>totalSec()>=36000},
  {id:'perfect', i:'💎', n:'Flawless', d:'Score 100% on a lesson', t:()=>Object.values(prog.lessons).some(r=>r.best>=100)},
  {id:'stars10', i:'⭐', n:'Star collector', d:'Get 3 stars on 10 lessons', t:()=>Object.values(prog.lessons).filter(r=>r.best>=97).length>=10},
  {id:'combo50', i:'⚡', n:'On fire', d:'Play 50 correct notes in a row', t:()=>prog.counts.bestCombo>=50},
  {id:'sess1', i:'💪', n:'Full workout', d:'Finish a practice session', t:()=>prog.counts.sessions>=1},
  {id:'sess10', i:'🏋', n:'Regular', d:'Finish 10 practice sessions', t:()=>prog.counts.sessions>=10},
  {id:'drill25', i:'🎯', n:'Drill sergeant', d:'Complete 25 drills', t:()=>prog.counts.drills>=25},
  {id:'ear10', i:'👂', n:'Golden ears', d:'Pass 10 play-by-ear drills', t:()=>prog.counts.ear>=10},
  {id:'songs5', i:'🎵', n:'Repertoire', d:`Play 5 different songs at ${PASS}% or better`, t:()=>nSongs()>=5},
  {id:'songs20', i:'🎼', n:'Songbook', d:`Play 20 different songs at ${PASS}% or better`, t:()=>nSongs()>=20},
  {id:'speed', i:'🚀', n:'Up to speed', d:'Reach your goal speed in the speed trainer', t:()=>prog.counts.trainer>=1},
  {id:'lv5', i:'🎖', n:'Level 5', d:'Reach level 5', t:()=>levelInfo(prog.xp).L>=5},
  {id:'lv10', i:'🏅', n:'Level 10', d:'Reach level 10', t:()=>levelInfo(prog.xp).L>=10},
];
function checkAch(){ for(const a of ACH) if(!prog.ach[a.id] && a.t()){ prog.ach[a.id]=Date.now(); toast(`${a.i} Achievement: ${a.n}`); } }

/* ---------- Toasts ---------- */
function toast(msg){
  const el=document.createElement('div'); el.className='toast'; el.textContent=msg;
  $('#toasts').appendChild(el); setTimeout(()=>el.remove(), 3200);
}

/* =====================================================================
   Engine state
   ===================================================================== */
const $=s=>document.querySelector(s);
const cv=$('#cv'), cx=cv.getContext('2d');
const css=getComputedStyle(document.documentElement), col=k=>css.getPropertyValue(k).trim();
const C={bg:col('--bg'),accent:col('--accent'),left:col('--left'),good:col('--good'),bad:col('--bad'),muted:col('--muted'),text:col('--text')};
const OTHER='#4a5070';           // hidden notes in play-by-ear drills

let song=null, notes=[], groups=[], gi=0, si=0, songEnd=0, songBeat=0.5, meter=4, lastBeat=null;
let t=-LEAD, playing=false, finished=false, waiting=false, mode='wait', speed=1, hands='both';
let soundOn=false, labelScale=1, metroOn=false, metroPref=false, lastTs=0, together=false, previewPhase=false;
let scrub=null;       // timeline being dragged or animating to a new position: {target, snap, resume, drag}
let partial=false, partialFrom=0;   // the run didn't start at the beginning (doesn't count toward stars)
let loop=null;        // looping a saved part: {a, b, label, n}
const LEADIN=1;       // seconds of song shown before a saved part starts
let cur=null;         // what's loaded: {kind:'lesson'|'drill'|'free', def, title, sub, tip, lesson?, regen?, section?}
let session=null;     // practice session in progress
let trainer=null;     // speed trainer in progress
let stats; resetStats();
const held=new Map();            // midi -> true (correct) | false (wrong) | null (neutral)
let lo=48, hi=84, W=0, H=0, kbTop=0, kbH=0, ww=1, whites=[], whiteIdx={};
const isBlack=m=>[1,3,6,8,10].includes(m%12);

function resetStats(){ stats={hit:0,miss:0,wrong:0,streak:0,bestStreak:0}; }
function accuracy(){ const tot=stats.hit+stats.miss+stats.wrong; return tot? Math.round(100*stats.hit/tot) : 100; }
const wants=n=> mode!=='listen' && (hands==='both' || (hands==='right')===(n.hand==='R'));

/* ---------- Song loading ---------- */
function loadSong(s){
  if(rec && !rp && !rec.loading) stopRecording(false);   // another song: keep what was recorded so far
  heatCommit();
  song=s; together=!!s.together;
  const split=s.split||60;
  const fold=m=>{ while(m<21) m+=12; while(m>108) m-=12; return m; };   // beyond the 88 keys: the nearest octave that exists
  notes = s.notes.map(n=>({...n, midi:fold(n.midi), hand:n.hand||(n.midi<split?'L':'R')})).sort((a,b)=>a.start-b.start||a.midi-b.midi);
  groups=[];
  for(const n of notes){ let g=groups[groups.length-1]; if(!(g && n.start-g.start<0.06)){ g={start:n.start, notes:[]}; groups.push(g); } g.notes.push(n); n.g=g; }
  songEnd = notes.reduce((m,n)=>Math.max(m,n.start+n.dur),0);
  songBeat = s.beat || (s.bpm ? 60/s.bpm*(s.pulse||1) : 0.5); meter = s.meter||4;
  metroOn = s.metro ? true : metroPref; $('#metro').setAttribute('aria-pressed',metroOn);
  const mids = notes.map(n=>n.midi);
  let a = mids.length? Math.min(...mids):60, b = mids.length? Math.max(...mids):72;
  a = Math.floor(a/12)*12; b = Math.ceil((b+1)/12)*12;
  while(b-a<24){ if(a>36) a-=12; else b+=12; }
  setRange(a,b);
  loop=null; scrub=null;
  restart(); heatStart(); renderTimeline();
}
function restart(){
  heatCommit();
  for(const n of notes){ n.hit=false; n.missed=false; n.auto=false; n.req=wants(n); }
  for(const g of groups){ g.wrong=0; g.reveal=false; }
  gi=0; si=0; t=-LEAD; playing=false; finished=false; waiting=false; lastBeat=null; partial=false;
  held.clear(); resetStats(); closeResult();
  if(loop) seekTo(loopStart());
  updateUI();
}
/* Jump to song time T: notes before it count as played (not scored), the score starts again from here */
function seekTo(T){
  heatCommit();
  t=Math.max(-LEAD, Math.min(T, songEnd));
  for(const n of notes){ n.missed=false; n.auto=false; n.req=wants(n); n.hit = n.start < t-1e-3; }
  for(const g of groups){ g.wrong=0; g.reveal=false; }
  si=notes.findIndex(n=>n.start>=t-1e-3); if(si<0) si=notes.length;
  gi=groups.findIndex(g=>g.start>=t-1e-3); if(gi<0) gi=groups.length;
  finished=false; waiting=false; lastBeat=null; held.clear(); resetStats(); closeResult();
  partial = t > -LEAD+0.05 || !!loop; partialFrom=t;
  if(rec && !rec.free){ recClock(); rec.path.push([+rec.w.toFixed(3), +t.toFixed(3)]); }
  updateUI();
}
/* Move smoothly to T (pausing meanwhile), then carry on playing if we were */
function seekAnimated(T){
  if(rp) return seekReplay(T);
  if(!notes.length) return;
  const resume = scrub ? scrub.resume : playing;
  if(playing){ playing=false; flushTime(); }
  for(const n of notes){ n.hit=false; n.missed=false; }   // neutral colours while moving
  closeResult(); finished=false;
  scrub={target:Math.max(-LEAD, Math.min(T, songEnd)), snap:true, resume};
}
const loopStart=()=>Math.max(-LEAD, loop.a-LEADIN);
function setRange(a,b){
  lo=Math.max(21,a); hi=Math.min(108,b); whites=[]; whiteIdx={};
  for(let m=lo;m<=hi;m++) if(!isBlack(m)){ whiteIdx[m]=whites.length; whites.push(m); }
  layout();
}
function advanceGroups(){ while(gi<groups.length && groups[gi].notes.every(n=>n.hit||!n.req)) gi++; }
/* Notes just after the current chord that belong to it: a hair later in the file, so in a group of their own,
   but played together with it. They can be pressed with the chord instead of counting as wrong (and then
   waiting for a key that's already down). */
function chordFollowers(){
  const g=groups[gi], out=[];
  if(g) for(let j=gi+1; j<groups.length && groups[j].start-g.start<=CHORD_SLACK; j++) out.push(...groups[j].notes.filter(n=>n.req && !n.hit));
  return out;
}

/* ---------- Layout & geometry ---------- */
function layout(){
  const dpr=window.devicePixelRatio||1;
  W=cv.clientWidth; H=cv.clientHeight;
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); cx.setTransform(dpr,0,0,dpr,0,0);
  kbH = staffView() && prog.settings.staffKeys===false ? 0 : Math.max(70,Math.min(H*0.3,180));
  kbTop=H-kbH; ww=W/Math.max(1,whites.length);
}
function keyRect(m){
  if(!isBlack(m)){ const i=whiteIdx[m]; return i===undefined?null:{x:i*ww,w:ww,h:kbH,black:false}; }
  const i=whiteIdx[m-1]; if(i===undefined) return null;
  const bw=ww*0.6; return {x:(i+1)*ww-bw/2, w:bw, h:kbH*0.62, black:true};
}
function keyAt(x,y){
  if(y<kbTop) return null;
  for(let m=lo;m<=hi;m++) if(isBlack(m)){ const r=keyRect(m); if(r && x>=r.x && x<=r.x+r.w && y<=kbTop+r.h) return m; }
  return whites[Math.min(whites.length-1, Math.max(0, Math.floor(x/ww)))];
}

/* ---------- Audio ---------- */
let ac=null;
function audio(){ if(!ac) ac=new (window.AudioContext||window.webkitAudioContext)(); if(ac.state==='suspended') ac.resume(); return ac; }
/* Realistic piano (fancy-piano.js, from MIDI-Creator): every key is calculated on this device the first time it's
   switched on, which takes a few seconds; until then, and if it can't be made, the simple sound below plays instead. */
let fancyOn=false;
function setFancy(on){
  fancyOn=on && !!self.FancyPiano;
  const b=$('#fancy'); b.setAttribute('aria-pressed',fancyOn); b.hidden=!self.FancyPiano;
  if(!fancyOn || FancyPiano.ready || FancyPiano.busy) return;
  FancyPiano.prepare(audio(), f=>{ b.textContent='🎹 '+Math.round(f*100)+'%'; }).then(ok=>{
    b.textContent='🎹';
    if(!ok){ fancyOn=false; b.setAttribute('aria-pressed',false); toast('⚠ The realistic piano could not be prepared on this device'); }
    else if(fancyOn) toast('🎹 Realistic piano is ready');
  });
}
function tone(m,dur=0.6,vel=0.6,midiVel){   // vel 0..1 for the simple sound; midiVel (1-127) when the real one is known
  if(fancyOn && FancyPiano.play(audio(), m, midiVel||Math.round(40+vel*100), dur)) return;
  const a=audio(), f=440*Math.pow(2,(m-69)/12), t0=a.currentTime, len=Math.max(0.25,dur);
  const g=a.createGain();
  g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(0.22*vel,t0+0.008);
  g.gain.exponentialRampToValueAtTime(0.08*vel,t0+0.15); g.gain.exponentialRampToValueAtTime(0.0005,t0+len+0.35);
  g.connect(a.destination);
  for(const [type,mul,amp] of [['triangle',1,1],['sine',2,0.25],['sine',3,0.08]]){
    const o=a.createOscillator(), og=a.createGain(); o.type=type; o.frequency.value=f*mul; og.gain.value=amp;
    o.connect(og).connect(g); o.start(t0); o.stop(t0+len+0.4);
  }
}
function click(accent){
  const a=audio(), t0=a.currentTime, o=a.createOscillator(), g=a.createGain();
  o.type='square'; o.frequency.value=accent?1760:1100;
  g.gain.setValueAtTime(accent?0.10:0.06,t0); g.gain.exponentialRampToValueAtTime(0.0001,t0+0.05);
  o.connect(g).connect(a.destination); o.start(t0); o.stop(t0+0.06);
}

/* ---------- Input handling ---------- */
function score(n){ n.hit=true; stats.hit++; stats.streak++; }
// one press plays every copy of that key written at the same moment (e.g. both hands' parts holding the same note)
function scoreKey(n,pool){ score(n); for(const x of pool) if(x!==n && x.midi===n.midi && x.req && !x.hit && Math.abs(x.start-n.start)<0.02) score(x); }
function noteOn(m, src, vel=90){
  if(src!=='midi') tone(m,0.8);
  held.set(m,null);
  let ok=null, late;
  if(playing && mode==='wait'){
    advanceGroups();
    const g=groups[gi];
    if(g){
      const need=g.notes.filter(n=>n.req && !n.hit);
      if(g.start-t<=EARLY && need.length){
        const n=need.find(n=>n.midi===m);
        if(n){
          ok=true;
          // Chords: count only once all keys are down together
          if(together && need.length>1){ if(need.every(x=>held.has(x.midi))) need.forEach(score); }
          else scoreKey(n, [...g.notes, ...chordFollowers()]);
        } else if(g.notes.some(n=>n.midi===m)) ok=true;
        else if((late=chordFollowers().find(x=>x.midi===m))){ ok=true; scoreKey(late, chordFollowers()); }   // part of the chord, just written a hair later
        else { ok=false; g.wrong++; if((song.hidden||readingItem()) && g.wrong>=2) g.reveal=true; }
      } else ok=false;
    }
  } else if(playing && mode==='play'){
    let best=null, bd=WIN;
    for(const n of notes){ if(n.start>t+WIN) break; if(n.req && n.midi===m && !n.hit && !n.missed){ const d=Math.abs(n.start-t); if(d<=bd){ bd=d; best=n; } } }
    if(best){ scoreKey(best, notes.slice(Math.max(0,si-64), si+64)); ok=true; } else ok=false;
  }
  if(ok===false){ stats.wrong++; stats.streak=0; heatMiss(t); }
  stats.bestStreak=Math.max(stats.bestStreak,stats.streak);
  held.set(m,ok); updateHud();
  if(rec && (rec.free || playing)){ recClock(); recOff(m); rec.open.set(m,[rec.w,0,m,vel,ok]); }
}
function noteOff(m){ held.delete(m); if(rec){ recClock(); recOff(m); } }

// Web MIDI
let midiAccess=null;
async function connectMidi(){
  if(!navigator.requestMIDIAccess){ setMidiStatus('No Web MIDI (use Chrome)',false); return; }
  try{
    midiAccess = await navigator.requestMIDIAccess();
    const bind=()=>{ const names=[]; midiAccess.inputs.forEach(i=>{ i.onmidimessage=onMidi; names.push(i.name); });
      setMidiStatus(names.length? '🎹 '+names.join(', ') : 'No piano found', names.length>0); };
    bind(); midiAccess.onstatechange=bind;
  }catch(e){ setMidiStatus('MIDI blocked — tap to retry',false); }
}
function onMidi(e){
  const [s,d1,d2]=e.data, c=s&0xf0;
  if(c===0x90 && d2>0) noteOn(d1,'midi',d2);
  else if(c===0x80 || (c===0x90 && d2===0)) noteOff(d1);
}
function setMidiStatus(txt,on){ const b=$('#midi'); b.textContent=txt; b.classList.toggle('on',on); }

// Touch / mouse on the on-screen keyboard
const pointers=new Map();
cv.addEventListener('pointerdown',e=>{ const r=cv.getBoundingClientRect(), m=keyAt(e.clientX-r.left,e.clientY-r.top); if(m==null) return; cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId,m); noteOn(m,'touch'); });
const release=e=>{ const m=pointers.get(e.pointerId); if(m!=null){ pointers.delete(e.pointerId); noteOff(m); } };
cv.addEventListener('pointerup',release); cv.addEventListener('pointercancel',release);

// Computer keyboard: A W S E D F T G Y H U J K = C4..C5, Space = start/pause, Esc = close
const KEYMAP='awsedftgyhujk';
const downKeys=new Set();
const overlayOpen=()=>!$('#screen').hidden || !$('#intro').hidden || !$('#who').hidden || !$('#marksMenu').hidden;
addEventListener('keydown',e=>{
  if(e.key==='Escape'){ if(!$('#marksMenu').hidden) closeMarks(); else if(!$('#who').hidden){ if(!whoForced) closeWho(); } else if(!$('#intro').hidden) $('#intro').hidden=true; else if(!$('#screen').hidden) closeScreen(); return; }
  if(e.target.tagName==='SELECT' || e.target.tagName==='INPUT' || overlayOpen()) return;
  if(e.code==='Space'){ e.preventDefault(); togglePlay(); return; }
  if(e.key==='ArrowLeft' || e.key==='ArrowRight'){ e.preventDefault(); seekAnimated(pos()+(e.key==='ArrowLeft'?-5:5)); return; }
  if(e.key==='Home'){ e.preventDefault(); $('#tStart').click(); return; }
  const i=KEYMAP.indexOf(e.key.toLowerCase()); if(i<0 || e.repeat || downKeys.has(e.key)) return;
  downKeys.add(e.key); noteOn(60+i,'key');
});
addEventListener('keyup',e=>{ const i=KEYMAP.indexOf(e.key.toLowerCase()); if(i<0) return; downKeys.delete(e.key); noteOff(60+i); });

/* ---------- Game loop ---------- */
function step(dt){
  let nt=t+dt*speed;
  if(mode==='wait'){
    advanceGroups();
    const g=groups[gi];
    waiting = !!(g && nt>=g.start);
    if(waiting) nt=g.start;
  } else waiting=false;
  if(mode==='play'){
    for(const n of notes){ if(n.start>nt) break; if(n.req && !n.hit && !n.missed && nt>n.start+WIN){ n.missed=true; stats.miss++; stats.streak=0; heatMiss(n.start); } }
  }
  if(metroOn && nt<songEnd){
    const bi=Math.floor((nt+1e-6)/songBeat);
    if(bi!==lastBeat){ lastBeat=bi; click(((bi%meter)+meter)%meter===0); }
  }
  while(si<notes.length && notes[si].start<=nt){
    const n=notes[si++];
    if(!n.req){ n.hit=true; n.auto=true; tone(n.midi,n.dur/speed, mode==='listen'?0.6:0.45); }   // Listen mode, or the other hand
    else if(mode==='play' && soundOn) tone(n.midi,n.dur/speed,0.4);
  }
  t=nt;
  if(heatRun && t>=0 && mode!=='listen') heatRun.seen.add(Math.min(heatRun.n-1, Math.floor(t/heatRun.bin)));
  if(loop && t>=loop.b-1e-3){ loop.n++; seekTo(loopStart()); return; }   // play the saved part again
  if(t>songEnd+0.8 && (mode!=='wait' || gi>=groups.length)) finish();
  updateHud();
}
function frame(ts){
  const raw=(ts-(lastTs||ts))/1000, dt=Math.min(0.05,raw); lastTs=ts;
  if(rec) recTick();
  if(rp){ if(rp.playing) rp.w=Math.min(rp.r.dur, rp.w0+(performance.now()-rp.t0)/1000); replayTick(); }
  else if(scrub){   // glide towards the timeline position; snap quickly once it's let go
    const k=1-Math.exp(-Math.min(raw,0.1)*(scrub.snap?28:7));
    t+=(scrub.target-t)*k;
    if(scrub.snap && Math.abs(scrub.target-t)<0.004){
      const r=scrub.resume; t=scrub.target; scrub=null; seekTo(t);
      if(r){ playing=true; holdWake(); }
      updateUI();
    }
  } else if(playing){
    step(dt);
    const r=Math.min(raw,0.25); pendSec+=r; if(session) session.sec+=r;
    if(pendSec>=10) flushTime();
  }
  draw(); updateTimeline(); requestAnimationFrame(frame);
}

/* =====================================================================
   Running things: lessons, drills, songs
   ===================================================================== */
const lessonItem=l=>({kind:'lesson', lesson:l, def:l, title:l.title, sub:`${l.course.icon} ${l.course.title} ${l.idx+1}`, tip:l.tip});
function setHands(h){ hands=h; $('#hands').value=h; }

function startItem(it, listen=false){
  if(rp) exitReplay(true);
  closeScreen(); $('#intro').hidden=true; closeResult(); closeMarks();
  cur=it;
  const d=it.def;
  if(!d.both && hands!=='both') setHands('both');
  previewPhase = !listen && !!d.preview;
  mode = (listen||previewPhase) ? 'listen' : d.mode; $('#mode').value=mode;
  loadSong(d);
  togglePlay();
}
function isCounting(){ const d=cur.def; return mode===d.mode && (hands==='both'||!d.both); }
function runXP(acc,res){ let xp=Math.round(stats.hit*acc/100*0.5)+(acc>=PASS?5:0); if(res.firstPass) xp+=25; if(res.test&&res.test.passedNow) xp+=50; xp+=Math.max(0,res.newStars||0)*10; return Math.max(1,xp); }

function recordRun(acc){
  if(!cur || mode==='listen' || stats.hit+stats.wrong+stats.miss===0) return null;
  const d=cur.def, res={acc, counts:isCounting() && !partial};
  prog.counts.runs++; prog.counts.bestCombo=Math.max(prog.counts.bestCombo||0, stats.bestStreak);
  if(cur.lesson && res.counts) Object.assign(res, updateLesson(cur.lesson.id, acc));
  if(cur.song && !partial && (hands==='both' || !d.both)){   // whole song, played with every hand it needs
    const r=prog.songs[cur.song.id]||(prog.songs[cur.song.id]={best:0, plays:0});
    res.prevBest=r.best; r.best=Math.max(r.best,acc); r.plays++; r.last=Date.now(); res.songBest=r.best;
  }
  if(cur.song && cur.song.test){   // a title test only counts when played by its rules
    const T=cur.song.test;
    const why = partial ? 'from the very start, without skipping'
      : mode!=='play' ? 'in Play along' : Math.abs(speed-1)>1e-6 ? 'at full speed (100%)'
      : d.both && hands!=='both' ? 'with both hands' : null;
    res.test={T, why};   // (its level only decides when the profile card offers it: passing it earlier counts too)
    if(!why){
      const r=prog.tests[T.id]||(prog.tests[T.id]={best:0}); r.best=Math.max(r.best,acc);
      if(acc>=TEST_PASS && !r.passed){ const before=titleRank(); r.passed=Date.now(); res.test.passedNow=true; res.test.newTitle=titleRank()>before; }
    }
  }
  if(cur.kind==='drill'){ prog.counts.drills++; if(d.ear && acc>=PASS) prog.counts.ear++; }
  if(hands==='both') for(const s of d.skills||[]) updSkill(s, acc);
  res.xp = runXP(acc,res); addXP(res.xp);
  day().runs++;
  prog.history.unshift({at:Date.now(), title:cur.title, kind:cur.kind, acc, xp:res.xp}); prog.history.length=Math.min(prog.history.length,60);
  checkAch(); saveProg();
  return res;
}

function finish(){
  playing=false; finished=true; releaseWake(); flushTime(); heatCommit(); updateUI();
  if(previewPhase){
    previewPhase=false; mode=song.mode; $('#mode').value=mode; restart();
    toast('👂 Your turn: play it back!');
    setTimeout(()=>{ if(!playing && !finished && cur && cur.def===song) togglePlay(); }, 900);
    return;
  }
  const acc=accuracy();
  if(mode==='listen' && cur && cur.kind!=='free')
    return setResult(cur.title,null,'♪','Your turn! Now play it yourself.',[{label:'▶ Start',primary:true,fn:()=>startItem(cur,false)},session?{label:'Skip',fn:()=>{ session.idx++; sessionCard(null); }}:{label:'Menu',fn:()=>openScreen('learn')}]);
  const res=recordRun(acc), take=rec && !rec.free ? stopRecording(false) : null;
  if(session) sessionAfter(acc,res);
  else if(partial && !trainer) partialFinish(acc,res);
  else if(trainer) trainerAfter(acc,res);
  else if(!cur || cur.kind==='free') freeFinish(acc,res);
  else if(cur.kind==='lesson') lessonFinish(acc,res);
  else drillFinish(acc,res);
  if(take) addResultButton('🎙 Replay recording', ()=>startReplay(take));
}
function addResultButton(label,fn){
  const el=document.createElement('button'); el.textContent=label;
  el.onclick=e=>{ e.stopPropagation(); clearCountdown(); fn(); }; $('#resBtns').appendChild(el);
}

/* ---------- Result card ---------- */
let cdTimer=null;
function clearCountdown(){ if(cdTimer){ clearInterval(cdTimer); cdTimer=null; } $('#resCount').textContent=''; }
function countdown(sec,fn){
  clearCountdown(); let n=sec; const el=$('#resCount');
  el.textContent=`Starting in ${n}… (tap the card to pause)`;
  cdTimer=setInterval(()=>{ n--; if(n<=0){ clearCountdown(); fn(); } else el.textContent=`Starting in ${n}… (tap the card to pause)`; },1000);
}
function setResult(title,starsN,big,detail,buttons,opt={}){
  clearCountdown();
  $('#resTitle').textContent=title;
  $('#resStars').innerHTML = starsN==null ? '' : [1,2,3].map(i=>i<=starsN?'★':'<span class="off">★</span>').join('');
  $('#resAcc').textContent=big;
  $('#resXP').textContent = opt.xp ? `+${opt.xp} XP` : '';
  if(opt.html) $('#resDetail').innerHTML=detail; else $('#resDetail').textContent=detail;
  const box=$('#resBtns'); box.innerHTML='';
  for(const b of buttons){ const el=document.createElement('button'); el.textContent=b.label; if(b.primary) el.className='primary'; el.onclick=e=>{ e.stopPropagation(); clearCountdown(); b.fn(); }; box.appendChild(el); }
  $('#result').hidden=false;
}
function closeResult(){ clearCountdown(); $('#result').hidden=true; }
const statLine=()=>`${stats.hit} hit · ${stats.miss} missed · ${stats.wrong} wrong · best streak ${stats.bestStreak}`;

function partialFinish(acc,res){
  const from=fmtTime(Math.max(0,partialFrom)), at=partialFrom;
  setResult(`Practice from ${from}`, null, acc+'%', statLine()+'. Only full play-throughs from the start count toward stars and best scores.',
    [{label:`↺ From ${from} again`, primary:true, fn:()=>{ seekTo(at); togglePlay(); }},
     {label:'From the start', fn:()=>{ restart(); togglePlay(); }},
     ...(cur&&cur.lesson ? [{label:'📖 Read lesson', fn:()=>showIntro(cur.lesson,cur,true)}] : []),
     {label:'Close', fn:closeResult}], {xp:res&&res.xp});
}
function freeFinish(acc,res){
  const back = cur&&cur.song ? {label:'🎵 Songs',fn:()=>openScreen('songs')} : {label:'Close',fn:closeResult};
  if(mode==='listen'){
    const play = cur&&cur.song ? [{label:'▶ Play it',primary:true,fn:()=>startItem(cur)}] : [];
    return setResult(song.title,null,'♪','Now try it yourself.',[...play, back]);
  }
  if(res && res.test) return testFinish(acc,res,back);
  let detail=statLine();
  if(res && res.songBest!=null) detail+=` · personal best ${res.songBest}%`;
  else if(cur && cur.song) detail+=' · one-hand practice (play both hands to set a best score)';
  const title = res && res.songBest!=null && res.prevBest && acc>res.prevBest ? '🎉 New best · '+song.title : song.title;
  setResult(title, cur&&cur.song?starsFor(acc):null, acc+'%', detail, [{label:'Again',primary:true,fn:()=>{restart();togglePlay();}},{label:'⚡ Speed trainer',fn:()=>startTrainer(cur)},back], {xp:res&&res.xp});
}
function testFinish(acc,res,back){
  const {T,why,passedNow,newTitle}=res.test, e=cur.song, again={label:'Again',primary:true,fn:()=>startSong(e,false)};
  const practise={label:'🎻 Practise it',fn:()=>{ closeResult(); openScreen('songs'); showSong(songById(T.song)); }};
  if(passedNow){ if(newTitle) toast(`🎓 You're now ${aTitle(T.title)}!`);
    return setResult(newTitle?`🎓 You're now ${aTitle(T.title)}!`:`🎓 ${T.title} test passed`, starsFor(acc), acc+'%',
      `${statLine()}. ${newTitle?`The title ${T.title} is yours to keep.`:`You already hold a higher title, so it stays.`}`, [back, {label:'Again',fn:again.fn}], {xp:res.xp}); }
  if(why) return setResult(`${T.title} test · didn't count`, null, acc+'%', `A test only counts when it's played ${why}. Start it again from the Title tests list.`, [again, practise, back], {xp:res.xp});
  const best=prog.tests[T.id].best;
  if(testPassed(T)) return setResult(`${T.title} test`, starsFor(acc), acc+'%', `${statLine()} · best test score ${best}%. Already passed.`, [again, back], {xp:res.xp});
  setResult(`${T.title} test · not yet`, starsFor(acc), acc+'%', `You need ${TEST_PASS}% to earn the title ${T.title}${best>acc?` (your best is ${best}%)`:''}. ${statLine()}.`, [again, practise, back], {xp:res.xp});
}
function lessonFinish(acc,res){
  const L=cur.lesson, pass=acc>=PASS, counts=res&&res.counts;
  let detail = statLine()+'.';
  if(!pass) detail = `You need ${PASS}% to complete this lesson. Try a slower speed, or practise one hand at a time.`;
  if(!counts) detail += hands!=='both' ? ' One-hand practice run: play with both hands to complete the lesson.' : ` Practice run: use “${L.mode==='play'?'Play along':'Wait for me'}” to complete the lesson.`;
  const nx=nextInPath(), btns=[];
  if(pass && counts && nx) btns.push({label:'Next lesson ▶',primary:true,fn:()=>showIntro(nx)});
  btns.push({label:'↺ Retry',primary:!(pass&&counts&&nx),fn:()=>startItem(cur,false)});
  btns.push({label:'📖 Read lesson',fn:()=>showIntro(L,cur,true)});
  if(pass) btns.push({label:'⚡ Speed trainer',fn:()=>startTrainer(cur)});
  btns.push({label:'Lessons',fn:()=>openScreen('learn')});
  const title = pass&&counts ? (res.firstPass?'🎉 Lesson complete':(acc>res.prevBest?'🎉 New best!':'✓ Well played')) : (pass?'Nice practice!':'Almost there');
  setResult(title, starsFor(acc), acc+'%', detail, btns, {xp:res&&res.xp});
}
function drillFinish(acc,res){
  const btns=[];
  if(cur.regen) btns.push({label:'🎲 New exercise',primary:true,fn:()=>startItem(cur.regen())});
  btns.push({label:'↺ Same again',fn:()=>startItem(cur)});
  btns.push({label:'Practice menu',fn:()=>openScreen('practice')});
  setResult(acc>=PASS?'✓ '+cur.title:cur.title, starsFor(acc), acc+'%', statLine()+'.', btns, {xp:res&&res.xp});
}

/* =====================================================================
   Drill generators
   ===================================================================== */
const rnd=a=>a[Math.floor(Math.random()*a.length)];
function walk(count,size,maxStep=2,start){
  const out=[]; let i = start!=null ? start : Math.floor(Math.random()*size);
  for(let k=0;k<count;k++){ out.push(i); if(size<2) continue; let j; do{ const st=1+Math.floor(Math.random()*maxStep); j=i+(Math.random()<.5?-st:st); }while(j<0||j>=size||j===i); i=j; }
  return out;
}
const POS = {
  r:  {label:'Right hand · C position', notes:['C4','D4','E4','F4','G4'], f:[1,2,3,4,5], skills:['c-r'], need:'b2'},
  l:  {label:'Left hand · C position',  notes:['C3','D3','E3','F3','G3'], f:[5,4,3,2,1], skills:['c-l'], need:'b4'},
  both:{label:'Both hands · C position', skills:['c-r','c-l'], need:'b4'},
  bk: {label:'Black keys', notes:['C#4','D#4','F#4','G#4','A#4'], f:[2,3,2,3,4], skills:['black'], need:'b5'},
  g:  {label:'Right hand · G position', notes:['G4','A4','B4','C5','D5'], f:[1,2,3,4,5], skills:['pos'], need:'b10'},
  d:  {label:'Right hand · D position', notes:['D4','E4','F#4','G4','A4'], f:[1,2,3,4,5], skills:['pos','black'], need:'s2'},
  oct:{label:'Whole octave C–C', notes:['C4','D4','E4','F4','G4','A4','B4','C5'], f:null, skills:['c-r','scales'], need:'b7'},
};
function drillItem(def,title,regen,sub){ def.title=title; prep(def); return {kind:'drill', def, title, sub:sub||'🏋 Drill', tip:def.tip, regen}; }
const dmode=m=>m||prog.settings.drillMode||'wait';

function genNotes(v,count=16,m){
  m=dmode(m); const P=POS[v]; let toks=[];
  if(v==='both'){ for(let r=0;r<count/4;r++){ const Q=POS[r%2?'l':'r']; toks.push(...walk(4,5).map(i=>Q.notes[i]+'@'+Q.f[i])); } }
  else toks=walk(count,P.notes.length,v==='oct'?3:2).map(i=>P.notes[i]+(P.f?'@'+P.f[i]:''));
  toks[toks.length-1]+=':2';
  return drillItem({src:toks.join(' '), bpm:m==='play'?66:80, mode:m, skills:P.skills, tip:'Find each key. Numbers are finger numbers.'}, 'Note finder · '+P.label, ()=>genNotes(v,count,m));
}

const LHC={C:'[C]C3@5+E3@3+G3@1', F:'[F]C3@5+F3@2+A3@1', G:'[G]B2@5+D3@3+G3@1', Am:'[Am]A2@5+C3@3+E3@1'};
const CSETS={
  major:{label:'C · F · G', ch:['C','F','G'], map:CH, skills:['chords'], need:'c2'},
  minor:{label:'Major + minor', ch:['C','F','G','Am','Dm','Em'], map:CH, skills:['chords','minor'], need:'c4'},
  inv:  {label:'Inversions + G7', ch:['C','GB','AmC','FC','G7'], map:CH, split:48, skills:['inv'], need:'c5'},
  lh:   {label:'Left hand', ch:['C','F','G','Am'], map:LHC, skills:['lhch'], need:'c8'},
};
function genChords(v,m){
  m=dmode(m); const S=CSETS[v], seq=['C']; while(seq.length<7){ let c; do{ c=rnd(S.ch); }while(c===seq[seq.length-1]); seq.push(c); }
  if(seq[6]!=='C') seq.push('C');
  const toks=seq.map((c,i)=>S.map[c]+(i===seq.length-1?':4':':2'));
  const names=seq.map(c=>/\[([^\]]+)\]/.exec(S.map[c])[1]).join(' – ');
  return drillItem({src:toks.join(' '), bpm:m==='play'?66:70, mode:m, together:true, split:S.split, skills:S.skills, tip:names}, 'Chord changes · '+S.label, ()=>genChords(v,m));
}

const SCALES={C:{label:'C major',l:'b7'}, G:{label:'G major',l:'s3'}, F:{label:'F major',l:'s4'}, Am:{label:'A minor',l:'s5'}, CL:{label:'C major, left hand',l:'s6'}, CB:{label:'C major, hands together',l:'s7'}};
function genScale(v,bpm=72){
  const S=SCALES[v], L=LESSON[S.l];
  return drillItem({src:L.src+' '+L.src, bpm, mode:'play', metro:true, split:L.split, skills:L.skills, tip:'Twice, in tempo with the metronome.'}, 'Scale · '+S.label, ()=>genScale(v,bpm));
}

const RPAT={easy:[[1,1,1,1],[2,1,1],[1,1,2],[2,2],[4],[1,1,'r1',1],[2,'r1',1]],
            medium:[[.5,.5,1,1,1],[1,.5,.5,1,1],[.5,.5,.5,.5,2],[1,1,.5,.5,1],[2,.5,.5,1]],
            hard:[[1.5,.5,1,1],[.5,1,.5,2],[1.5,.5,1.5,.5],[.5,.5,1,.5,.5,1],[1,'r.5',.5,2]]};
const RLEVEL={easy:{label:'Easy: quarters & halves',need:'r1'}, medium:{label:'Medium: eighth notes',need:'r3'}, hard:{label:'Hard: dotted & syncopated',need:'r6'}};
function genRhythm(level){
  const pool=[...RPAT.easy, ...(level!=='easy'?RPAT.medium:[]), ...(level==='hard'?RPAT.hard:[])];
  const bars=[]; for(let i=0;i<4;i++) bars.push(rnd(pool)); bars.push([4]);
  const vals=bars.flat(), nn=vals.filter(v=>typeof v==='number').length, P=POS.r, idx=walk(nn,5,2);
  let k=0; const toks=vals.map(v=> typeof v==='string' ? 'R:'+v.slice(1) : `${P.notes[idx[k]]}@${P.f[idx[k++]]}:${v}`);
  return drillItem({src:toks.join(' '), bpm:level==='easy'?72:66, mode:'play', metro:true, skills:['rhythm'], tip:'Count along with the clicks.'}, 'Rhythm · '+RLEVEL[level].label, ()=>genRhythm(level));
}

const HANDS={turns:{label:'Taking turns',need:'h1'}, parallel:{label:'Same direction',need:'h2'}, mirror:{label:'Mirror image',need:'h3'}, melody:{label:'Melody + bass',need:'h4'}};
function genHands(v,m){
  m=dmode(m);
  const R=['C4','D4','E4','F4','G4'], Lc=['C3','D3','E3','F3','G3'], Lm=['C3','B2','A2','G2','F2'];
  let toks=[];
  if(v==='parallel') toks=walk(10,5).map(d=>`${Lc[d]}@${5-d}+${R[d]}@${d+1}`);
  else if(v==='mirror') toks=walk(10,5,2,0).map(d=>`${Lm[d]}@${d+1}+${R[d]}@${d+1}`);
  else if(v==='turns'){ for(let r=0;r<4;r++){ toks.push(...walk(3,5).map(d=>`${R[d]}@${d+1}`)); toks.push(...walk(3,5).map(d=>`${Lc[d]}@${5-d}`)); } }
  else { // melody over bass
    const BAR={C:{bass:'C3@5',tones:[0,2,4],pass:[1,3]}, G:{bass:'G3@1',tones:[1,3,4],pass:[2]}, F:{bass:'F3@2',tones:[0,3],pass:[1,2]}};
    const progn=['C',rnd(['F','G']),rnd(['C','F']),'G'];
    for(const ch of progn){ const B=BAR[ch]; for(let i=0;i<4;i++){ const d=(i===0||Math.random()<.7)?rnd(B.tones):rnd(B.pass); toks.push(i===0?`${R[d]}@${d+1}+${B.bass}~4`:`${R[d]}@${d+1}`); } }
    toks.push('C4@1+C3@5:4');
  }
  if(v!=='melody') toks[toks.length-1]+=':2';
  return drillItem({src:toks.join(' '), bpm:m==='play'?66:76, mode:m, skills:['hands'], tip:'Use the Right/Left buttons to practise one hand.'}, 'Two hands · '+HANDS[v].label, ()=>genHands(v,m));
}

const EARS={3:{label:'3 notes'}, 5:{label:'5 notes'}, wide:{label:'Whole octave'}};
function genEar(v){
  const P = v==='wide' ? POS.oct : POS.r, n = v==='wide' ? 5 : +v;
  const toks=walk(n,P.notes.length,v==='wide'?3:2,0).map(i=>P.notes[i]+(P.f?'@'+P.f[i]:''));
  toks[toks.length-1]+=':2';
  return drillItem({src:toks.join(' '), bpm:76, mode:'wait', hidden:true, preview:true, ear:true, skills:['ear'], tip:'Listen, then find the notes. It always starts on middle C. After two misses the key is shown.'}, 'Play by ear · '+EARS[v].label, ()=>genEar(v));
}


/* Pop chords: progressions behind countless hits (a chord progression on its own is free to use) */
const PV={   // right-hand voicings around middle C, so changes need little movement; [3] is the left-hand root
  C:['C4@1','E4@3','G4@5','C3'], G:['B3@1','D4@2','G4@5','G2'], Am:['C4@1','E4@2','A4@5','A2'], F:['C4@1','F4@3','A4@5','F2'],
  E:['B3@1','E4@3','G#4@5','E2'],
};
const POP={
  four:   {label:'I–V–vi–IV · Four-chord pop', ch:['C','G','Am','F'], need:'c6', songs:'Let It Be, Someone Like You, With or Without You, I\'m Yours'},
  fifties:{label:'I–vi–IV–V · \'50s progression', ch:['C','Am','F','G'], need:'c6', songs:'Stand By Me, Every Breath You Take, Earth Angel'},
  minor:  {label:'vi–IV–I–V · Minor start', ch:['Am','F','C','G'], need:'c6', songs:'Zombie, Save Tonight'},
  three:  {label:'I–IV–V · Three-chord rock', ch:['C','F','G','F'], need:'c3', songs:'La Bamba, Twist and Shout, Wild Thing'},
  andal:  {label:'i–VII–VI–V · Andalusian', ch:['Am','G','F','E'], need:'c6', songs:'Hit the Road Jack, Runaway'},
  blues:  {label:'12-bar blues', ch:['C','C','C','C','F','F','C','C','G','F','C','G'], need:'c3', songs:'Johnny B. Goode, Hound Dog, Rock Around the Clock'},
};
const POPSTYLE={   // right-hand rhythm for one bar of a chord
  held:  {label:'held chords', rh:V=>[V.slice(0,3).join('+')+':4']},
  beats: {label:'four beats', rh:V=>Array(4).fill(V.slice(0,3).join('+')+':1')},
  pop:   {label:'pop rhythm 3+3+2', rh:V=>[1.5,1.5,1].map(b=>V.slice(0,3).join('+')+':'+b)},
  broken:{label:'broken chord', rh:V=>[0,1,2,1,0,1,2,1].map(i=>V[i]+':.5')},
};
function genPop(v,m,style){
  m=dmode(m); const P=POP[v], st=style||rnd(Object.keys(POPSTYLE)), S=POPSTYLE[st];
  const seq = P.ch.length>4 ? P.ch : [...P.ch, ...P.ch];
  const bar=c=>{ const V=PV[c], t=S.rh(V); t[0]=`[${c}]`+t[0].replace(':', `+${V[3]}~4:`); return t.join(' '); };
  const F=PV[seq[0]];
  const src=seq.map(bar).join(' | ')+` | [${seq[0]}]${F.slice(0,3).join('+')}+${F[3]}:4`;
  const skills=['chords','hands', ...(P.ch.some(c=>c.includes('m'))?['minor']:[])];
  return drillItem({src, bpm:m==='play'?(st==='broken'?72:84):70, mode:m, together:true, metro:true, split:50, skills,
    tip:`${[...new Set(P.ch)].join(' – ')} · ${S.label} · heard in ${P.songs} and many more`}, 'Pop chords · '+P.label.split(' · ').pop(), ()=>genPop(v,m));
}

/* Read the note: notes on a staff, no hints on the keys (they light up after two wrong tries) */
const READ={
  c:      {label:'Treble clef · C position', notes:'C4 D4 E4 F4 G4', split:0, need:'b2'},
  treble: {label:'Treble clef · white keys', notes:'C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5 A5', split:0, need:'b10'},
  bass5:  {label:'Bass clef · C position', notes:'C3 D3 E3 F3 G3', split:128, need:'b4'},
  bass:   {label:'Bass clef · white keys', notes:'E2 F2 G2 A2 B2 C3 D3 E3 F3 G3 A3 B3 C4', split:128, need:'b9'},
  both:   {label:'Both clefs', notes:'F2 G2 A2 B2 C3 D3 E3 F3 G3 A3 B3 C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5', split:60, need:'b9'},
  acc:    {label:'Sharps and flats', notes:'C4 C#4 Db4 D4 D#4 Eb4 E4 F4 F#4 Gb4 G4 G#4 Ab4 A4 A#4 Bb4 B4 C5', split:0, need:'b5'},
};
function genRead(v){
  const P=READ[v], pool=P.notes.split(' '), seq=[];
  while(seq.length<12){ const n=rnd(pool); if(n!==seq[seq.length-1]) seq.push(n); }
  return drillItem({src:seq.join(' '), bpm:60, mode:'wait', split:P.split, view:'staff', skills:['read'],
    tip:'Read each note from the staff and play it. A wrong key shows as a red note; after two tries the key lights up.'}, 'Read the note · '+P.label, ()=>genRead(v));
}
const DRILLS=[
  {id:'notes', icon:'🎯', title:'Note finder', desc:'Random notes in one hand position. Builds a feel for where every key is.', modeable:true, variants:POS, make:v=>genNotes(v)},
  {id:'chords', icon:'🎹', title:'Chord changes', desc:'Random chord progressions. Press each chord with all its keys together.', modeable:true, variants:CSETS, make:v=>genChords(v)},
  {id:'rhythm', icon:'🥁', title:'Rhythm reading', desc:'A new rhythm every time, played in tempo with the metronome.', variants:RLEVEL, make:v=>genRhythm(v)},
  {id:'scales', icon:'📈', title:'Scale run', desc:'Scales twice through, in tempo with the metronome.', variants:Object.fromEntries(Object.entries(SCALES).map(([k,s])=>[k,{label:s.label,need:s.l}])), make:v=>genScale(v)},
  {id:'hands', icon:'🙌', title:'Hand coordination', desc:'Random two-hand patterns: turns, parallel, mirror, melody + bass.', modeable:true, variants:HANDS, make:v=>genHands(v)},
  {id:'pop', icon:'🎤', title:'Pop chords', desc:'The chord progressions behind countless hits: chords in the right hand, the bass note in the left. A new accompaniment style each time.', modeable:true, variants:POP, make:v=>genPop(v)},
  {id:'read', icon:'🎼', title:'Read the note', desc:'Notes on a real staff, scrolling past the line. Find each one on the piano without hints on the keys.', variants:READ, make:v=>genRead(v)},
  {id:'ear', icon:'👂', title:'Play by ear', desc:'Hear a short melody, then find it. The notes stay hidden.', variants:EARS, make:v=>genEar(v)},
];

/* Drills you've unlocked (by passing the lesson in `need`) — used to mix practice sessions */
function drillPool(fsk){
  const pool=[], ok=need=>!need||passed(need);
  const add=(skills,make)=>{ if(!fsk || skills.some(s=>fsk.includes(s))) pool.push({skills,make}); };
  for(const [k,p] of Object.entries(POS)) if(ok(p.need)) add(p.skills,()=>genNotes(k));
  for(const [k,s] of Object.entries(CSETS)) if(ok(s.need)) add(s.skills,()=>genChords(k));
  for(const [k,r] of Object.entries(RLEVEL)) if(ok(r.need)) add(['rhythm'],()=>genRhythm(k));
  for(const [k,s] of Object.entries(SCALES)) if(ok(s.l)) add(LESSON[s.l].skills,()=>genScale(k));
  for(const [k,h] of Object.entries(HANDS)) if(ok(h.need)) add(['hands'],()=>genHands(k));
  for(const [k,p] of Object.entries(POP)) if(ok(p.need)) add(['chords','hands'],()=>genPop(k));
  for(const [k,r] of Object.entries(READ)) if(ok(r.need)) add(['read'],()=>genRead(k));
  if(passed('b2')) add(['ear'],()=>genEar(3));
  if(passed('b8')) add(['ear'],()=>genEar(5));
  if(passed('b7')) add(['ear'],()=>genEar('wide'));
  if(!pool.length && !fsk) pool.push({skills:['c-r'], make:()=>genNotes('r',12,'wait')});
  if(!pool.length && fsk){   // focus on something not yet unlocked: give the entry-level drill
    const base={rhythm:()=>genRhythm('easy'), chords:()=>genChords('major'), scales:()=>genScale('C',60), hands:()=>genHands('turns'), ear:()=>genEar(3), 'c-r':()=>genNotes('r')};
    for(const s of fsk) if(base[s]){ pool.push({skills:[s],make:base[s]}); break; }
  }
  return pool;
}

/* =====================================================================
   Practice sessions
   ===================================================================== */
const FOCUS={
  basics:{label:'🌱 Basics', skills:['c-r','c-l','black','pos']},
  rhythm:{label:'🥁 Rhythm', skills:['rhythm']},
  chords:{label:'🎶 Chords', skills:['chords','minor','inv','lhch']},
  scales:{label:'📈 Scales', skills:['scales']},
  hands: {label:'🙌 Two hands', skills:['hands']},
  ear:   {label:'👂 Ear', skills:['ear']},
  read:  {label:'🎼 Reading', skills:['read']},
  songs: {label:'🎵 Songs', skills:['songs']},
};
function estimate(d){ const end=d.notes.reduce((m,n)=>Math.max(m,n.start+n.dur),0), dur=(end+LEAD)/Math.max(0.25,speed); return dur*(d.mode==='wait'?2.2:1.15)*(d.preview?1.8:1)+12; }
function warmup(fsk){
  const L=learnedSkills();
  if(fsk && fsk.includes('rhythm')) return genRhythm('easy');
  if(fsk && fsk.some(s=>['chords','minor','inv','lhch'].includes(s)) && passed('c2')) return genChords('major');
  if(passed('b7')) return Object.assign(genScale(rnd(Object.keys(SCALES).filter(k=>passed(SCALES[k].l)))),{});
  if(L.has('c-l') && L.has('c-r')) return genNotes('both',8);
  return genNotes('r',8,'wait');
}
function pickSong(match,exclude){
  const songs=ALL_LESSONS.filter(l=>l.skills.includes('songs') && match(l) && !exclude.includes(l));
  const done=songs.filter(l=>passed(l.id)).sort((a,b)=>dueness(b.id)-dueness(a.id));
  const next=PATH.map(id=>LESSON[id]).find(l=>songs.includes(l) && !passed(l.id));
  if(done.length && (Math.random()<0.6 || !next)) return lessonItem(rnd(done.slice(0,3)));
  return next ? Object.assign(lessonItem(next),{isNew:true}) : null;
}
function buildSession(min, focus){
  const target=min*60, items=[]; let est=0;
  const fsk=focus?FOCUS[focus].skills:null, match=l=>!fsk || l.skills.some(s=>fsk.includes(s));
  const push=(it,section)=>{ it.section=section; items.push(it); est+=estimate(it.def); };
  if(focus!=='songs') push(warmup(fsk),'Warm-up');
  const beginner = nPassed()<5;
  const nNew = (min<=10?1:2) + (beginner?1:0), maxNew = nNew+2;
  const upcoming = PATH.map(id=>LESSON[id]).filter(l=>!passed(l.id) && match(l));
  const news=[]; let ni=0;
  const takeNew=()=>{ const l=upcoming[ni++]; if(!l) return false; news.push(l); push(Object.assign(lessonItem(l),{isNew:true}),'New'); return true; };
  for(let i=0;i<nNew;i++) takeNew();
  const songIt = (!focus || focus==='songs' || focus==='hands') ? pickSong(match,upcoming.slice(0,maxNew)) : null;
  const songEst = songIt ? estimate(songIt.def) : 0;
  const review = ALL_LESSONS.filter(l=>passed(l.id) && match(l) && !(songIt&&songIt.lesson===l))
                            .sort((a,b)=>dueness(b.id)-dueness(a.id));
  const drills = drillPool(fsk), used=new Map(), maxReview=Math.max(3,Math.round(min/2.5));
  const freshDrill=()=>{ const cap=fsk?6:3, ok=drills.filter(d=>(used.get(d)||0)<cap); if(!ok.length) return null; let d=rnd(ok); if(ok.length>1) while(d===last) d=rnd(ok); return d; };
  let ri=0, last=null, again=0;
  for(let k=0; est+songEst<target && k<40; k++){
    const d = k%2===0 ? freshDrill() : null;
    if(d){ used.set(d,(used.get(d)||0)+1); last=d; push(d.make(),'Mix'); }
    else if(ri<review.length && ri<maxReview) push(lessonItem(review[ri++]),'Review');
    else if(ni<maxNew && takeNew()){}                                  // little unlocked yet: learn a bit more
    else { const d2=freshDrill(); if(d2){ used.set(d2,(used.get(d2)||0)+1); last=d2; push(d2.make(),'Mix'); }
           else if(again<news.length){ push(lessonItem(news[again++]),'Again'); }   // repeat today's new lessons once
           else break; }
  }
  if(songIt) push(songIt,'Song');
  return items;
}
function startSession(min, focus, items, title){
  items=items||buildSession(min,focus);
  session={items, idx:0, results:[], sec:0, min, focus, est:Math.round(items.reduce((a,i)=>a+estimate(i.def),0)/60), title: title || (focus?FOCUS[focus].label+' session':'Today\'s practice')};
  trainer=null; prog.settings.sessionMin=min; saveProg();
  sessionCard(null);
}
function goItem(it){ if(it.isNew && it.lesson && !passed(it.lesson.id)) showIntro(it.lesson,it); else startItem(it); }
function sessionCard(prev){
  closeScreen(); $('#intro').hidden=true;
  if(playing) togglePlay();
  const S=session, it=S.items[S.idx];
  if(!it) return sessionSummary();
  const nextTxt=`Up next (${S.idx+1}/${S.items.length}) · <b>${esc(it.section)}</b>: ${esc(it.title)}`;
  const btns=[{label:'▶ Go',primary:true,fn:()=>goItem(it)}, {label:'Skip',fn:()=>{ S.idx++; sessionCard(null); }}];
  if(prev) btns.splice(1,0,{label:'↺ Retry last',fn:()=>{ S.idx--; S.results.pop(); goItem(S.items[S.idx]); }});
  btns.push({label:'End session',fn:sessionSummary});
  if(prev) setResult(prev.acc>=PASS?'✓ '+prev.title:prev.title, prev.res?starsFor(prev.acc):null, prev.res?prev.acc+'%':'–', nextTxt, btns, {html:true, xp:prev.res&&prev.res.xp});
  else setResult(S.title, null, `~${Math.max(1,S.est)} min`, `${S.items.length} exercises: ${[...new Set(S.items.map(i=>i.section.toLowerCase()))].join(', ')}.<br>${nextTxt}`, btns, {html:true});
  countdown(prev?5:4, ()=>goItem(it));
}
function sessionAfter(acc,res){
  const S=session; S.results.push({title:cur.title, section:cur.section, acc, xp:res?res.xp:0});
  S.idx++; sessionCard({acc, res, title:cur.title});
}
function sessionSummary(){
  const S=session; if(!S){ openScreen('home'); return; }
  if(playing) togglePlay();
  flushTime();
  session=null; closeScreen();
  const done=S.results.length, avg=done?Math.round(S.results.reduce((a,r)=>a+r.acc,0)/done):0;
  let bonus=0;
  if(done>=2){ prog.counts.sessions++; bonus=20+Math.round(S.sec/60)*3; addXP(bonus); checkAch(); saveProg(); }
  const xp=S.results.reduce((a,r)=>a+r.xp,0)+bonus;
  const list='<ul>'+S.results.map(r=>`<li><span>${r.acc>=PASS?'✓':'·'}</span><span>${esc(r.section)} · ${esc(r.title)}</span><span>${r.acc}%</span></li>`).join('')+'</ul>';
  const g=prog.settings.goal*60, today=day().sec;
  setResult(done>=2?'💪 Session complete':'Session ended', null, fmtTime(S.sec),
    `${done} exercises · average ${avg}%${bonus?` · session bonus +${bonus} XP`:''}<br>Today: ${Math.round(today/60)} of ${prog.settings.goal} min${today>=g?' 🎯':''} · 🔥 ${streak()} day streak${list}`,
    [{label:'🏠 Home',primary:true,fn:()=>openScreen('home')},{label:'Another session',fn:()=>startSession(S.min,S.focus)},{label:'Close',fn:closeResult}],{html:true, xp});
}
const fmtTime=s=>{ s=Math.round(s); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };

/* ---------- Speed trainer ---------- */
function startTrainer(it, startSpeed=0.5, goal=1){
  if(!it) return;
  session=null;
  const tIt={...it, def:{...it.def, mode:'play'}, title:it.title};
  let idx=SPEEDS.indexOf(startSpeed); if(idx<0) idx=2;
  trainer={item:tIt, idx, goal};
  setSpeed(SPEEDS[idx]); startItem(tIt);
}
function trainerAfter(acc,res){
  const T=trainer, sp=SPEEDS[T.idx], pct=s=>Math.round(s*100)+'%';
  const stop={label:'Stop',fn:()=>{ trainer=null; closeResult(); }};
  if(acc>=90 && sp>=T.goal){
    prog.counts.trainer++; addXP(30); checkAch(); saveProg();
    const btns=[{label:'Done',primary:true,fn:()=>{ trainer=null; closeResult(); }}];
    if(T.idx<SPEEDS.length-1) btns.push({label:`Go for ${pct(SPEEDS[T.idx+1])}`,fn:()=>{ T.goal=SPEEDS[T.idx+1]; T.idx++; setSpeed(SPEEDS[T.idx]); startItem(T.item); }});
    return setResult('🚀 Goal speed reached!', starsFor(acc), acc+'%', `You played ${T.item.title} at ${pct(sp)} speed. +30 XP bonus.`, btns, {xp:res&&res.xp});
  }
  if(acc>=90){
    T.idx++; setSpeed(SPEEDS[T.idx]);
    return setResult(`⚡ Speed up: ${pct(SPEEDS[T.idx])}`, starsFor(acc), acc+'%', `Great, ${acc}% at ${pct(sp)}. Next run is a bit faster (goal ${pct(T.goal)}).`, [{label:'▶ Continue',primary:true,fn:()=>startItem(T.item)},stop], {xp:res&&res.xp});
  }
  const btns=[{label:'▶ Try again',primary:true,fn:()=>startItem(T.item)}];
  if(T.idx>0) btns.push({label:`Slower (${pct(SPEEDS[T.idx-1])})`,fn:()=>{ T.idx--; setSpeed(SPEEDS[T.idx]); startItem(T.item); }});
  btns.push(stop);
  setResult(`Stay at ${pct(sp)}`, starsFor(acc), acc+'%', `Score 90% or more to speed up. Goal: ${pct(T.goal)}.`, btns, {xp:res&&res.xp});
}
function setSpeed(s){ speed=s; $('#speed').value=String(s); }

/* =====================================================================
   Drawing
   ===================================================================== */
function rrect(x,y,w,h,r){ cx.beginPath(); if(cx.roundRect) cx.roundRect(x,y,w,h,Math.min(r,h/2,w/2)); else cx.rect(x,y,w,h); cx.fill(); }
function rline(x,y,w,h,r,col,lw){   // rounded outline, drawn just inside the shape
  x+=lw/2; y+=lw/2; w-=lw; h-=lw; if(w<=0||h<=0) return;
  cx.beginPath(); if(cx.roundRect) cx.roundRect(x,y,w,h,Math.max(0,Math.min(r,h/2,w/2))); else cx.rect(x,y,w,h);
  cx.lineWidth=lw; cx.strokeStyle=col; cx.stroke();
}
function draw(){
  cx.fillStyle=C.bg; cx.fillRect(0,0,W,H);
  if(staffView()) drawStaff(); else drawFalling();
  drawKeys();
}
function drawFalling(){   // notes falling towards the keyboard
  for(let m=lo;m<=hi;m++){
    const r=keyRect(m); if(!r) continue;
    if(r.black){ cx.fillStyle='rgba(0,0,0,0.22)'; cx.fillRect(r.x,0,r.w,kbTop); }
    else if(m%12===0){ cx.fillStyle='rgba(255,255,255,0.07)'; cx.fillRect(r.x,0,1,kbTop); }
  }
  const pps=kbTop/LOOK, hidden=song&&song.hidden;
  cx.save(); cx.beginPath(); cx.rect(0,0,W,kbTop); cx.clip();
  cx.textAlign='center'; cx.textBaseline='bottom';
  for(const n of notes){
    const yb=kbTop-(n.start-t)*pps; if(yb<0) break;
    const yt=yb-n.dur*pps; if(yt>kbTop) continue;
    let r=keyRect(n.midi); if(!r) continue;
    const masked = hidden && (mode==='listen' || !(n.hit || n.g.reveal));
    if(masked){
      cx.globalAlpha=0.7; cx.fillStyle=OTHER; rrect(W/2-20,yt,40,Math.max(4,yb-yt),5);
      cx.globalAlpha=1; cx.fillStyle=C.text; cx.font='700 14px system-ui,sans-serif'; if(yb-yt>16) cx.fillText('?',W/2,yb-3);
      continue;
    }
    const other = mode!=='listen' && !n.req, handFill = n.hand==='L' ? C.left : C.accent;
    const nw=Math.max(r.w-3,7), nx=r.x+r.w/2-nw/2, nh=Math.max(4,yb-yt);   // black-key notes never get thinner than 7 px
    if(other){   // the hand the app plays for you: see-through, with a solid outline in that hand's colour
      cx.globalAlpha=0.28; cx.fillStyle=handFill; rrect(nx,yt,nw,nh,5);
      cx.globalAlpha=0.9; rline(nx,yt,nw,nh,5,handFill,1.5);
    } else {
      cx.globalAlpha = n.missed ? 0.45 : 1;
      cx.fillStyle = n.hit ? C.good : n.missed ? C.bad : handFill; rrect(nx,yt,nw,nh,5);
      if(r.black){ cx.globalAlpha=1; rline(nx,yt,nw,nh,5,'rgba(10,12,22,.85)',1.5); }   // keeps black-key notes apart from their neighbours
    }
    cx.globalAlpha=1;
    if(labelScale && nw>=11){   // note name at the bottom of the note, finger number above it, shrunk to fit narrow keys
      const fit=(txt,size,weight)=>{ cx.font=`${weight} ${size}px system-ui,sans-serif`; const w=cx.measureText(txt).width; if(w>nw){ size=Math.floor(size*nw/w); cx.font=`${weight} ${size}px system-ui,sans-serif`; } return size; };
      cx.fillStyle = other ? C.text : 'rgba(10,12,22,.8)';
      const nm=NAMES[n.midi%12], s1=fit(nm,Math.round(11*labelScale),600);
      if(yb-yt>s1+5){
        cx.fillText(nm,r.x+r.w/2,yb-3);
        if(n.finger){ const s2=fit(String(n.finger),Math.round(14*labelScale),800); if(yb-yt>s1+s2+9) cx.fillText(n.finger,r.x+r.w/2,yb-s1-6); }
      }
    }
    if(n.label){   // chord name in a pill to the left of the chord (right if no room)
      const ls=Math.max(1,labelScale), ph=Math.round(20*ls);
      cx.font=`700 ${Math.round(13*ls)}px system-ui,sans-serif`; const tw=cx.measureText(n.label).width+12*ls, py=Math.min(yb,kbTop)-ph-2;
      const px = r.x-tw-6>=0 ? r.x-tw-6 : r.x+r.w+6;
      cx.fillStyle='rgba(23,27,46,.9)'; rrect(px,py,tw,ph,ph/2);
      cx.fillStyle=C.text; cx.textAlign='left'; cx.textBaseline='middle'; cx.fillText(n.label,px+6*ls,py+ph/2+.5);
      cx.textAlign='center'; cx.textBaseline='bottom';
    }
  }
  cx.globalAlpha=1; cx.restore();
  cx.fillStyle = waiting ? C.accent : 'rgba(255,255,255,0.25)'; cx.fillRect(0,kbTop-2,W,2);

}
function drawKeys(){   // the keyboard: what's held, what the app plays, and (unless you're reading) which key comes next
  if(kbH<=0) return;
  const hidden=song&&song.hidden, reading=readingItem();
  const target=new Map(), sounding=new Map(), g=groups[gi];
  if(mode==='wait' && g && g.start-t<=EARLY && (!(hidden||reading) || g.reveal)) [...g.notes, ...(hidden||reading?[]:chordFollowers())].forEach(n=>{ if(n.req && !n.hit && !target.has(n.midi)) target.set(n.midi,n); });
  if(playing && !(hidden && mode==='listen')) for(let i=Math.max(0,si-64);i<si;i++){ const n=notes[i]; if(!n.req && n.start<=t && n.start+n.dur>t) sounding.set(n.midi,n); }
  const pulse = 0.55+0.45*Math.sin(performance.now()/180);
  const handCol=n=>n.hand==='L'?C.left:C.accent;

  const paintKey=(m,r)=>{
    const h=held.get(m), isHeld=held.has(m);
    const x=r.x+(r.black?0:1), w=r.w-(r.black?0:2), rad=r.black?3:5;
    let fill = r.black ? '#1a1d2b' : '#f3f4fa';
    if(isHeld) fill = h===true ? C.good : h===false ? C.bad : '#a9b0d8';
    else if(sounding.has(m)) fill = mode==='listen' ? handCol(sounding.get(m)) : '#8a90b4';
    cx.fillStyle=fill; rrect(x, kbTop, w, r.h, rad);
    const tg=target.get(m);
    if(!isHeld && tg){
      cx.globalAlpha = waiting ? pulse : 0.35; cx.fillStyle=handCol(tg); rrect(x,kbTop,w,r.h,rad); cx.globalAlpha=1;
      if(tg.finger && labelScale){
        const cxp=r.x+r.w/2, cyp=kbTop+r.h*(r.black?0.72:0.62), rr=Math.min(11*labelScale,r.w/2-1);
        cx.fillStyle='#0b0e1a'; cx.beginPath(); cx.arc(cxp,cyp,rr,0,Math.PI*2); cx.fill();
        cx.fillStyle='#fff'; cx.font=`800 ${Math.round(rr*1.25)}px system-ui,sans-serif`; cx.textAlign='center'; cx.textBaseline='middle'; cx.fillText(tg.finger,cxp,cyp+1);
      }
    }
  };
  for(const m of whites) paintKey(m,keyRect(m));
  cx.textAlign='center'; cx.textBaseline='bottom'; cx.font=`${Math.round(10*Math.max(1,labelScale*.8))}px system-ui,sans-serif`; cx.fillStyle='#7a7f9e';
  for(const m of whites) if(m%12===0 && ww>=16){ const r=keyRect(m); cx.fillText('C'+(m/12-1), r.x+r.w/2, H-4); }
  for(let m=lo;m<=hi;m++) if(isBlack(m)){ const r=keyRect(m); if(r) paintKey(m,r); }

}


/* =====================================================================
   Sheet music: a grand staff that scrolls past a playhead.
   Glyphs come from Bravura (a SMuFL music font, SIL Open Font License, see fonts/).
   Notes are spaced by time (like Simply Piano) rather than engraved like a printed page.
   ===================================================================== */
const SMUFL={gClef:'', fClef:'', sharp:'', flat:'', natural:'',
  flag8Up:'', flag8Down:'', flag16Up:'', flag16Down:'',
  restWhole:'', restHalf:'', restQuarter:'', dot:''};
const tsDigits=n=>String(n).split('').map(c=>String.fromCharCode(0xE080+(+c))).join('');
let musicFont=null, musicFontReady=false, sheet=null;
function ensureMusicFont(){
  if(!musicFont) musicFont=new FontFace('Bravura','url(fonts/bravura.woff2)').load().then(f=>{ document.fonts.add(f); musicFontReady=true; }).catch(()=>{});
  return musicFont;
}
const staffView=()=>!!song && notes.length>0 && !song.hidden && (song.view==='staff' || prog.settings.view==='staff');
const readingItem=()=>!!song && song.view==='staff';   // reading practice: no hints on the keys

/* ---------- From notes to notation ---------- */
const LETTERS='CDEFGAB', STEP_PC=[0,2,4,5,7,9,11], SHARPS='FCGDAEB', FLATS='BEADGCF';
const sigAcc=(k,L)=> k>0 && SHARPS.indexOf(L)<k ? 1 : k<0 && FLATS.indexOf(L)< -k ? -1 : 0;   // what the key signature does to a letter
function estimateKey(ns){   // the key signature that fits the notes best, as a major key or its relative minor (whose raised 6th and 7th count half)
  if(!ns.length) return 0;
  const named=ns.filter(n=>n.name).length>ns.length/2;
  const lastT=Math.max(...ns.map(n=>n.start)), endPc=Math.min(...ns.filter(n=>n.start>lastT-0.1).map(n=>n.midi))%12, bonus=0.08*ns.length;   // pieces end on their home note
  let best=0, bs=-1e9;
  for(let k=-6;k<=6;k++){
    const tonicL=((4*k)%7+7)%7, minorL=(tonicL+5)%7;   // letter of the major key's tonic (C, G, D, … / F, B♭, …) and of its relative minor
    let major=0, minor=0;
    if(named){
      for(const n of ns){ const m=n.name&&/^([A-G])(#|b)?/.exec(n.name); if(!m) continue;
        const L=LETTERS.indexOf(m[1]), a=m[2]==='#'?1:m[2]==='b'?-1:0, fits=a===sigAcc(k,m[1]);
        if(fits) major++;
        if(fits) minor++; else if((L===(minorL+6)%7 || L===(minorL+5)%7) && a===sigAcc(k,m[1])+1) minor+=0.5; }
    } else {
      const tonic=((7*k)%12+12)%12, scale=STEP_PC.map(x=>(x+tonic)%12), mt=(tonic+9)%12, raised=[(mt+11)%12,(mt+9)%12];
      for(const n of ns){ const pc=n.midi%12; if(scale.includes(pc)){ major++; minor++; } else if(raised.includes(pc)) minor+=0.5; }
    }
    const tonicPc=((7*k)%12+12)%12;
    if(endPc===tonicPc) major+=bonus; if(endPc===(tonicPc+9)%12) minor+=bonus;
    const sc=Math.max(major,minor)-0.001*Math.abs(k);
    if(sc>bs){ bs=sc; best=k; }
  }
  return best;
}
function spellIn(midi,k){   // spell a key number to suit key signature k
  const pc=midi%12, o=Math.floor(midi/12)-1; let best=null, bs=-1;
  for(let li=0;li<7;li++) for(const a of [0,1,-1]){
    if((STEP_PC[li]+a+12)%12!==pc) continue;
    const sc=(a===sigAcc(k,LETTERS[li])?4:0)+(a===0?2:0)+((k>=0?a===1:a===-1)?1:0);
    if(sc>bs){ bs=sc; best={li,a}; }
  }
  const oct = best.li===0&&best.a===-1 ? o+1 : best.li===6&&best.a===1 ? o-1 : o;   // C♭ and B♯ belong to the neighbouring octave
  return {d:oct*7+best.li, acc:best.a};
}
function spell(n,k=0){   // staff step (C0 = 0, D0 = 1, …) and accidental, from the written name when there is one
  const m=n.name && /^([A-G])(#|b)?(-?\d)$/.exec(n.name);
  return m ? {d:(+m[3])*7+LETTERS.indexOf(m[1]), acc:m[2]==='#'?1:m[2]==='b'?-1:0} : spellIn(n.midi,k);
}
const VALUES=[[4,'w',0],[3,'h',1],[2,'h',0],[1.5,'q',1],[1,'q',0],[0.75,'8',1],[0.5,'8',0],[0.375,'16',1],[0.25,'16',0]];
function noteValue(beats){ if(beats>=5) return [6,'w',1]; let best=VALUES[VALUES.length-1], bd=1e9; for(const v of VALUES){ const d=Math.abs(Math.log(beats/v[0])); if(d<bd){ bd=d; best=v; } } return best; }
function engrave(){   // worked out once per song: key, bars, chords per hand with values, stems, beams, accidentals and rests
  const k=song.keySig!=null ? song.keySig : estimateKey(notes);
  const q=song.q || songBeat;
  const ts=song.ts || (song.pulse===3 ? {n:meter*3, d:8} : {n:meter, d:4});
  const barLen=ts.n*q*4/ts.d, written=notes.some(n=>n.name) && !!song.bpm;   // Keys' own notation plays notes 8% short of their value
  let bars=(song.bars&&song.bars.length ? song.bars : []).filter(b=>b>0.01);
  if(!bars.length) for(let b=barLen;b<songEnd+barLen;b+=barLen) bars.push(b);
  const barAt=t=>{ let lo=0, hi=bars.length; while(lo<hi){ const m=(lo+hi)>>1; if(bars[m]<=t+1e-3) lo=m+1; else hi=m; } return lo; };   // bar number
  const barStart=i=> i===0 ? Math.min(0, (bars[0]||barLen)-barLen) : bars[i-1];
  const ev=[], rests=[], beams=[];
  for(const hand of ['R','L']){
    const es=[]; let g=null;
    for(const n of notes){ if(n.hand!==hand) continue; if(g && n.start-g.t<0.06){ g.notes.push(n); continue; } g={t:n.start, hand, notes:[n]}; es.push(g); }
    if(!es.length) continue;
    const mid=hand==='R'?34:22;   // middle line of the staff: B4 / D3
    let state=new Map(), stateBar=-1, lastEnd=0;
    for(const e of es){
      const beats=Math.max(...e.notes.map(n=>n.dur))*(written?1/0.92:1)/q;
      e.val=noteValue(beats); e.bar=barAt(e.t);
      if(e.bar!==stateBar){ state=new Map(); stateBar=e.bar; }
      e.heads=e.notes.map(n=>{ const sp=spell(n,k), cur=state.has(sp.d)?state.get(sp.d):sigAcc(k,LETTERS[((sp.d%7)+7)%7]);
        const show = sp.acc!==cur ? sp.acc : null; if(show!==null) state.set(sp.d,sp.acc);
        return {n, d:sp.d, show}; }).sort((a,b)=>a.d-b.d);
      e.up=(e.heads.reduce((a,h)=>a+h.d,0)/e.heads.length)<mid;
      ev.push(e);
    }
    // beams: eighths and sixteenths within one beat (a dotted quarter in 6/8) and one bar
    const grp=ts.d===8&&ts.n%3===0 ? 1.5*q : q; let run=[];
    const flush=()=>{ if(run.length>1){ const up=run.filter(e=>e.up).length>=run.length/2; run.forEach(e=>{ e.up=up; e.beam=beams.length; }); beams.push(run); } run=[]; };
    for(const e of es){
      const short=e.val[1]==='8'||e.val[1]==='16', bs=barStart(e.bar), slot=Math.floor((e.t-bs+1e-3)/grp), p=run[run.length-1];
      if(!short){ flush(); continue; }
      if(p && (p.bar!==e.bar || p.slot!==slot || e.t-(p.t+p.val[0]*q)>0.1*q)) flush();
      e.slot=slot; run.push(e);
    }
    flush();
    // rests where this hand is silent for a beat or more
    const add=(t,len)=>{ let c=t, left=len; while(left>=0.95*q){ const two=left>=1.95*q; rests.push({t:c, hand, kind:two?'h':'q'}); c+=two?2*q:q; left-=two?2*q:q; } };
    for(let b=0;b<=bars.length;b++){
      const b0=barStart(b), b1=b<bars.length?bars[b]:Math.max(b0+barLen,songEnd); if(b0>songEnd) break;
      const inBar=es.filter(e=>e.bar===b);
      if(!inBar.length && lastEnd<=b0+0.01){ if(b1-b0>=0.95*q) rests.push({t:b0, t1:b1, hand, kind:'w'}); continue; }
      let cur=Math.max(b0,lastEnd);
      for(const e of inBar){ if(e.t-cur>=0.95*q) add(cur,e.t-cur); cur=Math.max(cur,e.t+e.val[0]*q); lastEnd=Math.max(lastEnd,cur); }
      if(b1-cur>=0.95*q && b1<=songEnd+0.01) add(cur,b1-cur);
    }
  }
  ev.sort((a,b)=>a.t-b.t);
  const on=[...new Set(ev.map(e=>+e.t.toFixed(3)))].sort((a,b)=>a-b), gaps=on.slice(1).map((t,i)=>t-on[i]).filter(g=>g>0.03).sort((a,b)=>a-b);
  return {song, k, ts, q, bars, ev, rests, beams, minGap: gaps.length ? gaps[Math.floor(gaps.length*0.1)] : q};
}

/* ---------- Drawing ---------- */
function staffGeom(){
  const hud=72;                                      // room for the score and tip at the top
  const sp=Math.max(6, Math.min(15, (kbTop-hud)/20)); // the space between two staff lines
  const gap=6*sp, total=8*sp+gap;                   // two staves of four spaces, and room between them for middle C
  const top=hud+2.5*sp+Math.max(0,(kbTop-hud-20*sp)/2), trebleBot=top+4*sp, bassBot=trebleBot+gap+4*sp;
  return {sp, top, trebleBot, bassBot, left:sp*1.2, clefW:sp*4.2};
}
// The bottom line of the treble staff is E4 (step 30), of the bass staff G2 (step 18)
const staffBase=bass=>bass?18:30;
const staffY=(G,d,bass)=>(bass?G.bassBot:G.trebleBot)-(d-staffBase(bass))*G.sp/2;
const noteLabel=n=>{ const m=n.name&&/^([A-G])(#|b)?/.exec(n.name); return m ? m[1]+(m[2]==='#'?'♯':m[2]==='b'?'♭':'') : NAMES[n.midi%12].replace('#','♯'); };
function drawStaff(){
  ensureMusicFont();
  if(!sheet || sheet.song!==song) sheet=engrave();
  const S=sheet, G=staffGeom(), sp=G.sp, g=groups[gi], reading=readingItem(), font=`${4*sp}px Bravura`;
  const ksW=Math.abs(S.k)*sp*1.05, tsW=sp*2.6, headW=G.clefW+ksW+tsW, playX=G.left+headW+sp*2.5;
  const lineCol='rgba(232,234,246,.55)';
  cx.strokeStyle=lineCol; cx.lineWidth=1;
  for(const bot of [G.trebleBot,G.bassBot]) for(let i=0;i<5;i++){ const y=Math.round(bot-i*sp)+.5; cx.beginPath(); cx.moveTo(G.left,y); cx.lineTo(W,y); cx.stroke(); }
  cx.beginPath(); cx.moveTo(G.left+.5,G.top); cx.lineTo(G.left+.5,G.bassBot); cx.stroke();   // the line joining the two staves
  if(musicFontReady){   // clefs, key signature and time signature stay at the left
    cx.fillStyle=C.text; cx.font=font; cx.textAlign='left'; cx.textBaseline='alphabetic';
    cx.fillText(SMUFL.gClef, G.left+sp*.5, G.trebleBot-sp);   // the treble (G) clef curls around the G line
    cx.fillText(SMUFL.fClef, G.left+sp*.5, G.bassBot-3*sp);   // the bass (F) clef's dots sit either side of the F line
    const order=S.k>0?[38,35,39,36,33,37,34]:[34,37,33,36,32,35,31];   // treble steps of F♯ C♯ G♯ … / B♭ E♭ A♭ …
    for(let i=0;i<Math.abs(S.k);i++) for(const bass of [false,true]) cx.fillText(S.k>0?SMUFL.sharp:SMUFL.flat, G.left+G.clefW+i*sp*1.05, staffY(G, order[i]-(bass?14:0), bass));
    const tx=G.left+G.clefW+ksW+sp*.2;
    for(const bot of [G.trebleBot,G.bassBot]){ cx.fillText(tsDigits(S.ts.n), tx, bot-3*sp); cx.fillText(tsDigits(S.ts.d), tx, bot-sp); }
  }
  const pulse=0.55+0.45*Math.sin(performance.now()/180);   // the playhead pulses while the music waits for you
  cx.globalAlpha=waiting?pulse:1; cx.fillStyle=waiting?C.accent:'rgba(124,140,255,.5)';
  cx.fillRect(playX-1, G.top-2.5*sp, 2, G.bassBot-G.top+5*sp); cx.globalAlpha=1;
  const pps=Math.max(5*sp/S.q, 2.8*sp/Math.max(0.05,S.minGap));   // a quarter note is at least 5 spaces, and close notes never overlap
  const X=tt=>playX+(tt-t)*pps, tMin=t-(playX-G.left)/pps-1, tMax=t+(W-playX)/pps+1;
  cx.save(); cx.beginPath(); cx.rect(G.left+headW,0,W,kbTop); cx.clip();
  cx.strokeStyle=lineCol; cx.lineWidth=1;   // bar lines
  for(const b of S.bars){ if(b<tMin) continue; if(b>tMax) break; const x=Math.round(X(b)-sp*.9)+.5; cx.beginPath(); cx.moveTo(x,G.trebleBot-4*sp); cx.lineTo(x,G.bassBot); cx.stroke(); }
  if(musicFontReady){ cx.fillStyle='rgba(232,234,246,.7)'; cx.font=font; cx.textAlign='center'; cx.textBaseline='alphabetic';   // rests
    for(const r of S.rests){ if(r.t<tMin||r.t>tMax) continue; const bot=r.hand==='L'?G.bassBot:G.trebleBot;
      if(r.kind==='w') cx.fillText(SMUFL.restWhole, (X(r.t)+X(r.t1))/2-sp*.9, bot-3*sp); else cx.fillText(r.kind==='h'?SMUFL.restHalf:SMUFL.restQuarter, X(r.t), bot-2*sp); } }
  const colorOf=n=>{ const other=mode!=='listen'&&!n.req; return other ? 'rgba(232,234,246,.35)' : n.hit ? C.good : n.missed ? C.bad : g&&n.g===g ? C.accent : C.text; };
  const stemEnd=e=>{ const bass=e.hand==='L', ys=e.heads.map(h=>staffY(G,h.d,bass)); return e.up ? Math.min(...ys)-3.5*sp : Math.max(...ys)+3.5*sp; };
  // beams first, so stems can meet them
  const beamY=new Map();
  for(const [i,run] of S.beams.entries()){ if(run[run.length-1].t<tMin || run[0].t>tMax) continue; const up=run[0].up, ends=run.map(stemEnd), y=up?Math.min(...ends):Math.max(...ends); beamY.set(i,y);
    const x0=X(run[0].t)+(up?sp*.6:-sp*.6), x1=X(run[run.length-1].t)+(up?sp*.6:-sp*.6), th=sp*.5;
    cx.fillStyle=colorOf(run[0].notes[0]); cx.fillRect(x0-.5, up?y:y-th, x1-x0+1, th);
    for(let j=0;j<run.length-1;j++) if(run[j].val[1]==='16' && run[j+1].val[1]==='16'){ const a=X(run[j].t)+(up?sp*.6:-sp*.6), b=X(run[j+1].t)+(up?sp*.6:-sp*.6); cx.fillRect(a-.5, up?y+th*1.6:y-th*2.6, b-a+1, th); } }
  for(const e of S.ev){
    if(e.t<tMin) continue; if(e.t>tMax) break;
    const x=X(e.t), bass=e.hand==='L', base=staffBase(bass), col=colorOf(e.notes[0]);
    cx.lineWidth=Math.max(1,sp*.12);
    for(const h of e.heads){   // ledger lines
      const rel=h.d-base; cx.strokeStyle=colorOf(h.n);
      for(let k2=-2;k2>=rel;k2-=2){ const ly=staffY(G,base+k2,bass); cx.beginPath(); cx.moveTo(x-sp*1.15,ly); cx.lineTo(x+sp*1.15,ly); cx.stroke(); }
      for(let k2=10;k2<=rel;k2+=2){ const ly=staffY(G,base+k2,bass); cx.beginPath(); cx.moveTo(x-sp*1.15,ly); cx.lineTo(x+sp*1.15,ly); cx.stroke(); }
    }
    const open=e.val[1]==='w'||e.val[1]==='h';
    e.heads.forEach((h,i)=>{   // noteheads; a second (two neighbouring steps) moves to the other side of the stem
      const y=staffY(G,h.d,bass), shift=i>0 && h.d-e.heads[i-1].d===1 && !e.heads[i-1].shifted ? (h.shifted=true, e.up?sp*1.25:-sp*1.25) : (h.shifted=false, 0), hx=x+shift;
      cx.strokeStyle=cx.fillStyle=colorOf(h.n);
      cx.save(); cx.translate(hx,y); cx.rotate(-0.35); cx.beginPath(); cx.ellipse(0,0,sp*.66,sp*.45,0,0,Math.PI*2); cx.restore();
      if(open){ cx.lineWidth=Math.max(1.2,sp*.16); cx.stroke(); } else cx.fill();
      if(musicFontReady){ cx.font=font; cx.textAlign='center'; cx.textBaseline='alphabetic';
        if(h.show!==null) cx.fillText(h.show>0?SMUFL.sharp:h.show<0?SMUFL.flat:SMUFL.natural, x-sp*1.9, y);
        if(e.val[2]) cx.fillText(SMUFL.dot, hx+sp*1.25, (h.d-base)%2===0 ? y-sp/2 : y); }   // a dot sits in a space
      const label = reading ? ((h.n.hit && h.n.req) || (e.notes.includes(h.n) && g && h.n.g===g && g.reveal) ? noteLabel(h.n) : '') : (labelScale ? noteLabel(h.n) : '');
      if(label){ cx.font=`700 ${Math.round(sp*1.15*Math.max(1,labelScale))}px system-ui,sans-serif`; cx.textAlign='left'; cx.textBaseline='middle'; cx.fillText(label, hx+sp*(e.val[2]?1.9:1.05), y+(e.up?sp*.9:-sp*.9)); }
    });
    if(e.val[1]!=='w'){   // stem, and a flag unless it's beamed
      const sx=x+(e.up?sp*.6:-sp*.6), ys=e.heads.map(h=>staffY(G,h.d,bass)), from=e.up?Math.max(...ys):Math.min(...ys), to=e.beam!=null&&beamY.has(e.beam)?beamY.get(e.beam):stemEnd(e);
      cx.strokeStyle=col; cx.lineWidth=Math.max(1,sp*.12); cx.beginPath(); cx.moveTo(sx,from); cx.lineTo(sx,to); cx.stroke();
      if(e.beam==null && (e.val[1]==='8'||e.val[1]==='16') && musicFontReady){ cx.fillStyle=col; cx.font=font; cx.textAlign='left'; cx.textBaseline='alphabetic';
        cx.fillText(e.val[1]==='8'?(e.up?SMUFL.flag8Up:SMUFL.flag8Down):(e.up?SMUFL.flag16Up:SMUFL.flag16Down), sx-sp*.06, to); }
    }
    const fing=e.notes.find(n=>n.finger);   // finger numbers above the right hand, below the left
    if(fing && labelScale && !reading){ const ys=e.heads.map(h=>staffY(G,h.d,bass)), fy=bass ? Math.max(...ys, e.up?-1e9:stemEnd(e), G.bassBot)+sp*1.6 : Math.min(...ys, e.up?stemEnd(e):1e9, G.trebleBot-4*sp)-sp*1.4;
      cx.fillStyle=col; cx.font=`800 ${Math.round(sp*1.2*Math.max(1,labelScale))}px system-ui,sans-serif`; cx.textAlign='center'; cx.textBaseline='middle'; cx.fillText(e.notes.filter(n=>n.finger).map(n=>n.finger).join(''), x, fy); }
  }
  for(const [m,ok] of held) if(ok===false){   // a wrong key: a red ghost note shows where you are
    const gh=spellIn(m,S.k), bass=m<60, y=staffY(G,gh.d,bass);
    cx.globalAlpha=0.65; cx.fillStyle=C.bad; cx.save(); cx.translate(playX,y); cx.rotate(-0.35); cx.beginPath(); cx.ellipse(0,0,sp*.66,sp*.45,0,0,Math.PI*2); cx.restore(); cx.fill(); cx.globalAlpha=1;
  }
  cx.restore();
}
/* =====================================================================
   HUD & play controls
   ===================================================================== */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function updateHud(){
  const title = cur && cur.kind!=='free' ? `${esc(cur.sub||'')} · ${esc(cur.title)}` : esc(song?song.title:'');
  const tip = cur && cur.tip ? `<small class="tip">${esc(cur.tip)}</small>` : '';
  const handTxt = hands==='both' ? '' : ` · ${hands} hand only`;
  const sess = session ? `<small class="sess">Session ${session.idx+1}/${session.items.length} · ${fmtTime(session.sec)} / ~${session.est}:00</small>`
             : trainer ? `<small class="sess">⚡ Speed trainer · ${Math.round(speed*100)}% → goal ${Math.round(trainer.goal*100)}%</small>` : '';
  const lp = loop ? `<small class="sess">🔁 Looping “${esc(loop.label)}” · round ${loop.n}</small>` : '';
  const head = rp ? '🎙 Replaying your recording' : previewPhase ? '👂 Listen carefully…' : mode==='listen' ? 'Listening…' : `${accuracy()}% · streak ${stats.streak}`;
  $('#hud').innerHTML = `${head}${sess}${lp}<small>${title}${handTxt}</small>${mode==='listen'&&!previewPhase?'':tip}`;
}
function updateUI(){
  const on = rp ? rp.playing : playing || (scrub && scrub.resume);
  const pl = on ? 'Pause' : rp ? 'Play' : (finished||t<=-LEAD ? 'Start' : 'Resume');
  if($('#play').dataset.s!==pl+innerWidth){ $('#play').dataset.s=pl+innerWidth; $('#play').innerHTML=(on?ICON.pause:ICON.play)+(innerWidth<=640?'':`<span>${pl}</span>`); $('#play').setAttribute('aria-label',pl); }
  $('#transport').classList.toggle('off', !notes.length && !rp);
  $('#tReplay').hidden=!rp; if(rp) $('#tReplay').innerHTML=`<span>🎙 Replay ✕</span>`;
  $('#recBtn').hidden=!!rp; updateRecBtn();
  $('#lessonBtn').hidden=!(cur && cur.lesson) || !!rp;
  const kt=$('#kbToggle'); kt.hidden=!staffView();
  const vb=$('#viewBtn'), canSwitch=!!song && notes.length>0 && !song.hidden && song.view!=='staff';
  vb.hidden=!canSwitch; if(canSwitch){ const sv=staffView(); vb.innerHTML=sv?ICON.falling:ICON.sheet; vb.title=sv?'Show falling notes':'Show sheet music'; vb.setAttribute('aria-label',vb.title); } kt.classList.toggle('on', prog.settings.staffKeys!==false);
  kt.title = prog.settings.staffKeys===false ? 'Show the keyboard' : 'Hide the keyboard (read from the staff only)';
  const lb=$('#tLoop'); lb.hidden=!loop; if(loop) lb.innerHTML=`${ICON.loop}<span>${esc(loop.label)} ✕</span>`;
  $('#msg').textContent = rp ? (rp.playing ? '' : 'Paused') : !notes.length ? (rec ? 'Recording… play freely, then press stop' : 'Play freely, or pick something from 🎵 Songs') : !playing && !finished && t<=-LEAD ? 'Press Start (or Space) when you\'re ready' : (!playing && !finished ? 'Paused' : '');
  updateHud();
}
let wake=null;
async function holdWake(){ try{ if(navigator.wakeLock) wake=await navigator.wakeLock.request('screen'); }catch(e){} }
function releaseWake(){ try{ wake&&wake.release(); }catch(e){} wake=null; }
function togglePlay(){
  audio();
  if(rp){ if(rp.w>=rp.r.dur-0.01) seekReplay(0); rp.playing=!rp.playing; rpSync(); closeResult(); updateUI(); return; }
  if(!notes.length){ openScreen('songs'); return; }   // free keyboard: nothing to play yet
  if(scrub){ scrub.resume=!scrub.resume; updateUI(); return; }
  if(finished) restart();
  playing=!playing; lastTs=0;
  if(playing) holdWake(); else { releaseWake(); flushTime(); }
  updateUI();
}

function freeKeyboard(){ if(rp){ rp=null; mode=$('#mode').value='wait'; } cur=null; session=null; trainer=null; loadSong(prep({title:'Free play', notes:[]})); }
$('#songsBtn').onclick=()=>openScreen('songs');
$('#mode').onchange=e=>{ mode=e.target.value; previewPhase=false; restart(); };
$('#hands').onchange=e=>{ hands=e.target.value; restart(); };
$('#speed').innerHTML=SPEEDS.map(s=>`<option value="${s}"${s===1?' selected':''}>${Math.round(s*100)}%</option>`).join('');
$('#speed').onchange=e=>{ speed=parseFloat(e.target.value); };
$('#play').onclick=togglePlay;
/* Line icons for the playback controls (they follow the button's text colour) */
const svg=(body,extra='')=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
const ICON={
  start: svg('<path d="M18 19 9 12l9-7z" fill="currentColor"/><path d="M6 5v14"/>'),
  back5: svg('<path d="M3 12a9 9 0 1 0 2.7-6.4"/><path d="M3 4v5h5"/><text x="12.2" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui,sans-serif">5</text>'),
  fwd5:  svg('<path d="M21 12a9 9 0 1 1-2.7-6.4"/><path d="M21 4v5h-5"/><text x="11.8" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui,sans-serif">5</text>'),
  play:  svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>'),
  mark:  svg('<path d="M18 21l-6-4.5L6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/>'),
  markAdd: svg('<path d="M15 21.5l-5.5-4-5.5 4V8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2z"/>'+   // bookmark with a plus badge on its top-right corner
               '<path d="M18.5 1.5v7M15 5h7" style="stroke:var(--panel2)" stroke-width="5"/><path d="M18.5 2v6M15.5 5h6" stroke-width="2.4"/>'),
  edit:  svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  del:   svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
  book:  svg('<path d="M2 4.5h6a4 4 0 0 1 4 4V21a3 3 0 0 0-3-3H2z"/><path d="M22 4.5h-6a4 4 0 0 0-4 4V21a3 3 0 0 1 3-3h7z"/>'),
  sheet: svg('<path d="M2 7h20M2 11h20M2 15h20"/><ellipse cx="9" cy="17" rx="2.6" ry="2" fill="currentColor" stroke="none"/><path d="M11.4 17V4"/>'),
  falling: svg('<rect x="4" y="2" width="4" height="9" rx="1.5" fill="currentColor" stroke="none"/><rect x="14" y="6" width="4" height="7" rx="1.5" fill="currentColor" stroke="none"/><path d="M2 21h20M2 16.5h20"/>'),
  keys:  svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 5v8M12 5v8M17 5v8M5.5 13h3M10.5 13h3M15.5 13h3"/>'),
  rec:   svg('<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>'),
  stop:  svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>'),
  download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  loop:  svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
};
$('#kbToggle').innerHTML=ICON.keys;
$('#viewBtn').onclick=()=>{ prog.settings.view = staffView() ? 'falling' : 'staff'; saveProg(); sheet=null; layout(); updateUI(); };
$('#kbToggle').onclick=()=>{ prog.settings.staffKeys = prog.settings.staffKeys===false; saveProg(); layout(); updateUI(); };
$('#lessonBtn').innerHTML=ICON.book; $('#lessonBtn').onclick=()=>{ if(cur&&cur.lesson) showIntro(cur.lesson,cur,true); };
$('#tStart').innerHTML=ICON.start; $('#tBack').innerHTML=ICON.back5; $('#tFwd').innerHTML=ICON.fwd5; $('#tMark').innerHTML=ICON.markAdd; $('#marksBtn').innerHTML=ICON.mark;
const pos=()=>rp ? rp.w : scrub ? scrub.target : t;   // where the timeline is (the replay has its own clock)
$('#tStart').onclick=()=>seekAnimated(rp ? 0 : loop ? loopStart() : -LEAD);
$('#tReplay').onclick=()=>exitReplay();
$('#recBtn').onclick=()=>{ if(rp) return; if(rec) stopRecording(true); else startRecording(); };
$('#tBack').onclick=()=>seekAnimated(pos()-5);
$('#tFwd').onclick=()=>seekAnimated(pos()+5);
$('#tLoop').onclick=()=>{ loop=null; renderTimeline(); updateUI(); };
$('#tMark').onclick=()=>openMarks(true);
$('#marksBtn').onclick=()=>$('#marksMenu').hidden ? openMarks(false) : closeMarks();

/* ---------- Timeline ---------- */
const TL=$('#tl');
let tlShown='';
function updateTimeline(){
  const v=pos(), end=rp?rp.r.dur:songEnd, f=end>0?Math.max(0,Math.min(1,v/end)):0, pc=(f*100).toFixed(2)+'%';
  if(pc===tlShown) return;
  tlShown=pc; $('#tlFill').style.width=pc; $('#tlThumb').style.left=pc;
  $('#tCur').textContent=fmtTime(Math.max(0,v)); $('#tl').setAttribute('aria-valuetext',fmtTime(Math.max(0,v)));
}
function renderTimeline(){   // song length, saved-part ticks and the looped part
  tlShown=''; $('#tDur').textContent=fmtTime(rp?rp.r.dur:songEnd);
  const at=x=>(songEnd>0?Math.max(0,Math.min(100,100*x/songEnd)):0).toFixed(2)+'%';
  $('#tlMarks').innerHTML=marksFor(markKey()).map((m,i)=>`<span class="tmark" data-i="${i}" style="left:${at(m.t)}${m.c?';--mc:'+m.c:''}" title="${esc(m.label)} · ${fmtTime(m.t)}"></span>`).join('');
  $('#tlMarks').querySelectorAll('.tmark').forEach(el=>el.onpointerdown=e=>{ e.stopPropagation(); jumpToMark(+el.dataset.i); });
  $('#tlTrack').style.background=heatGradient(markKey());
  const lp=$('#tlLoop'); lp.hidden=!loop;
  if(loop){ lp.style.left=at(loop.a); lp.style.width=`calc(${at(Math.min(loop.b,songEnd))} - ${at(loop.a)})`; }
}
const timeAt=x=>{ const r=TL.getBoundingClientRect(), f=Math.max(0,Math.min(1,(x-r.left)/r.width)); return rp ? f*rp.r.dur : f<0.003 ? -LEAD : f*songEnd; };
TL.addEventListener('pointerdown',e=>{
  if(rp){ TL.setPointerCapture(e.pointerId); TL.classList.add('drag'); rp.drag=true; return seekReplay(timeAt(e.clientX)); }
  if(!notes.length) return;
  TL.setPointerCapture(e.pointerId); TL.classList.add('drag');
  seekAnimated(timeAt(e.clientX)); scrub.snap=false; scrub.drag=true;
});
TL.addEventListener('pointermove',e=>{ if(rp){ if(rp.drag) seekReplay(timeAt(e.clientX)); } else if(scrub && scrub.drag) scrub.target=timeAt(e.clientX); });
const tlUp=()=>{ TL.classList.remove('drag'); if(rp) rp.drag=false; if(scrub && scrub.drag){ scrub.drag=false; scrub.snap=true; } };
TL.addEventListener('pointerup',tlUp); TL.addEventListener('pointercancel',tlUp);
addEventListener('resize',updateUI);
$('#metro').onclick=e=>{ metroOn=!metroOn; if(!(song&&song.metro)) metroPref=metroOn; e.currentTarget.setAttribute('aria-pressed',metroOn); audio(); };
$('#sound').onclick=e=>{ soundOn=!soundOn; e.currentTarget.setAttribute('aria-pressed',soundOn); audio(); };
const LABEL_SIZES=[[0,'Aa off'],[1,'Aa S'],[1.4,'Aa M'],[1.8,'Aa L'],[2.4,'Aa XL']];
$('#labels').innerHTML=LABEL_SIZES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
function applyLabels(){ labelScale=prog.settings.labels!=null?prog.settings.labels:1; $('#labels').value=String(labelScale); setFancy(!!prog.settings.fancy); }   // saved per player (with the realistic piano)
$('#labels').onchange=e=>{ prog.settings.labels=labelScale=+e.target.value; saveProg(); };
$('#fancy').onclick=()=>{ prog.settings.fancy=!fancyOn; saveProg(); setFancy(prog.settings.fancy); };
$('#midi').onclick=connectMidi;
$('#homeBtn').onclick=()=>{ if(session) sessionSummary(); else openScreen('home'); };
$('#resCard').onclick=()=>clearCountdown();
$('#intro').onclick=e=>{ if(e.target.id==='intro') $('#intro').hidden=true; };
$('#fs').onclick=async()=>{
  try{ if(!document.fullscreenElement){ await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } else await document.exitFullscreen(); }catch(e){}
};
$('#file').onchange=async e=>{ const fs=[...e.target.files]; e.target.value=''; if(fs.length) importFiles(fs); };
addEventListener('resize',layout);
let hiddenAt=0;
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){ if(playing) togglePlay(); flushTime(); hiddenAt=Date.now(); }
  else if(profiles.list.length>1 && hiddenAt && Date.now()-hiddenAt>20*60e3) openWho(true);   // shared device: ask again after a break
});

/* =====================================================================
   Screens: Home, Lessons, Practice, Progress
   ===================================================================== */
let screenName=null;
function openScreen(name){
  closeResult(); $('#intro').hidden=true; closeMarks();
  if(playing) togglePlay();
  trainer=null; if(session){ flushTime(); session=null; }
  screenName=name;
  const tabs=[['home','🏠 Home'],['learn','🎓 Lessons'],['songs','🎵 Songs'],['practice','🏋 Practice'],['progress','📈 Progress']];
  $('#snav').innerHTML=tabs.map(([k,l])=>`<button data-s="${k}" class="${k===name?'on':''}">${l}</button>`).join('')+`<span class="sp"></span><button class="kb who" data-s="who" title="Switch player">${me().emoji} ${esc(me().name)}</button><button class="kb" data-s="close">🎹 Keyboard</button>`;
  $('#snav').querySelectorAll('button').forEach(b=>b.onclick=()=>b.dataset.s==='close'?closeScreen():b.dataset.s==='who'?openWho():openScreen(b.dataset.s));
  ({home:renderHome, learn:renderLearn, songs:renderSongs, practice:renderPractice, progress:renderProgress})[name]();
  $('#screen').hidden=false; $('#screen').scrollTop=0;
}
function closeScreen(){ $('#screen').hidden=true; screenName=null; }
const B=$('#sbody');
function bind(sel,fn){ B.querySelectorAll(sel).forEach(el=>el.onclick=()=>fn(el)); }
function goalRing(size=64){
  const g=prog.settings.goal, m=day().sec/60, f=Math.min(1,m/g), r=size/2-5, c=2*Math.PI*r;
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${'#20263f'}" stroke-width="6"/><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${f>=1?C.good:C.accent}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c*f} ${c}" transform="rotate(-90 ${size/2} ${size/2})"/></svg><span>${Math.floor(m)}/${g}<small>min</small></span></div>`;
}
// the next title test, straight from the profile card (Home and Progress)
async function attemptTest(T){
  if(!T) return;
  try{ await loadLibrary(); const e=testEntries().find(x=>x.test===T); await songDef(e);
    toast(`🎓 ${T.title} test: the whole song, both hands, Play along at full speed. ${TEST_PASS}% to pass.`);
    startSong(e,false);
  }catch(err){ toast('⚠ '+(err.message||err)); }
}
B.addEventListener('click',ev=>{ if(ev.target.closest('#attempt')) attemptTest(nextTest()); });
function heroHTML(){
  const li=levelInfo(prog.xp);
  const T=nextTest();
  return `<div class="hero"><span class="avatar">${me().emoji}</span><div class="lv"><b>${esc(me().name)}</b> · Level ${li.L} · ${titleOf()}<div class="xpbar"><i style="width:${100*li.cur/li.need}%"></i></div><small class="muted">${li.cur} / ${li.need} XP to level ${li.L+1}</small>
    ${!T?'':testOpen(T)?`<button class="primary nexttest" id="attempt" title="${esc(`${T.title} test: the whole song, both hands, Play along at full speed. ${TEST_PASS}% to pass.`)}">🎓 Attempt ${T.title}</button>`
       :`<small class="muted nexttest">🎓 Attempt ${T.title} at level ${T.level}</small>`}</div>
    <div class="pill"><b>🔥 ${streak()}</b><small>day streak</small></div><div class="pill"><b>${nPassed()}</b><small>of ${ALL_LESSONS.length} lessons</small></div>${goalRing()}</div>`;
}

function renderHome(){
  const nx=nextInPath(), due=dueLessons(), min=prog.settings.sessionMin||10;
  B.innerHTML=`${heroHTML()}
  <div class="grid" style="margin-top:12px">
    <div class="box today"><h3>▶ Today's practice</h3>
      <p>A warm-up, something new, a mix of what you've learned and a song, all in one go.</p>
      <div class="chips" id="lens">${[5,10,15,20,30].map(m=>`<button data-m="${m}" class="${m===min?'on':''}">${m} min</button>`).join('')}</div>
      <button class="primary" id="startDaily">▶ Start ${min}-minute session</button></div>
    <div class="tiles">
      ${nx?`<button class="tile" id="cont"><span class="ic">${nx.course.icon}</span><span><small>Continue learning</small><b>${esc(nx.title)}</b><small>${nx.course.title} · lesson ${nx.idx+1}</small></span></button>`
          :`<div class="tile"><span class="ic">👑</span><span><b>All lessons complete!</b><small>Keep them fresh with review and drills.</small></span></div>`}
      <button class="tile" id="rev" ${due.length?'':'disabled'}><span class="ic">↻</span><span><b>${due.length?`Review ${due.length} lesson${due.length>1?'s':''}`:'Review: all caught up'}</b><small>${due.length?'Refresh what you learned before you forget it.':'Lessons come back here when it\'s time to refresh them.'}</small></span></button>
      <button class="tile" id="drl"><span class="ic">🎯</span><span><b>Drills & tools</b><small>Notes, chords, rhythm, scales, by ear, speed trainer</small></span></button>
      <button class="tile" id="songs"><span class="ic">🎵</span><span><b>Songs</b><small>${self.SONGS?SONGS.length+' ':''}public-domain songs, plus your own in My songs</small></span></button>
    </div>
  </div>`;
  bind('#lens button',el=>{ prog.settings.sessionMin=+el.dataset.m; saveProg(); renderHome(); });
  bind('#startDaily',()=>startSession(prog.settings.sessionMin||10));
  bind('#cont',()=>showIntro(nx));
  bind('#rev',()=>startReview());
  bind('#drl',()=>openScreen('practice'));
  bind('#songs',()=>openScreen('songs'));
}
function startReview(){
  const due=dueLessons(); if(!due.length) return;
  const items=[]; let est=0; const pool=drillPool(null);
  for(const l of due){ const it=lessonItem(l); it.section='Review'; items.push(it); est+=estimate(l); if(pool.length){ const d=rnd(pool).make(); d.section='Mix'; items.push(d); est+=estimate(d.def); } if(est>900) break; }
  startSession(Math.max(5,Math.round(est/60)), null, items, '↻ Review session');
}

const lessonHay=l=>l._hay || (l._hay=[l.title, l.course.title, l.course.sub, ...l.text, l.tip, ...(l.learn||[]), ...(l.practice||[]), ...(l.watch||[]), ...l.skills.map(k=>SKILLS[k])].join(' '));
function renderLearn(){
  B.innerHTML=`<input id="lq" class="search" type="search" placeholder="Search ${ALL_LESSONS.length} lessons: a title or a topic, like chords, waltz or F sharp" value="${esc(lessonQ)}" autocomplete="off"><div id="llist"></div>`;
  $('#lq').oninput=e=>{ lessonQ=e.target.value; renderLessonList(); };
  renderLessonList();
}
function renderLessonList(){
  const nx=nextInPath(), q=lessonQ.trim();
  const courses=COURSES.map(c=>({c, ls:c.lessons.filter(l=>matches(lessonHay(l),q))})).filter(x=>x.ls.length);
  $('#llist').innerHTML = !courses.length ? '<p class="muted">No lessons match that search.</p>' : `<div class="grid">${courses.map(({c,ls})=>{
    const done=c.lessons.filter(l=>passed(l.id)).length;
    return `<section class="box course"><h3>${c.icon} ${c.title}</h3><div class="sub">${c.sub} · ${done}/${c.lessons.length}${q?` · ${ls.length} found`:''}</div><div class="bar"><i style="width:${100*done/c.lessons.length}%"></i></div>
      ${ls.map(l=>{ const i=l.idx, b=best(l.id), ok=b>=PASS, due=dueness(l.id)>=1;
        return `<button class="lesson${ok?' done':''}${l===nx?' next':''}" data-id="${l.id}"><span class="num">${ok?'✓':i+1}</span><span class="t">${esc(l.title)}</span>${due?'<span class="due" title="Ready for review">↻</span>':''}${ok?`<span class="s">${starStr(starsFor(b))}</span>`:''}</button>`; }).join('')}
    </section>`; }).join('')}</div>`;
  $('#llist').querySelectorAll('.lesson').forEach(el=>el.onclick=()=>showIntro(LESSON[el.dataset.id]));
}

/* ---------- Song library ---------- */
let libP=null, songQ='', songLvl=0, songCat='', catQ={}, lessonQ='';
/* Search: case and accents don't matter (fur elise = Für Elise), words can come in any order, ♯/♭ also match "sharp"/"flat" */
const norm=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/♯/g,'# sharp ').replace(/♭/g,'♭ flat ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const normQ=q=>norm(String(q||'').replace(/\b([a-g])\s*(?:sharp|#|♯)/gi,'$1#').replace(/\b([a-g])\s*(?:flat|♭)/gi,'$1♭'));   // "F sharp" = "F#" = "F♯"
function matches(hay,q){ const words=normQ(q).split(/\s+/).filter(Boolean); if(!words.length) return true; const h=norm(hay); return words.every(w=>h.includes(w)); }
const songHay=s=>[s.title, s.by, songCats()[s.cat], LEVELS[s.level], s.mine&&s.mine.file, ...marksFor(s.id).map(m=>m.label)].join(' ');
const LEVELS={1:'Easy', 2:'Medium', 3:'Harder'}, dots=n=>'●'.repeat(n)+'○'.repeat(3-n);
function loadLibrary(){   // songs.js is only fetched when needed (or once the app is idle)
  return libP || (libP=new Promise((res,rej)=>{
    const el=document.createElement('script'); el.src='songs.js';
    el.onload=()=>res(self.SONGS);
    el.onerror=()=>{ el.remove(); libP=null; rej(new Error('Could not load the song library')); };
    document.head.appendChild(el);
  }));
}
const songById=id=>id.startsWith('my:') ? myEntries().find(s=>s.id===id) : id.startsWith('test:') ? testEntries().find(s=>s.id===id) : self.SONGS.find(s=>s.id===id);
// the title tests as songs of their own (a copy of the library entry, so scores, saved parts and mode stay separate)
let testSongs=null;
function testEntries(){
  if(!self.SONGS) return [];
  return testSongs || (testSongs=TESTS.map(T=>{ const src=SONGS.find(s=>s.id===T.song); if(!src) return null; const {def,...e}=src; return Object.assign(e,{id:T.id, cat:'tests', test:T}); }).filter(Boolean));
}
async function songDef(e){   // notes are parsed (or the MIDI file fetched) the first time a song is opened
  if(e.def) return e.def;
  let d;
  if(e.mine){ const M=e.mine; d={notes:handsFor(M), beat:M.beat, meter:M.meter, q:M.q, ts:M.ts, keySig:M.keySig, bars:M.bars}; }
  else if(e.mid){
    const r=await fetch(e.mid); if(!r.ok) throw new Error('Could not load '+e.mid);
    const p=parseMidiFile(await r.arrayBuffer());
    if(e.hands==='tracks'){   // one track per staff (e.g. Mutopia files): the track with the higher average pitch is the right hand
      const avg=t=>{ const m=p.notes.filter(n=>n.track===t.index); return m.reduce((s,n)=>s+n.midi,0)/m.length; };
      const rt=p.tracks.reduce((a,b)=>avg(b)>avg(a)?b:a).index;
      p.notes.forEach(n=>n.hand=n.track===rt?'R':'L');
    }
    d={notes:p.notes, beat:p.beat*(e.pulse||1), split:e.split, meter:e.meter, q:p.beat, ts:p.ts, keySig:p.keySig, bars:p.bars};
  } else d={bpm:e.bpm, meter:e.meter, pulse:e.pulse, split:e.split, rh:e.rh, lh:e.lh};
  if(e.key!=null) d.keySig=e.key;   // a song can state its key signature (sharps +, flats −) when the guess would be wrong
  d.title=e.title;
  return e.def=prep(d);
}
const songItem=e=>({kind:'free', song:e, def:e.def, title:e.title, sub:'🎵 Song'});
function startSong(e,listen){
  session=null; trainer=null;
  if(e.test){ e.def.mode='play'; setSpeed(1); setHands('both'); }   // a title test: Play along, full speed, both hands
  else e.def.mode=prog.settings.songMode||'wait';
  startItem(songItem(e),listen);
}

let localWait=null, localGaveUp=false;
function renderSongs(){
  if(self.SONGS && (!mySongs || !recs) && !localWait){   // My songs and recordings come from the on-device database
    localWait=Promise.all([loadMySongs(), loadRecs()]).finally(()=>{ localWait=null; if(screenName==='songs') renderSongs(); });
    setTimeout(()=>{ if(localWait){ localGaveUp=true; if(screenName==='songs') renderSongs(); } }, 2500);   // don't keep the library waiting
  }
  if(!self.SONGS || (localWait && !localGaveUp)){
    B.innerHTML='<p class="muted">Loading songs…</p>';
    if(!self.SONGS) loadLibrary().then(()=>{ if(screenName==='songs') renderSongs(); },
      err=>{ if(screenName!=='songs') return; B.innerHTML=`<p class="muted">${esc(err.message)}. Check your connection.</p><button id="retry">Try again</button>`; bind('#retry',renderSongs); });
    return;
  }
  const mine=mySongs||[];
  const songCourse=LESSON.p1.course;
  if((songCat==='mine' && !mine.length) || songCat==='tests') songCat='';   // (Title tests have no filter: they're always at the bottom)
  B.innerHTML=`${!mySongs && (dbWaiting || localGaveUp) ? '<p class="notice">⚠ My songs and recordings can\'t open yet. This usually means Keys is also open in another tab or as the installed app, with an older version. Close that and they\'ll appear here.</p>' : ''}
  <input id="sq" class="search" type="search" placeholder="Search ${SONGS.length+mine.length} songs, composers or saved parts" value="${esc(songQ)}" autocomplete="off">
  <div class="chips" id="slv">${[0,1,2,3].map(k=>`<button data-l="${k}" class="${k===songLvl?'on':''}">${k?dots(k)+' '+LEVELS[k]:'All levels'}</button>`).join('')}</div>
  <div class="chips" id="sct"><button data-c="" class="${songCat?'':'on'}">All</button>${Object.entries(songCats()).filter(([k])=>k!=='tests').map(([k,l])=>`<button data-c="${k}" class="${k===songCat?'on':''}">${l}</button>`).join('')}</div>
  ${savedPartsHTML()}
  ${recordingsHTML()}
  <div id="slist"></div>
  <h2 class="sec">More songs</h2>
  <div class="grid">
    <div class="box"><h3>${songCourse.icon} Song lessons</h3><p>Learn a song step by step, with tips and finger numbers.</p>
      <div class="chips">${songCourse.lessons.map(l=>`<button data-id="${l.id}" class="sl">${passed(l.id)?'✓ ':''}${esc(l.title)}</button>`).join('')}</div></div>
    <div class="box"><h3>📁 Add your own songs</h3><p>Import MIDI (.mid) or MusicXML (.musicxml, .mxl) files, for example from MuseScore. They stay on this device, in <b>My songs</b> for every player.</p><button class="primary" id="openMid">＋ Add files</button></div>
    <div class="box"><h3>🎤 Pop chords</h3><p>Play along with the chord progressions behind countless hits.</p>
      <div class="chips">${Object.entries(POP).map(([k,p])=>`<button data-p="${k}" class="pp">${esc(p.label.split(' · ').pop())}</button>`).join('')}</div></div>
  </div>`;
  renderSongList();
  $('#sq').oninput=e=>{ songQ=e.target.value; renderSongList(); };
  // tapping the filter that's already on goes back to All
  bind('#slv button',el=>{ songLvl = +el.dataset.l===songLvl ? 0 : +el.dataset.l; renderSongs(); });
  bind('#sct button',el=>{ songCat = el.dataset.c===songCat ? '' : el.dataset.c; renderSongs(); });
  bind('.sl',el=>showIntro(LESSON[el.dataset.id]));
  bind('#openMid',()=>$('#file').click());
  bind('.pp',el=>startItem(genPop(el.dataset.p)));
  bind('.mk',el=>startAtMark(el.dataset.k,+el.dataset.i));
  bindRecordings();
}
function savedPartsHTML(){   // every saved part of this player, in songs and lessons
  const keys=new Set([...Object.keys(prog.marks), ...myEntries().filter(e=>e.mine.marks&&e.mine.marks.length).map(e=>e.id)]);
  const all=[...keys].flatMap(k=>{ const title=markTitle(k); return title ? marksFor(k).map((m,i)=>({k,i,m,title})) : []; });
  return all.length ? `<h2 class="sec">🔖 Your saved parts</h2><div class="marks">${all.map(x=>`<button class="mk" data-k="${esc(x.k)}" data-i="${x.i}">${markDot(x.m)}▶ ${esc(x.title)} · <b>${esc(x.m.label)}</b> <small class="muted">${fmtTime(x.m.t)}</small></button>`).join('')}</div>` : '';
}
let songBase=[];
function renderSongList(){
  songBase=[...myEntries(), ...SONGS, ...testEntries()].filter(s=>(!songLvl||s.level===songLvl) && (!songCat||s.cat===songCat) && matches(songHay(s),songQ));
  const cats=Object.entries(songCats()).filter(([c])=>songBase.some(s=>s.cat===c));
  $('#slist').innerHTML = !songBase.length ? '<p class="muted">No songs match your search.</p>' :
    cats.map(([c,label])=>`<div class="sechead"><h2 class="sec">${label} <span class="muted" id="sn-${c}"></span></h2>`+
      `<input class="search catq" type="search" data-c="${c}" placeholder="Search ${esc(label.replace(/^\S+\s/,'').toLowerCase())}" value="${esc(catQ[c]||'')}" autocomplete="off" aria-label="Search ${esc(label)}"></div><div class="songs" id="sl-${c}"></div>`).join('');
  for(const [c] of cats) fillCat(c);
  $('#slist').querySelectorAll('.catq').forEach(el=>el.oninput=()=>{ catQ[el.dataset.c]=el.value; fillCat(el.dataset.c); });
}
function fillCat(c){   // one category section, filtered by its own search box
  const all=songBase.filter(s=>s.cat===c), ss=all.filter(s=>matches(songHay(s),catQ[c]||''));
  const row=s=>{ const r=prog.songs[s.id], T=s.test;
    if(T){ const ok=testPassed(T), open=testOpen(T), tb=(prog.tests[T.id]||{}).best;
      return `<button class="song test${ok?' done':''}" data-id="${s.id}"><span class="t"><b>${ok?'✓':'🎓'} ${T.title} · ${esc(s.title)}</b><small>${esc(s.by)}</small></span>
        ${tb?`<span class="s" title="Your best test score"><small>${tb}%</small></span>`:''}${s.level?`<span class="lvl" title="${LEVELS[s.level]}">${dots(s.level)}</span>`:''}</button>`; }
    return `<button class="song" data-id="${s.id}"><span class="t"><b>${esc(s.title)}</b><small>${esc(s.by)}</small></span>
      ${r&&r.best?`<span class="s" title="Your best">${starStr(starsFor(r.best))}<small>${r.best}%</small></span>`:''}${s.level?`<span class="lvl" title="${LEVELS[s.level]}">${dots(s.level)}</span>`:''}</button>`; };
  $('#sn-'+c).textContent = ss.length<all.length ? `· ${ss.length} of ${all.length}` : `· ${all.length}`;
  const box=$('#sl-'+c);
  box.innerHTML = ss.length ? ss.map(row).join('') : '<p class="muted">No songs here match that search.</p>';
  box.querySelectorAll('.song').forEach(el=>el.onclick=()=>showSong(songById(el.dataset.id)));
}
async function showSong(e){
  let d; try{ d=await songDef(e); }catch(err){ return toast('⚠ '+err.message); }
  const r=prog.songs[e.id], len=d.notes.reduce((m,n)=>Math.max(m,n.start+n.dur),0), card=$('#introCard');
  const M=e.mine, T=e.test, tr=T&&prog.tests[T.id];
  card.innerHTML=`<div class="kicker">${T?`🎓 Title test · ${T.title}`:songCats()[e.cat]}${e.level?` · ${dots(e.level)} ${LEVELS[e.level]}`:''}</div>
    ${M?`<input id="sgTitle" class="search title" maxlength="80" value="${esc(e.title)}" aria-label="Song title">`:`<h2>${esc(e.title)}</h2>`}<p class="muted">${esc(e.by)}</p>
    <div class="meta">${fmtTime(len)} at full speed · ${d.both?'both hands':'one hand'}${r?` · played ${r.plays}×`:''}${T?(tr&&tr.best?` · best test score ${tr.best}%`:''):r?` · best ${r.best}%`:''}</div>
    ${T?`<p class="testrules">${testPassed(T)?`✓ Passed: you're ${aTitle(`<b>${T.title}</b>`)}. You can still play it to beat your score.`
        :`Earn the title <b>${T.title}</b>: play the whole song with both hands in <b>Play along</b> at full speed and score <b>${TEST_PASS}%</b> or more.`}
        ${testPassed(T)?'':` Practise it first in ${songCats()[songById(T.song).cat]}, where you can slow it down, take one hand at a time or use Wait for me.`}</p>`
    :`${d.both?`<div class="seg" id="sgHands"><button data-h="right">Right hand</button><button data-h="left">Left hand</button><button data-h="both">Both hands</button></div><br>`:''}
    <div class="seg" id="sgMode"><button data-m="wait">⏸ Wait for me</button><button data-m="play">⏱ Play along</button></div>`}
    ${marksFor(e.id).length?`<div class="meta">🔖 Saved parts:</div><div class="marks">${marksFor(e.id).map((m,i)=>`<button class="mk" data-i="${i}">${markDot(m)}▶ <b>${esc(m.label)}</b> <small class="muted">${fmtTime(m.t)}</small></button>`).join('')}</div>`:''}
    ${heatHTML(e.id)}
    ${M&&M.tracks.length>1?`<div class="meta">Instruments to play:</div><div class="tracks">${M.tracks.map(t=>`<label><input type="checkbox" data-t="${t.index}"${M.on.includes(t.index)?' checked':''}> ${esc(t.name)} <small>(${t.count})</small></label>`).join('')}</div>`:''}
    <div class="btns"><button class="primary" id="sgStart">▶ ${T?'Take the test':'Start'}</button><button id="sgListen">👂 Listen</button>${T?`<button id="sgPractise">🎻 Practise it</button>`:'<button id="sgTrain">⚡ Speed trainer</button>'}<button id="sgBack">Back</button>${M?'<button id="sgDel" class="danger">Remove</button>':''}</div>`;
  const seg=(id,key,get,set)=>{ const el=$(id); if(!el) return; const sync=()=>el.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset[key]===get())); el.querySelectorAll('button').forEach(b=>b.onclick=()=>{ set(b.dataset[key]); sync(); }); sync(); };
  seg('#sgHands','h',()=>hands,setHands);
  seg('#sgMode','m',()=>prog.settings.songMode||'wait',m=>{ prog.settings.songMode=m; saveProg(); });
  $('#sgStart').onclick=()=>startSong(e,false);
  $('#sgListen').onclick=()=>startSong(e,true);
  if(T) $('#sgPractise').onclick=()=>showSong(songById(T.song));   // the same piece in its normal category
  else $('#sgTrain').onclick=()=>startTrainer(songItem(e));
  $('#sgBack').onclick=()=>{ $('#intro').hidden=true; };
  card.querySelectorAll('.mk').forEach(b=>b.onclick=()=>startAtMark(e.id,+b.dataset.i));
  bindHeat(card,e.id);
  if(M){
    $('#sgTitle').onchange=ev=>{ const t=ev.target.value.trim(); if(!t) return; M.title=e.title=e.def.title=t; saveMySong(M); renderSongList(); };
    card.querySelectorAll('.tracks input').forEach(cb=>cb.onchange=()=>{
      const on=[...card.querySelectorAll('.tracks input:checked')].map(x=>+x.dataset.t);
      if(!on.length){ cb.checked=true; return; }
      M.on=on; e.def=null; saveMySong(M); showSong(e);
    });
    $('#sgDel').onclick=async()=>{
      if(!confirm(`Remove “${e.title}” from My songs on this device?`)) return;
      await deleteMySong(M.id); mySongs.splice(mySongs.indexOf(M),1); myMap.delete(M.id);
      $('#intro').hidden=true; renderSongs(); toast('Removed '+e.title);
    };
  }
  $('#intro').hidden=false;
}

/* ---------- My songs: MIDI / MusicXML files imported on this device (IndexedDB), shared by all players ---------- */
let idb=null, mySongs=null, dbWaiting=false;
const myMap=new Map();
function openDB(){
  return idb || (idb=new Promise((res,rej)=>{
    const r=indexedDB.open('keys',2);
    r.onupgradeneeded=()=>{ const d=r.result; for(const st of ['mysongs','recordings']) if(!d.objectStoreNames.contains(st)) d.createObjectStore(st,{keyPath:'id'}); };
    r.onsuccess=()=>{
      const d=r.result; dbWaiting=false;
      d.onversionchange=()=>{ d.close(); idb=null; };   // a newer Keys wants to upgrade: let it
      res(d);
      if(screenName==='songs' && (!mySongs || !recs)) renderSongs();   // it was blocked: show My songs and recordings now
    };
    r.onerror=()=>{ idb=null; rej(r.error); };
    r.onblocked=()=>{ dbWaiting=true; if(screenName==='songs') renderSongs(); };   // an older Keys tab still has the database open
  }));
}
async function dbDo(rw,fn,store='mysongs'){ const d=await openDB(); return new Promise((res,rej)=>{ const tx=d.transaction(store,rw?'readwrite':'readonly'), q=fn(tx.objectStore(store)); tx.oncomplete=()=>res(q.result); tx.onerror=()=>rej(tx.error); }); }
async function loadMySongs(){
  if(!mySongs){ try{ mySongs=await dbDo(false,st=>st.getAll()); }catch(e){ mySongs=[]; } mySongs.sort((a,b)=>a.added-b.added); }
  return mySongs;   // stays null while the database is blocked
}
const saveMySong=r=>dbDo(true,st=>st.put(r)).catch(()=>toast('⚠ Could not save on this device'));
const deleteMySong=id=>dbDo(true,st=>st.delete(id));
const songCats=()=>Object.assign(mySongs&&mySongs.length?{mine:'📁 My songs'}:{}, self.SONG_CATS, {tests:'🎓 Title tests'});
function myEntries(){
  return (mySongs||[]).map(r=>myMap.get(r.id) || myMap.set(r.id,{id:'my:'+r.id, title:r.title, by:r.by||r.file, cat:'mine', level:0, mine:r}).get(r.id));
}
function handsFor(r){   // which hand plays each note of an imported song
  const on=new Set(r.on), ns=r.notes.filter(n=>on.has(n.track)).map(n=>({...n}));
  if(ns.some(n=>n.staff)) ns.forEach(n=>{ if(n.staff) n.hand=n.staff>1?'L':'R'; });   // MusicXML piano staves
  else if(on.size===2){   // two parts: the higher one is the right hand
    const avg=t=>{ const m=ns.filter(n=>n.track===t); return m.reduce((a,n)=>a+n.midi,0)/m.length; }, [a,b]=[...on], hi=avg(a)>=avg(b)?a:b;
    ns.forEach(n=>n.hand=n.track===hi?'R':'L');
  }
  return ns;   // otherwise notes split at middle C
}
const meterOf=(ts,q)=> !ts ? {meter:4, beat:q} : ts.d===8 && ts.n%3===0 ? {meter:ts.n/3, beat:q*1.5} : {meter:ts.n, beat:q*4/ts.d};

const hashBytes=u8=>{ let h=0x811c9dc5; for(let i=0;i<u8.length;i++){ h^=u8[i]; h=Math.imul(h,16777619); } return (h>>>0).toString(16)+'-'+u8.length; };
let afterWho=null;   // something to show once a player has been picked
async function importFiles(files, bm){   // bm: bookmarks sent with a link, used when the file has none of its own
  await loadMySongs();
  if(!mySongs) return alert('My songs can\'t be opened right now because another Keys window is still open with an older version. Close the other Keys tabs (or the installed app) and try again.');
  const added=[]; let dups=0;
  for(const f of files){
    try{
      const buf=await f.arrayBuffer(), b=new Uint8Array(buf,0,4), sig=String.fromCharCode(...b), hash=hashBytes(new Uint8Array(buf));
      const p0=()=> sig==='MThd' ? parseMidiFile(buf) : null;
      const marksOf=p=> p && p.marks.length ? p.marks : cleanMarks(bm, p?p.lead:0);
      const dup=mySongs.find(r=>r.hash===hash);
      if(dup){   // same file again: open the copy we have (added before bookmarks existed? pick them up now)
        if(!dup.marks || (!dup.marks.length && bm && bm.length)){ dup.marks=marksOf(p0()); saveMySong(dup); }
        added.push(dup); dups++; continue;
      }
      const p = p0() || parseMusicXML(sig==='PK\x03\x04' ? await unzipMusicXML(buf) : new TextDecoder().decode(buf));
      if(!p.notes.length) throw new Error('no notes found');
      const r={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6), title:p.title||f.name.replace(/\.[^.]+$/,''), by:p.by||'', file:f.name, added:Date.now(), hash,
               tracks:p.tracks, on:p.tracks.map(t=>t.index), notes:p.notes, marks:marksOf(p.marks?p:null), ...meterOf(p.ts,p.beat),
               q:p.beat, ts:p.ts, keySig:p.keySig, bars:p.bars};
      await dbDo(true,st=>st.put(r)); mySongs.push(r); added.push(r);
    }catch(err){ alert(`Could not add ${f.name}: ${err.message}`); }
  }
  if(!added.length) return;
  const n=added.length-dups;
  toast(n ? `📁 Added ${n} song${n>1?'s':''} to My songs` : '📁 Already in My songs');
  const show=async()=>{ songQ=''; songLvl=0; songCat='mine'; openScreen('songs'); if(added.length===1){ await loadLibrary().catch(()=>{}); showSong(songById('my:'+added[0].id)); } };
  if(!$('#who').hidden) afterWho=show; else show();
}
/* Songs sent by link, e.g. from a MIDI converter:
     Keys/#midi=<the .mid file in base64 or base64url>&title=Song name
     Keys/#midi=https://example.com/song.mid   (the host must allow cross-origin downloads)
     &bm=[{"t":12.5,"n":"Chorus","c":"#60a5fa"},…]   bookmarks (seconds from the start of the file), used if the file has no markers
   Data after # never leaves the browser, so no server is needed. ?midi=… works too, for short values. */
async function importFromLink(){
  const h=new URLSearchParams(location.hash.slice(1)), q=new URLSearchParams(location.search), v=h.get('midi')||q.get('midi');
  if(!v) return;
  const title=(h.get('title')||q.get('title')||'Linked song').trim();
  let bm=[]; try{ bm=JSON.parse(h.get('bm')||q.get('bm')||'[]').map(b=>({t:b.t, label:b.n, c:b.c})); }catch(e){}
  history.replaceState(null,'',location.pathname);   // so a reload doesn't import it again
  try{
    let bytes;
    if(/^https?:\/\//i.test(v)){ const r=await fetch(v); if(!r.ok) throw new Error('download failed ('+r.status+')'); bytes=await r.arrayBuffer(); }
    else{ const b=atob(v.replace(/ /g,'+').replace(/-/g,'+').replace(/_/g,'/')); bytes=Uint8Array.from(b,c=>c.charCodeAt(0)); }
    await importFiles([new File([bytes], title.replace(/[\\/:*?"<>|]+/g,'_')+'.mid')], bm);
  }catch(err){ alert('Could not open the linked song: '+(err.message||err)); }
}

/* MusicXML (partwise): staves give the hands, <fingering> the finger numbers. Repeats are played as written once. */
function parseMusicXML(text){
  const x=new DOMParser().parseFromString(text,'application/xml'), root=x.documentElement;
  if(x.querySelector('parsererror') || !/^score-/.test(root.nodeName)) throw new Error('not a MusicXML file');
  if(root.nodeName!=='score-partwise') throw new Error('only "partwise" MusicXML is supported');
  const kid=(el,name)=>[...el.children].find(c=>c.nodeName===name), num=(el,name,d=0)=>{ const c=el&&kid(el,name); return c?+c.textContent:d; };
  const names={}; x.querySelectorAll('part-list score-part').forEach(sp=>{ const n=sp.querySelector('part-name'); names[sp.id]=(n&&n.textContent.trim())||''; });
  const PC={C:0,D:2,E:4,F:5,G:7,A:9,B:11}, UNIT={whole:4,half:2,quarter:1,eighth:.5,'16th':.25};
  const tempos=[], raw=[], tracks=[], measures=[]; let ts=null, keySig=null;
  [...root.children].filter(c=>c.nodeName==='part').forEach((part,ti)=>{
    let div=1, t=0, last=0, count=0; const open={};
    for(const m of part.children) if(m.nodeName==='measure'){ if(ti===0) measures.push(t); for(const el of m.children){
      const nn=el.nodeName;
      if(nn==='attributes'){ const d=kid(el,'divisions'); if(d) div=+d.textContent; const ky=kid(el,'key'); if(ky && keySig==null && kid(ky,'fifths')) keySig=num(ky,'fifths'); const tm=kid(el,'time'); if(tm && !ts && kid(tm,'beats')) ts={n:parseInt(kid(tm,'beats').textContent), d:num(tm,'beat-type',4)}; }
      else if(nn==='direction' || nn==='sound'){
        const snd=nn==='sound'?el:el.querySelector('sound'), mt=el.querySelector('metronome');
        if(snd && snd.getAttribute('tempo')) tempos.push({q:t, bpm:+snd.getAttribute('tempo')});
        else if(mt && mt.querySelector('per-minute')){ const u=UNIT[(mt.querySelector('beat-unit')||{}).textContent]||1; tempos.push({q:t, bpm:parseFloat(mt.querySelector('per-minute').textContent)*u*(mt.querySelector('beat-unit-dot')?1.5:1)}); }
      }
      else if(nn==='backup') t-=num(el,'duration')/div;
      else if(nn==='forward') t+=num(el,'duration')/div;
      else if(nn==='note'){
        if(kid(el,'grace')) continue;
        const d=num(el,'duration')/div, start=kid(el,'chord')?last:t;
        if(!kid(el,'chord')){ last=t; t+=d; }
        const pt=kid(el,'pitch'); if(!pt) continue;   // rest or unpitched
        const midi=(num(pt,'octave')+1)*12 + PC[kid(pt,'step').textContent.trim()] + Math.round(num(pt,'alter'));
        const ties=[...el.children].filter(c=>c.nodeName==='tie').map(c=>c.getAttribute('type'));
        if(ties.includes('stop') && open[midi]){ open[midi].e=start+d; if(!ties.includes('start')) delete open[midi]; continue; }
        const step=kid(pt,'step').textContent.trim(), alter=Math.round(num(pt,'alter')), name=Math.abs(alter)<2 ? step+(alter>0?'#':alter<0?'b':'')+num(pt,'octave') : undefined;
        const fg=el.querySelector('notations technical fingering'), n={track:ti, midi, name, s:start, e:start+d, staff:num(el,'staff')||undefined, finger:fg?(parseInt(fg.textContent)||undefined):undefined};
        raw.push(n); count++;
        if(ties.includes('start')) open[midi]=n;
      }
    } }
    tracks.push({index:ti, name:names[part.id]||'Part '+(ti+1), count});
  });
  // song position (in quarter notes) -> seconds, following tempo changes
  const tl=tempos.filter(x=>x.bpm>0).sort((a,b)=>a.q-b.q);
  if(!tl.length || tl[0].q>0) tl.unshift({q:0, bpm:tl.length?tl[0].bpm:100});
  let acc=0; tl.forEach((x,i)=>{ if(i) acc+=(x.q-tl[i-1].q)*60/tl[i-1].bpm; x.sec=acc; });
  const sec=q=>{ let s=tl[0]; for(const x of tl){ if(x.q<=q) s=x; else break; } return s.sec+(q-s.q)*60/s.bpm; };
  let notes=raw.map(n=>({track:n.track, midi:n.midi, name:n.name, staff:n.staff, finger:n.finger, start:sec(n.s), dur:Math.max(0.06,sec(n.e)-sec(n.s)-0.02)}));
  const first=notes.length?Math.min(...notes.map(n=>n.start)):0; notes.forEach(n=>n.start-=first);
  const bars=measures.map(q=>+(sec(q)-first).toFixed(4)).filter(b=>b>0.01);
  const txt=sel=>{ const e=x.querySelector(sel); return e?e.textContent.trim():''; };
  return {title:txt('work work-title')||txt('movement-title'), by:txt('identification creator[type="composer"]'), tracks:tracks.filter(t=>t.count), notes, beat:60/tl[0].bpm, ts, keySig, bars};
}
async function unzipMusicXML(buf){   // .mxl is a zip: find the score named in META-INF/container.xml
  const v=new DataView(buf), u8=new Uint8Array(buf), dec=new TextDecoder(), files={};
  let e=buf.byteLength-22; while(e>=0 && v.getUint32(e,true)!==0x06054b50) e--;
  if(e<0) throw new Error('not a valid .mxl file');
  for(let i=0, p=v.getUint32(e+16,true), n=v.getUint16(e+10,true); i<n; i++){
    const nl=v.getUint16(p+28,true);
    files[dec.decode(u8.subarray(p+46,p+46+nl))]={method:v.getUint16(p+10,true), size:v.getUint32(p+20,true), off:v.getUint32(p+42,true)};
    p+=46+nl+v.getUint16(p+30,true)+v.getUint16(p+32,true);
  }
  const read=async name=>{
    const f=files[name]; if(!f) throw new Error('missing '+name);
    const at=f.off+30+v.getUint16(f.off+26,true)+v.getUint16(f.off+28,true), data=u8.subarray(at,at+f.size);
    if(f.method===0) return dec.decode(data);
    if(f.method!==8) throw new Error('unsupported compression');
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  let main=Object.keys(files).find(k=>!k.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(k));
  if(files['META-INF/container.xml']){ const rf=new DOMParser().parseFromString(await read('META-INF/container.xml'),'application/xml').querySelector('rootfile'); if(rf) main=rf.getAttribute('full-path'); }
  return read(main);
}

function renderPractice(){
  const min=prog.settings.sessionMin||10, dm=prog.settings.drillMode||'wait', due=dueLessons();
  const learnable=ALL_LESSONS.filter(l=>passed(l.id)).concat(LESSON.p1.course.lessons.filter(l=>!passed(l.id)));
  B.innerHTML=`<h2 class="sec">Practice sessions</h2>
  <div class="grid">
    <div class="box"><h3>▶ Mixed session</h3><p>A warm-up, new lessons, review and drills mixed together, and a song at the end.</p>
      <div class="chips" id="lens">${[5,10,15,20,30,45].map(m=>`<button data-m="${m}" class="${m===min?'on':''}">${m} min</button>`).join('')}</div>
      <button class="primary" id="startMix">▶ Start</button></div>
    <div class="box"><h3>🎯 Focus session</h3><p>The same mix, but only one topic (${min} min).</p>
      <div class="chips" id="focus">${Object.entries(FOCUS).map(([k,f])=>`<button data-f="${k}">${f.label}</button>`).join('')}</div></div>
    <div class="box"><h3>↻ Review</h3><p>${due.length?`${due.length} lesson${due.length>1?'s are':' is'} due. Reviewing at the right time makes skills stick.`:'Nothing due right now. Lessons come back here after 1, 2, 4, 7, 14 days and so on.'}</p>
      <button id="rev" ${due.length?'':'disabled'}>↻ Review session</button>
      <div class="chips" style="margin-top:8px">${due.slice(0,6).map(l=>`<button data-id="${l.id}" class="dueL">${l.course.icon} ${esc(l.title)}</button>`).join('')}</div></div>
  </div>
  <h2 class="sec">Drills <span class="muted" style="text-transform:none;letter-spacing:0">· a new random exercise every time</span></h2>
  <div class="chips" id="dmode"><span class="muted" style="align-self:center">Drill mode:</span><button data-m="wait" class="${dm==='wait'?'on':''}">⏸ Wait for me</button><button data-m="play" class="${dm==='play'?'on':''}">⏱ Play along</button></div>
  <div class="grid">${DRILLS.map(d=>`<div class="box"><h3>${d.icon} ${d.title}</h3><p>${d.desc}${d.modeable?'':' <i>(fixed mode)</i>'}</p>
     <div class="chips">${Object.entries(d.variants).map(([k,v])=>`<button data-d="${d.id}" data-v="${k}" title="${v.need&&!passed(v.need)?'Unlocks properly after: '+esc(LESSON[v.need].title):''}">${v.need&&!passed(v.need)?'🔒 ':''}${esc(v.label)}</button>`).join('')}</div></div>`).join('')}</div>
  <h2 class="sec">Tools</h2>
  <div class="grid">
    <div class="box"><h3>⚡ Speed trainer</h3><p>Starts slow in play-along. Every run at 90% or better speeds it up, until you reach your goal speed.</p>
      <select id="trSel" style="width:100%;margin-bottom:8px">${learnable.map(l=>`<option value="l:${l.id}">${l.course.icon} ${esc(l.title)}</option>`).join('')}${(self.SONGS||[]).map(s=>`<option value="s:${s.id}">🎵 ${esc(s.title)}</option>`).join('')}</select>
      <div class="chips"><span class="muted" style="align-self:center">Start at</span><select id="trStart">${[0.4,0.5,0.6,0.7].map(s=>`<option value="${s}"${s===0.5?' selected':''}>${s*100}%</option>`).join('')}</select><span class="muted" style="align-self:center">goal</span><select id="trGoal">${[0.8,0.9,1,1.1,1.25].map(s=>`<option value="${s}"${s===1?' selected':''}>${Math.round(s*100)}%</option>`).join('')}</select></div>
      <button class="primary" id="trGo">⚡ Start</button></div>
    <div class="box"><h3>🎵 Songs</h3><p>Browse the song library, or add your own MIDI and MusicXML files to My songs.</p><button id="songs">Browse songs</button></div>
  </div>`;
  bind('#lens button',el=>{ prog.settings.sessionMin=+el.dataset.m; saveProg(); renderPractice(); });
  bind('#startMix',()=>startSession(prog.settings.sessionMin||10));
  bind('#focus button',el=>startSession(prog.settings.sessionMin||10, el.dataset.f));
  bind('#rev',()=>startReview());
  bind('.dueL',el=>startItem(lessonItem(LESSON[el.dataset.id])));
  bind('#dmode button',el=>{ prog.settings.drillMode=el.dataset.m; saveProg(); renderPractice(); });
  bind('[data-d]',el=>{ trainer=null; session=null; startItem(DRILLS.find(d=>d.id===el.dataset.d).make(el.dataset.v)); });
  bind('#trGo',async()=>{
    const [k,v]=$('#trSel').value.split(':'), sp=+$('#trStart').value, goal=+$('#trGoal').value;
    if(k==='l') return startTrainer(lessonItem(LESSON[v]), sp, goal);
    const e=songById(v); try{ await songDef(e); }catch(err){ return toast('⚠ '+err.message); }
    startTrainer(songItem(e), sp, goal);
  });
  bind('#songs',()=>openScreen('songs'));
}

function renderProgress(){
  const li=levelInfo(prog.xp), tot=totalSec(), nA=Object.keys(prog.ach).length;
  // last 14 days chart (single series: minutes practised; dashed line = daily goal)
  const daysArr=[]; for(let i=13;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=dkey(d); daysArr.push({k, d, min:Math.round(((prog.days[k]||{}).sec||0)/60), today:i===0}); }
  const goal=prog.settings.goal, maxV=Math.max(goal*1.25, ...daysArr.map(d=>d.min), 1);
  const chart=`<div class="chart" role="img" aria-label="Minutes practised per day over the last 14 days">${daysArr.map(d=>`<div class="col${d.min?'':' zero'}${d.today?' today':''}" title="${d.d.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'})}: ${d.min} min"><span class="v">${d.min} min</span><div class="b" style="height:${100*d.min/maxV}%"></div></div>`).join('')}
    <div class="goal" style="bottom:${100*goal/maxV}%"><span>goal ${goal} min</span></div></div>
    <div class="xlab">${daysArr.map(d=>`<span class="${d.today?'today':''}">${d.today?'today':d.d.toLocaleDateString(undefined,{weekday:'narrow'})}</span>`).join('')}</div>`;
  const skills=Object.entries(SKILLS).map(([k,name])=>{ const s=prog.skills[k]; return `<div class="sk"><span>${name}</span><div class="bar"><i style="width:${s?s.m:0}%"></i></div><span>${s?s.m+'%':'–'}</span></div>`; }).join('');
  const hist=prog.history.slice(0,12).map(h=>`<li><span>${h.kind==='lesson'?'🎓':h.kind==='drill'?'🏋':'🎵'}</span><span>${esc(h.title)}</span><span class="muted">${h.acc}% · +${h.xp} XP · ${new Date(h.at).toLocaleDateString(undefined,{day:'numeric',month:'short'})}</span></li>`).join('') || '<li class="muted">Nothing yet. Play something!</li>';
  B.innerHTML=`${heroHTML()}
  <h2 class="sec">Overview</h2>
  <div class="stats">
    <div class="stat"><b>${prog.xp}</b><small>total XP</small></div>
    <div class="stat"><b>🔥 ${streak()}</b><small>day streak · best ${prog.bestDays||0}</small></div>
    <div class="stat"><b>${Math.floor(tot/3600)}h ${Math.round(tot%3600/60)}m</b><small>practised in total</small></div>
    <div class="stat"><b>${nPassed()}/${ALL_LESSONS.length}</b><small>lessons complete</small></div>
    <div class="stat"><b>${prog.counts.sessions}</b><small>sessions · ${prog.counts.drills} drills</small></div>
    <div class="stat"><b>${nA}/${ACH.length}</b><small>achievements</small></div>
    <div class="stat"><b>🎵 ${nSongs()}</b><small>songs played at ${PASS}%+</small></div>
  </div>
  <h2 class="sec">Minutes practised, last 14 days</h2><div class="box">${chart}</div>
  <div class="grid" style="margin-top:12px">
    <div class="box"><h3>Courses</h3>${COURSES.map(c=>{ const d=c.lessons.filter(l=>passed(l.id)).length, st=c.lessons.reduce((a,l)=>a+starsFor(best(l.id)),0); return `<div class="sk"><span>${c.icon} ${c.title}</span><div class="bar"><i style="width:${100*d/c.lessons.length}%;background:var(--good)"></i></div><span>${d}/${c.lessons.length}</span></div><small class="muted" style="display:block;margin:-4px 0 6px 0">★ ${st} of ${c.lessons.length*3} stars</small>`; }).join('')}</div>
    <div class="box"><h3>Skills</h3><p>Your recent accuracy per skill, updated every time you practise.</p>${skills}</div>
  </div>
  <h2 class="sec">Achievements</h2>
  <div class="achs">${ACH.map(a=>`<div class="ach${prog.ach[a.id]?'':' lock'}" title="${esc(a.d)}"><span class="i">${a.i}</span><span><b>${esc(a.n)}</b><small>${esc(a.d)}</small></span></div>`).join('')}</div>
  <div class="grid" style="margin-top:12px">
    <div class="box"><h3>Recent activity</h3><ul class="hist">${hist}</ul></div>
    <div class="box"><h3>Settings & backup</h3>
      <p>Daily goal</p><div class="chips" id="goal">${[5,10,15,20,30,45,60].map(m=>`<button data-m="${m}" class="${m===goal?'on':''}">${m} min</button>`).join('')}</div>
      <p>Progress for <b>${me().emoji} ${esc(me().name)}</b> is saved on this device. Export a backup to move it to another phone or browser.</p>
      <div class="btns" style="justify-content:flex-start"><button id="exp">⬇ Export backup</button><button id="imp">⬆ Import backup</button><button id="reset">Reset progress</button><button id="players">👥 Players</button></div></div>
  </div>`;
  bind('#goal button',el=>{ prog.settings.goal=+el.dataset.m; saveProg(); renderProgress(); });
  bind('#exp',exportProg);
  bind('#imp',()=>$('#importFile').click());
  bind('#players',()=>openWho());
  bind('#reset',()=>{ if(confirm(`Delete all of ${me().name}'s progress? This cannot be undone (export a backup first if unsure).`)){ prog=blankProg(); saveProg(); renderProgress(); toast('Progress reset'); } });
}
function exportProg(){
  flushTime();
  const blob=new Blob([JSON.stringify(prog)],{type:'application/json'}), a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`keys-${me().name.replace(/[^\w-]+/g,'_')}-${dkey()}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000); toast('⬇ Backup downloaded');
}
$('#importFile').onchange=async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  try{
    const p=JSON.parse(await f.text()); if(!p || p.v!==1 || typeof p.xp!=='number') throw new Error('not a Keys backup');
    if(!confirm(`Replace ${me().name}'s progress with this backup (level ${levelInfo(p.xp).L}, ${Object.keys(p.lessons||{}).length} lessons)?`)) return;
    const b=blankProg(); prog=Object.assign(b,p,{counts:Object.assign(b.counts,p.counts), settings:Object.assign(b.settings,p.settings)});
    saveProg(); applyLabels(); toast('⬆ Backup restored'); if(screenName) openScreen(screenName);
  }catch(err){ alert('Could not import: '+err.message); }
};

/* ---------- Lesson intro ---------- */
function theoryHTML(L){   // "Learn more": the theory, how to practise, what to watch out for
  if(!L.learn) return '';
  const list=(t,a)=>a&&a.length ? `<h3>${t}</h3><ul>${a.map(x=>`<li>${x}</li>`).join('')}</ul>` : '';
  return `<details class="theory" open><summary>${ICON.book} Learn more</summary>
    <h3>The theory</h3>${L.learn.map(p=>`<p>${p}</p>`).join('')}
    ${list('How to practise',L.practice)}${list('Watch out for',L.watch)}</details>`;
}
function miniKeyboard(L){
  const split=L.split||60, info=new Map();
  for(const n of L.notes){ const i=info.get(n.midi); if(!i) info.set(n.midi,{hand:n.midi<split?'L':'R',finger:n.finger}); else if(i.finger==null) i.finger=n.finger; }
  const ms=[...info.keys()], a=Math.floor(Math.min(...ms)/12)*12, b=Math.ceil((Math.max(...ms)+1)/12)*12-1;
  const wh=[]; for(let m=a;m<=b;m++) if(!isBlack(m)) wh.push(m);
  const kw=24,kh=78,bw=14,bh=48, Wd=wh.length*kw;
  const colr=m=>info.get(m).hand==='L'?C.left:C.accent;
  let s=`<svg viewBox="0 0 ${Wd} ${kh}" width="${Wd}" height="${kh}" font-family="system-ui,sans-serif" text-anchor="middle">`;
  wh.forEach((m,i)=>{
    const used=info.has(m), x=i*kw;
    s+=`<rect x="${x+.5}" y=".5" width="${kw-1}" height="${kh-1}" rx="3" fill="${used?colr(m):'#f3f4fa'}" stroke="#0f1220"/>`;
    if(used){ const f=info.get(m).finger; if(f) s+=`<text x="${x+kw/2}" y="${kh-24}" font-size="13" font-weight="700" fill="#0b0e1a">${f}</text>`;
      s+=`<text x="${x+kw/2}" y="${kh-8}" font-size="10" fill="#0b0e1a">${NAMES[m%12]}</text>`; }
    else if(m%12===0) s+=`<text x="${x+kw/2}" y="${kh-8}" font-size="9" fill="#8b90b0">C${m/12-1}</text>`;
  });
  wh.forEach((m,i)=>{
    if(!isBlack(m+1) || m+1>b) return;
    const bm=m+1, used=info.has(bm), x=(i+1)*kw-bw/2;
    s+=`<rect x="${x}" y="0" width="${bw}" height="${bh}" rx="2" fill="${used?colr(bm):'#1a1d2b'}"/>`;
    if(used && info.get(bm).finger) s+=`<text x="${x+bw/2}" y="${bh-8}" font-size="11" font-weight="700" fill="#0b0e1a">${info.get(bm).finger}</text>`;
  });
  return s+'</svg>';
}
/* Lesson intro. reread: opened from a result card or the top bar, to read it again (Close returns to playing) */
function showIntro(L, it, reread=false){
  it = it || lessonItem(L);
  if(!session && !reread) trainer=null;
  closeResult(); closeScreen();
  if(playing) togglePlay();
  const c=L.course, card=$('#introCard'), inSession=!!session;
  card.innerHTML=`<div class="kicker">${inSession?`Session ${session.idx+1}/${session.items.length} · New · `:''}${c.icon} ${c.title} · Lesson ${L.idx+1} of ${c.lessons.length}</div>
    <h2>${esc(L.title)}</h2>${L.text.map(p=>`<p>${p}</p>`).join('')}
    <div class="mini">${miniKeyboard(L)}</div>
    ${theoryHTML(L)}
    ${heatHTML('lesson:'+L.id)}
    ${L.both?`<div class="seg" id="introHands"><button data-h="right">Right hand</button><button data-h="left">Left hand</button><button data-h="both">Both hands</button></div>`:''}
    <div class="meta">${L.mode==='play'?'⏱ Play along: the music keeps going.':'⏸ Wait for me: the music waits for you.'}${L.metro?' 🥁 Metronome on.':''} Numbers are finger numbers. Pass with ${PASS}%.${best(L.id)?` Your best: ${best(L.id)}%.`:''}</div>
    <div class="btns"><button class="primary" id="introStart">${reread?'↺ Start again':'▶ Start'}</button><button id="introListen">👂 Listen first</button><button id="introBack">${reread?'Close':inSession?'Skip':'Lessons'}</button></div>`;
  const seg=$('#introHands');
  if(seg){
    const sync=()=>seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.h===hands));
    seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{ setHands(b.dataset.h); sync(); });
    sync();
  }
  bindHeat(card,'lesson:'+L.id);
  $('#introStart').onclick=()=>startItem(it,false);
  $('#introListen').onclick=()=>startItem(it,true);
  $('#introBack').onclick=()=>{ if(reread) $('#intro').hidden=true; else if(inSession){ session.idx++; sessionCard(null); } else openScreen('learn'); };
  $('#intro').hidden=false; $('#intro').scrollTop=0;
}




/* =====================================================================
   Recordings: press record, play, and replay it later (saved per player, on this device)
   ===================================================================== */
let rec=null;   // being recorded: {w (seconds, paused time excluded), open (key → note), notes [[from,to,key,velocity,ok]], path [[w, song time]], free, …}
let rp=null;    // replaying: {r, w, playing, i, prevCur, prevMode}
let recs=null;  // saved recordings (all players)
async function loadRecs(){ if(!recs){ try{ recs=await dbDo(false,st=>st.getAll(),'recordings'); }catch(e){ recs=[]; } } return recs; }
function startRecording(){
  audio();
  const free=!notes.length;
  rec={w:0, acc:0, run:false, since:performance.now(), open:new Map(), notes:[], path:[], pw:0, free, at:Date.now(), title:free?'Free play':(cur?cur.title:song.title)};
  if(!free){
    rec.song={title:song.title, beat:songBeat, meter, notes:notes.map(n=>[+n.start.toFixed(3),+n.dur.toFixed(3),n.midi,n.hand==='L'?1:0])};
    rec.path.push([0,+t.toFixed(3)]);
    if(!playing) togglePlay();
  }
  toast('🎙 Recording…'); updateUI();
}
function recClock(){   // seconds recorded so far, from the precise clock; time paused in a song doesn't count
  const now=performance.now(), run=rec.free || playing;
  if(run!==rec.run){ if(rec.run) rec.acc+=(now-rec.since)/1000; rec.since=now; rec.run=run; }
  return rec.w = rec.acc + (run ? (now-rec.since)/1000 : 0);
}
function recOff(m){ const n=rec.open.get(m); if(n){ n[1]=+Math.max(rec.w,n[0]+0.05).toFixed(3); n[0]=+n[0].toFixed(3); rec.notes.push(n); rec.open.delete(m); } }
function recTick(){
  recClock();
  if(!rec.free && rec.w-rec.pw>=0.1){ rec.path.push([+rec.w.toFixed(3), +t.toFixed(3)]); rec.pw=rec.w; }
}
function stopRecording(showCard){   // saves the take (if anything was played) and returns it
  recClock(); const R=rec; rec=null;
  for(const m of [...R.open.keys()]){ rec=R; recOff(m); rec=null; }
  updateUI();
  if(!R.notes.length){ toast('Nothing was recorded'); return null; }
  if(!R.free && playing) togglePlay();
  R.notes.sort((a,b)=>a[0]-b[0]);
  if(!R.free) R.path.push([+R.w.toFixed(3), +t.toFixed(3)]);
  const take={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6), player:profiles.active, title:R.title, at:R.at,
              dur:+R.w.toFixed(2), acc:R.free?null:accuracy(), notes:R.notes, path:R.free?null:R.path, song:R.song||null};
  dbDo(true,st=>st.put(take),'recordings').then(()=>{ if(recs) recs.push(take); if(screenName==='songs') renderSongs(); }, ()=>toast('⚠ Could not save the recording on this device'));
  toast(`🎙 Recording saved (${fmtTime(take.dur)})`);
  if(showCard) setResult('🎙 Recording saved', null, fmtTime(take.dur), `${take.title} · ${take.notes.length} notes. Find it later under Songs → Your recordings.`,
    [{label:'▶ Replay', primary:true, fn:()=>startReplay(take)}, {label:'⬇ Download .mid', fn:()=>downloadRec(take)}, {label:'Close', fn:closeResult}]);
  return take;
}
function updateRecBtn(){
  const b=$('#recBtn'), label=rec ? `<span>${fmtTime(rec.w)}</span>` : '';
  b.classList.toggle('on',!!rec);
  const k=(rec?'on':'off')+label;
  if(b.dataset.s!==k){ b.dataset.s=k; b.innerHTML=(rec?ICON.stop:ICON.rec)+label; b.title=rec?'Stop recording':'Record yourself, to replay later'; b.setAttribute('aria-label',rec?'Stop recording':'Record'); }
}
setInterval(()=>{ if(rec){ recClock(); updateRecBtn(); } }, 250);

/* Replay: your notes sound and light up the keys; with a song, the notes move just as they did when you played */
function startReplay(r){
  if(rec) stopRecording(false);
  if(playing) togglePlay();
  closeResult(); closeScreen(); closeMarks(); $('#intro').hidden=true;
  const prevCur = rp ? rp.prevCur : cur, prevMode = rp ? rp.prevMode : mode;
  rp=null;
  const def = r.song ? prep({title:r.song.title, beat:r.song.beat, meter:r.song.meter, notes:r.song.notes.map(([s,d,m,h])=>({start:s, dur:d, midi:m, hand:h?'L':'R'}))})
                     : prep({title:r.title, notes:[]});
  mode='listen'; $('#mode').value='listen';
  loadSong(def);
  const ms=[...def.notes.map(n=>n.midi), ...r.notes.map(n=>n[2])];   // keyboard wide enough for both the song and what was played
  let a=Math.floor(Math.min(...ms)/12)*12, b=Math.ceil((Math.max(...ms)+1)/12)*12; while(b-a<24){ if(a>36) a-=12; else b+=12; }
  setRange(a,b);
  cur={kind:'free', def, title:r.title, sub:'🎙 Replay'};
  rp={r, w:0, playing:true, i:0, prevCur, prevMode};
  seekReplay(0); rp.playing=true; rpSync(); renderTimeline(); updateUI();
}
function seekReplay(w){
  rp.w=Math.max(0,Math.min(rp.r.dur,w)); rpSync(); held.clear();
  rp.i=rp.r.notes.findIndex(n=>n[0]>=rp.w-1e-3); if(rp.i<0) rp.i=rp.r.notes.length;
  replayTick(true); updateUI();
}
function rpSync(){ rp.w0=rp.w; rp.t0=performance.now(); }   // the replay clock restarts from here
function pathAt(path,w){   // song time at replay time w
  let lo=0, hi=path.length-1; if(w<=path[0][0]) return path[0][1];
  while(lo<hi){ const mid=(lo+hi+1)>>1; if(path[mid][0]<=w) lo=mid; else hi=mid-1; }
  const a=path[lo], b=path[lo+1]; if(!b || b[0]===a[0]) return a[1];
  return a[1]+(b[1]-a[1])*(w-a[0])/(b[0]-a[0]);
}
function replayTick(silent){
  const r=rp.r, w=rp.w;
  if(rp.playing && !silent) while(rp.i<r.notes.length && r.notes[rp.i][0]<=w){ const n=r.notes[rp.i++]; tone(n[2], Math.max(0.08,n[1]-n[0]), 0.25+0.45*n[3]/127, n[3]); }
  held.clear(); for(const n of r.notes){ if(n[0]>w) break; if(n[1]>w) held.set(n[2], n[4]); }
  if(r.path){ const nt=pathAt(r.path,w); if(nt!==t){ t=nt; si=notes.findIndex(n=>n.start>t); if(si<0) si=notes.length; } }
  if(rp.playing && w>=r.dur){
    rp.playing=false; held.clear(); updateUI();
    setResult('🎙 Replay finished', null, fmtTime(r.dur), `${r.title} · recorded ${new Date(r.at).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}${r.acc!=null?` · ${r.acc}%`:''}`,
      [{label:'↺ Replay again', primary:true, fn:()=>{ closeResult(); seekReplay(0); rp.playing=true; rpSync(); updateUI(); }},
       {label:'⬇ Download .mid', fn:()=>downloadRec(r)}, {label:'Close', fn:()=>exitReplay()}]);
  }
}
function exitReplay(quiet){
  if(!rp) return;
  const R=rp; rp=null; held.clear(); closeResult();
  mode=R.prevMode; $('#mode').value=mode;
  if(quiet) return;
  if(R.prevCur && R.prevCur.def){ cur=R.prevCur; loadSong(cur.def); } else freeKeyboard();
  updateUI();
}

/* A recording as a standard MIDI file (120 BPM, so 1 second = 2 beats) */
function recToMidi(r){
  const PPQ=480, tps=PPQ*2, ev=[], out=[0,0xFF,0x51,3,0x07,0xA1,0x20], vlq=x=>{ const b=[x&0x7f]; while(x>>=7) b.unshift((x&0x7f)|0x80); return b; };
  for(const n of r.notes){ ev.push([Math.round(n[0]*tps),1,n[2],n[3]]); ev.push([Math.round(n[1]*tps),0,n[2],0]); }
  ev.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);   // note-offs before note-ons at the same moment
  let last=0; for(const [tk,on,m,v] of ev){ out.push(...vlq(tk-last), on?0x90:0x80, m, on?Math.max(1,Math.min(127,v)):0); last=tk; }
  out.push(0,0xFF,0x2F,0);
  const L=out.length;
  return new Uint8Array([0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,PPQ>>8,PPQ&255, 0x4D,0x54,0x72,0x6B,L>>>24,(L>>16)&255,(L>>8)&255,L&255, ...out]);
}
function downloadRec(r){
  const name=`${r.title} ${new Date(r.at).toISOString().slice(0,16).replace('T',' ').replace(':','.')}`.replace(/[\\/:*?"<>|]+/g,'_');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([recToMidi(r)],{type:'audio/midi'})); a.download=name+'.mid';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function recordingsHTML(){
  const mine=(recs||[]).filter(r=>r.player===profiles.active).sort((a,b)=>b.at-a.at);
  if(!mine.length) return '';
  const when=at=>new Date(at).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  return `<h2 class="sec">🎙 Your recordings</h2><div class="reclist">${mine.map(r=>`<div class="mrow"><button class="mgo ic rgo" data-id="${r.id}">${ICON.play}<b>${esc(r.title)}</b><small>${when(r.at)} · ${fmtTime(r.dur)}${r.acc!=null?` · ${r.acc}%`:''}</small></button>`+
    `<button class="ic rdl" data-id="${r.id}" title="Download as a MIDI file" aria-label="Download">${ICON.download}</button><button class="ic rdel" data-id="${r.id}" title="Delete" aria-label="Delete">${ICON.del}</button></div>`).join('')}</div>`;
}
function bindRecordings(){
  const byId=id=>recs.find(r=>r.id===id);
  bind('.rgo',el=>startReplay(byId(el.dataset.id)));
  bind('.rdl',el=>downloadRec(byId(el.dataset.id)));
  bind('.rdel',async el=>{ const r=byId(el.dataset.id); if(!confirm(`Delete the recording “${r.title}” from ${new Date(r.at).toLocaleString()}?`)) return;
    await dbDo(true,st=>st.delete(r.id),'recordings'); recs.splice(recs.indexOf(r),1); renderSongs(); toast('Recording deleted'); });
}


/* =====================================================================
   Mistake heatmap: where in a song or lesson mistakes happen (per player)
   prog.heat[key] = {bin: seconds per slice (about a bar), n: slices, v: mistakes per play (recent plays count most), p: plays}
   ===================================================================== */
let heatRun=null;   // this run: {key, bin, n, err:{slice: count}, seen: slices played}
function heatStart(){
  const k=markKey();
  if(!k || !notes.length || rp){ heatRun=null; return; }
  const bin=Math.max(Math.min(4, Math.max(1, songBeat*meter)), songEnd/100);   // about one bar, at most 100 slices
  heatRun={key:k, bin, n:Math.max(1,Math.ceil(songEnd/bin)), err:{}, seen:new Set()};
}
function heatMiss(at){
  if(!heatRun || rp || mode==='listen' || at<0) return;
  const i=Math.min(heatRun.n-1, Math.floor(at/heatRun.bin));
  heatRun.err[i]=(heatRun.err[i]||0)+1; heatRun.seen.add(i);
}
function heatCommit(){   // fold this run's mistakes into the per-song heatmap
  const R=heatRun; if(!R || !R.seen.size) return;
  let H=prog.heat[R.key];
  if(!H || H.n!==R.n || Math.abs(H.bin-R.bin)>1e-3) H=prog.heat[R.key]={bin:+R.bin.toFixed(3), n:R.n, v:Array(R.n).fill(0), p:Array(R.n).fill(0)};
  for(const i of R.seen){ const e=R.err[i]||0; H.v[i]=+(H.p[i] ? H.v[i]*0.65+e*0.35 : e).toFixed(2); H.p[i]++; }
  R.seen=new Set(); R.err={}; saveProg();
  if(R.key===markKey()) renderTimeline();
}
function heatSpots(H,count=3){   // the worst parts, not right next to each other
  const order=H.v.map((v,i)=>({v,i})).filter(x=>x.v>=0.3 && H.p[x.i]).sort((a,b)=>b.v-a.v), out=[];
  for(const x of order){ if(out.every(o=>Math.abs(o.i-x.i)>1)) out.push(x); if(out.length===count) break; }
  return out;
}
function heatGradient(k){   // tints the timeline red where the mistakes are
  const H=k&&prog.heat[k]; if(!H || !H.v.some(v=>v>0)) return '';
  const max=Math.max(...H.v,1), stops=H.v.map((v,i)=>{ const c=`rgba(255,92,122,${(0.75*v/max).toFixed(2)})`; return `${c} ${(100*i/H.n).toFixed(2)}%, ${c} ${(100*(i+1)/H.n).toFixed(2)}%`; });
  return `linear-gradient(to right, ${stops.join(', ')}), var(--panel2)`;
}
function heatHTML(k){
  const H=prog.heat[k], played=H && H.p.some(x=>x);
  let body;
  if(!played) body='<p class="muted">Play this a few times and the parts where you make mistakes light up here, so you can practise just those.</p>';
  else{
    const max=Math.max(...H.v,0.5), spots=heatSpots(H), at=i=>fmtTime(i*H.bin);
    body=`<div class="heatbar">${H.v.map((v,i)=>`<button class="hc" data-i="${i}" style="--h:${(v/max).toFixed(2)}"${H.p[i]?'':' data-none'} title="${at(i)}–${at(i+1)}: ${H.p[i]?`${v.toFixed(1)} mistakes per play`:'not played yet'}"></button>`).join('')}</div>
      <div class="heatax"><span>0:00</span><span>${fmtTime(H.n*H.bin)}</span></div>
      ${spots.length ? `<div class="marks">${spots.map(x=>`<button class="hs" data-i="${x.i}">🔥 ${at(x.i)} · ${x.v.toFixed(1)} per play</button>`).join('')}</div><p class="muted small">Tap a spot or a slice to loop that part.</p>`
                     : '<p class="muted">No trouble spots right now. Nice work!</p>'}`;
  }
  return `<details class="heat"${played?' open':''}><summary>📊 Where you make mistakes</summary>${body}</details>`;
}
function bindHeat(root,k){ root.querySelectorAll('.hc,.hs').forEach(b=>b.onclick=()=>practiseSpot(k,+b.dataset.i)); }
async function practiseSpot(k,i){   // open the song or lesson and loop the part around slice i
  const H=prog.heat[k]; if(!H) return;
  let it;
  if(k.startsWith('lesson:')) it=lessonItem(LESSON[k.slice(7)]);
  else{ const e=songById(k); if(!e) return; try{ await songDef(e); }catch(err){ return toast('⚠ '+err.message); } e.def.mode=prog.settings.songMode||'wait'; it=songItem(e); }
  session=null; trainer=null; startItem(it);
  const a=Math.max(0,i-1)*H.bin, b=Math.min(songEnd+0.8,(i+2)*H.bin);
  loop={a, b, label:`Trouble spot ${fmtTime(i*H.bin)}`, n:1};
  renderTimeline(); seekTo(loopStart()); updateUI();
}

/* =====================================================================
   Saved parts: labelled spots in a song or lesson, per player
   ===================================================================== */
function markKey(c=cur){ return c ? (c.song ? c.song.id : c.lesson ? 'lesson:'+c.lesson.id : null) : null; }   // drills are new every time
/* An imported song's own bookmarks (from MIDI-Creator or the file's markers) are every player's starting parts;
   the first change gives this player their own copy in prog.marks. */
function fileMarks(k){ const e=k && k.startsWith('my:') && myMap.get(k.slice(3)); return (e && e.mine.marks) || []; }
function marksFor(k){ return !k ? [] : prog.marks[k] || fileMarks(k); }
function ownMarks(k){ return prog.marks[k] || (prog.marks[k]=fileMarks(k).map(m=>({...m}))); }
function markTitle(k){ if(k.startsWith('lesson:')){ const l=LESSON[k.slice(7)]; return l&&l.title; } const e=self.SONGS&&songById(k); return e&&e.title; }
function jumpToMark(i){ const m=marksFor(markKey())[i]; if(!m) return; if(loop && loop.a!==m.t){ loop=null; renderTimeline(); } seekAnimated(Math.max(-LEAD, m.t-LEADIN)); }
function loopMark(i){
  const L=marksFor(markKey()), m=L[i]; if(!m) return;
  if(loop && loop.a===m.t){ loop=null; renderTimeline(); updateUI(); return; }   // tap again to stop
  loop={a:m.t, b:i+1<L.length ? L[i+1].t : songEnd+0.8, label:m.label, n:1};
  renderTimeline(); seekAnimated(loopStart()); scrub.resume=true; updateUI();
}
function saveMarks(){ saveProg(); renderTimeline(); }
const markDot=m=> m.c ? `<span class="mdot" style="--mc:${m.c}"></span>` : '';   // the bookmark's color from MIDI-Creator
async function startAtMark(k,i){   // from a menu: open the song or lesson and start just before the part
  const m=marksFor(k)[i]; if(!m) return;
  let it;
  if(k.startsWith('lesson:')) it=lessonItem(LESSON[k.slice(7)]);
  else{ const e=songById(k); if(!e) return; try{ await songDef(e); }catch(err){ return toast('⚠ '+err.message); } e.def.mode=prog.settings.songMode||'wait'; it=songItem(e); }
  session=null; trainer=null; startItem(it); seekTo(Math.max(-LEAD, m.t-LEADIN));
}

const MM=$('#marksMenu');
let markEdit=-1, markAdding=false;
function openMarks(adding){
  if(playing) togglePlay();
  markEdit=-1; markAdding=adding; renderMarks();
  MM.style.top=($('header').getBoundingClientRect().bottom+6)+'px'; MM.hidden=false;
  const inp=MM.querySelector('#mLabel'); if(adding && inp){ inp.focus(); inp.select(); }
}
function closeMarks(){ MM.hidden=true; }
function renderMarks(){
  const k=markKey(), L=marksFor(k), now=Math.max(0,scrub?scrub.target:t);
  let body;
  if(!k) body = rp ? '<p class="muted">Saved parts aren\'t available while replaying a recording.</p>' : cur ? '<p class="muted">Drills are new every time, so they can\'t have saved parts. Saved parts work in songs and lessons.</p>'
                    : '<p class="muted">Saved parts work in songs and lessons. Open one, find the spot on the timeline, then save it here.</p>';
  else body=(L.length ? L.map((m,i)=> i===markEdit
      ? `<div class="mrow"><input id="mRename" maxlength="40" value="${esc(m.label)}"><button class="primary" data-a="ren" data-i="${i}">Save</button></div>`
      : `<div class="mrow"><button class="mgo ic" data-a="go" data-i="${i}">${markDot(m)}${ICON.play}<b>${esc(m.label)}</b><small>${fmtTime(m.t)}</small></button>`+
        `<button data-a="loop" data-i="${i}" title="Loop this part (until the next saved part)" class="ic${loop&&loop.a===m.t?' on':''}">${ICON.loop}</button>`+
        `<button data-a="edit" data-i="${i}" class="ic" title="Rename" aria-label="Rename">${ICON.edit}</button><button data-a="del" data-i="${i}" class="ic" title="Delete" aria-label="Delete">${ICON.del}</button></div>`).join('')
      : '<p class="muted">No saved parts yet. Move to a spot (drag the timeline or pause) and save it.</p>')+
    `<div class="madd"><input id="mLabel" maxlength="40" placeholder="Name this part" value="Part ${L.length+1}"><button class="primary" data-a="add">Save at ${fmtTime(now)}</button></div>`;
  MM.innerHTML=`<div class="phead"><div><b class="ic">${ICON.mark} Saved parts</b><small>${cur?esc(cur.title):'Nothing open'}</small></div><button data-a="close" aria-label="Close">✕</button></div>${body}`;
  MM.querySelectorAll('button[data-a]').forEach(b=>b.onclick=()=>markAction(b.dataset.a,+b.dataset.i));
  const ren=MM.querySelector('#mRename'); if(ren){ ren.focus(); ren.onkeydown=e=>{ if(e.key==='Enter') markAction('ren',markEdit); }; }
  const add=MM.querySelector('#mLabel'); if(add) add.onkeydown=e=>{ if(e.key==='Enter') markAction('add'); };
}
function markAction(a,i){
  const k=markKey(), L=['ren','del'].includes(a) ? ownMarks(k) : marksFor(k);
  if(a==='close') return closeMarks();
  if(a==='go'){ closeMarks(); return jumpToMark(i); }
  if(a==='loop'){ closeMarks(); return loopMark(i); }
  if(a==='edit'){ markEdit=i; return renderMarks(); }
  if(a==='ren'){ const v=MM.querySelector('#mRename').value.trim(); if(v){ L[i].label=v; if(loop&&loop.a===L[i].t) loop.label=v; saveMarks(); updateUI(); } markEdit=-1; return renderMarks(); }
  if(a==='del'){ if(loop&&loop.a===L[i].t) loop=null; L.splice(i,1); if(!L.length && !fileMarks(k).length) delete prog.marks[k]; saveMarks(); updateUI(); return renderMarks(); }   // kept empty if the song has its own bookmarks, or they'd come back
  if(a==='add' && k){
    const label=MM.querySelector('#mLabel').value.trim()||`Part ${L.length+1}`, at=+Math.max(0,scrub?scrub.target:t).toFixed(2);
    const list=ownMarks(k), same=list.find(m=>Math.abs(m.t-at)<0.05);
    if(same) same.label=label; else{ list.push({t:at, label}); list.sort((x,y)=>x.t-y.t); }   // same spot: just rename it
    saveMarks();
    toast(`🔖 Saved “${label}” at ${fmtTime(at)}`); closeMarks();
  }
}
document.addEventListener('pointerdown',e=>{ if(!MM.hidden && !MM.contains(e.target) && !e.target.closest('#marksBtn,#tMark')) closeMarks(); });

/* ---------- Players ("Who's playing?") ---------- */
const AVATARS=['🎹','🦊','🐼','🐸','🦁','🐯','🐨','🐙','🦄','🐝','🐢','🐬','🦉','🐱','🐶','🐰','🚀','⭐','🌈','🎸'];
let whoForced=false;   // shown at start-up: a player has to be picked
const W_=$('#whoCard');
function openWho(forced=false){
  closeResult(); $('#intro').hidden=true;
  if(playing) togglePlay();
  trainer=null; if(session){ flushTime(); session=null; }
  whoForced=forced; renderWho(); $('#who').hidden=false;
}
function closeWho(){ $('#who').hidden=true; whoForced=false; }
function renderWho(){
  const tile=p=>{ const g=p.id===profiles.active?prog:loadProg(p.id), li=levelInfo(g.xp), m=Math.floor(((g.days[dkey()]||{}).sec||0)/60);
    return `<div class="ptile${p.id===profiles.active?' on':''}"><button class="pick" data-id="${p.id}"><span class="avatar">${p.emoji}</span><b>${esc(p.name)}</b>
      <small>Level ${li.L} · 🔥 ${streak(g)} · today ${m}/${g.settings.goal} min</small></button><button class="edit" data-id="${p.id}" title="Edit ${esc(p.name)}">✎</button></div>`; };
  W_.innerHTML=`<h2>Who's playing?</h2>
    <div class="ptiles">${profiles.list.map(tile).join('')}<div class="ptile"><button class="pick add" id="addP"><span class="avatar">＋</span><b>Add player</b><small>Their own lessons, songs and streak</small></button></div></div>
    ${whoForced?'':'<div class="btns"><button id="whoClose">Close</button></div>'}`;
  W_.querySelectorAll('.pick[data-id]').forEach(b=>b.onclick=()=>switchProfile(b.dataset.id));
  W_.querySelectorAll('.edit').forEach(b=>b.onclick=()=>editPlayer(profiles.list.find(p=>p.id===b.dataset.id)));
  $('#addP').onclick=()=>editPlayer(null);
  if(!whoForced) $('#whoClose').onclick=closeWho;
}
function switchProfile(id){
  if(rec) stopRecording(false);
  if(id!==profiles.active){
    flushTime(); saveProg();
    profiles.active=id; saveProfiles(); prog=loadProg();
    freeKeyboard(); setHands('both'); setSpeed(1); updateWhoBtn(); applyLabels(); layout();
    toast(`${me().emoji} Hi, ${me().name}!`);
  }
  closeWho();
  if(afterWho){ const f=afterWho; afterWho=null; f(); } else openScreen('home');
}
function editPlayer(p){
  const isNew=!p; let emoji=p?p.emoji:AVATARS.find(a=>!profiles.list.some(x=>x.emoji===a))||AVATARS[0];
  W_.innerHTML=`<h2>${isNew?'Add player':'Edit player'}</h2>
    <input id="pName" class="search" maxlength="20" placeholder="Name" value="${p?esc(p.name):''}" autocomplete="off">
    <div class="avatars">${AVATARS.map(a=>`<button data-a="${a}" class="${a===emoji?'on':''}">${a}</button>`).join('')}</div>
    <div class="btns"><button class="primary" id="pSave">${isNew?'Add':'Save'}</button><button id="pCancel">Cancel</button>${!isNew&&profiles.list.length>1?'<button id="pDel" class="danger">Delete player</button>':''}</div>`;
  W_.querySelectorAll('.avatars button').forEach(b=>b.onclick=()=>{ emoji=b.dataset.a; W_.querySelectorAll('.avatars button').forEach(x=>x.classList.toggle('on',x===b)); });
  const name=$('#pName'); name.focus();
  const save=()=>{
    const n=name.value.trim(); if(!n){ name.focus(); return; }
    if(isNew){ const id='p'+Date.now().toString(36); profiles.list.push({id, name:n, emoji}); saveProfiles(); switchProfile(id); return; }
    Object.assign(p,{name:n, emoji}); saveProfiles(); renderWho(); if(screenName) openScreen(screenName); updateWhoBtn();
  };
  $('#pSave').onclick=save; name.onkeydown=e=>{ if(e.key==='Enter') save(); };
  $('#pCancel').onclick=renderWho;
  if($('#pDel')) $('#pDel').onclick=()=>{
    if(!confirm(`Delete ${p.name} and all of their progress? This cannot be undone.`)) return;
    try{ localStorage.removeItem(progKey(p.id)); }catch(e){}
    profiles.list=profiles.list.filter(x=>x!==p);
    if(profiles.active===p.id){ profiles.active=profiles.list[0].id; prog=loadProg(); freeKeyboard(); applyLabels(); }
    saveProfiles(); renderWho(); updateWhoBtn();
  };
}
function updateWhoBtn(){ const b=$('#whoBtn'); b.textContent=me().emoji; b.title=`${me().name} (switch player)`; }
$('#whoBtn').onclick=()=>openWho();

/* =====================================================================
   Boot
   ===================================================================== */
freeKeyboard();
connectMidi();
requestAnimationFrame(frame);
openScreen('home');
updateWhoBtn(); applyLabels();
if(profiles.list.length>1) openWho(true);
importFromLink(); addEventListener('hashchange',importFromLink);   // also when Keys is already open in that tab
setTimeout(()=>loadLibrary().catch(()=>{}), 2000);   // fetch the song list in the background
if('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
