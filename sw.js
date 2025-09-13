/* Service Worker v8.0.2 – Simple Cache-First Strategy */
const VERSION = 'v8.0.3';
const CACHE_NAME = 'app-' + VERSION;

// 核心资源 + 所有页面
const CORE_ASSETS = [
  './',
  './offline',
  './manifest.webmanifest',
  './assets/css/core.css',
  './assets/css/themes.css',
  './assets/css/extra.css',
  './assets/js/reader.js',
  './assets/js/tts.js',
  './assets/js/sw-register.js'
];

const PAGE_LIST = ["page_0000/", "page_0001/", "page_0002/", "page_0003/", "page_0004/", "page_0005/", "page_0006/", "page_0007/", "page_0008/", "page_0009/", "page_0010/", "page_0011/", "page_0012/", "page_0013/", "page_0014/", "page_001极速版/", "page_0016/", "page_0017/", "page_0018/", "page_0019/", "page_0020/", "page_0021/", "page_0022/", "page_0023/", "极速版/", "page_0025/", "page_0026/", "page_0027/", "page_0028/", "page_0029/", "page_0030/", "page_0031/", "page_0032/", "page_0033/", "page_0034/", "page_0035/", "page_0036/", "page_0037/", "page_0038/", "page_0039/", "page_0040/", "page_0041/", "page_0042/", "page_0043/", "page_0044/", "page_0045/", "page_0046/", "page_0047/", "page_0048/", "page极速版/", "page_0050/", "page_0051/", "page_0052/", "page_0053/", "page_0054/", "page_0055/", "page_0056/", "page_0057/", "page_0058/", "page_0059/", "page_0060/", "page_0061/", "page_0062/", "page_0063/", "page_0064/", "page_0065/", "page_0066/", "page_0067/", "page_0068/", "page_0069/", "page_0070/", "page_0071/", "page_0072/", "page_0073/", "page_0074/", "page_0075/", "page_0076/", "page_0077/", "page_0078/", "page_0079/", "page_0080/", "page_0081/", "page_0082/", "page_0083/", "page_0084/", "page_0085/", "page_0086/", "page_0087/", "page_0088/", "page_0089/", "page_0090/", "page_0091/", "page_0092/", "page_0093/", "page_0094/", "page_0095/", "page_0096/", "page_0097/", "page_0098/", "page_0099/", "page_0100/", "page_0101/", "page_0102/", "page_0103/", "page_极速版/", "page_0105/", "极速版/", "page_0107/", "page_0108/", "page_0109/", "page_0110/", "page_0111/", "page_0112/", "page_0113/", "page_0114/", "page_0115/", "page_0116/", "page_0117/", "page_0118/", "page_0119/", "page_0120/", "page_0121/", "page_0122/", "page_0123/", "page_0124/", "page_0125/", "page_0126/", "page_0127/", "page_0128/", "page_0129/", "page_0130/", "page_0131/", "page_0132/", "page_0133/", "page_0134/", "page_0135/", "page_0136/", "page_0137/", "page_0138/", "page_0139/", "page_0140/", "page_0141/", "page_0142/", "page_0143/", "page_0144/", "page_0145/", "page_0146/", "page_0147/", "page_0148/", "page_0149/", "page_0150/", "page_0151/", "page_0152/", "page_0153/", "page_0154/", "page_0155/", "page极速版/", "page_0157/", "page_0158/", "page_0159/", "page_0160/", "page极速版/", "page_0162/", "page_0163/", "page_0164/", "page_0165/", "page_0166/", "page_0167/", "page_0168/", "page_0169/", "page_0170/", "page_0171/", "page_0172/", "page_0173/", "page_0174/", "page_0175/", "page_0176/", "page_0177/", "page_0178/", "page_0179/", "page_0180/", "page_0181/"];

// 配置
const BATCH_SIZE = 20;
const BATCH_DELAY = 1000;

/** 路径归一化，保证 page_xxxx 和 page_xxxx/index.html 命中同一缓存 */
function normalizePagePath(pathname) {
  pathname = pathname.replace(/\/index\.html$/, '/');
  if (/\/page_\d{4}$/.test(pathname)) pathname += '/';
  return pathname;
}

/** 统一封装 fetch 并缓存成功的请求 */
async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

/** 处理离线情况 */
function handleOffline(request) {
  if (request.mode === 'navigate') {
    return caches.match('./offline') ||
           new Response('<h1>Offline</h1>', {
             status: 503,
             headers: {'Content-Type': 'text/html; charset=utf-8'}
           });
  }
  return new Response('Network error', { status: 503 });
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'START_CACHING') {
    cacheAllPages();
  } else if (event.data?.type === 'QUERY_CACHE_STATUS') {
    // 查询当前缓存状态
    getCurrentCacheStatus().then(status => {
      event.ports[0].postMessage({
        type: '极速版',
        cached: status.cached,
        total: status.total,
        complete: status.complete
      });
    });
  }
});

/** 获取当前缓存状态 */
async function getCurrentCacheStatus() {
  const cache = await caches.open(CACHE_NAME);
  let cachedCount = 0;
  
  // 检查核心资源是否已缓存
  for (const asset of CORE_ASSETS) {
    const cached = await cache.match(new Request(asset));
    if (cached) cachedCount++;
  }
  
  // 检查页面是否已缓存
  for (const page of PAGE_LIST) {
    const url = './' + page;
    const normalizedRequest = new Request(normalizePagePath(url), { credentials: 'include' });
    const cached = await cache.match(normalizedRequest);
    if (cached) cachedCount++;
  }
  
  const total = CORE_ASSETS.length + PAGE_LIST.length;
  const complete = cachedCount >= total;
  
  return {
    cached: cachedCount,
    total: total,
    complete: complete
  };
}

/** 渐进缓存所有页面 */
async function cacheAllPages() {
  const cache = await caches.open(CACHE_NAME);
  let cached = 0;
  const total = PAGE_LIST.length;

  // 先确保核心资源已缓存
  for (const asset of CORE_ASSETS) {
    try {
      const res = await fetch(asset);
      if (res.ok) {
        await cache.put(asset, res.clone());
        cached++;
      }
    } catch (e) {
      console.warn('[SW] Failed to cache asset:', asset, e);
    }
  }

  for (let i = 0; i < PAGE_LIST.length; i += BATCH_SIZE) {
    const batch = PAGE_LIST.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(page =>
      fetch('./' + page)
        .then(res => {
          // 只有响应成功才缓存
          if (res.ok) {
            return cache.put('./' + page, res.clone()).then(() => true);
          }
          return false;
        })
        .catch(() => false)
    ));

    const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
    cached += successful;

    // 通知客户端进度
    const isLastBatch = i + BATCH_SIZE >= PAGE_LIST.length;
    const percent = Math.round((cached / total) * 100);
    
    self.clients.matchAll().then(clients =>
      clients.forEach(client =>
        client.postMessage({
          type: isLastBatch ? 'CACHE_COMPLETE' : 'CACHE_PROGRESS',
          cached,
          total: total,
          percent: percent
        })
      )
    );

    if (!isLastBatch) await new Promise(r => setTimeout(r, BATCH_DELAY));
  }
}

/** fetch 事件：优先缓存，再网络，路径归一化 */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || event.request.method !== 'GET') return;

  const normalizedPath = normalizePagePath(url.pathname);
  const normalizedRequest = new Request(normalizedPath, { credentials: event.request.credentials });

  event.respondWith(
    caches.match(normalizedRequest)
      .then(cached => cached || fetchAndCache(normalizedRequest))
      .catch(() => handleOffline(event.request))
  );
});