<script lang="ts">
	import { onMount } from 'svelte';
	import { Download, X, Share, Smartphone } from 'lucide-svelte';

	interface BeforeInstallPromptEvent extends Event {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let isStandalone = $state<boolean>(false);
	let isIOS = $state<boolean>(false);
	let showIOSGuide = $state<boolean>(false);
	let dismissed = $state<boolean>(false);

	onMount(() => {
		isStandalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			(window.navigator as any).standalone === true;
		dismissed = localStorage.getItem('kasir_install_dismissed') === '1';
		const ua = window.navigator.userAgent.toLowerCase();
		isIOS =
			/iphone|ipad|ipod/.test(ua) ||
			(ua.includes('macintosh') && (window.navigator as any).maxTouchPoints > 1);

		window.addEventListener('appinstalled', hide);
		return () => window.removeEventListener('appinstalled', hide);
	});

	function handleBeforeInstallPrompt(e: Event) {
		e.preventDefault();
		deferredPrompt = e as BeforeInstallPromptEvent;
	}

	async function install() {
		if (!deferredPrompt) return;
		await deferredPrompt.prompt();
		const choice = await deferredPrompt.userChoice;
		if (choice.outcome === 'accepted') hide();
		deferredPrompt = null;
	}

	function hide() {
		dismissed = true;
		localStorage.setItem('kasir_install_dismissed', '1');
	}

	const visible = $derived(!isStandalone && !dismissed && (deferredPrompt !== null || isIOS));
</script>

<svelte:window on:beforeinstallprompt={handleBeforeInstallPrompt} />

{#if visible}
	<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 space-y-1.5">
		<div class="flex items-center justify-between gap-2">
			<p class="text-[10px] font-bold text-emerald-800 leading-tight">Pasang aplikasi di perangkat ini agar bisa dibuka langsung dari layar utama</p>
			<button
				onclick={hide}
				class="shrink-0 rounded p-0.5 text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700 transition cursor-pointer"
				aria-label="Tutup"
			>
				<X class="h-3 w-3" />
			</button>
		</div>

		{#if deferredPrompt}
			<button
				onclick={install}
				class="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white transition cursor-pointer"
			>
				<Download class="h-3.5 w-3.5" />
				<span>Pasang Aplikasi</span>
			</button>
		{:else if isIOS}
			<button
				onclick={() => (showIOSGuide = true)}
				class="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white transition cursor-pointer"
			>
				<Smartphone class="h-3.5 w-3.5" />
				<span>Cara Pasang di iPhone/iPad</span>
			</button>
		{/if}
	</div>
{/if}

{#if showIOSGuide}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl space-y-4">
			<div class="flex items-center justify-between">
				<h3 class="text-base font-semibold text-gray-900">Pasang di iPhone/iPad</h3>
				<button
					onclick={() => (showIOSGuide = false)}
					class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition cursor-pointer"
					aria-label="Tutup"
				>
					<X class="h-4 w-4" />
				</button>
			</div>
			<ol class="text-sm text-gray-700 space-y-2.5 list-decimal list-inside">
				<li class="flex items-start gap-2">
					<span>Buka menu <strong>Share</strong> di Safari (ikon <Share class="h-3.5 w-3.5 inline text-emerald-600" /> di bawah layar).</span>
				</li>
				<li><span>Pilih <strong>Add to Home Screen</strong>.</span></li>
				<li><span>Tekan <strong>Add</strong>. Aplikasi muncul di layar utama seperti aplikasi biasa.</span></li>
			</ol>
			<p class="text-[11px] text-gray-500">Gunakan Safari, bukan Chrome, agar opsi ini tersedia.</p>
		</div>
	</div>
{/if}
