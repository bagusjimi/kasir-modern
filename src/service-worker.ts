/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = `kasir-modern-cache-${version}`;
const ASSETS_TO_CACHE = [...assets, ...immutable];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.addAll(ASSETS_TO_CACHE);
		}).then(() => {
			return self.skipWaiting();
		})
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE_NAME) {
					await caches.delete(key);
				}
			}
			await self.clients.claim();
		})
	);
});

self.addEventListener('fetch', (event) => {
	// Abaikan permintaan non-GET dan endpoint API agar sinkronisasi ditangani sync engine
	if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
		return;
	}

	event.respondWith(
		caches.match(event.request).then((cachedResponse) => {
			if (cachedResponse) {
				return cachedResponse;
			}

			return fetch(event.request).then((response) => {
				// Caching jika respon valid
				if (response.status === 200 && response.type === 'basic') {
					const responseToCache = response.clone();
					caches.open(CACHE_NAME).then((cache) => {
						cache.put(event.request, responseToCache);
					});
				}
				return response;
			}).catch(() => {
				// Fallback jika offline dan request halaman navigasi
				if (event.request.mode === 'navigate') {
					return caches.match('/') as Promise<Response>;
				}
				throw new Error('Jaringan offline dan aset tidak tersedia di cache.');
			});
		})
	);
});
