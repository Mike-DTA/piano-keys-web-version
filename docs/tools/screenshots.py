"""Retakes the README screenshots in docs/screenshots/ with a demo player ("Sam").

  python3 -m http.server 3010 --bind 127.0.0.1                     # in the repo folder
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9223 \
      --user-data-dir=/tmp/keys-shots --hide-scrollbars --window-size=1200,750 about:blank
  python3 docs/tools/screenshots.py              # all scenes, or name some: ... sheet help

Uses its own Chrome profile, so your real progress is never touched.
"""
import sys, os, time, json
HERE=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from cdp import page, js, shot as _shot
OUT=os.path.join(HERE,'..','screenshots'); ONLY=sys.argv[1:]
ws=page(9223)
ws.call('Emulation.setDeviceMetricsOverride',{'width':1200,'height':750,'deviceScaleFactor':1.5,'mobile':False})
ws.call('Page.enable')
def load():
    ws.call('Page.navigate',{'url':'http://127.0.0.1:3010/'}); time.sleep(2.5)
    js(ws,"localStorage.clear(); (async()=>{ const q=indexedDB.deleteDatabase('keys'); await new Promise(r=>{q.onsuccess=q.onerror=q.onblocked=r; setTimeout(r,800);}); })()")
    ws.call('Page.navigate',{'url':'http://127.0.0.1:3010/'}); time.sleep(2.5)
    js(ws, DEMO); time.sleep(0.5)
DEMO=r"""(async()=>{
  profiles.list[0].name='Sam'; profiles.list[0].emoji='🦊'; saveProfiles(); updateWhoBtn();
  const mins=[22,15,25,10,0,30,18,16,12,21,0,14,17,9];
  for(let i=0;i<14;i++){ const d=new Date(); d.setDate(d.getDate()-i); prog.days[dkey(d)]={sec:mins[i]*60, xp:40, runs:4}; }
  prog.xp=2350; prog.bestDays=9;
  PATH.slice(0,26).forEach((id,i)=>{ prog.lessons[id]={best:[84,93,98,88,100,91][i%6], reps:2, plays:3, last:Date.now()-(i%7)*864e5}; });
  Object.assign(prog.songs,{'ode-to-joy':{best:96,plays:5},'greensleeves':{best:82,plays:4},'jingle-bells':{best:100,plays:6},'twinkle':{best:98,plays:3},'canon-in-d':{best:88,plays:2}});
  Object.assign(prog.skills,{'c-r':{m:94,n:9},'c-l':{m:86,n:6},'black':{m:79,n:4},'rhythm':{m:83,n:7},'chords':{m:88,n:5},'read':{m:72,n:4},'scales':{m:81,n:3},'hands':{m:69,n:3},'songs':{m:91,n:8},'theory':{m:85,n:3}});
  prog.tests=prog.tests||{}; prog.tests['test:ode-to-joy']={passed:true, best:94};
  prog.counts.sessions=8; prog.counts.drills=31; prog.counts.runs=120; prog.counts.bestCombo=64;
  checkAch(); prog.history=[]; [['Greensleeves','free',82],['Pop chords · Four-chord pop','drill',94],['The pop progression','lesson',91],['Read the note · Both clefs','drill',88],['Ode to Joy','free',96]].forEach(([title,kind,acc],i)=>prog.history.push({at:Date.now()-i*36e5,title,kind,acc,xp:20+i}));
  saveProg(); document.querySelectorAll('.toast').forEach(t=>t.remove());
  await loadLibrary(); await ensureMusicFont();
})()"""
def shot(ws,path,**k):
    js(ws,"setMidiStatus('🎹 Digital Piano',true); const m=document.getElementById('msg'); if(m && /Paused/.test(m.textContent)) m.style.visibility='hidden'"); time.sleep(0.2)
    _shot(ws,path,**k)
scenes={}
def scene(f): scenes[f.__name__]=f; return f
@scene
def home():
    js(ws,"openScreen('home')"); time.sleep(0.4); shot(ws,f'{OUT}/home.jpg',h=520)
@scene
def falling():
    js(ws,"(async()=>{ const e=songById('ode-to-joy'); await songDef(e); startSong(e,false); if(playing) togglePlay(); closeScreen(); seekTo(9.2); held.set(64,true); held.set(48,true); })()"); time.sleep(0.8)
    shot(ws,f'{OUT}/falling-notes.jpg')
@scene
def sheet():
    js(ws,"(async()=>{ prog.settings.view='staff'; prog.settings.labels=0; applyLabels(); const e=songById('bach-minuet-b-flat'); await songDef(e); startSong(e,false); if(playing) togglePlay(); closeScreen(); layout(); seekTo(5.3); })()"); time.sleep(0.8)
    shot(ws,f'{OUT}/sheet-music.jpg')
@scene
def reading():
    js(ws,"""(async()=>{ prog.settings.view='falling'; startItem(genRead('both')); speed=1.5; const wait=ms=>new Promise(x=>setTimeout(x,ms));
      for(let k=0;k<2;k++){ await new Promise(res=>{ const iv=setInterval(()=>{ if(waiting){ clearInterval(iv); res(); } },20); }); const g=groups[gi]; g.notes.forEach(n=>noteOn(n.midi,'midi')); await wait(60); g.notes.forEach(n=>noteOff(n.midi)); await wait(120); }
      await new Promise(res=>{ const iv=setInterval(()=>{ if(waiting){ clearInterval(iv); res(); } },20); });
      const tgt=groups[gi].notes[0]; noteOn(tgt.midi+(tgt.midi%12===4||tgt.midi%12===11?1:2),'midi'); })()"""); time.sleep(0.5)
    shot(ws,f'{OUT}/read-the-note.jpg')
@scene
def songs():
    js(ws,"prog.marks['greensleeves']=[{t:21.6,label:'Chorus'}]; prog.marks['fur-elise']=[{t:9.5,label:'Middle part'}]; saveProg(); openScreen('songs')"); time.sleep(1.2)
    shot(ws,f'{OUT}/songs.jpg')
@scene
def lesson():
    js(ws,"showIntro(LESSON.c3); $('#intro').scrollTop=150"); time.sleep(0.5)
    shot(ws,f'{OUT}/lesson-theory.jpg')
@scene
def heatmap():
    js(ws,"""(async()=>{ const e=songById('greensleeves'); await songDef(e); startSong(e,false); if(playing) togglePlay(); const R=heatRun;
      const v=Array.from({length:R.n},(_,i)=>[0,0,.2,0,0,1.4,2.6,1.1,0,0,0,.3,0,0,0,0,.4,0,1.8,3.2,1.5,.2,0,0,0,0,.5,0,0,0,0,0][i]||0);
      prog.heat['greensleeves']={bin:+R.bin.toFixed(3), n:R.n, v, p:Array(R.n).fill(4)}; saveProg(); openScreen('songs'); await new Promise(x=>setTimeout(x,700)); await showSong(e); })()"""); time.sleep(0.6)
    shot(ws,f'{OUT}/mistake-heatmap.jpg')
@scene
def progress():
    js(ws,"openScreen('progress')"); time.sleep(0.5); shot(ws,f'{OUT}/progress.jpg')
@scene
def players():
    js(ws,"profiles.list.push({id:'p2',name:'Emma',emoji:'🦄'},{id:'p3',name:'Dad',emoji:'🦉'}); saveProfiles(); openWho(true)"); time.sleep(0.5)
    shot(ws,f'{OUT}/players.jpg',h=520)
@scene
def help():
    js(ws,"startItem(lessonItem(LESSON.c1)); if(playing) togglePlay(); openHelp()"); time.sleep(0.6)
    shot(ws,f'{OUT}/help.jpg')
for name,f in scenes.items():
    if ONLY and name not in ONLY: continue
    load(); f()
