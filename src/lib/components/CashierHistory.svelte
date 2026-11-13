<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Transaction, TransactionAdjustmentType } from '../types/index.js';
	import ReceiptModal from './ReceiptModal.svelte';
	import {
		Search,
		Receipt,
		Printer,
		Calendar,
		DollarSign,
		CheckCircle2,
		Clock,
		Ban,
		Undo2,
		AlertCircle,
		X
	} from 'lucide-svelte';

	let transactions = $state<Transaction[]>([]);
	let searchQuery = $state<string>('');
	let selectedDate = $state<string>(new Date().toISOString().slice(0, 10));
	let selectedTx = $state<Transaction | null>(null);

	// Modal Pembatalan / Retur
	let isAdjustModalOpen = $state<boolean>(false);
	let adjustType = $state<TransactionAdjustmentType>('void');
	let adjustTx = $state<Transaction | null>(null);
	let adjustReason = $state<string>('');
	let adjustError = $state<string | null>(null);

	onMount(async () => {
		await loadHistory();
	});

	async function loadHistory() {
		const branchId = authState.branch?.id || 'cb-01';
		const allTx = await db.transactions
			.where('branch_id')
			.equals(branchId)
			.reverse()
			.sortBy('created_at');

		transactions = allTx;
	}

	let filteredTransactions = $derived(
		transactions.filter(tx => {
			const dateMatch = !selectedDate || tx.created_at.startsWith(selectedDate);
			const searchMatch =
				searchQuery.trim() === '' ||
				tx.invoice_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
				(tx.customer_name && tx.customer_name.toLowerCase().includes(searchQuery.toLowerCase()));
			return dateMatch && searchMatch;
		})
	);

	let dailyTotal = $derived(
		filteredTransactions.reduce((sum, tx) => sum + (tx.status === 'completed' ? tx.total : 0), 0)
	);

	function formatRupiah(num: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(num);
	}

	function openAdjustModal(tx: Transaction, type: TransactionAdjustmentType) {
		adjustType = type;
		adjustTx = tx;
		adjustReason = '';
		adjustError = null;
		isAdjustModalOpen = true;
	}

	async function confirmAdjust() {
		if (!adjustTx) return;
		if (!adjustReason.trim()) {
			adjustError = 'Alasan wajib diisi';
			return;
		}

		const tx = adjustTx;
		const type = adjustType;
		const now = new Date().toISOString();
		const user = authState.user;
		const newStatus = type === 'void' ? 'voided' : 'refunded';
		const actionLabel = type === 'void' ? 'dibatalkan' : 'diretur';

		// 1. Ubah status transaksi lokal
		await db.transactions.update(tx.id, {
			status: newStatus,
			void_reason: adjustReason.trim(),
			voided_at: now,
			voided_by: user?.id || '',
			voided_by_name: user?.name || '',
			synced: false
		});

		// 2. Kembalikan stok produk lokal + catat ledger stok
		for (const item of tx.items) {
			if (!item.product_id) continue;
			const prod = await db.products.get(item.product_id);
			if (prod) {
				await db.products.update(prod.id, {
					stock: prod.stock + item.quantity,
					updated_at: now
				});
			}
			await db.stock_movements.put({
				id: `mv-${type}-${tx.id}-${item.id}`,
				branch_id: tx.branch_id,
				product_id: item.product_id,
				quantity: item.quantity,
				type,
				reference_id: tx.id,
				reason: adjustReason.trim(),
				user_id: user?.id || '',
				user_name: user?.name || '',
				created_at: now,
				synced: false
			});
		}

		// 3. Catat penyesuaian transaksi
		await db.transaction_adjustments.put({
			id: `adj-${tx.id}`,
			transaction_id: tx.id,
			type,
			reason: adjustReason.trim(),
			user_id: user?.id || '',
			user_name: user?.name || '',
			branch_id: tx.branch_id,
			created_at: now,
			synced: false
		});

		// 4. Log aktivitas
		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: tx.branch_id,
			branch_name: tx.branch_name,
			user_id: user?.id || '',
			user_name: user?.name || 'Kasir',
			role: 'cashier',
			action: type === 'void' ? 'void_transaction' : 'return_transaction',
			details: `Transaksi ${tx.invoice_no} ${actionLabel}: ${adjustReason.trim()}`,
			timestamp: now,
			synced: false
		});

		// 5. Antrean sinkronisasi ke server
		await db.sync_queue.add({
			id: 'sq-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			entity: 'transaction_adjustment',
			action: 'insert',
			data: {
				id: `adj-${tx.id}`,
				transaction_id: tx.id,
				type,
				reason: adjustReason.trim(),
				user_id: user?.id || '',
				user_name: user?.name || '',
				branch_id: tx.branch_id,
				created_at: now
			},
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});

		await syncEngine.updatePendingCount();
		await loadHistory();
		isAdjustModalOpen = false;
		adjustTx = null;

		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
	}
</script>

<div class="space-y-6">
	<!-- Summary Card & Filter Bar -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
		<div class="bg-gradient-to-tr from-emerald-600 to-teal-600 rounded-2xl p-5 text-white shadow-lg shadow-emerald-600/20">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-emerald-100">Total Omset Hari Ini</p>
				<DollarSign class="h-5 w-5 text-emerald-200" />
			</div>
			<p class="text-2xl font-black mt-2">{formatRupiah(dailyTotal)}</p>
			<p class="text-[11px] text-emerald-100 mt-1">{filteredTransactions.length} transaksi selesai</p>
		</div>

		<div class="md:col-span-2 bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
			<div class="w-full sm:w-auto">
				<label for="filterDate" class="block text-xs font-semibold text-gray-600 mb-1">Pilih Tanggal</label>
				<div class="relative">
					<Calendar class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
					<input
						id="filterDate"
						type="date"
						bind:value={selectedDate}
						class="pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 focus:outline-hidden focus:border-emerald-500"
					/>
				</div>
			</div>

			<div class="w-full sm:flex-1">
				<label for="searchInvoice" class="block text-xs font-semibold text-gray-600 mb-1">Pencarian Nota</label>
				<div class="relative">
					<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
					<input
						id="searchInvoice"
						type="text"
						bind:value={searchQuery}
						placeholder="Cari No. Invoice / Pelanggan..."
						class="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-hidden focus:border-emerald-500"
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- Tabel Riwayat -->
	<div class="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
		<div class="p-4 border-b border-gray-100 flex items-center justify-between">
			<h3 class="font-bold text-gray-900 text-sm">Daftar Transaksi Kasir</h3>
			<span class="text-xs text-gray-500">Cabang: {authState.branch?.name || 'Utama'}</span>
		</div>

		<div class="overflow-x-auto">
			<table class="w-full text-left text-xs">
				<thead class="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-100">
					<tr>
						<th class="px-5 py-3.5">No. Invoice</th>
						<th class="px-5 py-3.5">Waktu</th>
						<th class="px-5 py-3.5">Kasir</th>
						<th class="px-5 py-3.5">Item</th>
						<th class="px-5 py-3.5">Metode</th>
						<th class="px-5 py-3.5">Total Belanja</th>
						<th class="px-5 py-3.5">Status Sync</th>
						<th class="px-5 py-3.5 text-right">Aksi</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100 font-medium text-gray-700">
					{#if filteredTransactions.length === 0}
						<tr>
							<td colspan="8" class="px-5 py-12 text-center text-gray-400">
								<Receipt class="h-10 w-10 mx-auto mb-2 text-gray-300 stroke-1" />
								Belum ada transaksi pada tanggal atau kata kunci ini.
							</td>
						</tr>
					{:else}
						{#each filteredTransactions as tx}
							<tr class="hover:bg-gray-50/60 transition">
								<td class="px-5 py-3.5">
									<div class="font-bold text-gray-900 font-mono">{tx.invoice_no}</div>
									{#if tx.customer_name}
										<div class="text-[11px] text-gray-400">Pelanggan: {tx.customer_name}</div>
									{/if}
								</td>
								<td class="px-5 py-3.5 text-gray-500">
									{new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
								</td>
								<td class="px-5 py-3.5">{tx.cashier_name}</td>
								<td class="px-5 py-3.5">{tx.items.length} macam item</td>
								<td class="px-5 py-3.5">
									<span class="uppercase font-semibold text-[10px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-700">
										{tx.payment_method}
									</span>
								</td>
								<td class="px-5 py-3.5">
									{#if tx.status === 'voided'}
										<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
											<Ban class="h-3 w-3" /> Dibatalkan
										</span>
									{:else if tx.status === 'refunded'}
										<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
											<Undo2 class="h-3 w-3" /> Retur
										</span>
									{:else}
										<span class="font-bold text-emerald-700">{formatRupiah(tx.total)}</span>
									{/if}
								</td>
								<td class="px-5 py-3.5">
									{#if tx.synced}
										<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
											<CheckCircle2 class="h-3 w-3" /> Cloud
										</span>
									{:else}
										<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
											<Clock class="h-3 w-3" /> Lokal
										</span>
									{/if}
								</td>
								<td class="px-5 py-3.5 text-right whitespace-nowrap">
									<button
										onclick={() => selectedTx = tx}
										class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 font-semibold transition cursor-pointer"
										title="Lihat / Cetak Ulang Nota"
									>
										<Printer class="h-3.5 w-3.5" />
										<span>Cetak</span>
									</button>
									{#if tx.status === 'completed'}
										<button
											onclick={() => openAdjustModal(tx, 'return')}
											class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 font-semibold transition cursor-pointer"
											title="Retur Transaksi (stok dikembalikan)"
										>
											<Undo2 class="h-3.5 w-3.5" />
											<span>Retur</span>
										</button>
										<button
											onclick={() => openAdjustModal(tx, 'void')}
											class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold transition cursor-pointer"
											title="Batalkan Transaksi (stok dikembalikan)"
										>
											<Ban class="h-3.5 w-3.5" />
											<span>Batal</span>
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>

<ReceiptModal
	transaction={selectedTx}
	onClose={() => selectedTx = null}
/>

<!-- Modal Pembatalan / Retur -->
{#if isAdjustModalOpen && adjustTx}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center gap-3 mb-3">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl {adjustType === 'void' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}">
					{#if adjustType === 'void'}
						<Ban class="h-5 w-5" />
					{:else}
						<Undo2 class="h-5 w-5" />
					{/if}
				</div>
				<div>
					<h3 class="text-base font-bold text-gray-900">
						{adjustType === 'void' ? 'Batalkan Transaksi?' : 'Retur Transaksi?'}
					</h3>
					<p class="text-xs text-gray-500">Stok akan dikembalikan otomatis</p>
				</div>
			</div>

			<div class="my-4 rounded-xl bg-gray-50 p-3 border border-gray-100 text-xs space-y-1">
				<div class="font-bold text-gray-800 font-mono">{adjustTx.invoice_no}</div>
				<div class="text-gray-500">Total: <span class="font-bold text-gray-700">{formatRupiah(adjustTx.total)}</span> • {adjustTx.items.length} macam item</div>
			</div>

			<div class="mb-4">
				<label for="adjustReason" class="block text-xs font-semibold text-gray-700 mb-1">
					Alasan {adjustType === 'void' ? 'Pembatalan' : 'Retur'} (Wajib)
				</label>
				<textarea
					id="adjustReason"
					bind:value={adjustReason}
					placeholder={adjustType === 'void' ? 'Contoh: Salah input kasir, transaksi ganda' : 'Contoh: Produk rusak/cacat, salah beli pelanggan'}
					rows="3"
					class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-hidden focus:border-emerald-500"
				></textarea>
			</div>

			{#if adjustError}
				<div class="flex items-center gap-1.5 p-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-medium mb-4">
					<AlertCircle class="h-4 w-4 shrink-0" />
					<span>{adjustError}</span>
				</div>
			{/if}

			<div class="flex items-center justify-end gap-2">
				<button
					onclick={() => { isAdjustModalOpen = false; adjustTx = null; }}
					class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-xs cursor-pointer"
				>
					Kembali
				</button>
				<button
					onclick={confirmAdjust}
					class="px-5 py-2 rounded-xl {adjustType === 'void' ? 'bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/20' : 'bg-amber-500 hover:bg-amber-600 shadow-md shadow-amber-500/20'} text-white font-bold text-xs transition cursor-pointer"
				>
					{adjustType === 'void' ? 'Batalkan Transaksi' : 'Proses Retur'}
				</button>
			</div>
		</div>
	</div>
{/if}

