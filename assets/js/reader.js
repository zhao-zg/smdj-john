/* Reader Core v3.6.8 – smooth transitions + swipe + dynamic reinit (TTS / inline script / bindings) */
(()=>{
  const APP_VER='3.6.8';
  const LS_KEY='reader.settings.v3.6.3';
  const DEFER_TTS_SEGMENT=false;
  const FONT_FAMILIES={
    sans:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,"Helvetica Neue",Arial,"Microsoft YaHei","Noto Sans CJK SC",sans-serif',
    serif:'"Noto Serif SC","Source Serif 4",Georgia,"Times New Roman",serif',
    dyslexic:'"OpenDyslexic",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,"Helvetica Neue",Arial,"Microsoft YaHei","Noto Sans CJK SC",sans-serif'
  };

  const st={fontSize:18,lineHeight:1.65,font:'sans',theme:'auto',ttsVisible:false};
  let lastScrollY=0,hideTimer=null,installPromptEvt=null,overrideStyle=null;

  /* Smooth navigation cache */
  const pageCache=new Map();
  const historyStackLimit=parseInt(localStorage.getItem('historyCacheSize')||'50',10);
  let currentURL=location.href;

  /* Helpers */
  function logNav(...a){ if(localStorage.getItem('navDebug')==='1') console.log('[NAV]',...a); }
  function logSwipe(...a){ if(localStorage.getItem('swipeDebug')==='1') console.log('[SWIPE]',...a); }

  /* Settings helpers */
  function loadSettings(){ try{Object.assign(st,JSON.parse(localStorage.getItem(LS_KEY)||'{}'));}catch(e){} }
  function saveSettings(){ localStorage.setItem(LS_KEY,JSON.stringify(st)); }
  function ensureOverrideStyle(){
    if(!overrideStyle){
      overrideStyle=document.createElement('style');
      overrideStyle.id='font-override';
      document.head.appendChild(overrideStyle);
    }
    const ff=FONT_FAMILIES[st.font]||FONT_FAMILIES.sans;
    overrideStyle.textContent=`body,#reader-content,.tts-sentence{font-family:${ff} !important;}`;
  }
  function applyTheme(){
    const html=document.documentElement;
    html.classList.remove('dark');
    if(st.theme!=='auto') html.classList.add(st.theme);
    html.setAttribute('data-theme',st.theme);
  }
  function syncChips() {
    document.querySelectorAll('#font-family-choices .chip').forEach(ch =>
      ch.classList.toggle('active', ch.dataset.font === st.font)
    );
    document.querySelectorAll('#theme-choices .chip').forEach(ch =>
      ch.classList.toggle('active', ch.dataset.theme === st.theme)
    );
    document.querySelectorAll('#tts-toggle-chips .chip').forEach(ch => {
      const isShow = ch.dataset.tts === 'show';
      const isHide = ch.dataset.tts === 'hide';
      if(isShow) ch.classList.toggle('active', st.ttsVisible === true);
      else if(isHide) ch.classList.toggle('active', st.ttsVisible === false);
    });
    const fsLabel=document.getElementById('font-size-label');
    if(fsLabel) fsLabel.textContent=st.fontSize+'px';
    const lhLabel=document.getElementById('line-height-label');
    if(lhLabel) lhLabel.textContent=st.lineHeight.toFixed(2);
  }

  /* Controls */
  function initControls(){
    const fs=document.getElementById('font-size-range');
    fs&&fs.addEventListener('input',()=>{st.fontSize=parseInt(fs.value,10);applySettings();saveSettings();});
    const lh=document.getElementById('line-height-range');
    lh&&lh.addEventListener('input',()=>{st.lineHeight=parseFloat(lh.value);applySettings();saveSettings();});
    document.querySelectorAll('#font-family-choices .chip').forEach(ch=>ch.addEventListener('click',()=>{st.font=ch.dataset.font;applySettings();saveSettings();}));
    document.querySelectorAll('#theme-choices .chip').forEach(ch=>ch.addEventListener('click',()=>{st.theme=ch.dataset.theme;applySettings();saveSettings();}));
    document.querySelectorAll('#tts-toggle-chips .chip').forEach(ch=>ch.addEventListener('click',()=>{
      if(window.TTS_SUPPORTED===false) return;
      st.ttsVisible=(ch.dataset.tts==='show');
      toggleTTSVisibility(st.ttsVisible,true);
      saveSettings();
      syncChips();
      if(st.ttsVisible && DEFER_TTS_SEGMENT) window.dispatchEvent(new CustomEvent('tts-lazy-segment'));
    }));
    const panel=document.getElementById('settings-panel');
    const openBtn=document.getElementById('open-settings');
    const closeBtn=document.getElementById('close-settings');
    openBtn&&openBtn.addEventListener('click',()=>{panel.setAttribute('data-open','true');panel.setAttribute('aria-hidden','false');});
    closeBtn&&closeBtn.addEventListener('click',()=>{panel.setAttribute('data-open','false');panel.setAttribute('aria-hidden','true');});
    document.addEventListener('click',e=>{
      if(panel && panel.getAttribute('data-open')==='true' && !panel.contains(e.target) && e.target!==openBtn){
        panel.setAttribute('data-open','false');
        panel.setAttribute('aria-hidden','true');
      }
    });
    const installBtn=document.getElementById('install-app-btn');
    if(installBtn){
      window.addEventListener('beforeinstallprompt',e=>{
        e.preventDefault(); installPromptEvt=e; installBtn.style.display='inline-flex';
      });
      installBtn.addEventListener('click',async()=>{
        if(!installPromptEvt) return;
        installPromptEvt.prompt();
        const result=await installPromptEvt.userChoice;
        if(result.outcome==='accepted') installBtn.style.display='none';
      });
      window.addEventListener('appinstalled',()=>installBtn.style.display='none');
      if(window.matchMedia('(display-mode: standalone)').matches) installBtn.style.display='none';
    }
  }
  function toggleTTSVisibility(show){
    const dock=document.getElementById('tts-dock');
    if(!dock) return;
    if(window.TTS_SUPPORTED===false){ dock.setAttribute('data-visible','false'); return; }
    dock.setAttribute('data-visible', show ? 'true' : 'false');
  }
  function applySettings(){
    document.documentElement.style.setProperty('--fs-base',st.fontSize+'px');
    document.documentElement.style.setProperty('--lh-base',st.lineHeight);
    document.documentElement.dataset.font=st.font;
    applyTheme();
    ensureOverrideStyle();
    syncChips();
    toggleTTSVisibility(st.ttsVisible,false);
  }

  /* Scroll/progress/back-top */
  function handleScroll(){
    const y=window.scrollY||document.documentElement.scrollTop;
    const appBar=document.querySelector('.app-bar');
    if(appBar){
      const goingDown=y>lastScrollY;
      if(y>120 && goingDown) appBar.setAttribute('data-hidden','true');
      else appBar.removeAttribute('data-hidden');
    }
    lastScrollY=y;
    updateProgress();
    toggleBackTop(y);
    scheduleBarShow();
  }
  function scheduleBarShow(){
    const appBar=document.querySelector('.app-bar');
    clearTimeout(hideTimer);
    hideTimer=setTimeout(()=>appBar&&appBar.removeAttribute('data-hidden'),1600);
  }
  function updateProgress(){
    const bar=document.getElementById('top-progress');
    const content=document.getElementById('reader-content');
    if(!bar||!content) return;
    const scrolled=window.scrollY||document.documentElement.scrollTop;
    const h=content.scrollHeight-window.innerHeight;
    bar.style.width=(h>0?(scrolled/h)*100:0)+'%';
  }
  function toggleBackTop(y){
    const btn=document.getElementById('back-top');
    if(!btn) return;
    if(y>360) btn.classList.add('show'); else btn.classList.remove('show');
  }
  function initBackTop(){
    const btn=document.getElementById('back-top');
    btn&&btn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
  }

  function initKeys(){
    document.addEventListener('keydown',e=>{
      if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      if(e.key==='ArrowLeft' && window.PAGE_INFO?.prevPage) customNavigate(window.PAGE_INFO.prevPage,'prev');
      if(e.key==='ArrowRight' && window.PAGE_INFO?.nextPage) customNavigate(window.PAGE_INFO.nextPage,'next');
    });
  }
  function motionPref(){ if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('reduce-motion'); }
  function systemThemeWatcher(){
    const mq=window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change',()=>{ if(st.theme==='auto') applyTheme(); });
  }

  /* Today links */
  function initTodayLinks(){
    document.querySelectorAll('.today-link').forEach(link=>{
      link.addEventListener('click', e=>{
        e.preventDefault();
        const startDate=link.dataset.startDate;
        const startIndex=parseInt(link.dataset.startIndex||'0',10);
        const total=parseInt(link.dataset.total||'0',10);
        if(!startDate||total<=0) return;
        const parts=startDate.split('-').map(Number);
        if(parts.length!==3){ alert('起始日期配置错误'); return; }
        const sDate=new Date(parts[0],parts[1]-1,parts[2]);
        const now=new Date();
        const diff=Math.floor((now-sDate)/(1000*60*60*24));
        let target=startIndex+diff;
        if(diff<0){ alert('尚未到起始日期'); target=startIndex; }
        else if(target>total-1){ alert('超出范围，跳最后一页'); target=total-1; }
        if(target<0) target=0;
        const prefix=(window.PAGE_INFO && window.PAGE_INFO.current>=0)?'../':'';
        const url=prefix+'page_'+String(target).padStart(4,'0')+'/';
        customNavigate(url, target > (window.PAGE_INFO?.current||0) ? 'next' : 'prev');
      });
    });
  }

  /* Swipe (same as prior) */
  function initSwipe(){
    if(window._swipeInstalled) return;
    window._swipeInstalled = true;
    if(localStorage.getItem('disableSwipe')==='1') return;
    const THRESHOLD_X=parseInt(localStorage.getItem('swipeThresholdX')||'60',10);
    const THRESHOLD_Y=parseInt(localStorage.getItem('swipeThresholdY')||'80',10);
    const ANGLE_RATIO=parseFloat(localStorage.getItem('swipeAngleRatio')||'1.2');
    const MAX_TIME=parseInt(localStorage.getItem('swipeMaxTime')||'1000',10);
    const LEGACY_MODE=localStorage.getItem('swipeLegacy')==='1';
    const DEBUG=localStorage.getItem('swipeDebug')==='1';
    let startX=0,startY=0,startTime=0,tracking=false,multi=false,moved=false;
    function dbg(...a){ if(DEBUG) console.log('[SWIPE]',...a); }
    function panelOpen(){ return document.getElementById('settings-panel')?.getAttribute('data-open')==='true'; }
    function inTTSDock(yClient){ const dock=document.getElementById('tts-dock'); if(!dock) return false; const rect=dock.getBoundingClientRect(); return yClient >= rect.top; }
    function onStart(e){ if(e.touches && e.touches.length>1){ multi=true; return; } multi=false; if(panelOpen()) return; const t=e.touches?e.touches[0]:e; if(inTTSDock(t.clientY)) return; tracking=true; moved=false; startX=t.clientX; startY=t.clientY; startTime=Date.now(); }
    function onMove(e){ if(!tracking||multi) return; const t=e.touches?e.touches[0]:e; const dx=t.clientX-startX, dy=t.clientY-startY; if(Math.abs(dx)>6||Math.abs(dy)>6) moved=true; }
    function gesturePass(dx,dy,dt){
      if(!moved) return false;
      if(dt>MAX_TIME) return false;
      const sel=window.getSelection(); if(sel && sel.toString().length>0) return false;
      if(Math.abs(dx)<THRESHOLD_X) return false;
      if(LEGACY_MODE) return true;
      if(Math.abs(dy)>THRESHOLD_Y) return false;
      if(Math.abs(dx)/(Math.abs(dy)+1)<ANGLE_RATIO) return false;
      return true;
    }
    function onEnd(e){
      if(!tracking||multi){ tracking=false; return; }
      tracking=false;
      const t=e.changedTouches?e.changedTouches[0]:e;
      const dx=t.clientX-startX, dy=t.clientY-startY, dt=Date.now()-startTime;
      dbg('end',{dx,dy,dt});
      if(!gesturePass(dx,dy,dt)) return;
      if(dx>0){ if(window.PAGE_INFO?.prevPage) customNavigate(window.PAGE_INFO.prevPage,'prev'); }
      else { if(window.PAGE_INFO?.nextPage) customNavigate(window.PAGE_INFO.nextPage,'next'); }
    }
    document.addEventListener('touchstart', onStart, {passive:true});
    document.addEventListener('touchmove', onMove, {passive:true});
    document.addEventListener('touchend', onEnd, {passive:true});
    document.addEventListener('pointerdown', e=>{ if(e.pointerType!=='touch') return; onStart(e); });
    document.addEventListener('pointerup', e=>{ if(e.pointerType!=='touch') return; onEnd(e); });
    console.log('[SWIPE] installed',{THRESHOLD_X,THRESHOLD_Y,ANGLE_RATIO,MAX_TIME,LEGACY_MODE,DEBUG});
  }

  /* Nav delegation */
  document.addEventListener('click', e=>{
    const a=e.target.closest('a.nav-btn');
    if(!a) return;
    const role=a.dataset.nav;
    if(role==='prev'||role==='next'||role==='toc'){
      if(a.classList.contains('disabled')) return;
      const href=a.getAttribute('href');
      if(!href) return;
      e.preventDefault();
      customNavigate(href, role==='next'?'next':'prev');
    }
  });

  function updateNavBarByPageInfo(pageInfo){
    if(!pageInfo) return;
    const nav=document.querySelector('.nav'); if(!nav) return;
    let prevBtn=nav.querySelector('[data-nav="prev"]');
    let nextBtn=nav.querySelector('[data-nav="next"]');
    let tocBtn=nav.querySelector('[data-nav="toc"]');
    if(!prevBtn) prevBtn=[...nav.querySelectorAll('a.nav-btn,span.nav-btn')].find(el=>el.textContent.trim()==='←');
    if(!nextBtn) nextBtn=[...nav.querySelectorAll('a.nav-btn,span.nav-btn')].find(el=>el.textContent.trim()==='→');
    if(!tocBtn) tocBtn=[...nav.querySelectorAll('a.nav-btn')].find(el=>el.textContent.trim()==='目录');
    if(pageInfo.prevPage){
      if(prevBtn && prevBtn.tagName==='SPAN'){ const a=document.createElement('a'); a.className='nav-btn'; a.textContent='←'; a.dataset.nav='prev'; prevBtn.replaceWith(a); prevBtn=a; }
      if(prevBtn){ prevBtn.classList.remove('disabled'); prevBtn.dataset.nav='prev'; prevBtn.setAttribute('href', pageInfo.prevPage); prevBtn.removeAttribute('aria-hidden'); }
    } else if(prevBtn){ prevBtn.classList.add('disabled'); prevBtn.removeAttribute('href'); prevBtn.setAttribute('aria-hidden','true'); prevBtn.dataset.nav='prev'; }
    if(pageInfo.nextPage){
      if(nextBtn && nextBtn.tagName==='SPAN'){ const a=document.createElement('a'); a.className='nav-btn'; a.textContent='→'; a.dataset.nav='next'; nextBtn.replaceWith(a); nextBtn=a; }
      if(nextBtn){ nextBtn.classList.remove('disabled'); nextBtn.dataset.nav='next'; nextBtn.setAttribute('href', pageInfo.nextPage); nextBtn.removeAttribute('aria-hidden'); }
    } else if(nextBtn){ nextBtn.classList.add('disabled'); nextBtn.removeAttribute('href'); nextBtn.setAttribute('aria-hidden','true'); nextBtn.dataset.nav='next'; }
    if(tocBtn){
      const correct=(pageInfo.current===-1)?'index.html':'../index.html';
      if(tocBtn.getAttribute('href')!==correct) tocBtn.setAttribute('href',correct);
      tocBtn.dataset.nav='toc';
    }
  }

  function prefetchLink(url){
    if(!url) return;
    if(localStorage.getItem('prefetchDisable')==='1') return;
    if(pageCache.has(url)) return;
    logNav('prefetch',url);
    fetch(url,{credentials:'same-origin'}).then(r=>{ if(!r.ok) throw new Error(r.status); return r.text(); }).then(html=>{
      const doc=new DOMParser().parseFromString(html,'text/html');
      const content=doc.querySelector('#reader-content');
      let pageInfo=null;
      for(const s of doc.querySelectorAll('script')){
        const txt=s.textContent||'';
        if(txt.includes('window.PAGE_INFO')){
          try{ const m=txt.match(/window\.PAGE_INFO\s*=\s*(\{[^;]+});/); if(m){ pageInfo=eval('('+m[1]+')'); break; } }catch(_){} 
        }
      }
      if(content && pageInfo){
        pageCache.set(url,{doc,contentHTML:content.innerHTML,title:doc.title,pageInfo});
        trimCache();
      }
    }).catch(()=>{});
  }
  function trimCache(){ if(pageCache.size<=historyStackLimit) return; const firstKey=pageCache.keys().next().value; pageCache.delete(firstKey); }
  function installInitialPrefetch(){ if(!window.PAGE_INFO) return; if(window.PAGE_INFO.prevPage) prefetchLink(new URL(window.PAGE_INFO.prevPage,location.href).href); if(window.PAGE_INFO.nextPage) prefetchLink(new URL(window.PAGE_INFO.nextPage,location.href).href); }
  function customNavigate(url,dir){ if(!url) return; const abs=new URL(url,location.href).href; if(abs===currentURL) return; const cached=pageCache.get(abs); if(cached) renderFromCache(abs,cached,dir); else fetchAndRender(abs,dir); }
  function renderFromCache(url,cached,dir){ logNav('cache-hit',url); currentURL=url; history.pushState({url},'',url); doTransition(cached,dir); installInitialPrefetch(); }
  function fetchAndRender(url,dir){ logNav('fetch',url); fetch(url,{credentials:'same-origin'}).then(r=>r.text()).then(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    const content=doc.querySelector('#reader-content');
    let pageInfo=null;
    for(const s of doc.querySelectorAll('script')){
      const txt=s.textContent||''; 
      if(txt.includes('window.PAGE_INFO')){
        try{ const m=txt.match(/window\.PAGE_INFO\s*=\s*(\{[^;]+});/); if(m){ pageInfo=eval('('+m[1]+')'); break; } }catch(_){} 
      }
    }
    if(content && pageInfo){
      pageCache.set(url,{doc,contentHTML:content.innerHTML,title:doc.title,pageInfo});
      trimCache();
      currentURL=url;
      history.pushState({url},'',url);
      doTransition({contentHTML:content.innerHTML,title:doc.title,pageInfo},dir);
      installInitialPrefetch();
    } else location.href=url;
  }).catch(()=>location.href=url); }
  function doTransition(data,dir){
    const content=document.getElementById('reader-content');
    if(!content) return;
    const reduce=document.documentElement.classList.contains('reduce-motion');
    if(reduce){ content.innerHTML=data.contentHTML; afterRender(data); return; }
    content.classList.add('fade-out');
    setTimeout(()=>{
      content.innerHTML=data.contentHTML;
      content.classList.remove('fade-out');
      content.classList.add('fade-in');
      setTimeout(()=>content.classList.remove('fade-in'),160);
      afterRender(data);
    },120);
  }
  function afterRender(data){
    document.title=data.title;
    window.PAGE_INFO=data.pageInfo;
    updateNavBarByPageInfo(data.pageInfo);
    window.scrollTo(0,0);
    updateProgress();
    window.dispatchEvent(new CustomEvent('page-changed',{detail:data.pageInfo}));
  }
  window.addEventListener('popstate',e=>{
    if(!e.state?.url) return;
    const cached=pageCache.get(e.state.url);
    if(cached) doTransition(cached,'none'); else location.href=e.state.url;
  });

  /* Init */
  loadSettings();
  applySettings();
  ensureOverrideStyle();
  initControls();
  initKeys();
  motionPref();
  systemThemeWatcher();
  initBackTop();
  initTodayLinks();
  initSwipe();
  installInitialPrefetch();
  updateNavBarByPageInfo(window.PAGE_INFO);
  window.addEventListener('scroll',handleScroll,{passive:true});
})();
