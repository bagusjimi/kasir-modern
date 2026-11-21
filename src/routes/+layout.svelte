<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { seedInitialData } from '#lib/db/index.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(async () => {
		try {
			await seedInitialData();
		} catch (err) {
			console.error('Gagal inisialisasi database:', err);
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Kasir Modern - POS Multi Cabang Offline-First</title>
	<meta name="description" content="Aplikasi Kasir Multi-Cabang Berbasis SvelteKit dan Cloudflare dengan Dukungan Offline-First PWA" />
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
	<meta name="theme-color" content="#1e1b16" />
</svelte:head>

<div class="min-h-screen text-gray-900 antialiased">
	{@render children()}
</div>
