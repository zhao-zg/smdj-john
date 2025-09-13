(function () {
  if (localStorage.getItem('disableSW') === '1') {
    console.log('[SW] disabled by user flag');
    return;
  }
  if (!('serviceWorker' in navigator)) return;

  const SW_URLS = ['/sw.js?v=8.0.3', './sw.js?v=8.0.3', '../sw.js?v=8.0.3'];
  
  // 缓存状态标记
  let caching = false;

  async function probe(url) {
    try {
      const res = await fetch(url, { cache: 'no-store', method: 'GET' });
      if (!res.ok) throw new Error('status ' + res.status);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html')) throw new Error('html fallback');
      return true;
    } catch (e) {
      console.warn('[SW] probe fail', url, e.message);
      return false;
    }
  }

  async function registerSW() {
    for (const url of SW_URLS) {
      if (!(await probe(new URL(url, location.href)))) continue;
      try {
        const reg = await navigator.serviceWorker.register(url);
        console.log('[SW] registered', url, 'scope:', reg.scope);
        
        // 设置消息监听
        setupMessageListener();

        // 注册完成后立即检查缓存
        checkAndStartCache();

        return;
      } catch (e) {
        console.warn('[SW] register fail', url, e);
      }
    }
    console.warn('[SW] all candidates failed');
  }

  // 检查是否为 PWA 模式
  function isPWAMode() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  // 查询Service Worker缓存状态
  async function checkCacheStatus() {
    return new Promise((resolve) => {
      if (!navigator.serviceWorker.controller) {
        resolve({ cached: 0, total: 0, complete: false });
        return;
      }

      // 设置一次性监听器
      const listener = (event) => {
        if (event.data && event.data.type === 'CACHE_STATUS_RESPONSE') {
          navigator.serviceWorker.removeEventListener('message', listener);
          resolve(event.data);
        }
      };
      
      navigator.serviceWorker.addEventListener('message', listener);
      
      // 发送查询请求
      navigator.serviceWorker.controller.postMessage({ 
        type: 'QUERY_CACHE_STATUS' 
      });
      
      // 设置超时
      setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', listener);
        resolve({ cached: 0, total: 0, complete: false });
      }, 2000);
    });
  }

  // 检查并开始缓存
  async function checkAndStartCache() {
    // 不是 PWA 模式，不缓存
    if (!isPWAMode()) {
      //console.log('[SW] 非 PWA 模式，不自动缓存');
      //return;
    }
    
    // 正在缓存中，不重复
    if (caching) {
      console.log('[SW] 缓存进行中');
      return;
    }
    
    // 查询Service Worker的缓存状态
    const status = await checkCacheStatus();
    
    // 已完成缓存，不重复
    if (status.complete) {
      console.log('[SW] 已完成全部缓存');
      return;
    }
    
    // 开始缓存
    startCaching();
  }

  // 开始缓存
  function startCaching() {
    if (caching) return;
    
    caching = true;
    console.log('[SW] 开始缓存');
    
    setTimeout(() => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'START_CACHING' });
      } else {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (navigator.serviceWorker.controller && caching) {
            navigator.serviceWorker.controller.postMessage({ type: 'START_CACHING' });
          }
        }, { once: true });
      }
    }, 200);
  }

  // 监听消息
  function setupMessageListener() {
    navigator.serviceWorker.addEventListener('message', event => {
      const { type, cached, total, percent } = event.data;
      
      switch (type) {
        case 'CACHE_PROGRESS':
          console.log(`[SW] 缓存进度: ${percent}% (${cached}/${total})`);
          localStorage.setItem('swCacheProgress', JSON.stringify({ 
            cached, total, percent, time: Date.now() 
          }));
          showToast(`正在缓存: ${percent}%`);
          break;
          
        case 'CACHE_COMPLETE':
          console.log(`[SW] 缓存完成: '✅' (${cached}/${total})`);
          localStorage.setItem('swCacheComplete', JSON.stringify({ 
            cached, total, time: Date.now() 
          }));
          localStorage.removeItem('swCacheProgress');
          caching = false;
          
          showToast('✅ 离线缓存完成');
          break;
      }
    });
  }

  // Toast 提示
  function showToast(message, duration = 2500) {
    const old = document.getElementById('sw-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'sw-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.8);
      color: white;
      padding: 10px 20px;
      border-radius: 20px;
      font-size: 14px;
      z-index: 99999;
      pointer-events: none;
      transition: opacity 0.3s;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // 启动
  window.addEventListener('load', () => {
    registerSW();
  });
})();