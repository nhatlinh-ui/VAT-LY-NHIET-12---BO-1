/* Thi nhanh Vật lí nhiệt — nhạc nền cho màn hình giáo viên.
   Toàn bộ nhạc được tổng hợp bằng Web Audio ngay trong trình duyệt (không dùng file nhạc có bản quyền).
   - Sảnh chờ: nền nhẹ nhàng, chờ học sinh vào phòng.
   - Câu hỏi: nhịp tim + hi-hat + nền trầm, càng gần hết giờ càng nhanh, càng dày; 5 giây cuối có tiếng tích tắc.
   - Công bố đáp án: hồi trống rồi hợp âm.
   - Bảng xếp hạng: đoạn nhạc ngắn. Kết thúc: kèn chiến thắng.
   Giáo viên có thể chọn file nhạc riêng (mp3) cho phần câu hỏi. */
(function(){
  const LS={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
  let ctx=null, master=null, comp=null, noiseBuf=null;
  let enabled=LS.get("tn-music")!=="off";
  let volume=Number(LS.get("tn-vol")||"0.7");
  let mode="none", key="", timer=null, nextTime=0, step=0;
  let tensionV=0, secondsLeft=99, lastTickSec=-1;
  let custom=null, customName="";           // HTMLAudioElement cho nhạc riêng
  let padNodes=[];                          // nốt kéo dài (drone/pad) đang kêu

  function ensure(){
    if(ctx) { if(ctx.state==="suspended") ctx.resume(); return true; }
    const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return false;
    ctx=new AC();
    comp=ctx.createDynamicsCompressor(); comp.threshold.value=-16; comp.ratio.value=4;
    master=ctx.createGain(); master.gain.value=enabled?volume:0;
    master.connect(comp).connect(ctx.destination);
    noiseBuf=ctx.createBuffer(1,ctx.sampleRate*1,ctx.sampleRate);
    const d=noiseBuf.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    return true;
  }
  const hz=n=>440*Math.pow(2,(n-69)/12);   // số MIDI -> tần số

  /* ---------- nhạc cụ ---------- */
  function tone(t,midi,dur,{type="triangle",vol=.15,attack=.005,release=.12,dest=master,detune=0}={}){
    const o=ctx.createOscillator(),g=ctx.createGain();
    o.type=type;o.frequency.value=hz(midi);o.detune.value=detune;
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+attack);
    g.gain.setValueAtTime(vol,t+Math.max(attack,dur-release));g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g).connect(dest);o.start(t);o.stop(t+dur+.05);
  }
  function kick(t,vol=.5,f0=110,f1=42){
    const o=ctx.createOscillator(),g=ctx.createGain();
    o.type="sine";o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+.18);
    g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.0001,t+.32);
    o.connect(g).connect(master);o.start(t);o.stop(t+.35);
  }
  function noise(t,dur,{vol=.08,hp=7000,lp=null,dest=master}={}){
    const s=ctx.createBufferSource();s.buffer=noiseBuf;
    const f=ctx.createBiquadFilter();f.type="highpass";f.frequency.value=hp;
    const g=ctx.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    let node=s.connect(f);
    if(lp){const l=ctx.createBiquadFilter();l.type="lowpass";l.frequency.value=lp;node=node.connect(l)}
    node.connect(g).connect(dest);s.start(t);s.stop(t+dur+.02);
  }
  function startPad(notes,{type="sawtooth",vol=.05,cutoff=500}={}){
    stopPad();
    const f=ctx.createBiquadFilter();f.type="lowpass";f.frequency.value=cutoff;f.Q.value=4;
    const g=ctx.createGain();g.gain.setValueAtTime(0,ctx.currentTime);g.gain.linearRampToValueAtTime(vol,ctx.currentTime+1.2);
    f.connect(g).connect(master);
    const oscs=notes.flatMap(n=>[-7,7].map(dt=>{const o=ctx.createOscillator();o.type=type;o.frequency.value=hz(n);o.detune.value=dt;o.connect(f);o.start();return o}));
    const lfo=ctx.createOscillator(),lg=ctx.createGain();lfo.frequency.value=.15;lg.gain.value=cutoff*.35;lfo.connect(lg).connect(f.frequency);lfo.start();
    padNodes=[{oscs:[...oscs,lfo],g,f}];
  }
  function stopPad(fade=.6){
    if(!ctx) return; const t=ctx.currentTime;
    padNodes.forEach(p=>{p.g.gain.cancelScheduledValues(t);p.g.gain.setValueAtTime(p.g.gain.value,t);p.g.gain.linearRampToValueAtTime(0,t+fade);p.oscs.forEach(o=>{try{o.stop(t+fade+.05)}catch(e){}})});
    padNodes=[];
  }

  /* ---------- bộ lập lịch vòng lặp ---------- */
  function loop(fn,bpmFn){
    clearInterval(timer); step=0; nextTime=ctx.currentTime+.08;
    timer=setInterval(()=>{
      while(nextTime<ctx.currentTime+.12){
        fn(nextTime,step);
        nextTime+=60/bpmFn()/4; step++;     // nốt móc kép
      }
    },25);
  }
  function stopLoop(){clearInterval(timer);timer=null}

  // Sảnh chờ: hợp âm êm, nốt gảy nhẹ
  const LOBBY_CHORDS=[[57,60,64],[53,57,60],[55,59,62],[52,55,59]];
  function lobbyStep(t,s){
    const bar=Math.floor(s/16)%4, ch=LOBBY_CHORDS[bar];
    if(s%16===0) ch.forEach(n=>tone(t,n,2.6,{type:"sine",vol:.05,attack:.25,release:1.2}));
    if(s%4===2) tone(t,ch[(s/4|0)%3]+12,.35,{type:"triangle",vol:.05});
    if(s%8===0) noise(t,.05,{vol:.02,hp:9000});
  }

  // Câu hỏi: căng thẳng tăng dần theo thời gian còn lại
  const ARP=[57,60,64,65,64,60,57,56];       // La thứ có nốt Fa (âm giai u ám)
  function questionStep(t,s){
    const x=tensionV;                        // 0 = mới bắt đầu, 1 = sắp hết giờ
    const beat=s%4===0;
    // nhịp tim "thình-thịch"
    if(s%8===0) kick(t,.45+.15*x);
    if(s%8===1 && x>.2) kick(t,.3,95,45);
    if(s%8===4 && x>.65) kick(t,.35);
    // hi-hat: móc đơn, sau đó dày thành móc kép
    if(s%2===0 || x>.55) noise(t,.04,{vol:(s%2===0?.05:.03)+.03*x,hp:7500});
    // tiếng "tick" kim loại nhẹ ở phách
    if(beat) tone(t,93,.03,{type:"square",vol:.025});
    // rải hợp âm u ám, xuất hiện từ giữa thời gian
    if(x>.3 && s%2===0) tone(t,ARP[(s/2|0)%8]+(x>.75?12:0),.18,{type:"triangle",vol:.035+.05*x});
    // nốt trầm kéo dài mỗi ô nhịp, lên nửa cung khi gấp
    if(s%16===0) tone(t,(x>.75?34:33),1.1,{type:"sawtooth",vol:.05+.03*x,release:.6});
    // pad mở dần bộ lọc
    padNodes.forEach(p=>p.f.frequency.setTargetAtTime(380+1600*x,t,.4));
  }
  const questionBpm=()=>96+54*tensionV;

  /* ---------- hiệu ứng ngắn ---------- */
  function sting(kind){
    const t=ctx.currentTime+.05;
    if(kind==="go"){ [69,76,81].forEach((n,i)=>tone(t+i*.09,n,.25,{type:"square",vol:.06})); noise(t,.35,{vol:.05,hp:3000}); }
    if(kind==="reveal"){
      for(let i=0;i<14;i++){const tt=t+i*(.07-.003*i);noise(tt,.06,{vol:.05+.006*i,hp:1500,lp:6000})}
      const tc=t+.78; kick(tc,.6); [57,64,69,73,76].forEach(n=>tone(tc,n,1.6,{type:"sawtooth",vol:.035,release:1}));noise(tc,1.2,{vol:.06,hp:5000});
    }
    if(kind==="board"){ [72,76,79,84,79,84].forEach((n,i)=>tone(t+i*.12,n,.22,{type:"triangle",vol:.08})); kick(t,.35); kick(t+.48,.35); }
    if(kind==="final"){
      const seq=[[67,0],[72,.18],[76,.36],[79,.54],[76,.8],[79,.98],[84,1.16]];
      seq.forEach(([n,d])=>{tone(t+d,n,.32,{type:"square",vol:.06});tone(t+d,n-12,.32,{type:"triangle",vol:.05})});
      [60,64,67,72].forEach(n=>tone(t+1.4,n,2.6,{type:"sawtooth",vol:.04,release:1.6}));
      noise(t+1.4,2,{vol:.07,hp:4000});kick(t+1.4,.6);
    }
    if(kind==="tick"){ tone(t,88,.07,{type:"square",vol:.07}); }
    if(kind==="timeup"){ tone(t,45,.6,{type:"sawtooth",vol:.12}); tone(t,46,.6,{type:"sawtooth",vol:.1}); }
  }

  /* ---------- nhạc riêng của giáo viên ---------- */
  function playCustom(){ if(!custom) return false; custom.currentTime=0; custom.volume=enabled?volume:0; custom.playbackRate=1; custom.play().catch(()=>{}); return true; }
  function stopCustom(){ if(custom){ custom.pause(); } }

  /* ---------- điều khiển theo trạng thái trò chơi ---------- */
  function enter(newMode){
    stopLoop(); stopPad(); stopCustom();
    mode=newMode;
    if(!ctx) return;
    if(mode==="lobby"){ startPad([45,52],{type:"sine",vol:.05,cutoff:700}); loop(lobbyStep,()=>84); }
    if(mode==="question"){
      tensionV=0; lastTickSec=-1; sting("go");
      if(!playCustom()){ startPad([33,40,45],{vol:.035,cutoff:380}); loop(questionStep,questionBpm); }
    }
    if(mode==="reveal") sting("reveal");
    if(mode==="board") sting("board");
    if(mode==="final") sting("final");
  }

  const api={
    unlock(){ ensure(); },
    sync(live){
      if(!live) return;
      const k=live.phase+":"+(live.seq||0);
      if(k===key) return; key=k;
      ensure();
      enter(live.phase==="lobby"||live.phase==="question"||live.phase==="reveal"||live.phase==="board"||live.phase==="final"?live.phase:"none");
    },
    tension(left,T){
      if(mode!=="question"||!ctx) return;
      tensionV=Math.max(0,Math.min(1,1-left/T));
      if(custom&&!custom.paused) custom.playbackRate=1+.12*tensionV;
      const sec=Math.ceil(left);
      if(sec<=5&&sec>=1&&sec!==lastTickSec){lastTickSec=sec;sting("tick")}
      if(left<=0&&lastTickSec!==0){lastTickSec=0;sting("timeup")}
    },
    stopAll(){ stopLoop(); stopPad(); stopCustom(); },
    setEnabled(on){ enabled=on; LS.set("tn-music",on?"on":"off"); if(master) master.gain.setTargetAtTime(on?volume:0,ctx.currentTime,.05); if(custom) custom.volume=on?volume:0; },
    setVolume(v){ volume=v; LS.set("tn-vol",String(v)); if(master&&enabled) master.gain.setTargetAtTime(v,ctx.currentTime,.05); if(custom) custom.volume=enabled?v:0; },
    setCustom(file){
      if(custom){custom.pause();URL.revokeObjectURL(custom.src)}
      if(!file){custom=null;customName="";return}
      custom=new Audio(URL.createObjectURL(file));custom.loop=true;customName=file.name;
      if(mode==="question"){stopLoop();stopPad();playCustom()}
    },
    get enabled(){return enabled}, get volume(){return volume}, get customName(){return customName}
  };

  /* ---------- bảng điều khiển âm thanh trên thanh tiêu đề ---------- */
  api.mountPanel=function(container){
    const wrap=document.createElement("div");wrap.className="soundbar";
    wrap.innerHTML=`<button class="btn" type="button" id="mToggle"></button>
      <label class="vol" for="mVol"><span>Âm lượng</span><input id="mVol" type="range" min="0" max="1" step="0.05"></label>
      <label class="btn filebtn" for="mFile" title="Dùng file nhạc của thầy/cô (mp3) cho phần câu hỏi">Nhạc riêng…</label><input id="mFile" type="file" accept="audio/*" hidden>
      <button class="btn" type="button" id="mClear" hidden>Dùng nhạc mặc định</button>`;
    container.prepend(wrap);
    const tg=wrap.querySelector("#mToggle"),vol=wrap.querySelector("#mVol"),fi=wrap.querySelector("#mFile"),cl=wrap.querySelector("#mClear"),fl=wrap.querySelector(".filebtn");
    const paint=()=>{tg.textContent="Nhạc: "+(enabled?"bật":"tắt");tg.setAttribute("aria-pressed",enabled);vol.value=volume;cl.hidden=!customName;fl.textContent=customName?("♪ "+customName.slice(0,22)):"Nhạc riêng…"};
    tg.onclick=()=>{ensure();api.setEnabled(!enabled);paint()};
    vol.oninput=()=>{ensure();api.setVolume(Number(vol.value))};
    fi.onchange=()=>{ensure();api.setCustom(fi.files[0]||null);paint()};
    cl.onclick=()=>{api.setCustom(null);fi.value="";if(mode==="question")enter("question");paint()};
    paint();
  };

  // Trình duyệt chỉ cho phát âm thanh sau cú nhấp đầu tiên của người dùng
  ["pointerdown","keydown"].forEach(ev=>document.addEventListener(ev,()=>api.unlock(),{capture:true}));
  window.QuizMusic=api;
})();
