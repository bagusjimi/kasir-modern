<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import type { Branch, User } from '../types/index.js';
	import {
		Store,
		KeyRound,
		User as UserIcon,
		Building2,
		AlertCircle,
		ArrowRight,
		ShieldCheck,
		Wifi,
		WifiOff,
		Lock
	} from 'lucide-svelte';
	import { syncEngine } from '../sync/index.js';

	let username = $state<string>('');
	let pin = $state<string>('');
	let selectedBranchId = $state<string>('cb-01');
	let branches = $state<Branch[]>([]);
	let errorMessage = $state<string | null>(null);
	let isSubmitting = $state<boolean>(false);

	let detectedUser = $state<User | null>(null);

	onMount(async () => {
		branches = await db.branches.toArray();
		if (branches.length > 0) {
			selectedBranchId = branches[0].id;
		}
	});

	// Otomatis deteksi cabang penugasan saat username diinput
	$effect(() => {
		const trimmed = username.trim().toLowerCase();
		if (trimmed) {
			db.users.where('username').equalsIgnoreCase(trimmed).first().then(u => {
				detectedUser = u || null;
				if (u && u.role === 'cashier' && u.branch_id && u.branch_id !== 'all') {
					selectedBranchId = u.branch_id;
				}
			});
		} else {
			detectedUser = null;
		}
	});

	async function handleLogin() {
		errorMessage = null;
		if (!username.trim()) {
			errorMessage = 'Silakan masukkan nama pengguna (username)';
			return;
		}
		if (!pin.trim()) {
			errorMessage = 'Silakan masukkan PIN kasir';
			return;
		}

		isSubmitting = true;
		const res = await authState.login(username.trim(), pin.trim(), selectedBranchId);
		isSubmitting = false;

		if (!res.success) {
			errorMessage = res.message || 'Login gagal, periksa kredensial Anda';
		}
	}

	async function quickLogin(demoUser: string, demoPin: string, branchId?: string) {
		username = demoUser;
		pin = demoPin;
		if (branchId) selectedBranchId = branchId;
		await handleLogin();
	}

	function getBranchName(branchId: string): string {
		const b = branches.find(item => item.id === branchId);
		return b ? b.name : branchId;
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 flex flex-col justify-center items-center p-4">
	<!-- Status Jaringan di Pojok Kanan Atas -->
	<div class="absolute top-4 right-4">
		{#if syncEngine.isOnline}
			<div class="flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
				<Wifi class="h-3.5 w-3.5" />
				<span>Online</span>
			</div>
		{:else}
			<div class="flex items-center gap-1.5 rounded-full bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-300 border border-rose-500/30">
				<WifiOff class="h-3.5 w-3.5" />
				<span>Offline Mode (IndexedDB)</span>
			</div>
		{/if}
	</div>

	<div class="w-full max-w-md">
		<!-- Header / Logo -->
		<div class="text-center mb-8">
			<div class="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-xl shadow-emerald-500/30 mb-3">
				<Store class="h-8 w-8" />
			</div>
			<h1 class="text-2xl font-black text-white tracking-tight">KASIR MODERN</h1>
			<p class="text-xs text-slate-400 mt-1">Sistem POS Multi-Cabang Berbasis Cloudflare & Offline-First</p>
		</div>

		<!-- Card Login -->
		<div class="rounded-3xl bg-white p-7 shadow-2xl border border-white/20">
			<form onsubmit={(e) => { e.preventDefault(); handleLogin(); }} class="space-y-4">
				<div>
					<label for="username" class="block text-xs font-bold text-gray-700 mb-1.5">Nama Pengguna (Username)</label>
					<div class="relative">
						<UserIcon class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
						<input
							id="username"
							type="text"
							bind:value={username}
							placeholder="Masukkan username Anda..."
							class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
						/>
					</div>
					{#if detectedUser && detectedUser.role === 'cashier'}
						<div class="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200/60">
							<Lock class="h-3 w-3 shrink-0" />
							<span>Terikat pada: {getBranchName(detectedUser.branch_id)}</span>
						</div>
					{/if}
				</div>

				<div>
					<label for="pin" class="block text-xs font-bold text-gray-700 mb-1.5">PIN Masuk Kasir / Sandi</label>
					<div class="relative">
						<KeyRound class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
						<input
							id="pin"
							type="password"
							bind:value={pin}
							placeholder="4-6 digit PIN..."
							class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm font-mono tracking-widest focus:outline-hidden focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
						/>
					</div>
				</div>

				<div>
					<label for="branch" class="block text-xs font-bold text-gray-700 mb-1.5">Lokasi Cabang Operasional</label>
					<div class="relative">
						<Building2 class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
						<select
							id="branch"
							bind:value={selectedBranchId}
							disabled={detectedUser?.role === 'cashier'}
							class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 focus:outline-hidden focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 font-medium disabled:bg-gray-100 disabled:text-gray-600 disabled:cursor-not-allowed"
						>
							{#if detectedUser?.role === 'admin'}
								<option value="all">Semua Cabang (Pusat)</option>
							{/if}
							{#each branches as b}
								<option value={b.id}>{b.name} ({b.code})</option>
							{/each}
						</select>
					</div>
					{#if detectedUser?.role === 'cashier'}
						<p class="text-[10px] text-gray-400 mt-1 italic">
							*Cabang terkunci otomatis sesuai hak akses dan penugasan kasir.
						</p>
					{/if}
				</div>

				{#if errorMessage}
					<div class="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
						<AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
						<span>{errorMessage}</span>
					</div>
				{/if}

				<button
					type="submit"
					disabled={isSubmitting}
					class="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 active:scale-98 transition cursor-pointer"
				>
					<span>{isSubmitting ? 'Memverifikasi...' : 'Masuk ke Sistem'}</span>
					<ArrowRight class="h-4 w-4" />
				</button>
			</form>

			<!-- Quick Demo Switcher -->
			<div class="mt-6 pt-5 border-t border-gray-100 text-xs">
				<p class="font-bold text-gray-700 mb-2.5 text-center">Masuk Cepat (Akun Demo):</p>
				<div class="grid grid-cols-2 gap-2">
					<button
						onclick={() => quickLogin('admin', '123456', 'all')}
						class="flex flex-col items-center justify-center p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100/70 text-indigo-900 transition cursor-pointer"
					>
						<span class="font-bold flex items-center gap-1 text-[11px]">
							<ShieldCheck class="h-3.5 w-3.5 text-indigo-600" /> Admin Pusat
						</span>
						<span class="text-[10px] text-indigo-500 font-mono">PIN: 123456</span>
					</button>

					<button
						onclick={() => quickLogin('kasir_jkt', '1234', 'cb-01')}
						class="flex flex-col items-center justify-center p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/70 text-emerald-900 transition cursor-pointer"
					>
						<span class="font-bold text-[11px]">Kasir Jakarta</span>
						<span class="text-[10px] text-emerald-600 font-mono">PIN: 1234</span>
					</button>

					<button
						onclick={() => quickLogin('kasir_bdg', '1234', 'cb-02')}
						class="flex flex-col items-center justify-center p-2.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-800 transition cursor-pointer"
					>
						<span class="font-bold text-[11px]">Kasir Bandung</span>
						<span class="text-[10px] text-gray-500 font-mono">PIN: 1234</span>
					</button>

					<button
						onclick={() => quickLogin('kasir_sby', '1234', 'cb-03')}
						class="flex flex-col items-center justify-center p-2.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-800 transition cursor-pointer"
					>
						<span class="font-bold text-[11px]">Kasir Surabaya</span>
						<span class="text-[10px] text-gray-500 font-mono">PIN: 1234</span>
					</button>
				</div>
			</div>
		</div>

		<div class="text-center text-[11px] text-slate-500 mt-6">
			Mendukung mode offline penuh. Data disinkronkan otomatis saat online.
		</div>
	</div>
</div>
