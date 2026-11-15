<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import type { User } from '../types/index.js';
	import { formatRupiah } from '../shift/index.js';
	import {
		Lock,
		KeyRound,
		Wallet,
		UserCircle2,
		AlertCircle,
		ArrowRight,
		MonitorSmartphone,
		Building2,
		WifiOff,
		LogOut
	} from 'lucide-svelte';

	// Layar kunci operator (lapis 2). Muncul saat perangkat sudah terikat ke
	// cabang tetapi belum ada operator yang memegang laci. Kasir memilih
	// namanya, memasukkan PIN, lalu membuka shift — tanpa login ulang.
	let operators = $state<User[]>([]);
	let selectedOperatorId = $state<string>('');
	let pin = $state<string>('');
	let openingCash = $state<number>(0);
	let errorMessage = $state<string | null>(null);
	let isLoading = $state<boolean>(true);
	let isSubmitting = $state<boolean>(false);

	let selectedOperator = $derived(operators.find((o) => o.id === selectedOperatorId) || null);

	// Daftar operator dibaca reaktif dari IndexedDB. Sinkronisasi pertama setelah
	// perangkat diaktifkan menulis akun kasir secara asinkron, sehingga daftar
	// harus ikut terbarui tanpa perlu refresh halaman.
	const operatorsQuery = liveQuery(async () => {
		const branchId = authState.branch?.id || authState.device?.branch_id || 'all';
		const all = await db.users.toArray();
		return all.filter(
			(u) => u.active && u.role === 'cashier' && (branchId === 'all' || u.branch_id === branchId || u.branch_id === 'all')
		);
	});

	$effect(() => {
		const sub = operatorsQuery.subscribe({
			next: (list) => {
				operators = list;
				if (list.length > 0 && !list.some((o) => o.id === selectedOperatorId)) {
					selectedOperatorId = list[0].id;
				}
				isLoading = false;
			},
			error: () => {
				isLoading = false;
			}
		});
		return () => sub.unsubscribe();
	});

	/** Lepas perangkat dari cabang (lapis 1). Beri konfirmasi karena aksi ini
	 *  mengharuskan inisialisasi ulang terminal. */
	function releaseDevice() {
		if (confirm('Lepas perangkat ini dari cabang? Anda perlu menginisialisasi ulang perangkat untuk memakainya lagi.')) {
			authState.logout();
		}
	}

	async function handleOpenShift() {
		errorMessage = null;
		if (!selectedOperator) return (errorMessage = 'Pilih operator yang memegang laci');
		if (!pin.trim()) return (errorMessage = 'Masukkan PIN operator');
		if (openingCash < 0 || isNaN(openingCash)) return (errorMessage = 'Setoran awal tidak boleh negatif');

		isSubmitting = true;
		const res = await authState.openShift({ operator: selectedOperator, pin, openingCash });
		isSubmitting = false;
		if (!res.success) errorMessage = res.message || 'Gagal membuka shift';
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-zinc-100 via-white to-emerald-50 flex flex-col justify-center items-center p-4">
	<div class="w-full max-w-lg">
		<div class="text-center mb-6">
			<div class="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-white shadow-lg mb-3">
				<Lock class="h-7 w-7" />
			</div>
			<h1 class="text-xl font-black text-zinc-900 tracking-tight">Buka Shift Operator</h1>
			<p class="text-xs text-zinc-500 mt-1">Pilih nama Anda, masukkan PIN, lalu mulai bertransaksi.</p>
		</div>

		<!-- Info perangkat & cabang -->
		<div class="mb-4 flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold">
			<span class="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-zinc-600 border border-zinc-200 shadow-2xs">
				<MonitorSmartphone class="h-3.5 w-3.5 text-emerald-600" />
				{authState.device?.name || 'Perangkat Kasir'}
			</span>
			<span class="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-zinc-600 border border-zinc-200 shadow-2xs">
				<Building2 class="h-3.5 w-3.5 text-emerald-600" />
				{authState.branch?.name || 'Cabang'}
			</span>
		</div>

		<div class="rounded-3xl bg-white p-6 shadow-xl border border-zinc-200">
			{#if isLoading}
				<div class="flex flex-col items-center gap-3 py-6">
					<div class="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
					<p class="text-xs text-zinc-500">Memuat daftar operator...</p>
				</div>
			{:else if operators.length === 0}
				<div class="text-center py-4">
					<div class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 mb-3">
						<UserCircle2 class="h-6 w-6" />
					</div>
					<p class="text-sm font-bold text-zinc-800">Belum ada akun kasir</p>
					<p class="text-xs text-zinc-500 mt-1">
						Minta Admin menambahkan akun kasir untuk cabang ini di menu <strong>Pengguna</strong>.
					</p>
					<button
						type="button"
						onclick={releaseDevice}
						class="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 hover:text-zinc-700 cursor-pointer"
					>
						<LogOut class="h-3.5 w-3.5" /> Lepas perangkat dari cabang
					</button>
				</div>
			{:else}
				<form onsubmit={(e) => { e.preventDefault(); handleOpenShift(); }} class="space-y-4">
					<div>
						<span class="block text-xs font-bold text-zinc-700 mb-1.5">Operator (Pemegang Laci)</span>
						<div class="grid grid-cols-2 gap-2">
							{#each operators as op}
								<button
									type="button"
									onclick={() => (selectedOperatorId = op.id)}
									class="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition cursor-pointer {selectedOperatorId === op.id ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20' : 'border-zinc-200 hover:border-zinc-300 bg-white'}"
								>
									<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white text-[11px] font-bold uppercase">
										{op.name.slice(0, 2)}
									</div>
									<span class="text-xs font-semibold text-zinc-800 truncate">{op.name}</span>
								</button>
							{/each}
						</div>
					</div>

					<div>
						<label for="operator-pin" class="block text-xs font-bold text-zinc-700 mb-1.5">PIN Operator</label>
						<div class="relative">
							<KeyRound class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
							<input
								id="operator-pin"
								type="password"
								bind:value={pin}
								placeholder="PIN pribadi"
								class="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm font-mono tracking-widest focus:outline-hidden focus:border-emerald-500"
							/>
						</div>
					</div>

					<div>
						<label for="opening-cash" class="block text-xs font-bold text-zinc-700 mb-1.5">Setoran Awal (Modal Laci)</label>
						<div class="relative">
							<Wallet class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
							<input
								id="opening-cash"
								type="number"
								bind:value={openingCash}
								min="0"
								class="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-zinc-300 text-lg font-bold text-zinc-900 focus:outline-hidden focus:border-emerald-500"
							/>
						</div>
						<p class="text-[11px] text-zinc-400 mt-1">
							Jumlah uang fisik yang disetor ke laci saat membuka shift.
						</p>
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
						class="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition cursor-pointer disabled:opacity-60"
					>
						<span>{isSubmitting ? 'Membuka shift...' : `Mulai Shift${selectedOperator ? ' — ' + selectedOperator.name : ''}`}</span>
						<ArrowRight class="h-4 w-4" />
					</button>
				</form>

				<div class="mt-4 flex items-center justify-between text-[11px]">
					<span class="inline-flex items-center gap-1 text-zinc-400">
						<WifiOff class="h-3.5 w-3.5" /> Mode offline tetap didukung
					</span>
					<button
						type="button"
						onclick={releaseDevice}
						class="inline-flex items-center gap-1 font-semibold text-zinc-500 hover:text-zinc-700 cursor-pointer"
						title="Lepas perangkat dari cabang"
					>
						<LogOut class="h-3.5 w-3.5" /> Lepas perangkat
					</button>
				</div>
			{/if}
		</div>

		{#if authState.device && selectedOperator}
			<div class="mt-4 text-center text-[11px] text-zinc-400">
				Setoran awal akan tercatat di shift {selectedOperator.name} · {formatRupiah(openingCash || 0)}
			</div>
		{/if}
	</div>
</div>
