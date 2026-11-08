/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';
import { resolve } from '$app/paths';

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = `kasir-modern-cache-${version}`;

// Ekstrak URL string dari manifest assets dan immutable (yang bertipe { path: string })
// Abaikan file dot/hidden seperti .assetsignore yang tidak disajikan web server
const formatPath = (item: any): string => {
	const rawPath = typeof item === 'string' ? item : item?.path || '';
	if (!rawPath) return '';
	return resolve(rawPath as any);
};

const RAW_ASSETS = [...assets, ...immutable];
const ASSETS_TO_CACHE = [
	resolve('/'),
	...RAW_ASSETS
		.map(formatPath)
		.filter((p) => p && !p.includes('/.') && !p.endsWith('.assetsignore'))
];

// Hilangkan duplikasi
const UNIQUE_ASSETS = Array.from(new Set(ASSETS_TO_CACHE));

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(async (cache) => {
			// Gunakan cache.add satu per satu dengan catch agar jika satu file hilang/404, tidak menggagalkan seluruh caching
			await Promise.all(
				UNIQUE_ASSETS.map((url) =>
					cache.add(url).catch((err) => {
						console.warn(`[SW] Gagal menyimpan aset ke cache: ${url}`, err);
					})
				)
			);
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
					return caches.match(resolve('/')) as Promise<Response>;
				}
				throw new Error('Jaringan offline dan aset tidak tersedia di cache.');
			});
		})
	);
});
