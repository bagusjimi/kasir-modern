<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { getOpenShiftForDevice, computeShiftSummary, formatRupiah, formatDateTime, type ShiftSummary } from '../shift/index.js';
	import type { Shift, User } from '../types/index.js';
	import {
		Clock,
		Play,
		Square,
		AlertCircle,
		CheckCircle2,
		Wallet,
		TrendingUp,
		CreditCard,
		Coins,
		FileText,
		History as HistoryIcon,
		UserCircle2,
		KeyRound
	} from 'lucide-svelte';

	let openShift = $state<Shift | null>(null);
	let shiftHistory = $state<Shift[]>([]);
	let operators = $state<User[]>([]);
	let isLoading = $state<boolean>(true);

	// Form buka shift (operator + PIN)
	let isOpenModalOpen = $state<boolean>(false);
	let openingCash = $state<number>(0);
	let selectedOperatorId = $state<string>('');
	let operatorPin = $state<string>('');
	let openError = $state<string | null>(null);

	// Modal tutup shift (Z-Report)
	let isCloseModalOpen = $state<boolean>(false);
	let summary = $state<ShiftSummary | null>(null);
	let closingCash = $state<number>(0);
	let closeNote = $state<string>('');
	let closeError = $state<string | null>(null);

	let cashDifference = $derived(closingCash - (summary?.expectedCash ?? 0));
	let selectedOperator = $derived(operators.find(o => o.id === selectedOperatorId) || null);

	onMount(loadData);

	async function loadData() {
		isLoading = true;
		// Shift terikat pada PERANGKAT (toko); identitas orang ada di dalam shift.
		const deviceId = authState.device?.id || '';
		openShift = (await getOpenShiftForDevice(deviceId)) || null;
		const branchId = authState.branch?.id || authState.device?.branch_id || 'all';
		const allShifts = await db.shifts.orderBy('opened_at').reverse().limit(10).toArray();
		shiftHistory = allShifts.filter(s => s.status === 'closed' && (branchId === 'all' || s.branch_id === branchId));
		// Operator yang bisa dipilih: kasir aktif yang ditugaskan ke cabang toko ini.
		const allUsers = await db.users.toArray();
		operators = allUsers.filter(u => u.active && u.role === 'cashier' && (u.branch_id === branchId || u.branch_id === 'all'));
		isLoading = false;
	}

	async function openOpenModal() {
		await loadData();
		openingCash = 0;
		selectedOperatorId = operators[0]?.id || '';
		operatorPin = '';
		openError = null;
		isOpenModalOpen = true;
	}

	async function confirmOpenShift() {
		openError = null;
		if (!selectedOperator) {
			openError = 'Pilih operator yang memegang laci';
			return;
		}
		if (!operatorPin.trim()) {
			openError = 'Masukkan PIN operator';
			return;
		}
		if (openingCash < 0 || isNaN(openingCash)) {
			openError = 'Setoran awal tidak boleh negatif';
			return;
		}

		const res = await authState.openShift({ operator: selectedOperator, pin: operatorPin, openingCash });
		if (!res.success) {
			openError = res.message || 'Gagal membuka shift';
			return;
		}
		isOpenModalOpen = false;
		await loadData();
	}

	async function openCloseModal() {
		if (!openShift) return;
		summary = await computeShiftSummary(openShift);
		closingCash = summary.expectedCash;
		closeNote = '';
		closeError = null;
		isCloseModalOpen = true;
	}

	async function confirmCloseShift() {
		closeError = null;
		if (!openShift || !summary) return;

		if (closingCash < 0 || isNaN(closingCash)) {
			closeError = 'Uang fisik di laci tidak boleh negatif';
			return;
		}

		const now = new Date().toISOString();
		await db.shifts.update(openShift.id, {
			closed_at: now,
			closing_cash: closingCash,
			expected_cash: summary.expectedCash,
			cash_difference: cashDifference,
			total_sales: summary.totalSales,
			cash_sales: summary.cashSales,
			non_cash_sales: summary.nonCashSales,
			total_transactions: summary.totalTransactions,
			voided_count: summary.voidedCount,
			refunded_count: summary.refundedCount,
			status: 'closed',
			note: closeNote.trim() || undefined,
			updated_at: now,
			synced: false
		});

		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: openShift.branch_id,
			branch_name: openShift.branch_name,
			user_id: openShift.cashier_id,
			user_name: openShift.cashier_name,
			role: 'cashier',
			action: 'close_shift',
			details: `Shift ditutup oleh ${openShift.cashier_name}. Kas diharapkan ${formatRupiah(summary.expectedCash)}, fisik ${formatRupiah(closingCash)}, selisih ${formatRupiah(cashDifference)}.`,
			timestamp: now,
			synced: false
		});

		isCloseModalOpen = false;
		await authState.releaseOperator();
		await loadData();
	}
</script>

<div class="space-y-6">
        <div class="flex flex-col justify-between gap-4 border-b border-gray-300/70 pb-5 sm:flex-row sm:items-end">
                <div>
                        <p class="eyebrow text-gray-400">Operasional · laci kas</p>
                        <h1 class="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900">Shift kasir</h1>
                        <p class="mt-1 text-xs text-gray-500">Setoran awal, tutup shift dengan Z-Report, dan selisih kas tiap shift.</p>
                </div>
                {#if !openShift && !isLoading}
                        <button
                                onclick={openOpenModal}
                                class="inline-flex cursor-pointer items-center gap-2 self-start rounded-md bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-800 sm:self-auto"
                        >
                                <Play class="h-3.5 w-3.5" />
                                <span>Buka shift</span>
                        </button>
                {:else if openShift}
                        <button
                                onclick={openCloseModal}
                                class="inline-flex cursor-pointer items-center gap-2 self-start rounded-md border border-rose-300 bg-white px-4 py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 sm:self-auto"
                        >
                                <Square class="h-3.5 w-3.5" />
                                <span>Tutup shift</span>
                        </button>
                {/if}
        </div>

        {#if openShift}
                <div class="reveal overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xs">
                        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-gray-200 px-5 py-3.5">
                                <div class="flex flex-wrap items-center gap-3">
                                        <span class="stamp inline-flex items-center gap-1.5 px-2 py-1 text-[9px] text-emerald-800">
                                                <span class="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
                                                shift aktif
                                        </span>
                                        <span class="num text-[11px] text-gray-500">dibuka {formatDateTime(openShift.opened_at)}</span>
                                </div>
                                <span class="num text-[11px] text-gray-400">
                                        durasi
                                        <span class="font-semibold text-gray-800">
                                                {Math.max(0, Math.floor((Date.now() - new Date(openShift.opened_at).getTime()) / 60000))} menit
                                        </span>
                                </span>
                        </div>
                        <dl class="grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-gray-200">
                                <div class="border-b border-gray-100 px-5 py-4 sm:border-b-0">
                                        <dt class="eyebrow text-[9px] text-gray-400">Setoran awal</dt>
                                        <dd class="num mt-1.5 text-lg font-semibold text-gray-900">{formatRupiah(openShift.opening_cash)}</dd>
                                </div>
                                <div class="border-b border-gray-100 px-5 py-4 sm:border-b-0">
                                        <dt class="eyebrow text-[9px] text-gray-400">Kasir</dt>
                                        <dd class="mt-1.5 truncate text-sm font-semibold text-gray-900">{openShift.cashier_name}</dd>
                                </div>
                                <div class="px-5 py-4">
                                        <dt class="eyebrow text-[9px] text-gray-400">Cabang</dt>
                                        <dd class="mt-1.5 truncate text-sm font-semibold text-gray-900">{openShift.branch_name || '—'}</dd>
                                </div>
                                <div class="px-5 py-4">
                                        <dt class="eyebrow text-[9px] text-gray-400">Perangkat</dt>
                                        <dd class="mt-1.5 truncate text-sm font-semibold text-gray-900">{openShift.device_name || authState.device?.name || '—'}</dd>
                                </div>
                        </dl>
                </div>
        {:else if !isLoading}
                <div class="flex items-start gap-3 rounded-lg border border-dashed border-amber-400 bg-amber-50/70 px-5 py-4">
                        <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                        <div>
                                <p class="text-xs font-semibold text-amber-900">Belum ada shift aktif</p>
                                <p class="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                                        Buka shift dengan setoran awal sebelum memproses transaksi. POS dinonaktifkan sampai shift dibuka.
                                </p>
                        </div>
                </div>
        {/if}

        <div class="rounded-lg border border-gray-200 bg-white shadow-xs">
                <div class="flex items-center justify-between gap-3 border-b border-dashed border-gray-200 px-5 py-3.5">
                        <div class="flex items-center gap-2">
                                <HistoryIcon class="h-3.5 w-3.5 text-gray-400" />
                                <h2 class="text-base font-semibold text-gray-900">Riwayat shift</h2>
                        </div>
                        <span class="eyebrow text-[9px] text-gray-400">{shiftHistory.length} catatan</span>
                </div>
                {#if shiftHistory.length === 0}
                        <div class="px-5 py-12 text-center">
                                <Clock class="mx-auto h-8 w-8 stroke-1 text-gray-300" />
                                <p class="mt-2 text-xs text-gray-400">Belum ada riwayat shift di perangkat ini.</p>
                        </div>
                {:else}
                        <div class="overflow-x-auto">
                                <table class="w-full text-left text-xs">
                                        <thead>
                                                <tr class="border-b border-gray-900/15">
                                                        <th class="px-5 py-2.5 font-medium">Dibuka</th>
                                                        <th class="px-5 py-2.5 font-medium">Ditutup</th>
                                                        <th class="px-5 py-2.5 font-medium">Setoran awal</th>
                                                        <th class="px-5 py-2.5 font-medium">Penjualan</th>
                                                        <th class="px-5 py-2.5 font-medium">Kas diharapkan</th>
                                                        <th class="px-5 py-2.5 text-right font-medium">Selisih</th>
                                                </tr>
                                        </thead>
                                        <tbody class="divide-y divide-gray-100">
                                                {#each shiftHistory as sh}
                                                        <tr class="transition hover:bg-gray-50">
                                                                <td class="num whitespace-nowrap px-5 py-3 text-gray-600">{formatDateTime(sh.opened_at)}</td>
                                                                <td class="num whitespace-nowrap px-5 py-3 text-gray-600">{sh.closed_at ? formatDateTime(sh.closed_at) : '—'}</td>
                                                                <td class="num px-5 py-3 text-gray-700">{formatRupiah(sh.opening_cash)}</td>
                                                                <td class="num px-5 py-3 font-semibold text-gray-900">{formatRupiah(sh.total_sales || 0)}</td>
                                                                <td class="num px-5 py-3 text-gray-700">{formatRupiah(sh.expected_cash || 0)}</td>
                                                                <td class="num px-5 py-3 text-right font-semibold {(sh.cash_difference || 0) === 0 ? 'text-gray-400' : 'text-rose-700'}">
                                                                        {(sh.cash_difference || 0) > 0 ? '+' : ''}{formatRupiah(sh.cash_difference || 0)}
                                                                </td>
                                                        </tr>
                                                {/each}
                                        </tbody>
                                </table>
                        </div>
                {/if}
        </div>
</div>

<!-- Modal Buka Shift -->
{#if isOpenModalOpen}
        <div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-xs">
                <div class="nota relative my-8 w-full max-w-md rounded-sm border border-gray-300 p-6 shadow-2xl">
                        <div class="flex items-start justify-between gap-3 border-b border-dashed border-gray-300 pb-3">
                                <div>
                                        <p class="eyebrow text-[9px] text-gray-400">Mulai sesi</p>
                                        <h2 class="mt-1 text-xl font-semibold tracking-tight text-gray-900">Buka shift baru</h2>
                                </div>
                                <Play class="mt-1 h-4 w-4 shrink-0 text-emerald-700" />
                        </div>

                        <div class="mt-4 space-y-4">
                                <div>
                                        <label for="operatorSelect" class="eyebrow block text-[9px] text-gray-400">Operator pemegang laci</label>
                                        <div class="relative mt-1">
                                                <UserCircle2 class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                                                <select
                                                        id="operatorSelect"
                                                        bind:value={selectedOperatorId}
                                                        class="w-full cursor-pointer rounded-sm border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm font-medium text-gray-900 transition focus:border-emerald-600 focus:outline-hidden"
                                                >
                                                        {#if operators.length === 0}
                                                                <option value="">Belum ada akun kasir di cabang ini</option>
                                                        {:else}
                                                                {#each operators as op}
                                                                        <option value={op.id}>{op.name}</option>
                                                                {/each}
                                                        {/if}
                                                </select>
                                        </div>
                                        <p class="mt-1 text-[10px] leading-relaxed text-gray-400">Admin dapat menambah akun kasir di menu Pengguna.</p>
                                </div>

                                <div>
                                        <label for="operatorPin" class="eyebrow block text-[9px] text-gray-400">PIN operator</label>
                                        <div class="relative mt-1">
                                                <KeyRound class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                                                <input
                                                        id="operatorPin"
                                                        type="password"
                                                        bind:value={operatorPin}
                                                        placeholder="••••"
                                                        class="num w-full rounded-sm border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm tracking-[0.4em] transition focus:border-emerald-600 focus:outline-hidden"
                                                />
                                        </div>
                                        <p class="mt-1 text-[10px] leading-relaxed text-gray-400">PIN menandai siapa yang bertanggung jawab atas kas selama shift.</p>
                                </div>

                                <div>
                                        <label for="openingCash" class="eyebrow block text-[9px] text-gray-400">Setoran awal (modal laci)</label>
                                        <div class="relative mt-1">
                                                <span class="num absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">Rp</span>
                                                <input
                                                        id="openingCash"
                                                        type="number"
                                                        bind:value={openingCash}
                                                        min="0"
                                                        class="num w-full rounded-sm border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-lg font-semibold text-gray-900 transition focus:border-emerald-600 focus:outline-hidden"
                                                />
                                        </div>
                                </div>

                                {#if openError}
                                        <div class="flex items-center gap-2 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                                                <AlertCircle class="h-4 w-4 shrink-0" />
                                                <span>{openError}</span>
                                        </div>
                                {/if}
                        </div>

                        <div class="mt-5 flex items-center justify-end gap-2 border-t border-dashed border-gray-300 pt-4">
                                <button
                                        onclick={() => (isOpenModalOpen = false)}
                                        class="cursor-pointer rounded-md border border-gray-300 px-4 py-2.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                                >
                                        Batal
                                </button>
                                <button
                                        onclick={confirmOpenShift}
                                        class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-emerald-700 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-800"
                                >
                                        <CheckCircle2 class="h-3.5 w-3.5" />
                                        <span>Buka shift</span>
                                </button>
                        </div>
                </div>
        </div>
{/if}

<!-- Modal Tutup Shift (Z-Report) -->
{#if isCloseModalOpen && openShift && summary}
        <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-xs sm:items-center">
                <div class="nota relative my-8 w-full max-w-lg rounded-sm border border-gray-300 p-6 shadow-2xl">
                        <div class="flex items-start justify-between gap-3 border-b border-dashed border-gray-300 pb-3">
                                <div>
                                        <p class="eyebrow text-[9px] text-gray-400">Z-Report</p>
                                        <h2 class="mt-1 text-xl font-semibold tracking-tight text-gray-900">Tutup shift</h2>
                                </div>
                                <span class="stamp shrink-0 px-2 py-1 text-[9px] text-rose-700">kas akhir</span>
                        </div>

                        <p class="mt-3 num text-[11px] leading-relaxed text-gray-500">
                                {openShift.cashier_name} · {openShift.branch_name || '—'}<br />
                                dibuka {formatDateTime(openShift.opened_at)}
                        </p>

                        <!-- Ringkasan penjualan -->
                        <div class="mt-4 space-y-2 text-xs">
                                <div class="leader text-gray-600">
                                        <span>Total penjualan</span>
                                        <span class="num font-semibold text-gray-900">{formatRupiah(summary.totalSales)}</span>
                                </div>
                                <div class="leader text-gray-600">
                                        <span>Penjualan tunai</span>
                                        <span class="num text-gray-800">{formatRupiah(summary.cashSales)}</span>
                                </div>
                                <div class="leader text-gray-600">
                                        <span>Non-tunai</span>
                                        <span class="num text-gray-800">{formatRupiah(summary.nonCashSales)}</span>
                                </div>
                                <p class="num pt-1 text-[10px] text-gray-400">{summary.totalTransactions} transaksi selesai</p>
                        </div>

                        <!-- Rincian kas -->
                        <div class="mt-4 border-y border-dashed border-gray-300 py-3">
                                <div class="space-y-2 text-xs">
                                        <div class="leader text-gray-600">
                                                <span>Setoran awal</span>
                                                <span class="num text-gray-800">{formatRupiah(openShift.opening_cash)}</span>
                                        </div>
                                        <div class="leader text-gray-600">
                                                <span>+ Penjualan tunai</span>
                                                <span class="num text-emerald-800">{formatRupiah(summary.cashSales)}</span>
                                        </div>
                                        <div class="leader text-gray-600">
                                                <span>− Retur tunai</span>
                                                <span class="num text-rose-700">{formatRupiah(summary.refundedCash)}</span>
                                        </div>
                                </div>
                                <div class="mt-3 flex items-baseline justify-between gap-3 border-t border-gray-900/70 pt-2">
                                        <span class="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">Kas seharusnya</span>
                                        <span class="num text-lg font-semibold text-gray-900">{formatRupiah(summary.expectedCash)}</span>
                                </div>
                        </div>

                        <div class="mt-3 grid grid-cols-2 gap-3 text-xs">
                                <div class="rounded-sm border border-gray-200 px-3 py-2">
                                        <p class="eyebrow flex items-center gap-1 text-[9px] text-gray-400">
                                                <CreditCard class="h-3 w-3" /> void / retur
                                        </p>
                                        <p class="num mt-1 font-semibold text-gray-800">{summary.voidedCount} void · {summary.refundedCount} retur</p>
                                </div>
                                <div class="rounded-sm border border-gray-200 px-3 py-2">
                                        <p class="eyebrow flex items-center gap-1 text-[9px] text-gray-400">
                                                <Coins class="h-3 w-3" /> selisih otomatis
                                        </p>
                                        <p class="num mt-1 font-semibold {cashDifference === 0 ? 'text-emerald-800' : 'text-rose-700'}">
                                                {cashDifference > 0 ? '+' : ''}{formatRupiah(cashDifference)}
                                        </p>
                                </div>
                        </div>

                        <div class="mt-4 space-y-3">
                                <div>
                                        <label for="closingCash" class="eyebrow block text-[9px] text-gray-400">Uang fisik di laci</label>
                                        <div class="relative mt-1">
                                                <span class="num absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">Rp</span>
                                                <input
                                                        id="closingCash"
                                                        type="number"
                                                        bind:value={closingCash}
                                                        min="0"
                                                        class="num w-full rounded-sm border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-lg font-semibold text-gray-900 transition focus:border-rose-500 focus:outline-hidden"
                                                />
                                        </div>
                                </div>
                                <div>
                                        <label for="closeNote" class="eyebrow block text-[9px] text-gray-400">Catatan (opsional)</label>
                                        <input
                                                id="closeNote"
                                                type="text"
                                                bind:value={closeNote}
                                                placeholder="Contoh: selisih karena kembalian kurang Rp 500"
                                                class="mt-1 w-full rounded-sm border border-gray-300 bg-white px-3 py-2 text-xs transition focus:border-emerald-600 focus:outline-hidden"
                                        />
                                </div>

                                {#if closeError}
                                        <div class="flex items-center gap-2 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                                                <AlertCircle class="h-4 w-4 shrink-0" />
                                                <span>{closeError}</span>
                                        </div>
                                {/if}
                        </div>

                        <div class="mt-5 flex items-center justify-end gap-2 border-t border-dashed border-gray-300 pt-4">
                                <button
                                        onclick={() => (isCloseModalOpen = false)}
                                        class="cursor-pointer rounded-md border border-gray-300 px-4 py-2.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                                >
                                        Batal
                                </button>
                                <button
                                        onclick={confirmCloseShift}
                                        class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-rose-600 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-rose-700"
                                >
                                        <Square class="h-3.5 w-3.5" />
                                        <span>Tutup shift</span>
                                </button>
                        </div>
                </div>
        </div>
{/if}
