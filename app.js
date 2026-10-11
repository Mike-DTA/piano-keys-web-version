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
const PASS = 80;       // % needed to complete a lesson
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SPEEDS = [0.25,0.4,0.5,0.6,0.7,0.8,0.9,1,1.1,1.25,1.5];
const INTERVALS = [1,2,4,7,14,30,60];          // review intervals in days
const TITLES = ['Beginner','Novice','Apprentice','Player','Performer','Musician','Virtuoso','Maestro'];

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
  for(let tok of src.trim().split(/\s+/)){
    if(tok==='|') continue;   // bar line
    let label=null; const lm=/^\[([^\]]+)\]/.exec(tok);
    if(lm){ label=lm[1]; tok=tok.slice(lm[0].length); }
    const ci = tok.lastIndexOf(':');
    const body = ci>=0 ? tok.slice(0,ci) : tok, adv = ci>=0 ? parseFloat(tok.slice(ci+1)) : 1;
    if(body!=='R') body.split('+').forEach((part,i)=>{
      const m = /^([A-G][#b]?-?\d)(?:@(\d))?(?:~([\d.]+))?$/.exec(part);
      if(!m) throw new Error('Bad note: '+part);
      const len = m[3] ? parseFloat(m[3]) : adv;
      const n = {midi:nameToMidi(m[1]), start:beat*spb, dur:len*spb*0.92, finger:m[2]?+m[2]:undefined};
      if(label && i===0) n.label=label;
      out.push(n);
    });
    beat += adv;
  }
  return out;
}
const voice=(src,bpm,hand)=>src ? parseNotation(src,bpm).map(n=>Object.assign(n,{hand})) : [];
function prep(d){
  if(!d.notes) d.notes = d.rh ? [...voice(d.rh,d.bpm,'R'), ...voice(d.lh,d.bpm,'L')] : parseNotation(d.src,d.bpm);
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
  const tempos=[{tick:0,usq:500000}], raw=[], tracks=[];
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
        if(type===0x51) tempos.push({tick, usq:(v.getUint8(p)<<16)|(v.getUint8(p+1)<<8)|v.getUint8(p+2)});
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
  return {tracks:tracks.filter(t=>t.count>0), notes, beat:t0.usq/1e6};
}

/* ---------- Content index ---------- */
const ALL_LESSONS = COURSES.flatMap(c=>c.lessons.map((l,i)=>Object.assign(l,{course:c, idx:i})));
const LESSON = Object.fromEntries(ALL_LESSONS.map(l=>[l.id,l]));
ALL_LESSONS.forEach(prep);

/* =====================================================================
   Progress store
   ===================================================================== */
const PKEY='keys.progress.v1';
function blankProg(){ return {v:1, xp:0, lessons:{}, songs:{}, days:{}, skills:{}, ach:{}, counts:{drills:0,ear:0,sessions:0,runs:0,trainer:0,bestCombo:0}, history:[], bestDays:0, settings:{goal:10, sessionMin:10, drillMode:'wait'}, created:Date.now()}; }
function loadProg(){
  try{ const p=JSON.parse(localStorage.getItem(PKEY)); if(p && p.v){ const b=blankProg(); return Object.assign(b,p,{counts:Object.assign(b.counts,p.counts), settings:Object.assign(b.settings,p.settings)}); } }catch(e){}
  const p=blankProg();
  try{ for(const l of ALL_LESSONS){ const old=+(localStorage.getItem('keys.lesson.'+l.id)||0); if(old) p.lessons[l.id]={best:old, reps:0, plays:1, last:Date.now()}; } }catch(e){}   // migrate v2
  return p;
}
let prog = loadProg();
function saveProg(){ try{ localStorage.setItem(PKEY, JSON.stringify(prog)); }catch(e){} }

const dkey=(d=new Date())=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const day=(k=dkey())=>prog.days[k]||(prog.days[k]={sec:0,xp:0,runs:0});
const dayOK=k=>prog.days[k] && prog.days[k].sec>=60;
function streak(){ const d=new Date(); if(!dayOK(dkey(d))) d.setDate(d.getDate()-1); let n=0; while(dayOK(dkey(d))){ n++; d.setDate(d.getDate()-1); } return n; }
const totalSec=()=>Object.values(prog.days).reduce((s,d)=>s+d.sec,0);
const lvlNeed=L=>50*L*(L-1);
function levelInfo(xp){ let L=1; while(xp>=lvlNeed(L+1)) L++; return {L, cur:xp-lvlNeed(L), need:lvlNeed(L+1)-lvlNeed(L), title:TITLES[Math.min(TITLES.length-1,Math.floor((L-1)/2))]}; }
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
  if(after.L>before) toast(`⬆️ Level ${after.L}: ${after.title}!`);
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
  {id:'songs5', i:'🎵', n:'Repertoire', d:`Play 5 library songs at ${PASS}% or better`, t:()=>nSongs()>=5},
  {id:'songs20', i:'🎼', n:'Songbook', d:`Play 20 library songs at ${PASS}% or better`, t:()=>nSongs()>=20},
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
const OTHER='#4a5070';           // notes the app plays for the hand you're not practising

let song=null, notes=[], groups=[], gi=0, si=0, songEnd=0, songBeat=0.5, meter=4, lastBeat=null;
let t=-LEAD, playing=false, finished=false, waiting=false, mode='wait', speed=1, hands='both';
let soundOn=false, labelsOn=true, metroOn=false, metroPref=false, lastTs=0, midiFile=null, together=false, previewPhase=false;
let cur=null;         // what's loaded: {kind:'lesson'|'drill'|'free'|'file', def, title, sub, tip, lesson?, regen?, section?}
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
  song=s; together=!!s.together;
  const split=s.split||60;
  notes = s.notes.map(n=>({...n, hand:n.hand||(n.midi<split?'L':'R')})).sort((a,b)=>a.start-b.start||a.midi-b.midi);
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
  restart();
}
function restart(){
  for(const n of notes){ n.hit=false; n.missed=false; n.auto=false; n.req=wants(n); }
  for(const g of groups){ g.wrong=0; g.reveal=false; }
  gi=0; si=0; t=-LEAD; playing=false; finished=false; waiting=false; lastBeat=null;
  held.clear(); resetStats(); closeResult(); updateUI();
}
function setRange(a,b){
  lo=Math.max(21,a); hi=Math.min(108,b); whites=[]; whiteIdx={};
  for(let m=lo;m<=hi;m++) if(!isBlack(m)){ whiteIdx[m]=whites.length; whites.push(m); }
  layout();
}
function advanceGroups(){ while(gi<groups.length && groups[gi].notes.every(n=>n.hit||!n.req)) gi++; }

/* ---------- Layout & geometry ---------- */
function layout(){
  const dpr=window.devicePixelRatio||1;
  W=cv.clientWidth; H=cv.clientHeight;
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); cx.setTransform(dpr,0,0,dpr,0,0);
  kbH=Math.max(70,Math.min(H*0.3,180)); kbTop=H-kbH; ww=W/Math.max(1,whites.length);
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
function tone(m,dur=0.6,vel=0.6){
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
function noteOn(m, src){
  if(src!=='midi') tone(m,0.8);
  held.set(m,null);
  let ok=null;
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
          else score(n);
        } else if(g.notes.some(n=>n.midi===m)) ok=true;
        else { ok=false; g.wrong++; if(song.hidden && g.wrong>=2) g.reveal=true; }
      } else ok=false;
    }
  } else if(playing && mode==='play'){
    let best=null, bd=WIN;
    for(const n of notes){ if(n.start>t+WIN) break; if(n.req && n.midi===m && !n.hit && !n.missed){ const d=Math.abs(n.start-t); if(d<=bd){ bd=d; best=n; } } }
    if(best){ score(best); ok=true; } else ok=false;
  }
  if(ok===false){ stats.wrong++; stats.streak=0; }
  stats.bestStreak=Math.max(stats.bestStreak,stats.streak);
  held.set(m,ok); updateHud();
}
function noteOff(m){ held.delete(m); }

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
  if(c===0x90 && d2>0) noteOn(d1,'midi');
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
const overlayOpen=()=>!$('#screen').hidden || !$('#intro').hidden;
addEventListener('keydown',e=>{
  if(e.key==='Escape'){ if(!$('#intro').hidden) $('#intro').hidden=true; else if(!$('#screen').hidden) closeScreen(); return; }
  if(e.target.tagName==='SELECT' || e.target.tagName==='INPUT' || overlayOpen()) return;
  if(e.code==='Space'){ e.preventDefault(); togglePlay(); return; }
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
    for(const n of notes){ if(n.start>nt) break; if(n.req && !n.hit && !n.missed && nt>n.start+WIN){ n.missed=true; stats.miss++; stats.streak=0; } }
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
  if(t>songEnd+0.8 && (mode!=='wait' || gi>=groups.length)) finish();
  updateHud();
}
function frame(ts){
  const raw=(ts-(lastTs||ts))/1000, dt=Math.min(0.05,raw); lastTs=ts;
  if(playing){
    step(dt);
    const r=Math.min(raw,0.25); pendSec+=r; if(session) session.sec+=r;
    if(pendSec>=10) flushTime();
  }
  draw(); requestAnimationFrame(frame);
}

/* =====================================================================
   Running things: lessons, drills, songs
   ===================================================================== */
const lessonItem=l=>({kind:'lesson', lesson:l, def:l, title:l.title, sub:`${l.course.icon} ${l.course.title} ${l.idx+1}`, tip:l.tip});
function setHands(h){ hands=h; $('#hands').value=h; }

function startItem(it, listen=false){
  closeScreen(); $('#intro').hidden=true; closeResult();
  cur=it;
  const d=it.def;
  if(!d.both && hands!=='both') setHands('both');
  previewPhase = !listen && !!d.preview;
  mode = (listen||previewPhase) ? 'listen' : d.mode; $('#mode').value=mode;
  $('#tracks').hidden=true;
  loadSong(d);
  togglePlay();
}
function isCounting(){ const d=cur.def; return mode===d.mode && (hands==='both'||!d.both); }
function runXP(acc,res){ let xp=Math.round(stats.hit*acc/100*0.5)+(acc>=PASS?5:0); if(res.firstPass) xp+=25; xp+=Math.max(0,res.newStars||0)*10; return Math.max(1,xp); }

function recordRun(acc){
  if(!cur || mode==='listen' || stats.hit+stats.wrong+stats.miss===0) return null;
  const d=cur.def, res={acc, counts:isCounting()};
  prog.counts.runs++; prog.counts.bestCombo=Math.max(prog.counts.bestCombo||0, stats.bestStreak);
  if(cur.lesson && res.counts) Object.assign(res, updateLesson(cur.lesson.id, acc));
  if(cur.song && (hands==='both' || !d.both)){   // library song, played with every hand it needs
    const r=prog.songs[cur.song.id]||(prog.songs[cur.song.id]={best:0, plays:0});
    res.prevBest=r.best; r.best=Math.max(r.best,acc); r.plays++; r.last=Date.now(); res.songBest=r.best;
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
  playing=false; finished=true; releaseWake(); flushTime(); updateUI();
  if(previewPhase){
    previewPhase=false; mode=song.mode; $('#mode').value=mode; restart();
    toast('👂 Your turn: play it back!');
    setTimeout(()=>{ if(!playing && !finished && cur && cur.def===song) togglePlay(); }, 900);
    return;
  }
  const acc=accuracy();
  if(mode==='listen' && cur && cur.kind!=='free' && cur.kind!=='file')
    return setResult(cur.title,null,'♪','Your turn! Now play it yourself.',[{label:'▶ Start',primary:true,fn:()=>startItem(cur,false)},session?{label:'Skip',fn:()=>{ session.idx++; sessionCard(null); }}:{label:'Menu',fn:()=>openScreen('learn')}]);
  const res=recordRun(acc);
  if(session) return sessionAfter(acc,res);
  if(trainer) return trainerAfter(acc,res);
  if(!cur || cur.kind==='free' || cur.kind==='file') return freeFinish(acc,res);
  if(cur.kind==='lesson') return lessonFinish(acc,res);
  return drillFinish(acc,res);
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

function freeFinish(acc,res){
  const back = cur&&cur.song ? {label:'🎵 Songs',fn:()=>openScreen('songs')} : {label:'Close',fn:closeResult};
  if(mode==='listen'){
    const play = cur&&cur.song ? [{label:'▶ Play it',primary:true,fn:()=>startItem(cur)}] : [];
    return setResult(song.title,null,'♪','Now try it yourself.',[...play, back]);
  }
  let detail=statLine();
  if(res && res.songBest!=null) detail+=` · personal best ${res.songBest}%`;
  else if(cur && cur.song) detail+=' · one-hand practice (play both hands to set a best score)';
  else{ let bestS=acc; try{ const k='keys.best.'+song.title+'.'+mode; bestS=Math.max(acc, +(localStorage.getItem(k)||0)); localStorage.setItem(k,bestS); }catch(e){} detail+=` · personal best ${bestS}%`; }
  const title = res && res.songBest!=null && res.prevBest && acc>res.prevBest ? '🎉 New best · '+song.title : song.title;
  setResult(title, cur&&cur.song?starsFor(acc):null, acc+'%', detail, [{label:'Again',primary:true,fn:()=>{restart();togglePlay();}},{label:'⚡ Speed trainer',fn:()=>startTrainer(cur)},back], {xp:res&&res.xp});
}
function lessonFinish(acc,res){
  const L=cur.lesson, pass=acc>=PASS, counts=res&&res.counts;
  let detail = statLine()+'.';
  if(!pass) detail = `You need ${PASS}% to complete this lesson. Try a slower speed, or practise one hand at a time.`;
  if(!counts) detail += hands!=='both' ? ' One-hand practice run: play with both hands to complete the lesson.' : ` Practice run: use “${L.mode==='play'?'Play along':'Wait for me'}” to complete the lesson.`;
  const nx=nextInPath(), btns=[];
  if(pass && counts && nx) btns.push({label:'Next lesson ▶',primary:true,fn:()=>showIntro(nx)});
  btns.push({label:'↺ Retry',primary:!(pass&&counts&&nx),fn:()=>startItem(cur,false)});
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

const DRILLS=[
  {id:'notes', icon:'🎯', title:'Note finder', desc:'Random notes in one hand position. Builds a feel for where every key is.', modeable:true, variants:POS, make:v=>genNotes(v)},
  {id:'chords', icon:'🎹', title:'Chord changes', desc:'Random chord progressions. Press each chord with all its keys together.', modeable:true, variants:CSETS, make:v=>genChords(v)},
  {id:'rhythm', icon:'🥁', title:'Rhythm reading', desc:'A new rhythm every time, played in tempo with the metronome.', variants:RLEVEL, make:v=>genRhythm(v)},
  {id:'scales', icon:'📈', title:'Scale run', desc:'Scales twice through, in tempo with the metronome.', variants:Object.fromEntries(Object.entries(SCALES).map(([k,s])=>[k,{label:s.label,need:s.l}])), make:v=>genScale(v)},
  {id:'hands', icon:'🙌', title:'Hand coordination', desc:'Random two-hand patterns: turns, parallel, mirror, melody + bass.', modeable:true, variants:HANDS, make:v=>genHands(v)},
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
function draw(){
  cx.fillStyle=C.bg; cx.fillRect(0,0,W,H);
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
    const other = mode!=='listen' && !n.req;
    let fill = other ? OTHER : (n.hand==='L' ? C.left : C.accent);
    if(!other && n.hit) fill=C.good; else if(n.missed) fill=C.bad;
    cx.globalAlpha = n.missed ? 0.45 : other ? 0.6 : 1;
    cx.fillStyle=fill; rrect(r.x+1.5,yt,r.w-3,Math.max(4,yb-yt),5);
    cx.globalAlpha=1;
    if(labelsOn && r.w>=14 && yb-yt>16){
      cx.fillStyle='rgba(10,12,22,.8)';
      cx.font='600 11px system-ui,sans-serif'; cx.fillText(NAMES[n.midi%12],r.x+r.w/2,yb-3);
      if(n.finger && yb-yt>32){ cx.font='800 14px system-ui,sans-serif'; cx.fillText(n.finger,r.x+r.w/2,yb-17); }
    }
    if(n.label){   // chord name in a pill to the left of the chord (right if no room)
      cx.font='700 13px system-ui,sans-serif'; const tw=cx.measureText(n.label).width+12, py=Math.min(yb,kbTop)-22;
      const px = r.x-tw-6>=0 ? r.x-tw-6 : r.x+r.w+6;
      cx.fillStyle='rgba(23,27,46,.9)'; rrect(px,py,tw,20,10);
      cx.fillStyle=C.text; cx.textAlign='left'; cx.textBaseline='middle'; cx.fillText(n.label,px+6,py+10.5);
      cx.textAlign='center'; cx.textBaseline='bottom';
    }
  }
  cx.globalAlpha=1; cx.restore();
  cx.fillStyle = waiting ? C.accent : 'rgba(255,255,255,0.25)'; cx.fillRect(0,kbTop-2,W,2);

  const target=new Map(), sounding=new Map(), g=groups[gi];
  if(mode==='wait' && g && g.start-t<=EARLY && (!hidden || g.reveal)) g.notes.forEach(n=>{ if(n.req && !n.hit) target.set(n.midi,n); });
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
      if(tg.finger && labelsOn){
        const cxp=r.x+r.w/2, cyp=kbTop+r.h*(r.black?0.72:0.62), rr=Math.min(11,r.w/2-1);
        cx.fillStyle='#0b0e1a'; cx.beginPath(); cx.arc(cxp,cyp,rr,0,Math.PI*2); cx.fill();
        cx.fillStyle='#fff'; cx.font=`800 ${Math.round(rr*1.25)}px system-ui,sans-serif`; cx.textAlign='center'; cx.textBaseline='middle'; cx.fillText(tg.finger,cxp,cyp+1);
      }
    }
  };
  for(const m of whites) paintKey(m,keyRect(m));
  cx.textAlign='center'; cx.textBaseline='bottom'; cx.font='10px system-ui,sans-serif'; cx.fillStyle='#7a7f9e';
  for(const m of whites) if(m%12===0 && ww>=16){ const r=keyRect(m); cx.fillText('C'+(m/12-1), r.x+r.w/2, H-4); }
  for(let m=lo;m<=hi;m++) if(isBlack(m)){ const r=keyRect(m); if(r) paintKey(m,r); }

  if(songEnd>0){ cx.fillStyle='rgba(255,255,255,0.08)'; cx.fillRect(0,0,W,3); cx.fillStyle=C.accent; cx.fillRect(0,0,W*Math.max(0,Math.min(1,t/songEnd)),3); }
}

/* =====================================================================
   HUD & play controls
   ===================================================================== */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function updateHud(){
  const title = cur && cur.kind!=='free' && cur.kind!=='file' ? `${esc(cur.sub||'')} · ${esc(cur.title)}` : esc(song?song.title:'');
  const tip = cur && cur.tip ? `<small class="tip">${esc(cur.tip)}</small>` : '';
  const handTxt = hands==='both' ? '' : ` · ${hands} hand only`;
  const sess = session ? `<small class="sess">Session ${session.idx+1}/${session.items.length} · ${fmtTime(session.sec)} / ~${session.est}:00</small>`
             : trainer ? `<small class="sess">⚡ Speed trainer · ${Math.round(speed*100)}% → goal ${Math.round(trainer.goal*100)}%</small>` : '';
  const head = previewPhase ? '👂 Listen carefully…' : mode==='listen' ? 'Listening…' : `${accuracy()}% · streak ${stats.streak}`;
  $('#hud').innerHTML = `${head}${sess}<small>${title}${handTxt}</small>${mode==='listen'&&!previewPhase?'':tip}`;
}
function updateUI(){
  $('#play').textContent = playing ? '❚❚ Pause' : (finished||t<=-LEAD ? '▶ Start' : '▶ Resume');
  $('#msg').textContent = !notes.length ? 'Play freely, or pick something from 🎵 Songs' : !playing && !finished && t<=-LEAD ? 'Press Start (or Space) when you\'re ready' : (!playing && !finished ? 'Paused' : '');
  updateHud();
}
let wake=null;
async function holdWake(){ try{ if(navigator.wakeLock) wake=await navigator.wakeLock.request('screen'); }catch(e){} }
function releaseWake(){ try{ wake&&wake.release(); }catch(e){} wake=null; }
function togglePlay(){
  audio();
  if(!notes.length){ openScreen('songs'); return; }   // free keyboard: nothing to play yet
  if(finished) restart();
  playing=!playing; lastTs=0;
  if(playing) holdWake(); else { releaseWake(); flushTime(); }
  updateUI();
}

function freeKeyboard(){ cur=null; session=null; trainer=null; $('#tracks').hidden=true; loadSong(prep({title:'Free play', notes:[]})); }
$('#songsBtn').onclick=()=>openScreen('songs');
$('#mode').onchange=e=>{ mode=e.target.value; previewPhase=false; restart(); };
$('#hands').onchange=e=>{ hands=e.target.value; restart(); };
$('#speed').innerHTML=SPEEDS.map(s=>`<option value="${s}"${s===1?' selected':''}>${Math.round(s*100)}%</option>`).join('');
$('#speed').onchange=e=>{ speed=parseFloat(e.target.value); };
$('#play').onclick=togglePlay;
$('#restart').onclick=()=>{ restart(); releaseWake(); };
$('#metro').onclick=e=>{ metroOn=!metroOn; if(!(song&&song.metro)) metroPref=metroOn; e.currentTarget.setAttribute('aria-pressed',metroOn); audio(); };
$('#sound').onclick=e=>{ soundOn=!soundOn; e.currentTarget.setAttribute('aria-pressed',soundOn); audio(); };
$('#labels').onclick=e=>{ labelsOn=!labelsOn; e.currentTarget.setAttribute('aria-pressed',labelsOn); };
$('#midi').onclick=connectMidi;
$('#homeBtn').onclick=()=>{ if(session) sessionSummary(); else openScreen('home'); };
$('#resCard').onclick=()=>clearCountdown();
$('#intro').onclick=e=>{ if(e.target.id==='intro') $('#intro').hidden=true; };
$('#fs').onclick=async()=>{
  try{ if(!document.fullscreenElement){ await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } else await document.exitFullscreen(); }catch(e){}
};
$('#file').onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const parsed=parseMidiFile(await f.arrayBuffer());
    if(!parsed.notes.length) throw new Error('No notes found in this file');
    session=null; trainer=null;
    midiFile={title:f.name.replace(/\.midi?$/i,''), ...parsed, on:new Set(parsed.tracks.map(t=>t.index))};
    $('#tracks').innerHTML = 'Tracks: ' + parsed.tracks.map(t=>`<label><input type="checkbox" data-t="${t.index}" checked> ${esc(t.name)} (${t.count})</label>`).join('');
    $('#tracks').querySelectorAll('input').forEach(cb=>cb.onchange=()=>{ const i=+cb.dataset.t; cb.checked?midiFile.on.add(i):midiFile.on.delete(i); loadFileSong(); });
    loadFileSong();
  }catch(err){ alert('Could not open MIDI file: '+err.message); }
  e.target.value='';
};
function loadFileSong(){
  const def={title:midiFile.title, notes:midiFile.notes.filter(x=>midiFile.on.has(x.track)), beat:midiFile.beat};
  cur={kind:'file', def, title:def.title}; $('#tracks').hidden=false;
  closeScreen(); loadSong(def);
}
addEventListener('resize',layout);
document.addEventListener('visibilitychange',()=>{ if(document.hidden){ if(playing) togglePlay(); flushTime(); } });

/* =====================================================================
   Screens: Home, Lessons, Practice, Progress
   ===================================================================== */
let screenName=null;
function openScreen(name){
  closeResult(); $('#intro').hidden=true;
  if(playing) togglePlay();
  trainer=null; if(session){ flushTime(); session=null; }
  screenName=name;
  const tabs=[['home','🏠 Home'],['learn','🎓 Lessons'],['songs','🎵 Songs'],['practice','🏋 Practice'],['progress','📈 Progress']];
  $('#snav').innerHTML=tabs.map(([k,l])=>`<button data-s="${k}" class="${k===name?'on':''}">${l}</button>`).join('')+'<span class="sp"></span><button class="kb" data-s="close">🎹 Keyboard</button>';
  $('#snav').querySelectorAll('button').forEach(b=>b.onclick=()=>b.dataset.s==='close'?closeScreen():openScreen(b.dataset.s));
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
function heroHTML(){
  const li=levelInfo(prog.xp);
  return `<div class="hero"><div class="lv"><b>Level ${li.L}</b> · ${li.title}<div class="xpbar"><i style="width:${100*li.cur/li.need}%"></i></div><small class="muted">${li.cur} / ${li.need} XP to level ${li.L+1}</small></div>
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
      <button class="tile" id="songs"><span class="ic">🎵</span><span><b>Songs</b><small>${self.SONGS?SONGS.length+' ':''}public-domain songs, plus your own MIDI files</small></span></button>
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

function renderLearn(){
  const nx=nextInPath();
  B.innerHTML=`<div class="grid">${COURSES.map(c=>{
    const done=c.lessons.filter(l=>passed(l.id)).length;
    return `<section class="box course"><h3>${c.icon} ${c.title}</h3><div class="sub">${c.sub} · ${done}/${c.lessons.length}</div><div class="bar"><i style="width:${100*done/c.lessons.length}%"></i></div>
      ${c.lessons.map((l,i)=>{ const b=best(l.id), ok=b>=PASS, due=dueness(l.id)>=1;
        return `<button class="lesson${ok?' done':''}${l===nx?' next':''}" data-id="${l.id}"><span class="num">${ok?'✓':i+1}</span><span class="t">${esc(l.title)}</span>${due?'<span class="due" title="Ready for review">↻</span>':''}${ok?`<span class="s">${starStr(starsFor(b))}</span>`:''}</button>`; }).join('')}
    </section>`; }).join('')}</div>`;
  bind('.lesson',el=>showIntro(LESSON[el.dataset.id]));
}

/* ---------- Song library ---------- */
let libP=null, songQ='', songLvl=0, songCat='';
const LEVELS={1:'Easy', 2:'Medium', 3:'Harder'}, dots=n=>'●'.repeat(n)+'○'.repeat(3-n);
function loadLibrary(){   // songs.js is only fetched when needed (or once the app is idle)
  return libP || (libP=new Promise((res,rej)=>{
    const el=document.createElement('script'); el.src='songs.js';
    el.onload=()=>res(self.SONGS);
    el.onerror=()=>{ el.remove(); libP=null; rej(new Error('Could not load the song library')); };
    document.head.appendChild(el);
  }));
}
const songById=id=>self.SONGS.find(s=>s.id===id);
async function songDef(e){   // notes are parsed (or the MIDI file fetched) the first time a song is opened
  if(e.def) return e.def;
  let d;
  if(e.mid){
    const r=await fetch(e.mid); if(!r.ok) throw new Error('Could not load '+e.mid);
    const p=parseMidiFile(await r.arrayBuffer());
    d={notes:p.notes, beat:p.beat, split:e.split, meter:e.meter};
  } else d={bpm:e.bpm, meter:e.meter, pulse:e.pulse, split:e.split, rh:e.rh, lh:e.lh};
  d.title=e.title;
  return e.def=prep(d);
}
const songItem=e=>({kind:'free', song:e, def:e.def, title:e.title, sub:'🎵 Song'});
function startSong(e,listen){ session=null; trainer=null; e.def.mode=prog.settings.songMode||'wait'; startItem(songItem(e),listen); }

function renderSongs(){
  if(!self.SONGS){
    B.innerHTML='<p class="muted">Loading songs…</p>';
    loadLibrary().then(()=>{ if(screenName==='songs') renderSongs(); },
      err=>{ if(screenName!=='songs') return; B.innerHTML=`<p class="muted">${esc(err.message)}. Check your connection.</p><button id="retry">Try again</button>`; bind('#retry',renderSongs); });
    return;
  }
  const songCourse=LESSON.p1.course;
  B.innerHTML=`<input id="sq" class="search" type="search" placeholder="Search ${SONGS.length} songs or composers" value="${esc(songQ)}" autocomplete="off">
  <div class="chips" id="slv">${[0,1,2,3].map(k=>`<button data-l="${k}" class="${k===songLvl?'on':''}">${k?dots(k)+' '+LEVELS[k]:'All levels'}</button>`).join('')}</div>
  <div class="chips" id="sct"><button data-c="" class="${songCat?'':'on'}">All</button>${Object.entries(SONG_CATS).map(([k,l])=>`<button data-c="${k}" class="${k===songCat?'on':''}">${l}</button>`).join('')}</div>
  <div id="slist"></div>
  <h2 class="sec">More songs</h2>
  <div class="grid">
    <div class="box"><h3>${songCourse.icon} Song lessons</h3><p>Learn a song step by step, with tips and finger numbers.</p>
      <div class="chips">${songCourse.lessons.map(l=>`<button data-id="${l.id}" class="sl">${passed(l.id)?'✓ ':''}${esc(l.title)}</button>`).join('')}</div></div>
    <div class="box"><h3>📄 Your own MIDI file</h3><p>Open any .mid file on this device and choose which tracks to play.</p><button id="openMid">Open .mid file</button></div>
  </div>`;
  renderSongList();
  $('#sq').oninput=e=>{ songQ=e.target.value; renderSongList(); };
  bind('#slv button',el=>{ songLvl=+el.dataset.l; renderSongs(); });
  bind('#sct button',el=>{ songCat=el.dataset.c; renderSongs(); });
  bind('.sl',el=>showIntro(LESSON[el.dataset.id]));
  bind('#openMid',()=>$('#file').click());
}
function renderSongList(){
  const q=songQ.trim().toLowerCase();
  const list=SONGS.filter(s=>(!songLvl||s.level===songLvl) && (!songCat||s.cat===songCat) && (!q||(s.title+' '+s.by).toLowerCase().includes(q)));
  const row=s=>{ const r=prog.songs[s.id];
    return `<button class="song" data-id="${s.id}"><span class="t"><b>${esc(s.title)}</b><small>${esc(s.by)}</small></span>
      ${r&&r.best?`<span class="s" title="Your best">${starStr(starsFor(r.best))}<small>${r.best}%</small></span>`:''}<span class="lvl" title="${LEVELS[s.level]}">${dots(s.level)}</span></button>`; };
  $('#slist').innerHTML = !list.length ? '<p class="muted">No songs match your search.</p>' :
    Object.keys(SONG_CATS).map(c=>{ const ss=list.filter(s=>s.cat===c); return ss.length ? `<h2 class="sec">${SONG_CATS[c]} <span class="muted">· ${ss.length}</span></h2><div class="songs">${ss.map(row).join('')}</div>` : ''; }).join('');
  $('#slist').querySelectorAll('.song').forEach(el=>el.onclick=()=>showSong(songById(el.dataset.id)));
}
async function showSong(e){
  let d; try{ d=await songDef(e); }catch(err){ return toast('⚠ '+err.message); }
  const r=prog.songs[e.id], len=d.notes.reduce((m,n)=>Math.max(m,n.start+n.dur),0), card=$('#introCard');
  card.innerHTML=`<div class="kicker">${SONG_CATS[e.cat]} · ${dots(e.level)} ${LEVELS[e.level]}</div>
    <h2>${esc(e.title)}</h2><p class="muted">${esc(e.by)}</p>
    <div class="meta">${fmtTime(len)} at full speed · ${d.both?'both hands':'one hand'}${r?` · best ${r.best}% · played ${r.plays}×`:''}</div>
    ${d.both?`<div class="seg" id="sgHands"><button data-h="right">Right hand</button><button data-h="left">Left hand</button><button data-h="both">Both hands</button></div><br>`:''}
    <div class="seg" id="sgMode"><button data-m="wait">⏸ Wait for me</button><button data-m="play">⏱ Play along</button></div>
    <div class="btns"><button class="primary" id="sgStart">▶ Start</button><button id="sgListen">👂 Listen</button><button id="sgTrain">⚡ Speed trainer</button><button id="sgBack">Back</button></div>`;
  const seg=(id,key,get,set)=>{ const el=$(id); if(!el) return; const sync=()=>el.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset[key]===get())); el.querySelectorAll('button').forEach(b=>b.onclick=()=>{ set(b.dataset[key]); sync(); }); sync(); };
  seg('#sgHands','h',()=>hands,setHands);
  seg('#sgMode','m',()=>prog.settings.songMode||'wait',m=>{ prog.settings.songMode=m; saveProg(); });
  $('#sgStart').onclick=()=>startSong(e,false);
  $('#sgListen').onclick=()=>startSong(e,true);
  $('#sgTrain').onclick=()=>startTrainer(songItem(e));
  $('#sgBack').onclick=()=>{ $('#intro').hidden=true; };
  $('#intro').hidden=false;
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
    <div class="box"><h3>🎵 Songs</h3><p>Browse the song library or open your own MIDI file, with the hand, speed and metronome options.</p><button id="songs">Browse songs</button></div>
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
      <p>Progress is saved on this device. Export a backup to move it to another phone or browser.</p>
      <div class="btns" style="justify-content:flex-start"><button id="exp">⬇ Export backup</button><button id="imp">⬆ Import backup</button><button id="reset">Reset progress</button></div></div>
  </div>`;
  bind('#goal button',el=>{ prog.settings.goal=+el.dataset.m; saveProg(); renderProgress(); });
  bind('#exp',exportProg);
  bind('#imp',()=>$('#importFile').click());
  bind('#reset',()=>{ if(confirm('Delete all progress on this device? This cannot be undone (export a backup first if unsure).')){ prog=blankProg(); saveProg(); renderProgress(); toast('Progress reset'); } });
}
function exportProg(){
  flushTime();
  const blob=new Blob([JSON.stringify(prog)],{type:'application/json'}), a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`keys-progress-${dkey()}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000); toast('⬇ Backup downloaded');
}
$('#importFile').onchange=async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  try{
    const p=JSON.parse(await f.text()); if(!p || p.v!==1 || typeof p.xp!=='number') throw new Error('not a Keys backup');
    if(!confirm(`Replace progress on this device with this backup (level ${levelInfo(p.xp).L}, ${Object.keys(p.lessons||{}).length} lessons)?`)) return;
    const b=blankProg(); prog=Object.assign(b,p,{counts:Object.assign(b.counts,p.counts), settings:Object.assign(b.settings,p.settings)});
    saveProg(); toast('⬆ Backup restored'); if(screenName) openScreen(screenName);
  }catch(err){ alert('Could not import: '+err.message); }
};

/* ---------- Lesson intro ---------- */
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
function showIntro(L, it){
  it = it || lessonItem(L);
  if(!session) trainer=null;
  closeResult(); closeScreen();
  if(playing) togglePlay();
  const c=L.course, card=$('#introCard'), inSession=!!session;
  card.innerHTML=`<div class="kicker">${inSession?`Session ${session.idx+1}/${session.items.length} · New · `:''}${c.icon} ${c.title} · Lesson ${L.idx+1} of ${c.lessons.length}</div>
    <h2>${esc(L.title)}</h2>${L.text.map(p=>`<p>${p}</p>`).join('')}
    <div class="mini">${miniKeyboard(L)}</div>
    ${L.both?`<div class="seg" id="introHands"><button data-h="right">Right hand</button><button data-h="left">Left hand</button><button data-h="both">Both hands</button></div>`:''}
    <div class="meta">${L.mode==='play'?'⏱ Play along: the music keeps going.':'⏸ Wait for me: the music waits for you.'}${L.metro?' 🥁 Metronome on.':''} Numbers are finger numbers. Pass with ${PASS}%.${best(L.id)?` Your best: ${best(L.id)}%.`:''}</div>
    <div class="btns"><button class="primary" id="introStart">▶ Start</button><button id="introListen">👂 Listen first</button><button id="introBack">${inSession?'Skip':'Lessons'}</button></div>`;
  const seg=$('#introHands');
  if(seg){
    const sync=()=>seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.h===hands));
    seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{ setHands(b.dataset.h); sync(); });
    sync();
  }
  $('#introStart').onclick=()=>startItem(it,false);
  $('#introListen').onclick=()=>startItem(it,true);
  $('#introBack').onclick=()=>{ if(inSession){ session.idx++; sessionCard(null); } else openScreen('learn'); };
  $('#intro').hidden=false;
}

/* =====================================================================
   Boot
   ===================================================================== */
freeKeyboard();
connectMidi();
requestAnimationFrame(frame);
openScreen('home');
setTimeout(()=>loadLibrary().catch(()=>{}), 2000);   // fetch the song list in the background
if('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
