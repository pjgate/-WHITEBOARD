// Service worker cho app Bảng trắng.
// Chiến lược: luôn lấy bản mới nhất từ mạng (network-first) cho các tệp của app,
// chỉ dùng bản lưu sẵn khi mất mạng. Nhờ vậy mỗi lần đẩy bản mới lên GitHub,
// lần mở app kế tiếp sẽ tự dùng bản mới mà không cần cài lại.
// Yêu cầu tới Google (Drive, đăng nhập, font…) không bị can thiệp.
const CACHE = 'bang-trang-v21';
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // để Google API đi thẳng
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
