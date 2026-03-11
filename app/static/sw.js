// SecurChat Service Worker — Integrity Verification
// Этот Service Worker кеширует scripts.js и проверяет его целостность при обновлениях.
// Если сервер скомпрометирован и JS подменён, SW заблокирует загрузку.

const CACHE_NAME = 'securchat-integrity-v3';
const CRITICAL_SCRIPTS = ['/static/scripts/scripts.js'];

// При установке: кешируем текущий scripts.js и сохраняем его хеш
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      for (const scriptUrl of CRITICAL_SCRIPTS) {
        try {
          const response = await fetch(scriptUrl, { cache: 'no-cache' });
          if (response.ok) {
            const clone = response.clone();
            const buffer = await clone.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-384', buffer);
            const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

            // Сохраняем хеш как «эталонный»
            await cache.put(scriptUrl + '::hash', new Response(hashBase64));
            await cache.put(scriptUrl, response);
          }
        } catch (e) {
          // При оффлайне — используем кешированную версию
        }
      }
      self.skipWaiting();
    })()
  );
});

// При активации: захватываем все клиенты
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Перехват запросов к критичным скриптам
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isCriticalScript = CRITICAL_SCRIPTS.some(s => url.pathname.endsWith(s.replace('/static', '')));

  if (!isCriticalScript) {
    return; // Пропускаем не-критичные запросы
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const scriptPath = CRITICAL_SCRIPTS.find(s => url.pathname.endsWith(s.replace('/static', '')));

      try {
        // Загружаем свежую версию с сервера
        const networkResponse = await fetch(event.request, { cache: 'no-cache' });

        if (networkResponse.ok) {
          const clone = networkResponse.clone();
          const buffer = await clone.arrayBuffer();
          const newHashBuffer = await crypto.subtle.digest('SHA-384', buffer);
          const newHash = btoa(String.fromCharCode(...new Uint8Array(newHashBuffer)));

          // Получаем эталонный хеш из кеша
          const storedHashResponse = await cache.match(scriptPath + '::hash');

          if (storedHashResponse) {
            const storedHash = await storedHashResponse.text();

            if (newHash !== storedHash) {
              // ХЕШИ НЕ СОВПАДАЮТ — возможная подмена!
              // Оповещаем все вкладки
              const clients = await self.clients.matchAll({ type: 'window' });
              clients.forEach(client => {
                client.postMessage({
                  type: 'INTEGRITY_VIOLATION',
                  script: scriptPath,
                  expectedHash: storedHash,
                  actualHash: newHash
                });
              });

              // Возвращаем кешированную (доверенную) версию
              const cachedResponse = await cache.match(scriptPath);
              if (cachedResponse) {
                return cachedResponse;
              }
              // Если кеша нет — блокируем с ошибкой
              return new Response('// BLOCKED: Script integrity check failed', {
                status: 403,
                headers: { 'Content-Type': 'application/javascript' }
              });
            }
          }

          // Хеши совпали — обновляем кеш
          await cache.put(scriptPath, networkResponse.clone());
          return networkResponse;
        }
      } catch (e) {
        // Ошибка сети — возвращаем из кеша
      }

      // Fallback на кешированную версию
      const cachedResponse = await cache.match(scriptPath);
      if (cachedResponse) {
        return cachedResponse;
      }

      return new Response('// Script unavailable', {
        status: 503,
        headers: { 'Content-Type': 'application/javascript' }
      });
    })()
  );
});
