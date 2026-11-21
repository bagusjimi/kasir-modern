<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Branch } from '../types/index.js';
	import {
		Store,
		KeyRound,
		User as UserIcon,
		AlertCircle,
		ArrowRight,
		Wifi,
		WifiOff,
		MonitorSmartphone,
		ShieldCheck,
		Settings,
		Building2
	} from 'lucide-svelte';

	// Layar ini adalah pintu INISIALISASI TOKO (lapis perangkat), bukan login
	// operator kasir. Operator ditentukan lewat shift di dalam aplikasi.
	type Screen = 'loading' | 'setup' | 'device' | 'admin';

	let screen = $state<Screen>('loading');
	let errorMessage = $state<string | null>(null);
	let isSubmitting = $state<boolean>(false);

	// Penyiapan awal (sistem masih kosong)
	let setupAdminName = $state<string>('');
	let setupAdminUsername = $state<string>('');
	let setupAdminPin = $state<string>('');
	let setupAdminPinConfirm = $state<string>('');
	let setupBranchCode = $state<string>('');
	let setupBranchName = $state<string>('');
	let setupDeviceName = $state<string>('Kasir 1');

	// Inisialisasi perangkat (sistem sudah ada)
	let branches = $state<Branch[]>([]);
	let selectedBranchId = $state<string>('');
	let newBranchCode = $state<string>('');
	let newBranchName = $state<string>('');
	let deviceName = $state<string>('Kasir 1');
	let useNewBranch = $state<boolean>(false);

	// Masuk admin
	let adminUsername = $state<string>('');
	let adminPin = $state<string>('');

	onMount(async () => {
		branches = await db.branches.toArray();
		if (branches.length > 0) selectedBranchId = branches[0].id;
		await refreshServerStatus();
	});

	async function refreshServerStatus() {
		const online = typeof navigator !== 'undefined' && navigator.onLine;
		if (online) {
			try {
				const res = await fetch('/api/auth/status');
				if (res.ok) {
					const data: any = await res.json();
					if (Array.isArray(data.branches) && data.branches.length > 0) {
						// Gabungkan daftar cabang server dengan yang ada di perangkat.
						for (const b of data.branches) {
							const existing = await db.branches.get(b.id);
							if (!existing) {
								await db.branches.put({
									id: b.id,
									code: b.code,
									name: b.name,
									address: '',
									phone: '',
									created_at: new Date().toISOString(),
									updated_at: new Date().toISOString()
								});
							}
						}
						branches = await db.branches.toArray();
						if (!selectedBranchId && branches.length > 0) selectedBranchId = branches[0].id;
					}
					// Belum ada akun sama sekali -> tampilkan penyiapan awal,
					// meskipun cabang mungkin sudah ada (mis. dibuat manual).
					if (!data.has_users) {
						screen = 'setup';
						return;
					}
				}
			} catch {
				// Server tidak terjangkau: putuskan dari data lokal
			}
		}
		// Offline atau server terjangkau dengan data: butuh cabang untuk inisialisasi perangkat.
		if (branches.length === 0) {
			screen = 'setup';
		} else {
			screen = 'device';
		}
	}

	async function handleSetup() {
		errorMessage = null;
		if (!setupAdminName.trim()) return (errorMessage = 'Nama lengkap admin harus diisi');
		if (setupAdminUsername.trim().length < 3) return (errorMessage = 'Username minimal 3 karakter');
		if (setupAdminPin.trim().length < 4) return (errorMessage = 'PIN admin minimal 4 karakter');
		if (setupAdminPin.trim() !== setupAdminPinConfirm.trim()) return (errorMessage = 'Konfirmasi PIN tidak sama');
		if (!setupBranchCode.trim()) return (errorMessage = 'Kode cabang pertama wajib diisi');
		if (!setupBranchName.trim()) return (errorMessage = 'Nama cabang pertama wajib diisi');

		isSubmitting = true;
		const res = await authState.initializeStore({
			admin_name: setupAdminName,
			admin_username: setupAdminUsername,
			admin_pin: setupAdminPin,
			branch_code: setupBranchCode,
			branch_name: setupBranchName,
			device_name: setupDeviceName
		});
		isSubmitting = false;
		if (!res.success) errorMessage = res.message || 'Penyiapan awal gagal';
	}

	async function handleInitDevice() {
		errorMessage = null;
		if (!deviceName.trim()) return (errorMessage = 'Nama perangkat wajib diisi');
		if (useNewBranch) {
			if (!newBranchCode.trim() || !newBranchName.trim()) {
				return (errorMessage = 'Kode & nama cabang baru wajib diisi');
			}
		} else if (!selectedBranchId) {
			return (errorMessage = 'Pilih cabang untuk perangkat ini');
		}

		isSubmitting = true;
		const res = await authState.initDevice({
			device_name: deviceName,
			branch_id: useNewBranch ? '' : selectedBranchId,
			branch_code: useNewBranch ? newBranchCode : '',
			branch_name: useNewBranch ? newBranchName : ''
		});
		isSubmitting = false;
		if (!res.success) errorMessage = res.message || 'Inisialisasi perangkat gagal';
	}

	async function handleAdminLogin() {
		errorMessage = null;
		if (!adminUsername.trim()) return (errorMessage = 'Masukkan username admin');
		if (!adminPin.trim()) return (errorMessage = 'Masukkan PIN admin');

		isSubmitting = true;
		const res = await authState.loginAdmin(adminUsername, adminPin);
		isSubmitting = false;
		if (!res.success) errorMessage = res.message || 'Gagal masuk sebagai admin';
	}

        // Kelas bersama agar seluruh layar inisialisasi memakai satu bahasa bentuk.
        const field =
                'w-full rounded-md border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 focus:outline-hidden';
        const label = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500';
        const primaryBtn =
                'inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:translate-y-px disabled:opacity-60 cursor-pointer';
        const ghostBtn =
                'inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 transition hover:text-gray-900 cursor-pointer';
</script>
<div class="min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,31rem)]">
        <!-- Panel merek: sampul buku kas -->
        <aside class="relative isolate overflow-hidden bg-gray-950 text-gray-300">
                <div
                        class="pointer-events-none absolute inset-0 opacity-60"
                        style="background-image: radial-gradient(620px 320px at 18% 0%, rgba(31,78,62,0.55), transparent 72%), repeating-linear-gradient(to bottom, transparent 0 31px, rgba(253,251,245,0.055) 31px 32px);"
                ></div>
                <div
                        class="pointer-events-none absolute -right-28 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full border border-gray-100/10"
                ></div>

                <div class="relative flex h-full flex-col justify-between gap-10 p-7 sm:p-10 lg:p-14">
                        <div class="flex items-center justify-between gap-4">
                                <div class="flex items-center gap-3">
                                        <div class="stamp flex h-11 w-11 items-center justify-center text-gray-100">
                                                <Store class="h-5 w-5" />
                                        </div>
                                        <div class="leading-tight">
                                                <p class="font-display text-lg font-semibold tracking-tight text-gray-50">Kasir Modern</p>
                                                <p class="eyebrow text-[9px] text-gray-500">Buku Kas Digital</p>
                                        </div>
                                </div>

                                {#if syncEngine.isOnline}
                                        <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                                                <Wifi class="h-3 w-3" /> Terhubung
                                        </span>
                                {:else}
                                        <span class="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-rose-300">
                                                <WifiOff class="h-3 w-3" /> Offline
                                        </span>
                                {/if}
                        </div>

                        <div class="max-w-xl">
                                <p class="eyebrow text-rose-400">Satu toko, banyak cabang</p>
                                <h1 class="mt-4 font-display text-4xl leading-[1.05] font-semibold tracking-tight text-gray-50 sm:text-5xl">
                                        Catat tiap rupiah,<br />dari cabang mana pun.
                                </h1>
                                <p class="mt-5 max-w-md text-sm leading-relaxed text-gray-400">
                                        Kasir, stok, shift, dan laporan dalam satu buku. Tetap berjalan saat internet putus, lalu menyusul sendiri ketika tersambung lagi.
                                </p>
                        </div>

                        <dl class="hidden max-w-md divide-y divide-gray-100/10 border-y border-gray-100/10 lg:block">
                                <div class="flex items-baseline gap-4 py-3">
                                        <dt class="num text-[11px] text-rose-400">01</dt>
                                        <dd class="text-xs text-gray-400"><span class="font-semibold text-gray-100">Satu perangkat, satu cabang.</span> Terminal terikat ke tokonya, bukan ke orang.</dd>
                                </div>
                                <div class="flex items-baseline gap-4 py-3">
                                        <dt class="num text-[11px] text-rose-400">02</dt>
                                        <dd class="text-xs text-gray-400"><span class="font-semibold text-gray-100">Shift dengan PIN.</span> Kasir bergantian tanpa login ulang; laci tetap tercatat.</dd>
                                </div>
                                <div class="flex items-baseline gap-4 py-3">
                                        <dt class="num text-[11px] text-rose-400">03</dt>
                                        <dd class="text-xs text-gray-400"><span class="font-semibold text-gray-100">Offline-first.</span> Transaksi tersimpan lokal dan disinkronkan otomatis.</dd>
                                </div>
                        </dl>

                        <p class="eyebrow hidden text-[9px] text-gray-600 lg:block">Multi-cabang · Offline-first · PWA</p>
                </div>
        </aside>

        <!-- Kolom formulir -->
        <main class="flex flex-col justify-center px-4 py-10 sm:px-8">
                <div class="reveal mx-auto w-full max-w-md">
                        <div class="mb-6 flex items-end justify-between gap-4">
                                <div>
                                        <p class="eyebrow text-gray-400">Inisialisasi</p>
                                        <h2 class="mt-1 text-2xl font-semibold text-gray-900">
                                                {screen === 'setup' ? 'Penyiapan awal toko' : screen === 'admin' ? 'Pintu admin' : 'Aktifkan perangkat'}
                                        </h2>
                                </div>
                                <div class="lg:hidden">
                                        {#if syncEngine.isOnline}
                                                <span class="inline-flex items-center gap-1 rounded-full border border-emerald-600/25 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"><Wifi class="h-3 w-3" /> Online</span>
                                        {:else}
                                                <span class="inline-flex items-center gap-1 rounded-full border border-rose-600/25 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700"><WifiOff class="h-3 w-3" /> Offline</span>
                                        {/if}
                                </div>
                        </div>

                        <div class="nota rounded-lg border border-gray-200/80 px-6 py-7 shadow-xl sm:px-7">
                                {#if screen === 'loading'}
                                        <div class="flex flex-col items-center gap-3 py-8">
                                                <div class="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-600"></div>
                                                <p class="eyebrow text-[10px] text-gray-400">Menyiapkan perangkat</p>
                                        </div>
                                {:else if screen === 'setup'}
                                        <form onsubmit={(e) => { e.preventDefault(); handleSetup(); }} class="space-y-4">
                                                <div class="flex items-start gap-3 border-b border-dashed border-gray-200 pb-4">
                                                        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 text-emerald-700">
                                                                <Settings class="h-4 w-4" />
                                                        </div>
                                                        <p class="text-xs leading-relaxed text-gray-500">
                                                                Sistem masih kosong. Buat akun admin, cabang pertama, dan perangkat kasir pertama.
                                                        </p>
                                                </div>

                                                <div class="grid grid-cols-1 gap-3">
                                                        <div>
                                                                <label for="setup-admin-name" class={label}>Nama Lengkap Admin</label>
                                                                <input id="setup-admin-name" type="text" bind:value={setupAdminName} placeholder="Contoh: Ahmad Owner" class={field} />
                                                        </div>
                                                        <div>
                                                                <label for="setup-admin-username" class={label}>Username Admin</label>
                                                                <input id="setup-admin-username" type="text" bind:value={setupAdminUsername} autocomplete="off" placeholder="Huruf kecil, tanpa spasi (min. 3)" class="{field} font-mono" />
                                                        </div>
                                                        <div class="grid grid-cols-2 gap-3">
                                                                <div>
                                                                        <label for="setup-admin-pin" class={label}>PIN Admin</label>
                                                                        <input id="setup-admin-pin" type="password" bind:value={setupAdminPin} placeholder="Min. 4" class="{field} font-mono tracking-[0.3em]" />
                                                                </div>
                                                                <div>
                                                                        <label for="setup-admin-pin-confirm" class={label}>Konfirmasi PIN</label>
                                                                        <input id="setup-admin-pin-confirm" type="password" bind:value={setupAdminPinConfirm} placeholder="Ulangi PIN" class="{field} font-mono tracking-[0.3em]" />
                                                                </div>
                                                        </div>
                                                </div>

                                                <div class="border-t border-dashed border-gray-200 pt-4">
                                                        <p class="eyebrow mb-3 text-[9px] text-gray-400">Cabang pertama</p>
                                                        <div class="grid grid-cols-2 gap-3">
                                                                <div>
                                                                        <label for="setup-branch-code" class={label}>Kode Cabang</label>
                                                                        <input id="setup-branch-code" type="text" bind:value={setupBranchCode} placeholder="CB01" class="{field} font-mono uppercase" />
                                                                </div>
                                                                <div>
                                                                        <label for="setup-branch-name" class={label}>Nama Cabang</label>
                                                                        <input id="setup-branch-name" type="text" bind:value={setupBranchName} placeholder="Cabang Pusat" class={field} />
                                                                </div>
                                                        </div>
                                                        <div class="mt-3">
                                                                <label for="setup-device-name" class={label}>Nama Perangkat Kasir</label>
                                                                <input id="setup-device-name" type="text" bind:value={setupDeviceName} placeholder="Kasir 1" class={field} />
                                                        </div>
                                                </div>

                                                {#if errorMessage}
                                                        <div class="flex items-start gap-2 border-l-2 border-rose-500 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                                                                <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
                                                                <span>{errorMessage}</span>
                                                        </div>
                                                {/if}

                                                <button type="submit" disabled={isSubmitting} class={primaryBtn}>
                                                        <span>{isSubmitting ? 'Menyimpan...' : 'Selesaikan Penyiapan'}</span>
                                                        <ArrowRight class="h-4 w-4" />
                                                </button>
                                        </form>
                                {:else if screen === 'device'}
                                        <form onsubmit={(e) => { e.preventDefault(); handleInitDevice(); }} class="space-y-4">
                                                <div class="flex items-start gap-3 border-b border-dashed border-gray-200 pb-4">
                                                        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 text-emerald-700">
                                                                <MonitorSmartphone class="h-4 w-4" />
                                                        </div>
                                                        <p class="text-xs leading-relaxed text-gray-500">
                                                                Ikat perangkat ini ke satu cabang toko. Kasir cukup bergantian lewat Shift — tanpa login ulang.
                                                        </p>
                                                </div>

                                                <div>
                                                        <label for="device-name" class={label}>Nama Perangkat</label>
                                                        <input id="device-name" type="text" bind:value={deviceName} placeholder="Kasir 1" class={field} />
                                                </div>

                                                <div>
                                                        <div class="mb-1.5 flex items-center justify-between">
                                                                <label for="branch-select" class="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">Cabang Toko</label>
                                                                <button type="button" onclick={() => (useNewBranch = !useNewBranch)} class="text-[11px] font-semibold text-emerald-700 transition hover:text-emerald-800 cursor-pointer">
                                                                        {useNewBranch ? 'Pilih cabang yang ada' : '+ Cabang baru'}
                                                                </button>
                                                        </div>
                                                        {#if useNewBranch}
                                                                <div class="grid grid-cols-2 gap-3">
                                                                        <input type="text" bind:value={newBranchCode} placeholder="Kode (CB02)" class="{field} font-mono uppercase" />
                                                                        <input type="text" bind:value={newBranchName} placeholder="Nama cabang" class={field} />
                                                                </div>
                                                                <p class="mt-1.5 text-[11px] text-gray-400">Butuh koneksi internet sekali agar cabang baru terdaftar di server.</p>
                                                        {:else}
                                                                <div class="relative">
                                                                        <Building2 class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                                                        <select id="branch-select" bind:value={selectedBranchId} class="{field} pl-10">
                                                                                {#each branches as b}
                                                                                        <option value={b.id}>{b.name} ({b.code})</option>
                                                                                {/each}
                                                                        </select>
                                                                </div>
                                                        {/if}
                                                </div>

                                                {#if errorMessage}
                                                        <div class="flex items-start gap-2 border-l-2 border-rose-500 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                                                                <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
                                                                <span>{errorMessage}</span>
                                                        </div>
                                                {/if}

                                                <button type="submit" disabled={isSubmitting} class={primaryBtn}>
                                                        <span>{isSubmitting ? 'Menyiapkan...' : 'Aktifkan Perangkat'}</span>
                                                        <ArrowRight class="h-4 w-4" />
                                                </button>
                                        </form>
                                {:else if screen === 'admin'}
                                        <form onsubmit={(e) => { e.preventDefault(); handleAdminLogin(); }} class="space-y-4">
                                                <div class="flex items-start gap-3 border-b border-dashed border-gray-200 pb-4">
                                                        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-800">
                                                                <ShieldCheck class="h-4 w-4" />
                                                        </div>
                                                        <p class="text-xs leading-relaxed text-gray-500">
                                                                Kelola pengguna &amp; pantau aktivitas kasir. Bukan untuk transaksi.
                                                        </p>
                                                </div>

                                                <div>
                                                        <label for="admin-username" class={label}>Username Admin</label>
                                                        <div class="relative">
                                                                <UserIcon class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                                                <input id="admin-username" type="text" bind:value={adminUsername} autocomplete="off" placeholder="Masukkan username admin" class="{field} pl-10" />
                                                        </div>
                                                </div>

                                                <div>
                                                        <label for="admin-pin" class={label}>PIN Admin</label>
                                                        <div class="relative">
                                                                <KeyRound class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                                                <input id="admin-pin" type="password" bind:value={adminPin} placeholder="PIN admin..." class="{field} pl-10 font-mono tracking-[0.3em]" />
                                                        </div>
                                                </div>

                                                {#if errorMessage}
                                                        <div class="flex items-start gap-2 border-l-2 border-rose-500 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                                                                <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
                                                                <span>{errorMessage}</span>
                                                        </div>
                                                {/if}

                                                <button type="submit" disabled={isSubmitting} class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800 active:translate-y-px disabled:opacity-60 cursor-pointer">
                                                        <span>{isSubmitting ? 'Memverifikasi...' : 'Masuk sebagai Admin'}</span>
                                                        <ArrowRight class="h-4 w-4" />
                                                </button>
                                        </form>
                                {/if}

                                {#if screen !== 'loading'}
                                        <div class="mt-5 border-t border-dashed border-gray-200 pt-4 text-center">
                                                {#if screen === 'admin'}
                                                        <button type="button" onclick={() => { errorMessage = null; screen = branches.length ? 'device' : 'setup'; }} class={ghostBtn}>
                                                                ← Kembali ke inisialisasi perangkat
                                                        </button>
                                                {:else}
                                                        <button type="button" onclick={() => { errorMessage = null; screen = 'admin'; }} class={ghostBtn}>
                                                                <ShieldCheck class="h-3.5 w-3.5" /> Masuk sebagai Admin
                                                        </button>
                                                {/if}
                                        </div>
                                {/if}
                        </div>

                        <p class="mt-6 text-center text-[11px] leading-relaxed text-gray-400">
                                Mendukung mode offline penuh. Data disinkronkan otomatis saat online.
                        </p>
                </div>
        </main>
</div>
