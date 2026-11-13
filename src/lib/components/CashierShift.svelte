<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import { getOpenShift, computeShiftSummary, formatRupiah, formatDateTime, type ShiftSummary } from '../shift/index.js';
	import type { Shift } from '../types/index.js';
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
		History as HistoryIcon
	} from 'lucide-svelte';

	let openShift = $state<Shift | null>(null);
	let shiftHistory = $state<Shift[]>([]);
	let isLoading = $state<boolean>(true);

	// Form buka shift
	let isOpenModalOpen = $state<boolean>(false);
	let openingCash = $state<number>(0);
	let openError = $state<string | null>(null);

	// Modal tutup shift (Z-Report)
	let isCloseModalOpen = $state<boolean>(false);
	let summary = $state<ShiftSummary | null>(null);
	let closingCash = $state<number>(0);
	let closeNote = $state<string>('');
	let closeError = $state<string | null>(null);

	let cashDifference = $derived(closingCash - (summary?.expectedCash ?? 0));

	onMount(loadData);

	async function loadData() {
		isLoading = true;
		const cashierId = authState.user?.id || '';
		openShift = (await getOpenShift(cashierId)) || null;
		shiftHistory = (await db.shifts.orderBy('opened_at').reverse().limit(10).toArray())
			.filter(s => s.status === 'closed');
		isLoading = false;
	}

	function openOpenModal() {
		openingCash = 0;
		openError = null;
		isOpenModalOpen = true;
	}

	async function confirmOpenShift() {
		openError = null;
		if (openingCash < 0 || isNaN(openingCash)) {
			openError = 'Setoran awal tidak boleh negatif';
			return;
		}

		const existing = await getOpenShift(authState.user?.id || '');
		if (existing) {
			openError = 'Masih ada shift yang terbuka. Tutup shift tersebut terlebih dahulu.';
			return;
		}

		const now = new Date().toISOString();
		const shift: Shift = {
			id: 'sh-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: authState.branch?.id || authState.user?.branch_id || 'all',
			branch_name: authState.branch?.name,
			cashier_id: authState.user?.id || '-',
			cashier_name: authState.user?.name || 'Kasir',
			opening_cash: openingCash,
			opened_at: now,
			status: 'open',
			updated_at: now,
			synced: false
		};

		await db.shifts.add(shift);

		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: shift.branch_id,
			branch_name: shift.branch_name,
			user_id: shift.cashier_id,
			user_name: shift.cashier_name,
			role: 'cashier',
			action: 'open_shift',
			details: `Shift dibuka dengan setoran awal ${formatRupiah(openingCash)}.`,
			timestamp: now,
			synced: false
		});

		isOpenModalOpen = false;
		await syncEngine.updatePendingCount();
		await loadData();

		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
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
			details: `Shift ditutup. Kas diharapkan ${formatRupiah(summary.expectedCash)}, fisik ${formatRupiah(closingCash)}, selisih ${formatRupiah(cashDifference)}.`,
			timestamp: now,
			synced: false
		});

		isCloseModalOpen = false;
		await syncEngine.updatePendingCount();
		await loadData();

		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-black text-zinc-900 flex items-center gap-2">
				<Clock class="h-5 w-5 text-emerald-600" />
				Shift Kasir
			</h1>
			<p class="text-xs text-zinc-500 mt-0.5">Kelola setoran awal, tutup shift dengan Z-Report, dan pantau selisih kas.</p>
		</div>
		{#if !openShift && !isLoading}
			<button
				onclick={openOpenModal}
				class="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-600/30 transition cursor-pointer"
			>
				<Play class="h-4 w-4" />
				<span>Buka Shift</span>
			</button>
		{:else if openShift}
			<button
				onclick={openCloseModal}
				class="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-rose-600/30 transition cursor-pointer"
			>
				<Square class="h-4 w-4" />
				<span>Tutup Shift</span>
			</button>
		{/if}
	</div>

	<!-- Kartu Shift Aktif -->
	{#if openShift}
		<div class="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
			<div class="flex items-center gap-2 mb-3">
				<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white">
					<span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
					SHIFT AKTIF
				</span>
				<span class="text-xs text-zinc-500">Dibuka {formatDateTime(openShift.opened_at)}</span>
			</div>
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<div class="rounded-xl bg-white p-3 border border-emerald-100">
					<p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Setoran Awal</p>
					<p class="text-sm font-black text-zinc-900 mt-1">{formatRupiah(openShift.opening_cash)}</p>
				</div>
				<div class="rounded-xl bg-white p-3 border border-emerald-100">
					<p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Kasir</p>
					<p class="text-sm font-black text-zinc-900 mt-1 truncate">{openShift.cashier_name}</p>
				</div>
				<div class="rounded-xl bg-white p-3 border border-emerald-100">
					<p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Cabang</p>
					<p class="text-sm font-black text-zinc-900 mt-1 truncate">{openShift.branch_name || '-'}</p>
				</div>
				<div class="rounded-xl bg-white p-3 border border-emerald-100">
					<p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Durasi</p>
					<p class="text-sm font-black text-emerald-700 mt-1">
						{Math.max(0, Math.floor((Date.now() - new Date(openShift.opened_at).getTime()) / 60000))} menit
					</p>
				</div>
			</div>
		</div>
	{:else if !isLoading}
		<div class="rounded-2xl border border-amber-200 bg-amber-50 p-5 flex items-start gap-3">
			<AlertCircle class="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
			<div>
				<p class="text-sm font-bold text-amber-800">Belum ada shift aktif</p>
				<p class="text-xs text-amber-700 mt-0.5">Buka shift dengan setoran awal sebelum memproses transaksi kasir. Transaksi POS dinonaktifkan sampai shift dibuka.</p>
			</div>
		</div>
	{/if}

	<!-- Riwayat Shift -->
	<div class="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
		<div class="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-100 bg-zinc-50/70">
			<HistoryIcon class="h-4 w-4 text-zinc-400" />
			<h2 class="text-sm font-bold text-zinc-800">Riwayat Shift</h2>
		</div>
		{#if shiftHistory.length === 0}
			<div class="p-8 text-center text-zinc-400">
				<Clock class="h-10 w-10 mx-auto mb-2 stroke-1" />
				<p class="text-sm font-medium">Belum ada riwayat shift</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-left text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
							<th class="px-5 py-2.5 font-semibold">Dibuka</th>
							<th class="px-5 py-2.5 font-semibold">Ditutup</th>
							<th class="px-5 py-2.5 font-semibold">Setoran Awal</th>
							<th class="px-5 py-2.5 font-semibold">Penjualan</th>
							<th class="px-5 py-2.5 font-semibold">Kas Diharapkan</th>
							<th class="px-5 py-2.5 font-semibold">Selisih</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-zinc-100">
						{#each shiftHistory as sh}
							<tr class="hover:bg-zinc-50/60">
								<td class="px-5 py-3 text-zinc-700 whitespace-nowrap">{formatDateTime(sh.opened_at)}</td>
								<td class="px-5 py-3 text-zinc-700 whitespace-nowrap">{sh.closed_at ? formatDateTime(sh.closed_at) : '-'}</td>
								<td class="px-5 py-3 text-zinc-700">{formatRupiah(sh.opening_cash)}</td>
								<td class="px-5 py-3 text-zinc-900 font-semibold">{formatRupiah(sh.total_sales || 0)}</td>
								<td class="px-5 py-3 text-zinc-700">{formatRupiah(sh.expected_cash || 0)}</td>
								<td class="px-5 py-3 font-bold {(sh.cash_difference || 0) === 0 ? 'text-emerald-600' : 'text-rose-600'}">
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
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center gap-2 border-b border-zinc-100 pb-3 mb-4">
				<Play class="h-5 w-5 text-emerald-600" />
				<h3 class="text-lg font-bold text-zinc-900">Buka Shift Baru</h3>
			</div>

			<div class="space-y-4">
				<div>
					<label for="openingCash" class="block text-xs font-semibold text-zinc-700 mb-1">Setoran Awal (Modal Laci)</label>
					<input
						id="openingCash"
						type="number"
						bind:value={openingCash}
						min="0"
						class="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-lg font-bold text-zinc-900 focus:outline-hidden focus:border-emerald-500"
					/>
					<p class="text-[11px] text-zinc-400 mt-1">Masukkan jumlah uang fisik yang disetor ke laci kasir saat membuka shift.</p>
				</div>

				{#if openError}
					<div class="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
						<AlertCircle class="h-4 w-4 shrink-0" />
						<span>{openError}</span>
					</div>
				{/if}
			</div>

			<div class="flex items-center justify-end gap-3 pt-4">
				<button
					onclick={() => isOpenModalOpen = false}
					class="px-4 py-2.5 rounded-xl border border-zinc-300 text-zinc-700 hover:bg-zinc-50 text-sm font-semibold transition"
				>
					Batal
				</button>
				<button
					onclick={confirmOpenShift}
					class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-md shadow-emerald-600/30 transition cursor-pointer"
				>
					<CheckCircle2 class="h-4 w-4" />
					<span>Buka Shift</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Tutup Shift (Z-Report) -->
{#if isCloseModalOpen && openShift && summary}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto">
		<div class="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl my-8">
			<div class="flex items-center gap-2 border-b border-zinc-100 pb-3 mb-4">
				<FileText class="h-5 w-5 text-rose-600" />
				<h3 class="text-lg font-bold text-zinc-900">Z-Report: Tutup Shift</h3>
			</div>

			<!-- Ringkasan Penjualan -->
			<div class="grid grid-cols-2 gap-3 mb-4">
				<div class="rounded-xl bg-zinc-50 border border-zinc-200 p-3">
					<p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-1">
						<TrendingUp class="h-3 w-3" /> Total Penjualan
					</p>
					<p class="text-base font-black text-zinc-900 mt-1">{formatRupiah(summary.totalSales)}</p>
					<p class="text-[10px] text-zinc-400">{summary.totalTransactions} transaksi selesai</p>
				</div>
				<div class="rounded-xl bg-zinc-50 border border-zinc-200 p-3">
					<p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-1">
						<Wallet class="h-3 w-3" /> Penjualan Tunai
					</p>
					<p class="text-base font-black text-zinc-900 mt-1">{formatRupiah(summary.cashSales)}</p>
					<p class="text-[10px] text-zinc-400">Non-tunai: {formatRupiah(summary.nonCashSales)}</p>
				</div>
			</div>

			<!-- Rincian Kas -->
			<div class="rounded-xl border border-zinc-200 divide-y divide-zinc-100 mb-4 text-sm">
				<div class="flex justify-between px-4 py-2.5 text-zinc-600">
					<span>Setoran awal</span>
					<span class="font-semibold text-zinc-900">{formatRupiah(openShift.opening_cash)}</span>
				</div>
				<div class="flex justify-between px-4 py-2.5 text-zinc-600">
					<span>+ Penjualan tunai</span>
					<span class="font-semibold text-emerald-700">{formatRupiah(summary.cashSales)}</span>
				</div>
				<div class="flex justify-between px-4 py-2.5 text-zinc-600">
					<span>- Retur tunai</span>
					<span class="font-semibold text-rose-600">{formatRupiah(summary.refundedCash)}</span>
				</div>
				<div class="flex justify-between px-4 py-2.5 bg-emerald-50/60">
					<span class="font-bold text-zinc-800">Kas seharusnya di laci</span>
					<span class="font-black text-emerald-700">{formatRupiah(summary.expectedCash)}</span>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3 mb-4 text-xs">
				<div class="rounded-xl bg-zinc-50 border border-zinc-200 p-3">
					<p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-1">
						<CreditCard class="h-3 w-3" /> Void / Retur
					</p>
					<p class="text-sm font-bold text-zinc-800 mt-1">{summary.voidedCount} void, {summary.refundedCount} retur</p>
				</div>
				<div class="rounded-xl bg-zinc-50 border border-zinc-200 p-3">
					<p class="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-1">
						<Coins class="h-3 w-3" /> Selisih (Otomatis)
					</p>
					<p class="text-sm font-black {(cashDifference) === 0 ? 'text-emerald-600' : 'text-rose-600'} mt-1">
						{cashDifference > 0 ? '+' : ''}{formatRupiah(cashDifference)}
					</p>
				</div>
			</div>

			<div class="space-y-3">
				<div>
					<label for="closingCash" class="block text-xs font-semibold text-zinc-700 mb-1">Uang Fisik Dihitung di Laci</label>
					<input
						id="closingCash"
						type="number"
						bind:value={closingCash}
						min="0"
						class="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-lg font-bold text-zinc-900 focus:outline-hidden focus:border-rose-500"
					/>
				</div>
				<div>
					<label for="closeNote" class="block text-xs font-semibold text-zinc-700 mb-1">Catatan (opsional)</label>
					<input
						id="closeNote"
						type="text"
						bind:value={closeNote}
						placeholder="Contoh: selisih karena kembalian kurang Rp 500"
						class="w-full px-3.5 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-hidden focus:border-emerald-500"
					/>
				</div>

				{#if closeError}
					<div class="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
						<AlertCircle class="h-4 w-4 shrink-0" />
						<span>{closeError}</span>
					</div>
				{/if}
			</div>

			<div class="flex items-center justify-end gap-3 pt-4">
				<button
					onclick={() => isCloseModalOpen = false}
					class="px-4 py-2.5 rounded-xl border border-zinc-300 text-zinc-700 hover:bg-zinc-50 text-sm font-semibold transition"
				>
					Batal
				</button>
				<button
					onclick={confirmCloseShift}
					class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold shadow-md shadow-rose-600/30 transition cursor-pointer"
				>
					<Square class="h-4 w-4" />
					<span>Tutup Shift</span>
				</button>
			</div>
		</div>
	</div>
{/if}
