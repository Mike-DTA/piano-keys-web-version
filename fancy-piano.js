/* =====================================================================
   Realistic piano, ported from MIDI-Creator's "Fancy" playback
   ---------------------------------------------------------------------
   Every key of the piano is calculated as a sound sample on this device the first time the realistic piano is
   switched on (in background threads, so the page keeps responding), then played through a calculated soundboard,
   the ringing of the undamped top strings and a small hall. Nothing is downloaded.

   This one file does both jobs: in a background thread only the sound maths below runs, and the thread answers
   requests for one sample at a time; on the page it also sets up FancyPiano (see the bottom).

   The sound maths is copied unchanged from MIDI-Creator (index.html, the "fancy-dsp" part), so improvements there
   can be copied over as a whole.
   ===================================================================== */

const fClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fHz=m=>440*Math.pow(2,(m-69)/12);
function fRng(seed){let s=(seed>>>0)||1;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
// damped sinusoid y[n]=A r^n sin(w n+phase), added into out (digital resonator, cheap and stable)
function addRes(out,N,A,w,tau,fs,phase=0){
  const r=Math.exp(-1/(tau*fs)),n1=Math.min(N,Math.ceil(tau*fs*11.5));
  if(n1<2||!A)return;
  const c1=2*r*Math.cos(w),c2=-r*r;let y1=A*Math.sin(phase),y2=A*Math.sin(phase-w)/r;
  for(let n=0;n<n1;n++){out[n]+=y1;const y=c1*y1+c2*y2;y2=y1;y1=y;}
}
function fRms(a,i0,i1){let s=0;i1=Math.min(i1,a.length);for(let i=i0;i<i1;i++)s+=a[i]*a[i];return Math.sqrt(s/Math.max(1,i1-i0));}
/* ---------- acoustic piano ----------
   Each key is one over-bright mono string model: stretched inharmonic partials, a fast "prompt" decay over a slow
   aftersound from 1-3 slightly mistuned unison strings, phantom partials in the bass and a hammer knock.
   Hammer hardness (velocity) is a low-pass applied at playback (pianoFc), and the soundboard and the sympathetic
   strings are shared convolutions (renderPianoBody / renderPianoRes), so none of them move when a key is repitched. */
const pianoB=m=>2e-4*Math.pow(2,(21-m)/12)+3.5e-4*Math.pow(2,(m-60)/9.5); // inharmonicity: wound bass strings + plain treble strings
const pianoStretch=m=>m>66?16*Math.pow((m-66)/42,2):-9*Math.pow((66-m)/45,2); // stretch tuning in cents (Railsback curve)
const pianoTau=f0=>fClamp(3.6*Math.pow(261.6/f0,.4),.45,6.5);
const pianoF0=m=>fHz(m)*Math.pow(2,pianoStretch(m)/1200);
// hammer cut-off in Hz for a key, a velocity v (0..1) and a brightness bias: harder and higher hammers are brighter
// (it falls only half as fast below middle C: low notes get their loudness from their upper partials)
const pianoFc=(m,v,bias=0)=>Math.max(fHz(m)*1.2,4500*Math.pow(2,(m-60)/(m<60?48:24)+2.2*(v-1)+1.6*bias));
// How each key dies away, matched to measurements of two real grands: a fast first part (the "ping") over a much
// quieter, long-lasting second part. Rows are [key, time of the fast part for the fundamental (s), level of the slow
// part against the fast one, time of the slow part (s)]; keys in between are interpolated.
const PIANO_DECAY=[[21,1.93,.415,5.2],[27,1.7,.381,5.3],[33,1.25,.266,5.5],[36,.98,.205,5.7],[42,.79,.143,5.9],[48,.78,.108,5.9],[54,.7,.103,5.4],
  [60,.54,.099,5],[66,.46,.087,5],[72,.38,.072,5.2],[78,.3,.053,5.6],[84,.25,.043,5.9],[96,.22,.036,7],[108,.19,.032,7.6]];
function pianoDecay(m){const D=PIANO_DECAY;let i=1;while(i<D.length-1&&m>D[i][0])i++;const a=D[i-1],b=D[i],u=fClamp((m-a[0])/(b[0]-a[0]),0,1);return[1,2,3].map(j=>a[j]*Math.pow(b[j]/a[j],u));}
// longest sample per key in seconds: long enough for the low strings to ring out, shorter where notes die sooner
const pianoLen=m=>m<=47?11:m<=60?11-2.5*(m-47)/13:m<=72?8.5-2*(m-60)/12:m<=84?6.5-2*(m-72)/12:4.5-2.3*(m-84)/24;
// partial k of a string: its frequency, and its starting level (strike point, string and soundboard losses)
function pianoPartial(k,f0,B){
  const fk=k*f0*Math.sqrt(1+B*k*k),m=69+12*Math.log2(f0/440),q=fk*fk*fk*fk; // q/(q+62^4): as on a real piano, the soundboard gives next to nothing below about 60 Hz
  const a=(Math.abs(Math.sin(Math.PI*k*.118))+.14)/Math.pow(k,.9)*Math.pow(fk/(fk+110),1.3)/(1+Math.pow(fk/11000,2))*(1+.6/k)*q/(q+1.478e7);
  return[fk,a*Math.pow(10,(pianoTone(m,k)+8*Math.min(1,.15+.2*k)*pianoGrain(fk,1))/20)];
}
// Balance of the overtones, set against two real grands. Rows are keys; the columns are overtone 1, 2, 3-4, 5-8, 9-16
// and 17 up, in dB. An ideal struck string has far stronger middle overtones than a piano, whose hammer stays on the
// string too long to excite them, and that excess is what makes a string model sound electric.
const PIANO_TONE=[[21,0,-1.5,-3,-7,-7,-4],[36,0,-1.5,-10,-9,-6,-3],[48,0,-1.5,-11,-7,-3,-3],[60,0,-3.5,-10,-5,-3,-3],[72,0,-4.5,-10,-2,-3,-3],[84,0,-4.5,-10,-17,-11,-3],[96,0,-13.5,-23,-28,-23,-3],[108,0,-15.5,-28,-33,-23,-3]];
function pianoTone(m,k){
  const T=PIANO_TONE,X=[0,1,1.8,2.66,3.58,4.6],x=Math.log2(k);let i=1,j=1;while(i<T.length-1&&m>T[i][0])i++;while(j<5&&x>X[j])j++;
  const a=T[i-1],b=T[i],u=fClamp((m-a[0])/(b[0]-a[0]),0,1),v=fClamp((x-X[j-1])/(X[j]-X[j-1]),0,1),col=c=>a[c+1]+(b[c+1]-a[c+1])*u;
  return col(j-1)+(col(j)-col(j-1))*v;
}
// The instrument's own unevenness: a fixed bumpy curve over pitch, from -1 to 1, the same for every key, so overtones
// that land close together are treated alike (as a soundboard does). Real overtones are far less tidy in level,
// fading and pitch than a formula; salt picks which of those three the curve is for.
function pianoGrain(f,salt){
  const x=8*Math.log2(f/20),i=Math.floor(x),u=x-i,w=u*u*(3-2*u);
  const h=j=>{let s=Math.imul(j+salt*7919,2654435761)>>>0;s^=s>>>15;s=Math.imul(s,2246822519)>>>0;s^=s>>>13;return(s>>>0)/2147483648-1;};
  return h(i)*(1-w)+h(i+1)*w;
}
function renderPiano(midi,fs){
  const f0=pianoF0(midi),rnd=fRng(midi*7919+5);
  const [tauP,aft,tauA]=pianoDecay(midi),damp1=1/(1+Math.pow(f0/700,1.15));
  // the sample runs until the slow part is about 42 dB down, or the limit for this key, and fades out over its last quarter
  const T=fClamp(Math.min(tauA*damp1*(42+20*Math.log10(aft))/8.69+.5,pianoLen(midi)),1.2,11),N=Math.floor(T*fs),out=new Float32Array(N);
  const B=pianoB(midi),fmax=Math.min(fs*.45,16000);
  const nS=midi<29?1:midi<41?2:3,cents=[],wS=[[1],[.93,.3],[.25,.9,.18]][nS-1]; // one string leads, so the unison beating stays a gentle shimmer and never a wobble
  for(let s=0;s<nS;s++)cents.push(nS===1?.3:(s-(nS-1)/2)*(.7+rnd()*.6)+(rnd()-.5)*.3);
  const A=[0],F=[0];
  for(let k=1;k<=400;k++){
    const [fk,a]=pianoPartial(k,f0,B);if(fk>fmax)break;
    // above the first one, each overtone fades a little faster or slower than the formula says, sits a cent or so off
    // it, and has a stronger or weaker slow part (the 2.4 and .5 keep the average where the table puts it)
    const aftK=aft*Math.pow(10,((k>1?10:4)*pianoGrain(fk,4)-(k>1?2.4:.5))/20),damp=Math.pow(2,(k>1?.8:0)*pianoGrain(fk,2))/(1+Math.pow(fk/700,1.15)),w=2*Math.PI*fk/fs*(k>1?Math.pow(2,1.5*pianoGrain(fk,3)/1200):1),spread=Math.min(6.283,.25*k);
    addRes(out,N,a,w,tauP*Math.pow(damp,.8)+.01,fs,(rnd()-.5)*spread);
    cents.forEach((c,s)=>addRes(out,N,a*aftK*wS[s],w*Math.pow(2,(c+(rnd()-.5)*.5)/1200),tauA*damp*(.92+rnd()*.2)+.03,fs,(rnd()-.5)*(spread+.5)));
    A.push(a);F.push(fk);
  }
  if(midi<60){
    const amax=Math.max(...A);
    for(let k=2;k<A.length-1&&k<28;k++){
      const fp=F[k]+F[k+1];if(fp>fmax)break;
      // (kept far below the real overtones next to them: any louder and they beat against those and sound out of tune)
      addRes(out,N,.03*A[k]*A[k+1]/amax,2*Math.PI*fp/fs,tauP*Math.pow(1/(1+Math.pow(F[k]/700,1.15)),.8)/2+.01,fs,rnd()*6.283);
    }
  }
  const M=Math.floor(.04*fs),cf=1-Math.exp(-2*Math.PI*2600/fs),amp=fRms(out,0,Math.floor(.05*fs))*(.1+.16*fClamp((midi-55)/50,0,1));let lp=0;
  for(let i=0;i<M;i++){lp+=((rnd()*2-1)-lp)*cf;out[i]+=lp*amp*Math.exp(-i/(fs*.006));}
  const ramp=Math.floor(.0008*fs),fade=Math.floor(.25*N);
  for(let i=0;i<ramp;i++)out[i]*=i/ramp;
  for(let i=0;i<fade;i++)out[N-1-i]*=.5-.5*Math.cos(Math.PI*i/fade);
  let pk=0;for(let i=0;i<N;i++){const v=Math.abs(out[i]);if(v>pk)pk=v;}
  // key-to-key level follows measured grand pianos: even from the bottom up to middle C, then about 0.1 dB quieter per
  // semitone, and another 0.55 dB per semitone above F#6, where the notes are nearly pure tones
  const g=Math.min(.98/pk,.13*Math.pow(10,-Math.max(0,midi-60)*.005-Math.max(0,midi-90)*.0275)/fRms(out,0,Math.floor(.1*fs)));
  for(let i=0;i<N;i++)out[i]*=g;
  return out;
}
const fUnit=ch=>{for(const c of ch){let e=0;for(let i=0;i<c.length;i++)e+=c[i]*c[i];e=1/Math.sqrt(e||1);for(let i=0;i<c.length;i++)c[i]*=e;}return ch;};
const fJoin=ch=>{const o=new Float32Array(ch[0].length*2);o.set(ch[0]);o.set(ch[1],ch[0].length);return o;}; // left then right in one array, so a background thread can hand it back
// soundboard: dense, short-lived plate modes plus a few early case reflections, different in each ear
function renderPianoBody(fs){
  const N=Math.floor(.5*fs),rnd=fRng(90210),ch=[new Float32Array(N),new Float32Array(N)];
  for(let f=52;f<6500;f+=(5+.016*f)*(.6+rnd()*.8)){
    const tau=Math.max(.004,(22+rnd()*30)/(Math.PI*f)),a=Math.sqrt(f*(5+.016*f))/(1+Math.pow(f/1100,1.3));
    for(const c of ch)addRes(c,N,a*(.35+rnd()*.65)*(rnd()<.5?-1:1),2*Math.PI*f/fs,tau,fs,rnd()*6.283);
  }
  fUnit(ch);
  for(const c of ch){
    for(let i=0;i<N;i++)c[i]*=.24;
    for(let i=0;i<8;i++){
      const n=Math.floor((.002+.026*rnd())*fs),g=(rnd()<.5?-1:1)*(.2-.014*i);
      c[n-1]+=g*.25;c[n]+=g*.5;c[n+1]+=g*.25;
    }
  }
  return fJoin(ch);
}
// sympathetic strings: every string from key lo upward ringing freely (the undamped top octave, or all of them under the sustain pedal)
function renderPianoRes(fs,lo,sec){
  const N=Math.floor(sec*fs),rnd=fRng(lo*131+7),ch=[new Float32Array(N),new Float32Array(N)];
  for(let m=lo;m<=108;m++){
    const f0=pianoF0(m),B=pianoB(m),tauA=pianoTau(f0),pan=(m-64)/44*.5;
    for(let k=1;k<=(m<60?6:m<84?4:3);k++){
      const fk=k*f0*Math.sqrt(1+B*k*k);if(fk>fs*.45)break;
      const tau=Math.min(tauA/(1+Math.pow(fk/700,1.15)),sec/5)+.03,a=Math.pow(fk/(fk+110),1.3)/Math.sqrt(k*tau);
      ch.forEach((c,i)=>addRes(c,N,a*(i?1+pan:1-pan)*(.6+rnd()*.4),2*Math.PI*fk/fs,tau,fs,rnd()*6.283));
    }
  }
  const fi=Math.floor(.012*fs),fo=Math.floor(.1*fs);
  for(const c of ch){for(let i=0;i<fi;i++)c[i]*=i/fi;for(let i=0;i<fo;i++)c[N-1-i]*=i/fo;}
  return fJoin(fUnit(ch));
}

/* ---------- in a background thread: calculate what the page asks for ---------- */
if(typeof window==='undefined'){
  self.onmessage=e=>{
    const d=e.data;
    try{ const r=self[d.f].apply(null,d.a); postMessage({id:d.id,r},[r.buffer]); }
    catch(err){ postMessage({id:d.id,err:String(err&&err.message||err)}); }
  };
} else {

/* ---------- on the page: FancyPiano ----------
   FancyPiano.prepare(audioContext, onProgress) calculates the samples (onProgress gets 0..1) and resolves to true
   when the piano can play. FancyPiano.play(audioContext, midiKey, velocity 1-127, duration in seconds) plays a key
   and returns false while the piano isn't ready, so the caller can use its own sound instead. */
window.FancyPiano=(function(){
  const SRC=document.currentScript&&document.currentScript.src;
  // MIDI-Creator's default settings: brightness 5, low-note volume 50 (neutral), bass reduction 50, hammer knock 50
  const BRIGHT=.05, KNOCK=50, BASS_HZ=20+1.2*50;
  // as heard in MIDI-Creator on a piano layer at its default volume (100) and reverb (24), through its hall
  const LAYER=Math.pow(100/127,1.5)*1.1, REV_SEND=Math.min(1.5,Math.pow(24/127,1.3)*1.2), REV_WET=.6, MASTER=.8, MAX_VOICES=120;
  const P={ready:false,busy:null,ac:null,buf:[],ir:null,voice:null,net:null,voices:0};

  // one thread per spare processor core, up to 4; without them (some browsers, or opened as a file) the page does it
  function runThreads(tasks,tick){
    let ws=[];
    try{ if(SRC && window.Worker){ const n=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||4)-1)); for(let i=0;i<n;i++) ws.push(new Worker(SRC)); } }catch(e){ ws=[]; }
    if(!ws.length) return Promise.resolve(false);
    return new Promise(res=>{
      let next=0, id=0, alive=ws.length, over=false; const pend=new Map();
      const end=v=>{ if(over) return; over=true; ws.forEach(w=>w.terminate()); res(v); };
      const feed=w=>{
        if(next>=tasks.length){ if(!pend.size) end(true); return; }
        const t=tasks[next++], k=++id; pend.set(k,t); w.job=k; w.postMessage({id:k,f:t.f,a:t.a});
      };
      ws.forEach(w=>{
        w.onmessage=e=>{ const d=e.data, t=pend.get(d.id); pend.delete(d.id); if(!t) return;
          if(!d.err){ t.put(d.r); t.done=true; tick(); } feed(w); };
        // a thread that stops leaves its work to the page
        w.onerror=ev=>{ if(ev.preventDefault) ev.preventDefault(); pend.delete(w.job); if(--alive<=0) end(false); };
        feed(w);
      });
    });
  }

  async function prepare(ac,onProgress){
    if(P.ready && P.ac===ac) return true;
    if(P.busy) return P.busy;
    P.busy=(async()=>{
      const fs=Math.min(ac.sampleRate,48000), sr=ac.sampleRate, buf=[], ir={}, tasks=[];
      const mono=(r,f)=>{ const b=ac.createBuffer(1,r.length,f); b.copyToChannel(r,0); return b; };
      const stereo=r=>{ const n=r.length>>1, b=ac.createBuffer(2,n,sr); b.copyToChannel(r.subarray(0,n),0); b.copyToChannel(r.subarray(n),1); return b; };
      tasks.push({f:'renderPianoBody',a:[sr],put:r=>{ ir.body=stereo(r); }}, {f:'renderPianoRes',a:[sr,90,1.5],put:r=>{ ir.hi=stereo(r); }});
      for(let k=21;k<=108;k++) tasks.push({f:'renderPiano',a:[k,fs],put:r=>{ buf[k-21]=mono(r,fs); }});
      let done=0; const tick=()=>{ done++; if(onProgress) onProgress(done/tasks.length); };
      if(onProgress) onProgress(0);
      if(await runThreads(tasks,tick)!==true){
        let t0=performance.now();
        for(const t of tasks){
          if(t.done) continue;
          t.put(self[t.f].apply(null,t.a)); t.done=true; tick();
          if(performance.now()-t0>25){ await new Promise(r=>setTimeout(r,0)); t0=performance.now(); }
        }
      }
      P.ac=ac; P.buf=buf; P.ir=ir; P.net=network(ac); P.voice=voicing(ac); P.ready=true;
      return true;
    })().catch(err=>{ console.warn('Realistic piano:',err); return false; }).finally(()=>{ P.busy=null; });
    return P.busy;
  }

  // soundboard and sympathetic strings (MIDI-Creator's piano layer), a hall, and a gentle limiter, into the speakers
  function network(ac){
    const g=v=>{ const n=ac.createGain(); n.gain.value=v; return n; };
    const comp=ac.createDynamicsCompressor(); comp.threshold.value=-14; comp.ratio.value=5; comp.attack.value=.004; comp.release.value=.2; comp.connect(ac.destination);
    const master=g(MASTER); master.connect(comp);
    const inp=g(1), send=g(REV_SEND), hp=ac.createBiquadFilter(), body=ac.createConvolver(), dry=g(LAYER);
    hp.type='highpass'; hp.Q.value=-3; hp.frequency.value=BASS_HZ;   // takes out only the sub-bass rumble
    body.normalize=false; body.buffer=P.ir.body;
    inp.connect(hp); inp.connect(body); body.connect(hp); hp.connect(dry); dry.connect(master);
    const hi=ac.createConvolver(), hiOut=g(.008), res=g(LAYER); hi.normalize=false; hi.buffer=P.ir.hi;
    inp.connect(res); res.connect(hi); hi.connect(hiOut); hiOut.connect(master);
    const rev=ac.createConvolver(), wet=g(LAYER), revOut=g(REV_WET); rev.buffer=hall(ac,2.2);
    send.connect(wet); wet.connect(rev); rev.connect(revOut); revOut.connect(master);
    return {inp,send};
  }
  function hall(ac,sec){
    const sr=ac.sampleRate, n=Math.floor(sr*sec), b=ac.createBuffer(2,n,sr);
    for(let c=0;c<2;c++){ const d=b.getChannelData(c); let lp=0; for(let i=0;i<n;i++){ const t=i/n, a=.75-.62*t; lp+=((Math.random()*2-1)-lp)*a; d[i]=lp*Math.pow(1-t,3.4)*(i<sr*.012?i/(sr*.012):1); } }
    return b;
  }

  // Hammer knock: in the top octaves the blow itself is heard as a short "tock" from the soundboard
  const PIANO_KNOCK=-17.5, pulses=new Map(), toneE=new WeakMap();
  function knock(ac,buf,pitch){
    const kn=fClamp((pitch-60)/12,0,1); if(!kn) return null;
    const fs=buf.sampleRate, Lp=Math.max(8,Math.round(.0016*Math.pow(2,(60-pitch)/48)*fs)), id=fs+':'+Lp;
    let pb=pulses.get(id);
    if(!pb){ pb=ac.createBuffer(1,Lp,fs); const d=pb.getChannelData(0); for(let i=0;i<Lp;i++) d[i]=.5-.5*Math.cos(2*Math.PI*i/Lp); pulses.set(id,pb); }
    let et=toneE.get(buf);
    if(et===undefined){ const d=buf.getChannelData(0), n=Math.min(d.length,Math.floor(.06*fs)); et=0; for(let i=0;i<n;i++) et+=d[i]*d[i]; toneE.set(buf,et); }
    return {buf:pb, amp:kn*Math.sqrt(et*Math.pow(10,(PIANO_KNOCK+.22*(pitch-72)+(KNOCK-50)*.3)/10)/(.375*Lp))};
  }

  // Voicing: measures how loud each finished key comes out through the soundboard, as heard, and evens it out
  // against its neighbours (as a piano technician does)
  function fft(re,im){
    const n=re.length;
    for(let i=1,j=0;i<n;i++){ let b=n>>1; for(;j&b;b>>=1) j^=b; j^=b; if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
    for(let len=2;len<=n;len<<=1){
      const a=-2*Math.PI/len, wr=Math.cos(a), wi=Math.sin(a);
      for(let i=0;i<n;i+=len){ let cr=1,ci=0; for(let q=0;q<len/2;q++){ const p=i+q+len/2, xr=re[p]*cr-im[p]*ci, xi=re[p]*ci+im[p]*cr; re[p]=re[i+q]-xr; im[p]=im[i+q]-xi; re[i+q]+=xr; im[i+q]+=xi; const t=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=t; } }
    }
  }
  function voicing(ac){
    const sr=ac.sampleRate; let n=16384; while(n<.3*sr) n*=2;
    const W=new Float64Array(n/2), R=new Float32Array(88), out=new Float32Array(88);
    const hl=[0,1].map(c=>{ const re=new Float64Array(2*n), im=new Float64Array(2*n), d=P.ir.body.getChannelData(c); for(let i=0;i<d.length&&i<2*n;i++) re[i]=d[i]; fft(re,im); return [re,im]; });
    for(let i=1;i<n/2;i++){ const f=i*sr/n, q=f*f, aw=12194*12194*q*q/((q+424.4)*Math.sqrt((q+11599)*(q+544496))*(q+148693636)); let s=0; for(const [re,im] of hl) s+=(1+re[2*i])*(1+re[2*i])+im[2*i]*im[2*i]; W[i]=aw*aw*s/2; }
    for(let k=0;k<88;k++){
      const b=P.buf[k], d=b.getChannelData(0), step=b.sampleRate/sr, re=new Float64Array(n), im=new Float64Array(n), fc=pianoFc(k+21,.7);
      for(let i=0;i<n;i++){ const j=Math.round(i*step); if(j>=d.length) break; re[i]=d[j]; }
      fft(re,im); let s=0; for(let i=1;i<n/2;i++) s+=(re[i]*re[i]+im[i]*im[i])*W[i]/(1+Math.pow(i*sr/n/fc,4));
      R[k]=10*Math.log10(s+1e-20);
    }
    for(let i=0;i<88;i++){ let s=0,c=0; for(let j=Math.max(0,i-4);j<=Math.min(87,i+4);j++){ s+=R[j]; c++; } out[i]=Math.pow(10,fClamp(s/c-R[i],-6,6)/20); }
    return out;
  }

  // one key: its own sample, through the hammer (a velocity-dependent shelf and low-pass), spread across the
  // stereo field by key, into the soundboard and the hall
  function play(ac,pitch,vel,dur){
    if(!P.ready || ac!==P.ac) return false;
    pitch=Math.round(pitch); if(pitch<21 || pitch>108) return false;
    if(P.voices>=MAX_VOICES) return true;
    const t=ac.currentTime+.005, v=fClamp(vel,1,127)/127, ki=pitch-21, buf=P.buf[ki];
    const level=Math.pow(v,1.4)*1.15*(P.voice?P.voice[ki]:1), rel=pitch>=90?4:fClamp(.3-(pitch-36)*.0035,.07,.33);
    const env=ac.createGain(); env.gain.setValueAtTime(level,t);
    const pan=ac.createStereoPanner(); pan.pan.value=fClamp((pitch-64)/44*.3,-1,1);
    env.connect(pan); pan.connect(P.net.inp); pan.connect(P.net.send);
    const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=-3; lp.frequency.value=Math.min(pianoFc(pitch,v,BRIGHT),ac.sampleRate*.45); lp.connect(env);
    const hs=ac.createBiquadFilter(); hs.type='highshelf'; hs.frequency.value=Math.min(3*fHz(pitch),ac.sampleRate*.4); hs.gain.value=fClamp(24*(v-.75)+10*BRIGHT,-14,10); hs.connect(lp);
    const s=ac.createBufferSource(), sg=ac.createGain(); s.buffer=buf; sg.gain.value=.97+Math.random()*.06; s.connect(sg); sg.connect(hs); s.start(t);
    const srcs=[s], kb=knock(ac,buf,pitch);
    if(kb){ const k=ac.createBufferSource(), kg=ac.createGain(); k.buffer=kb.buf; kg.gain.value=kb.amp*(.9+Math.random()*.2); k.connect(kg); kg.connect(env); k.start(t); srcs.push(k); }
    // letting go: the damper comes down (the top keys have none and ring on)
    const off=t+Math.max(.05,dur||0), stop=off+rel*3+.1;
    env.gain.setValueAtTime(level,off); env.gain.setTargetAtTime(0,off,rel/3);
    srcs.forEach(x=>x.stop(Math.min(stop,t+buf.duration+.05)));
    P.voices++;
    s.onended=()=>{ P.voices--; try{ env.disconnect(); pan.disconnect(); }catch(e){} };
    return true;
  }

  return { prepare, play, get ready(){ return P.ready; }, get busy(){ return !!P.busy; } };
})();

}
