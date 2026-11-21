<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import type { User } from '../types/index.js';
	import { formatRupiah } from '../shift/index.js';
	import {
		Lock,
		Store,
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
<div class="relative flex min-h-screen flex-col">
        <div
                class="pointer-events-none absolute inset-0 -z-10 opacity-70"
                style="background-image: repeating-linear-gradient(to bottom, transparent 0 31px, rgba(30,27,22,0.04) 31px 32px);"
        ></div>

        <!-- Kepala halaman -->
        <header class="flex items-center justify-between px-5 py-5 sm:px-8">
                <div class="flex items-center gap-2.5">
                        <div class="stamp flex h-9 w-9 items-center justify-center text-gray-800">
                                <Store class="h-4 w-4" />
                        </div>
                        <div class="leading-tight">
                                <p class="font-display text-sm font-semibold tracking-tight text-gray-900">Kasir Modern</p>
                                <p class="eyebrow text-[9px] text-gray-400">Buku Kas Digital</p>
                        </div>
                </div>
                <div class="flex items-center gap-2">
                        <span class="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gray-600">
                                <MonitorSmartphone class="h-3 w-3 text-emerald-700" />
                                {authState.device?.name || 'Perangkat Kasir'}
                        </span>
                        <span class="hidden items-center gap-1.5 rounded-full border border-gray-300 bg-white/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gray-600 sm:inline-flex">
                                <Building2 class="h-3 w-3 text-emerald-700" />
                                {authState.branch?.name || 'Cabang'}
                        </span>
                </div>
        </header>

        <div class="flex flex-1 items-center justify-center px-4 pb-10 pt-2 sm:px-6">
                <div class="reveal w-full max-w-lg">
                        <div class="mb-7 text-center">
                                <p class="eyebrow text-gray-400">Lapis kedua · pemegang laci</p>
                                <h1 class="mt-2 text-3xl font-semibold tracking-tight text-gray-900">Buka shift operator</h1>
                                <p class="mt-2 text-xs text-gray-500">Pilih nama Anda, masukkan PIN, lalu mulai bertransaksi.</p>
                        </div>

                        <div class="nota rounded-lg border border-gray-200/80 px-6 py-6 shadow-xl sm:px-7">
                                {#if isLoading}
                                        <div class="flex flex-col items-center gap-3 py-8">
                                                <div class="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-600"></div>
                                                <p class="eyebrow text-[10px] text-gray-400">Memuat daftar operator</p>
                                        </div>
                                {:else if operators.length === 0}
                                        <div class="py-3 text-center">
                                                <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-amber-400 text-amber-700">
                                                        <UserCircle2 class="h-6 w-6" />
                                                </div>
                                                <p class="font-display text-lg font-semibold text-gray-900">Belum ada akun kasir</p>
                                                <p class="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-gray-500">
                                                        Minta Admin menambahkan akun kasir untuk cabang ini di menu <strong class="text-gray-700">Pengguna</strong>.
                                                </p>
                                                <button type="button" onclick={releaseDevice} class="mt-5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 transition hover:text-gray-900 cursor-pointer">
                                                        <LogOut class="h-3.5 w-3.5" /> Lepas perangkat dari cabang
                                                </button>
                                        </div>
                                {:else}
                                        <form onsubmit={(e) => { e.preventDefault(); handleOpenShift(); }} class="space-y-5">
                                                <div>
                                                        <span class="eyebrow mb-2 block text-[9px] text-gray-400">Operator</span>
                                                        <div class="grid grid-cols-2 gap-2">
                                                                {#each operators as op (op.id)}
                                                                        {@const isSelected = selectedOperatorId === op.id}
                                                                        <button
                                                                                type="button"
                                                                                onclick={() => (selectedOperatorId = op.id)}
                                                                                aria-pressed={isSelected}
                                                                                class="flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition cursor-pointer {isSelected ? 'border-emerald-600 bg-emerald-50/70 shadow-xs' : 'border-gray-300 bg-white hover:border-gray-400'}"
                                                                        >
                                                                                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-gray-900 font-display text-[11px] font-semibold uppercase text-gray-100">
                                                                                        {op.name.slice(0, 2)}
                                                                                </div>
                                                                                <span class="truncate text-xs font-semibold {isSelected ? 'text-emerald-900' : 'text-gray-800'}">{op.name}</span>
                                                                        </button>
                                                                {/each}
                                                        </div>
                                                </div>

                                                <div>
                                                        <label for="operator-pin" class="eyebrow mb-1.5 block text-[9px] text-gray-400">PIN Operator</label>
                                                        <div class="relative">
                                                                <KeyRound class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                                                <input
                                                                        id="operator-pin"
                                                                        type="password"
                                                                        bind:value={pin}
                                                                        placeholder="PIN pribadi"
                                                                        class="w-full rounded-md border border-gray-300 bg-white py-2.5 pl-10 pr-3.5 font-mono text-sm tracking-[0.3em] text-gray-900 transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 focus:outline-hidden"
                                                                />
                                                        </div>
                                                </div>

                                                <div>
                                                        <label for="opening-cash" class="eyebrow mb-1.5 block text-[9px] text-gray-400">Setoran Awal (Modal Laci)</label>
                                                        <div class="relative">
                                                                <Wallet class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                                                <input
                                                                        id="opening-cash"
                                                                        type="number"
                                                                        bind:value={openingCash}
                                                                        min="0"
                                                                        class="num w-full rounded-md border border-gray-300 bg-white py-2.5 pl-10 pr-3.5 text-lg font-semibold text-gray-900 transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 focus:outline-hidden"
                                                                />
                                                        </div>
                                                        <div class="leader mt-1.5 px-0.5">
                                                                <span class="text-[11px] text-gray-400">Tercatat sebagai modal awal</span>
                                                                <span class="num text-[11px] font-medium text-gray-700">{formatRupiah(openingCash || 0)}</span>
                                                        </div>
                                                </div>

                                                {#if errorMessage}
                                                        <div class="flex items-start gap-2 border-l-2 border-rose-500 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                                                                <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
                                                                <span>{errorMessage}</span>
                                                        </div>
                                                {/if}

                                                <button
                                                        type="submit"
                                                        disabled={isSubmitting}
                                                        class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:translate-y-px disabled:opacity-60 cursor-pointer"
                                                >
                                                        <span>{isSubmitting ? 'Membuka shift...' : `Mulai Shift${selectedOperator ? ' — ' + selectedOperator.name : ''}`}</span>
                                                        <ArrowRight class="h-4 w-4" />
                                                </button>
                                        </form>

                                        <div class="mt-5 flex items-center justify-between gap-3 border-t border-dashed border-gray-200 pt-4 text-[11px]">
                                                <span class="inline-flex items-center gap-1.5 text-gray-400">
                                                        <WifiOff class="h-3.5 w-3.5" /> Mode offline tetap didukung
                                                </span>
                                                <button
                                                        type="button"
                                                        onclick={releaseDevice}
                                                        class="inline-flex items-center gap-1.5 font-semibold text-gray-500 transition hover:text-gray-900 cursor-pointer"
                                                        title="Lepas perangkat dari cabang"
                                                >
                                                        <LogOut class="h-3.5 w-3.5" /> Lepas perangkat
                                                </button>
                                        </div>
                                {/if}
                        </div>

                        {#if authState.device && selectedOperator}
                                <p class="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-gray-400">
                                        {authState.device.name} · {authState.branch?.name || 'Cabang'} · setoran {formatRupiah(openingCash || 0)}
                                </p>
                        {/if}
                </div>
        </div>
</div>
