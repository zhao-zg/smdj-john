/* 句级 TTS v3.6.7 - 延迟分句优化 */
class TTSDock {
  constructor(){
    if(!('speechSynthesis' in window)){
      window.TTS_SUPPORTED=false;
      document.getElementById('tts-dock')?.setAttribute('data-visible','false');
      return;
    }
    window.TTS_SUPPORTED=true;
    this.synth=window.speechSynthesis;
    this.voice=null;this.sentences=[];this.index=0;
    this.playing=false;this.paused=false;this.continuous=false;
    this.rate=1;this.pitch=1;this.volume=1;
    this._voicesLoaded=false;this._dragging=false;this._lastSpokenIndex=-1;
    this._voiceRetry=0;this._refreshTimer=null;this._segmented=false;

    this.restore();
    this.cache();
    this.bind();

    this.ensureSegmented();
    this.collect();

    this._waitForVoices().then(()=>{
      this.ensureVoice();
      try{ this.synth.cancel(); }catch(_){ }
      this.updateAll();
    });
  }

  async _waitForVoices(timeout=3000){
    return new Promise(resolve=>{
      const start=performance.now();
      const check=()=>{
        const voices=this.synth.getVoices();
        if(voices.length>0 || performance.now()-start>timeout){
          resolve(voices);
        } else {
          setTimeout(check,100);
        }
      };
      check();
    });
  }

  ensureSegmented(){
    if(this._segmented) return true;
    this.segmentDocument();
    this.collect();
    return this._segmented;
  }
  
  restore(){
    try{
      const s=JSON.parse(localStorage.getItem('tts.dock.settings')||'{}');
      this.rate=s.rate??1;
      this.pitch=s.pitch??1;
      this.volume=s.volume??1;
      this.continuous=s.continuous??false;
    }catch(e){}
  }
  
  save(){
    localStorage.setItem('tts.dock.settings',JSON.stringify({
      rate:this.rate,
      pitch:this.pitch,
      volume:this.volume,
      continuous:this.continuous
    }));
  }
  
  cache(){
    this.dock=document.getElementById('tts-dock');
    this.btnPrev=document.getElementById('tts-btn-prev');
    this.btnPlay=document.getElementById('tts-btn-play');
    this.btnNext=document.getElementById('tts-btn-next');
    this.btnStop=document.getElementById('tts-btn-stop');
    this.btnMode=document.getElementById('tts-btn-mode');
    this.btnClose=document.getElementById('tts-btn-close');
    this.bar=document.getElementById('tts-progress-bar');
    this.fill=document.getElementById('tts-progress-fill');
    this.handle=document.getElementById('tts-progress-handle');
    this.text=document.getElementById('tts-progress-text');
  }
  
  bind(){
    this.btnPlay?.addEventListener('click',()=>this.togglePlay());
    this.btnPrev?.addEventListener('click',()=>this.previous());
    this.btnNext?.addEventListener('click',()=>this.next());
    this.btnStop?.addEventListener('click',()=>this.stop());
    this.btnMode?.addEventListener('click',()=>{
      this.continuous=!this.continuous;
      this.updateMode();
      this.save();
    });
    
    this.btnClose?.addEventListener('click',()=>{
      this.stop();
      this.dock.setAttribute('data-visible','false');
      try{
        const r=JSON.parse(localStorage.getItem('reader.settings.v3.6.3')||'{}');
        r.ttsVisible=false;
        localStorage.setItem('reader.settings.v3.6.3',JSON.stringify(r));
        document.querySelectorAll('#tts-toggle-chips .chip').forEach(ch=>{
          if(ch.dataset.tts==='show')ch.classList.remove('active');
          if(ch.dataset.tts==='hide')ch.classList.add('active');
        });
      }catch(e){}
    });
    
    // 进度条交互
    this.bar?.addEventListener('click',e=>{
      if(this._dragging)return;
      // 点击进度条时也需要确保已分句
      if(!this._segmented) this.ensureSegmented();
      this._seek(e,true);
    });
    
    const startDrag=e=>{
      // 拖动前确保已分句
      if(!this._segmented) this.ensureSegmented();
      if(!this.sentences.length)return;
      
      this._dragging=true;
      this._wasPlayingBeforeDrag=this.playing;
      if(this.playing||this.paused)this.synth.cancel();
      this._seek(e,false);
      
      document.addEventListener('mousemove',moveDrag);
      document.addEventListener('mouseup',endDrag);
      document.addEventListener('touchmove',moveDrag,{passive:false});
      document.addEventListener('touchend',endDrag);
    };
    
    const moveDrag=e=>{
      if(!this._dragging)return;
      e.preventDefault();
      this._seek(e,false);
    };
    
    const endDrag=()=>{
      if(!this._dragging)return;
      this._dragging=false;
      document.removeEventListener('mousemove',moveDrag);
      document.removeEventListener('mouseup',endDrag);
      document.removeEventListener('touchmove',moveDrag);
      document.removeEventListener('touchend',endDrag);
      
      if(this._wasPlayingBeforeDrag){
        if(this.index!==this._lastSpokenIndex||!this.synth.speaking){
          this.playing=true;
          this.paused=false;
          this.speakCurrent(true);
        }else{
          this.highlightCurrent();
          this.updateProgress();
        }
      }else{
        this.highlightCurrent();
        this.updateProgress();
      }
    };
    
    this.bar?.addEventListener('mousedown',startDrag);
    this.handle?.addEventListener('mousedown',startDrag);
    this.bar?.addEventListener('touchstart',startDrag,{passive:false});
    this.handle?.addEventListener('touchstart',startDrag,{passive:false});
    
    // 键盘快捷键
    document.addEventListener('keydown',e=>{
      if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
      if(e.key===' '){
        e.preventDefault();
        this.togglePlay();
      }else if(e.key==='Escape'){
        this.stop();
      }
    });
    
    // 页面隐藏时暂停
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden && this.playing) this.pause();
    });
  }
  
  _clientX(e){
    return e.touches&&e.touches.length?e.touches[0].clientX:e.clientX;
  }
  
  _seek(e,playIfPlaying){
    if(!this.sentences.length)return;
    const rect=this.bar.getBoundingClientRect();
    let pct=(this._clientX(e)-rect.left)/rect.width;
    pct=Math.min(1,Math.max(0,pct));
    const target=Math.round(pct*(this.sentences.length-1));
    
    if(target===this.index&&!playIfPlaying){
      this.updateProgress();
      return;
    }
    
    this.index=target;
    if(playIfPlaying&&(this.playing||this.paused)){
      if(this.index!==this._lastSpokenIndex||!this.synth.speaking){
        this.synth.cancel();
        setTimeout(()=>this.speakCurrent(true),60);
      }
    }else{
      this.highlightCurrent();
      this.updateProgress();
    }
  }
  
  segmentDocument(){
    const root=document.getElementById('reader-content');
    if(!root||root.dataset.ttsSegmented==='true')return;
    
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
      acceptNode:n=>{
        if(!n.parentElement)return NodeFilter.FILTER_REJECT;
        if(['SCRIPT','STYLE','NOSCRIPT'].includes(n.parentElement.tagName))return NodeFilter.FILTER_REJECT;
        if(!n.textContent.trim())return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    
    let node;
    const nodes=[];
    while(node=walker.nextNode())nodes.push(node);
    
    const splitter=/([^。！？!?；;…]*[。！？!?；;…]|[^。！？!?；;…]+$)/g;
    let idx=0;
    
    nodes.forEach(tn=>{
      const parts=tn.textContent.match(splitter);
      if(!parts)return;
      const frag=document.createDocumentFragment();
      parts.forEach(p=>{
        const s=p.trim();
        if(!s)return;
        const sp=document.createElement('span');
        sp.className='tts-sentence';
        sp.dataset.ttsIndex=String(idx++);
        sp.textContent=s;
        frag.appendChild(sp);
      });
      tn.parentNode.replaceChild(frag,tn);
    });
    
    root.dataset.ttsSegmented='true';
    this._segmented=true;
  }
  
  collect(){
    this.sentences=[...document.querySelectorAll('#reader-content .tts-sentence')].map(sp=>({
      el:sp,
      text:sp.textContent
    }));
    this.updateProgress();
  }
  
  refreshVoices(){
    const attempt=()=>{
      const voices=this.synth.getVoices();
      if(voices&&voices.length){
        if(!this.voice){
          this.voice=voices.find(v=>/^zh/i.test(v.lang))||
                     voices.find(v=>/Chinese/i.test(v.name))||
                     voices[0];
        }
        this._voicesLoaded=true;
        if(this._refreshTimer){
          clearTimeout(this._refreshTimer);
          this._refreshTimer=null;
        }
      }else{
        this._voicesLoaded=false;
        this._voiceRetry++;
        const delay=Math.min(5000,500+this._voiceRetry*250);
        this._refreshTimer=setTimeout(attempt,delay);
      }
    };
    
    if(this.synth.onvoiceschanged!==undefined){
      this.synth.onvoiceschanged=()=>attempt();
    }
    attempt();
  }
  
  ensureVoice(){
    if(this.voice&&this._voicesLoaded)return true;
    const voices=this.synth.getVoices();
    if(voices&&voices.length){
      this.voice=voices.find(v=>/^zh/i.test(v.lang))||
                 voices.find(v=>/Chinese/i.test(v.name))||
                 voices[0];
      this._voicesLoaded=true;
      return true;
    }
    this.refreshVoices();
    return false;
  }
  
  togglePlay(){
    this.playing?this.pause():this.play();
  }
  
  play(){
    if(!this._segmented){
      this.ensureSegmented();
      this.collect();
    }
    if(!this.sentences.length){
      console.warn('[TTS] 无可播放的句子');
      return;
    }
	
    if(!this.ensureVoice()){
      console.log('[TTS] voice 未准备好，等待后重试');
      this._waitForVoices().then(()=>this.play());
      return;
    }

    if(this.paused){
      this.synth.resume();
      this.paused=false;this.playing=true;
      this.updateAll();
      return;
    }

    this.playing=true;this.paused=false;
    this.updateAll();
    this.speakCurrent(false);
  }
  
  pause(){
    if(this.playing){
      this.synth.pause();
      this.playing=false;
      this.paused=true;
      this.updateAll();
    }
  }
  
  stop(){
    this.synth.cancel();
    this.playing=false;
    this.paused=false;
    this.index=0;
    this._lastSpokenIndex=-1;
    this.clearHighlight();
    this.updateAll();
  }
  
  previous(){
    // 操作前确保已分句
    if(!this._segmented) this.ensureSegmented();
    if(!this.sentences.length) return;
    
    this.index=Math.max(0,this.index-1);
    if(this.playing||this.paused){
      if(this.index!==this._lastSpokenIndex||!this.synth.speaking){
        this.synth.cancel();
        setTimeout(()=>this.speakCurrent(true),60);
      }else{
        this.highlightCurrent();
        this.updateProgress();
      }
    }else{
      this.highlightCurrent();
      this.updateProgress();
    }
  }
  
  next(){
    // 操作前确保已分句
    if(!this._segmented) this.ensureSegmented();
    if(!this.sentences.length) return;
    
    this.index=Math.min(this.sentences.length-1,this.index+1);
    if(this.playing||this.paused){
      if(this.index!==this._lastSpokenIndex||!this.synth.speaking){
        this.synth.cancel();
        setTimeout(()=>this.speakCurrent(true),60);
      }else{
        this.highlightCurrent();
        this.updateProgress();
      }
    }else{
      this.highlightCurrent();
      this.updateProgress();
    }
  }
  
  speakCurrent(force){
    if(!this.sentences.length){
      this.stop();
      return;
    }
    
    if(this.index>=this.sentences.length){
      if(this.continuous&&window.PAGE_INFO?.nextPage){
        setTimeout(()=>window.location.href=PAGE_INFO.nextPage,600);
      } else {
        this.stop();
      }
      return;
    }
    
    if(!force && this.index===this._lastSpokenIndex && this.synth.speaking){
		return;
    }
    if(!this.ensureVoice()){
      setTimeout(()=>this.speakCurrent(force),400);
      return;
    }
    
    const seg=this.sentences[this.index];
    this.highlightElement(seg.el);
    this.updateProgress();
    
    const u=new SpeechSynthesisUtterance(seg.text);
    this._lastSpokenIndex=this.index;
    u.voice=this.voice;
    u.rate=this.rate;
    u.pitch=this.pitch;
    u.volume=this.volume;
    
    u.onend=()=>{
      if(!this.playing)return;
	  if(this.index===this._lastSpokenIndex)this.index++;
      setTimeout(()=>this.speakCurrent(false),40);
    };
    
    u.onerror=()=>{
      if(this.playing){
        this.index++;
        setTimeout(()=>this.speakCurrent(false),120);
      }
    };
    
    try{
      this.synth.speak(u);
    }catch(err){
      console.error('[TTS] speak 失败',err);
      this.index++;
      if(this.playing)setTimeout(()=>this.speakCurrent(false),200);
    }
  }
  
  highlightElement(el){
    this.clearHighlight();
    if(!el)return;
    el.classList.add('tts-active');
    const rect=el.getBoundingClientRect();
    const vh=window.innerHeight;
    if(rect.top<80||rect.bottom>vh-120){
      el.scrollIntoView({behavior:'smooth',block:'center'});
    }
  }
  
  highlightCurrent(){
    const seg=this.sentences[this.index];
    if(seg)this.highlightElement(seg.el);
  }
  
  clearHighlight(){
    document.querySelectorAll('.tts-active').forEach(e=>e.classList.remove('tts-active'));
  }
  
  updateProgress(){
    if(!this.sentences.length){
      this.fill&&(this.fill.style.width='0%');
      this.handle&&(this.handle.style.left='0%');
      this.text&&(this.text.textContent='0 / 0');
      return;
    }
    
    if(this.sentences.length===1){
      this.fill&&(this.fill.style.width='100%');
      this.handle&&(this.handle.style.left='100%');
      this.text&&(this.text.textContent='1 / 1');
      return;
    }
    
    const pct=(this.index/(this.sentences.length-1))*100;
    this.fill&&(this.fill.style.width=pct+'%');
    this.handle&&(this.handle.style.left=pct+'%');
    this.text&&(this.text.textContent=`${this.index+1} / ${this.sentences.length}`);
  }
  
  updateMode(){
    if(this.btnMode)this.btnMode.textContent=this.continuous?'🔁':'🔂';
  }
  
  updateButtons(){
    const disabled=window.TTS_SUPPORTED===false;
    [this.btnPrev,this.btnPlay,this.btnNext,this.btnStop,this.btnMode].forEach(b=>{
      if(b)b.disabled=disabled;
    });
  }
  
  updateAll(){
    if(this.btnPlay)this.btnPlay.textContent=this.playing?'⏸️':'▶️';
    this.updateMode();
    this.updateProgress();
    this.updateButtons();
  }
  
  reinitialize(){
    try{ this.synth.cancel(); }catch(_){ }
    this._segmented=false;
    this.sentences=[];
    this.index=0;
    this._lastSpokenIndex=-1;
    this.playing=false;
    this.paused=false;
    this.cache();
    this.clearHighlight();
    this.updateAll();
    const root=document.getElementById('reader-content');
    if(root) root.dataset.ttsSegmented='false';
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  if(window.TTS_SUPPORTED!==false){
    window._ttsDock=new TTSDock();
  }
});