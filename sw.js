// ===== Service Worker — سنة شات =====
// غيّر هذا الرقم عند كل تحديث للموقع
const VERSION = 'v1.0.0';
const CACHE = 'sunnachat-' + VERSION;

// الملفات التي تُحفظ للعمل بدون إنترنت
const ASSETS = [
  '/',
  '/index.html',
  '/book1.pdf',
  '/book2.pdf',
  '/cover1.jpg',
  '/cover2.jpeg',
  'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@400;600;700;900&display=swap'
];

// ===== تثبيت =====
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()) // تفعيل فوري
  );
});

// ===== تفعيل وحذف الكاش القديم =====
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => {
      self.clients.claim();
      // إخبار الصفحة بوجود تحديث
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'UPDATE_READY', version: VERSION }))
      );
    })
  );
});

// ===== الاستجابة للطلبات =====
self.addEventListener('fetch', e => {
  // تجاهل طلبات API
  if (e.request.url.includes('api.') ||
      e.request.url.includes('googleapis') ||
      e.request.url.includes('mistral') ||
      e.request.url.includes('openrouter') ||
      e.request.method !== 'GET') {
    return;
  }

  e.respondWith(
    caches.match(e.request)
      .then(cached => {
        // إرجاع المحفوظ + تحديث الكاش في الخلفية
        const fetched = fetch(e.request)
          .then(res => {
            if (res && res.status === 200) {
              const clone = res.clone();
              caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetched;
      })
  );
});
