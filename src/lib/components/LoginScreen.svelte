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
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 flex flex-col justify-center items-center p-4">
	<div class="absolute top-4 right-4">
		{#if syncEngine.isOnline}
			<div class="flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
				<Wifi class="h-3.5 w-3.5" />
				<span>Terhubung</span>
			</div>
		{:else}
			<div class="flex items-center gap-1.5 rounded-full bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-300 border border-rose-500/30">
				<WifiOff class="h-3.5 w-3.5" />
				<span>Mode Tanpa Koneksi (Data Lokal)</span>
			</div>
		{/if}
	</div>

	<div class="w-full max-w-md">
		<div class="text-center mb-8">
			<div class="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-xl shadow-emerald-500/30 mb-3">
				<Store class="h-8 w-8" />
			</div>
			<h1 class="text-2xl font-black text-white tracking-tight">KASIR MODERN</h1>
			<p class="text-xs text-slate-400 mt-1">Inisialisasi Toko &amp; Perangkat Kasir</p>
		</div>

		<div class="rounded-3xl bg-white p-7 shadow-2xl border border-white/20">
			{#if screen === 'loading'}
				<div class="flex flex-col items-center gap-3 py-6">
					<div class="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
					<p class="text-xs text-zinc-500">Menyiapkan perangkat...</p>
				</div>
			{:else if screen === 'setup'}
				<!-- Penyiapan Awal: buat admin, cabang, dan perangkat pertama -->
				<form onsubmit={(e) => { e.preventDefault(); handleSetup(); }} class="space-y-4">
					<div class="text-center mb-1">
						<div class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 mb-2">
							<Settings class="h-5 w-5" />
						</div>
						<h2 class="text-lg font-black text-gray-800">Penyiapan Awal Toko</h2>
						<p class="text-xs text-gray-500 mt-1">
							Sistem masih kosong. Buat akun admin, cabang pertama, dan perangkat kasir pertama.
						</p>
					</div>

					<div class="grid grid-cols-1 gap-3">
						<div>
							<label for="setup-admin-name" class="block text-xs font-bold text-gray-700 mb-1.5">Nama Lengkap Admin</label>
							<input id="setup-admin-name" type="text" bind:value={setupAdminName} placeholder="Contoh: Ahmad Owner"
								class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500" />
						</div>
						<div>
							<label for="setup-admin-username" class="block text-xs font-bold text-gray-700 mb-1.5">Username Admin</label>
							<input id="setup-admin-username" type="text" bind:value={setupAdminUsername} autocomplete="off"
								placeholder="Huruf kecil, tanpa spasi (min. 3)"
								class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-hidden focus:border-emerald-500" />
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div>
								<label for="setup-admin-pin" class="block text-xs font-bold text-gray-700 mb-1.5">PIN Admin</label>
								<input id="setup-admin-pin" type="password" bind:value={setupAdminPin} placeholder="Min. 4"
									class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-mono tracking-widest focus:outline-hidden focus:border-emerald-500" />
							</div>
							<div>
								<label for="setup-admin-pin-confirm" class="block text-xs font-bold text-gray-700 mb-1.5">Konfirmasi PIN</label>
								<input id="setup-admin-pin-confirm" type="password" bind:value={setupAdminPinConfirm} placeholder="Ulangi PIN"
									class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-mono tracking-widest focus:outline-hidden focus:border-emerald-500" />
							</div>
						</div>
					</div>

					<div class="border-t border-gray-100 pt-3">
						<p class="text-[11px] font-bold uppercase tracking-wide text-zinc-400 mb-2">Cabang Pertama</p>
						<div class="grid grid-cols-2 gap-3">
							<div>
								<label for="setup-branch-code" class="block text-xs font-bold text-gray-700 mb-1.5">Kode Cabang</label>
								<input id="setup-branch-code" type="text" bind:value={setupBranchCode} placeholder="CB01"
									class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-mono uppercase focus:outline-hidden focus:border-emerald-500" />
							</div>
							<div>
								<label for="setup-branch-name" class="block text-xs font-bold text-gray-700 mb-1.5">Nama Cabang</label>
								<input id="setup-branch-name" type="text" bind:value={setupBranchName} placeholder="Cabang Pusat"
									class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500" />
							</div>
						</div>
						<div class="mt-3">
							<label for="setup-device-name" class="block text-xs font-bold text-gray-700 mb-1.5">Nama Perangkat Kasir</label>
							<input id="setup-device-name" type="text" bind:value={setupDeviceName} placeholder="Kasir 1"
								class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500" />
						</div>
					</div>

					{#if errorMessage}
						<div class="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
							<AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
							<span>{errorMessage}</span>
						</div>
					{/if}

					<button type="submit" disabled={isSubmitting}
						class="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition cursor-pointer disabled:opacity-60">
						<span>{isSubmitting ? 'Menyimpan...' : 'Selesaikan Penyiapan'}</span>
						<ArrowRight class="h-4 w-4" />
					</button>
				</form>
			{:else if screen === 'device'}
				<!-- Inisialisasi Perangkat ke Cabang (lapis toko) -->
				<form onsubmit={(e) => { e.preventDefault(); handleInitDevice(); }} class="space-y-4">
					<div class="text-center mb-1">
						<div class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 mb-2">
							<MonitorSmartphone class="h-5 w-5" />
						</div>
						<h2 class="text-lg font-black text-gray-800">Inisialisasi Perangkat</h2>
						<p class="text-xs text-gray-500 mt-1">
							Ikat perangkat ini ke satu cabang toko. Kasir cukup bergantian lewat Shift — tanpa login ulang.
						</p>
					</div>

					<div>
						<label for="device-name" class="block text-xs font-bold text-gray-700 mb-1.5">Nama Perangkat</label>
						<input id="device-name" type="text" bind:value={deviceName} placeholder="Kasir 1"
							class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500" />
					</div>

					<div>
						<div class="flex items-center justify-between mb-1.5">
							<label for="branch-select" class="block text-xs font-bold text-gray-700">Cabang Toko</label>
							<button type="button" onclick={() => (useNewBranch = !useNewBranch)}
								class="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer">
								{useNewBranch ? 'Pilih cabang yang ada' : '+ Cabang baru'}
							</button>
						</div>
						{#if useNewBranch}
							<div class="grid grid-cols-2 gap-3">
								<input type="text" bind:value={newBranchCode} placeholder="Kode (CB02)"
									class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-mono uppercase focus:outline-hidden focus:border-emerald-500" />
								<input type="text" bind:value={newBranchName} placeholder="Nama cabang"
									class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500" />
							</div>
							<p class="text-[11px] text-zinc-400 mt-1">Butuh koneksi internet sekali agar cabang baru terdaftar di server.</p>
						{:else}
							<div class="relative">
								<Building2 class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
								<select id="branch-select" bind:value={selectedBranchId}
									class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-hidden focus:border-emerald-500">
									{#each branches as b}
										<option value={b.id}>{b.name} ({b.code})</option>
									{/each}
								</select>
							</div>
						{/if}
					</div>

					{#if errorMessage}
						<div class="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
							<AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
							<span>{errorMessage}</span>
						</div>
					{/if}

					<button type="submit" disabled={isSubmitting}
						class="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition cursor-pointer disabled:opacity-60">
						<span>{isSubmitting ? 'Menyiapkan...' : 'Aktifkan Perangkat'}</span>
						<ArrowRight class="h-4 w-4" />
					</button>
				</form>
			{:else if screen === 'admin'}
				<!-- Masuk sebagai Admin (pintu terpisah) -->
				<form onsubmit={(e) => { e.preventDefault(); handleAdminLogin(); }} class="space-y-4">
					<div class="text-center mb-1">
						<div class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 mb-2">
							<ShieldCheck class="h-5 w-5" />
						</div>
						<h2 class="text-lg font-black text-gray-800">Masuk sebagai Admin</h2>
						<p class="text-xs text-gray-500 mt-1">Kelola pengguna &amp; pantau aktivitas kasir. Bukan untuk transaksi.</p>
					</div>

					<div>
						<label for="admin-username" class="block text-xs font-bold text-gray-700 mb-1.5">Username Admin</label>
						<div class="relative">
							<UserIcon class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
							<input id="admin-username" type="text" bind:value={adminUsername} autocomplete="off"
								placeholder="Masukkan username admin"
								class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500" />
						</div>
					</div>

					<div>
						<label for="admin-pin" class="block text-xs font-bold text-gray-700 mb-1.5">PIN Admin</label>
						<div class="relative">
							<KeyRound class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
							<input id="admin-pin" type="password" bind:value={adminPin} placeholder="PIN admin..."
								class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm font-mono tracking-widest focus:outline-hidden focus:border-emerald-500" />
						</div>
					</div>

					{#if errorMessage}
						<div class="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
							<AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
							<span>{errorMessage}</span>
						</div>
					{/if}

					<button type="submit" disabled={isSubmitting}
						class="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-sm shadow-lg transition cursor-pointer disabled:opacity-60">
						<span>{isSubmitting ? 'Memverifikasi...' : 'Masuk sebagai Admin'}</span>
						<ArrowRight class="h-4 w-4" />
					</button>
				</form>
			{/if}

			{#if screen !== 'loading'}
				<div class="mt-4 text-center">
					{#if screen === 'admin'}
						<button type="button" onclick={() => { errorMessage = null; screen = branches.length ? 'device' : 'setup'; }}
							class="text-[11px] font-semibold text-zinc-500 hover:text-zinc-700 cursor-pointer">
							← Kembali ke inisialisasi perangkat
						</button>
					{:else}
						<button type="button" onclick={() => { errorMessage = null; screen = 'admin'; }}
							class="text-[11px] font-semibold text-zinc-500 hover:text-zinc-700 cursor-pointer">
							Masuk sebagai Admin (kelola pengguna)
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<div class="text-center text-[11px] text-slate-500 mt-6">
			Mendukung mode offline penuh. Data disinkronkan otomatis saat online.
		</div>
	</div>
</div>
