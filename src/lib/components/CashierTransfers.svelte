<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.svelte.js';
	import { formatDateTime } from '../shift/index.js';
	import type { Product, Branch, StockTransfer, StockTransferItem, StockTransferStatus } from '../types/index.js';
	import type { StoreSettings } from '../types/index.js';
	import {
		ArrowLeftRight,
		Plus,
		Trash2,
		AlertCircle,
		Package,
		Send,
		XCircle,
		Clock,
		Printer,
		FileText
	} from 'lucide-svelte';

	let products = $state<Product[]>([]);
	let branches = $state<Branch[]>([]);
	let transfers = $state<StockTransfer[]>([]);
	let isLoading = $state<boolean>(true);

	// Tab: keluar (sumber) / masuk (tujuan)
	let activeView = $state<'keluar' | 'masuk'>('keluar');

	// Form transfer baru
	let isFormOpen = $state<boolean>(false);
	let toBranchId = $state<string>('');
	let transferNote = $state<string>('');
	let formError = $state<string | null>(null);

	interface DraftRow {
		product_id: string;
		quantity: number;
	}

	let draftRows = $state<DraftRow[]>([]);

	// Modal konfirmasi batal
	let isCancelOpen = $state<boolean>(false);
	let cancelTransfer = $state<StockTransfer | null>(null);

	// Modal detail item
	let isDetailOpen = $state<boolean>(false);
	let detailTransfer = $state<StockTransfer | null>(null);

	// Dokumen serah terima (surat jalan)
	let storeSettings = $state<StoreSettings | null>(null);
	let isDocOpen = $state<boolean>(false);
	let docTransfer = $state<StockTransfer | null>(null);

	function handlePrintDoc() {
		window.print();
	}

	let currentBranchId = $state<string>('all');

	const outgoing = $derived(transfers.filter(t => t.from_branch_id === currentBranchId || currentBranchId === 'all'));
	const incoming = $derived(transfers.filter(t => t.to_branch_id === currentBranchId || currentBranchId === 'all'));

	const statusLabels: Record<StockTransferStatus, string> = {
		dikirim: 'Dikirim',
		diterima: 'Diterima',
		dibatalkan: 'Dibatalkan'
	};

	function statusClass(status: StockTransferStatus): string {
		return status === 'dikirim'
			? 'bg-amber-50 text-amber-700 border border-amber-200'
			: status === 'diterima'
				? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
				: 'bg-gray-100 text-gray-500 border border-gray-200';
	}

	onMount(loadData);

	async function loadData() {
		isLoading = true;
		currentBranchId = authState.branch?.id || authState.user?.branch_id || 'all';
		const allProducts = await db.products.toArray();
		products = allProducts.filter(p => p.is_active && p.branch_id === currentBranchId);
		branches = await db.branches.orderBy('name').toArray();
		const settings = await db.app_settings.get('store_settings');
		storeSettings = (settings?.value as StoreSettings) || null;
		const allTransfers = await db.stock_transfers.toArray();
		transfers = allTransfers
			.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
			.slice(0, 50)
			.filter(t => currentBranchId === 'all' || t.from_branch_id === currentBranchId || t.to_branch_id === currentBranchId);
		isLoading = false;
	}

	function openForm() {
		toBranchId = '';
		transferNote = '';
		formError = null;
		draftRows = [{ product_id: products[0]?.id || '', quantity: 1 }];
		isFormOpen = true;
	}

	function addRow() {
		draftRows = [...draftRows, { product_id: products[0]?.id || '', quantity: 1 }];
	}

	function removeRow(index: number) {
		draftRows = draftRows.filter((_, i) => i !== index);
	}

	function newId(prefix: string): string {
		return prefix + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
	}

	function makeTransferNo(fromCode: string, toCode: string): string {
		const now = new Date();
		const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
		const timePart = now.toISOString().slice(11, 23).replace(/[:.]/g, '');
		return `TRF/${datePart}/${fromCode}/${toCode}/${timePart}`;
	}

	async function queueProductUpdate(prod: Product, now: string) {
		const updatedProduct: Product = {
			...prod,
			updated_at: now,
			version: (prod.version || 1) + 1
		};
		await db.products.put(updatedProduct);
		await db.sync_queue.add({
			id: newId('sq'),
			entity: 'product',
			action: 'update',
			data: updatedProduct,
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});
	}

	async function saveActivity(action: string, details: string, branchId: string, now: string) {
		await db.activity_logs.add({
			id: newId('act'),
			branch_id: branchId,
			branch_name: authState.branch?.name,
			user_id: authState.user?.id || '-',
			user_name: authState.user?.name || 'Kasir',
			role: authState.user?.role || 'cashier',
			action,
			details,
			timestamp: now,
			synced: false
		});
	}

	async function queueTransfer(trf: StockTransfer, action: 'insert' | 'update') {
		await db.sync_queue.add({
			id: newId('sq'),
			entity: 'transfer',
			action,
			data: trf,
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});
	}

	async function confirmSend() {
		formError = null;

		if (!toBranchId) {
			formError = 'Pilih cabang tujuan terlebih dahulu';
			return;
		}
		if (toBranchId === currentBranchId) {
			formError = 'Cabang tujuan tidak boleh sama dengan cabang saat ini';
			return;
		}
		const validRows = draftRows.filter(r => r.product_id && r.quantity > 0);
		if (validRows.length === 0) {
			formError = 'Tambahkan minimal satu produk dengan jumlah lebih dari 0';
			return;
		}
		const seen = new Set<string>();
		for (const r of validRows) {
			if (seen.has(r.product_id)) {
				formError = 'Produk yang sama tidak boleh muncul dua kali. Gabungkan jumlahnya.';
				return;
			}
			seen.add(r.product_id);
		}

		const now = new Date().toISOString();
		const fromBranch = authState.branch;
		const toBranch = branches.find(b => b.id === toBranchId);
		const fromCode = fromBranch?.code || 'CB';
		const toCode = toBranch?.code || 'CB';
		const transferId = newId('trf');
		const userId = authState.user?.id || '-';
		const userName = authState.user?.name || 'Kasir';

		const items: StockTransferItem[] = [];
		for (const row of validRows) {
			const prod = await db.products.get(row.product_id);
			if (!prod) {
				formError = 'Produk tidak ditemukan';
				return;
			}
			if (prod.stock < row.quantity) {
				formError = `Stok tidak cukup untuk ${prod.name} (tersedia ${prod.stock})`;
				return;
			}
			items.push({
				id: newId('ti'),
				transfer_id: transferId,
				product_id: prod.id,
				product_name: prod.name,
				sku: prod.sku,
				quantity: row.quantity,
				quantity_received: 0,
				created_at: now,
				price: prod.price,
				cost_price: prod.cost_price,
				category: prod.category,
				unit: prod.unit,
				min_stock: prod.min_stock || 0
			});

			// Stok cabang asal langsung dikurangi saat barang dikirim
			await db.products.put({
				...prod,
				stock: prod.stock - row.quantity,
				updated_at: now,
				version: (prod.version || 1) + 1
			});
			await db.sync_queue.add({
				id: newId('sq'),
				entity: 'product',
				action: 'update',
				data: { ...prod, stock: prod.stock - row.quantity, updated_at: now, version: (prod.version || 1) + 1 },
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			// Ledger stok: barang keluar dari cabang asal
			await db.stock_movements.add({
				id: newId('mv'),
				branch_id: currentBranchId,
				product_id: prod.id,
				quantity: -row.quantity,
				type: 'transfer_out',
				reference_id: transferId,
				reason: `Transfer ke ${toBranch?.name || toBranchId}`,
				user_id: userId,
				user_name: userName,
				created_at: now,
				synced: false
			});
		}

		const transfer: StockTransfer = {
			id: transferId,
			transfer_no: makeTransferNo(fromCode, toCode),
			from_branch_id: currentBranchId,
			from_branch_name: fromBranch?.name,
			to_branch_id: toBranchId,
			to_branch_name: toBranch?.name,
			status: 'dikirim',
			notes: transferNote.trim() || undefined,
			user_id: userId,
			user_name: userName,
			items,
			created_at: now,
			updated_at: now,
			synced: false
		};

		await db.stock_transfers.add(transfer);
		await queueTransfer(transfer, 'insert');
		await saveActivity(
			'stock_transfer_sent',
			`Transfer stok ${transfer.transfer_no} ke ${toBranch?.name || toBranchId}: ${items.length} produk.`,
			currentBranchId,
			now
		);

		isFormOpen = false;
		await syncEngine.updatePendingCount();
		await loadData();
		// Proses manual: langsung tampilkan dokumen serah terima untuk dicetak
		openDoc(transfer);
		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
	}

	function openCancelModal(trf: StockTransfer) {
		cancelTransfer = trf;
		isCancelOpen = true;
	}

	async function confirmCancel() {
		if (!cancelTransfer) return;
		const trf = cancelTransfer;
		const now = new Date().toISOString();
		const userId = authState.user?.id || '-';
		const userName = authState.user?.name || 'Kasir';

		// Kembalikan stok ke cabang asal
		for (const it of trf.items) {
			const prod = await db.products.get(it.product_id);
			if (prod) {
				const restored = { ...prod, stock: prod.stock + it.quantity, updated_at: now, version: (prod.version || 1) + 1 };
				await db.products.put(restored);
				await db.sync_queue.add({
					id: newId('sq'),
					entity: 'product',
					action: 'update',
					data: restored,
					timestamp: Date.now(),
					retry_count: 0,
					status: 'pending'
				});
			}

			await db.stock_movements.add({
				id: newId('mv'),
				branch_id: trf.from_branch_id,
				product_id: it.product_id,
				quantity: it.quantity,
				type: 'adjustment',
				reference_id: trf.id,
				reason: `Pembatalan transfer ${trf.transfer_no}`,
				user_id: userId,
				user_name: userName,
				created_at: now,
				synced: false
			});
		}

		const cancelledTransfer: StockTransfer = {
			...trf,
			status: 'dibatalkan',
			updated_at: now,
			synced: false
		};
		await db.stock_transfers.put(cancelledTransfer);
		await queueTransfer(cancelledTransfer, 'update');
		await saveActivity(
			'stock_transfer_cancelled',
			`Batalkan transfer ${trf.transfer_no} ke ${trf.to_branch_name || trf.to_branch_id}. Stok dikembalikan.`,
			trf.from_branch_id,
			now
		);

		isCancelOpen = false;
		cancelTransfer = null;
		await syncEngine.updatePendingCount();
		await loadData();
		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
	}

	function openDetail(trf: StockTransfer) {
		detailTransfer = trf;
		isDetailOpen = true;
	}

	function openDoc(trf: StockTransfer) {
		docTransfer = trf;
		isDocOpen = true;
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-black text-zinc-900 flex items-center gap-2">
				<ArrowLeftRight class="h-5 w-5 text-emerald-600" />
				Transfer Stok Antar Cabang
			</h1>
			<p class="text-xs text-zinc-500 mt-0.5">Catat pengiriman stok ke cabang lain dan cetak dokumen serah terima. Stok toko asal berkurang saat dicatat; toko tujuan mengelola stoknya sendiri secara manual.</p>
		</div>
		<button
			onclick={openForm}
			disabled={products.length === 0 || branches.length < 2}
			class="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-600/30 transition cursor-pointer"
		>
			<Plus class="h-4 w-4" />
			<span>Transfer Baru</span>
		</button>
	</div>

	{#if branches.length < 2}
		<div class="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium flex items-start gap-3">
			<AlertCircle class="h-5 w-5 shrink-0 mt-0.5" />
			<span>Transfer membutuhkan minimal dua cabang. Tambahkan cabang lain terlebih dahulu di menu Kelola Cabang.</span>
		</div>
	{/if}

	<!-- Tab Keluar / Masuk -->
	<div class="flex gap-2">
		<button
			onclick={() => activeView = 'keluar'}
			class="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer {activeView === 'keluar' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}"
		>
			Transfer Keluar ({outgoing.filter(t => t.status === 'dikirim').length})
		</button>
		<button
			onclick={() => activeView = 'masuk'}
			class="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer {activeView === 'masuk' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}"
		>
			Transfer Masuk ({incoming.filter(t => t.status === 'dikirim').length})
		</button>
	</div>

	<!-- Daftar Transfer -->
	<div class="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
		<div class="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-100 bg-zinc-50/70">
			<Package class="h-4 w-4 text-zinc-400" />
			<h2 class="text-sm font-bold text-zinc-800">
				{activeView === 'keluar' ? 'Riwayat Transfer Keluar' : 'Riwayat Transfer Masuk'}
			</h2>
		</div>
		<div class="divide-y divide-zinc-100">
			{#if isLoading}
				<div class="px-5 py-12 text-center text-xs text-zinc-400">Memuat...</div>
			{:else}
				{#each (activeView === 'keluar' ? outgoing : incoming) as trf (trf.id)}
					<div class="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-zinc-50/60 transition">
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-mono text-[11px] font-bold text-zinc-800">{trf.transfer_no}</span>
								<span class="text-[10px] font-bold px-2 py-0.5 rounded-full {statusClass(trf.status)}">
									{statusLabels[trf.status]}
								</span>
							</div>
							<div class="text-xs text-zinc-500 mt-1">
								{activeView === 'keluar'
									? `Ke: ${trf.to_branch_name || trf.to_branch_id}`
									: `Dari: ${trf.from_branch_name || trf.from_branch_id}`}
								&middot; {trf.items.length} produk
								&middot; {formatDateTime(trf.created_at)}
							</div>
							{#if trf.notes}
								<div class="text-[11px] text-zinc-400 mt-0.5 italic">{trf.notes}</div>
							{/if}
						</div>
						<div class="flex items-center gap-1.5 shrink-0">
							<button
								onclick={() => openDoc(trf)}
								class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-zinc-600 hover:bg-zinc-100 transition cursor-pointer"
								title="Cetak dokumen serah terima"
							>
								<FileText class="h-3.5 w-3.5" />
								Dokumen
							</button>
							<button
								onclick={() => openDetail(trf)}
								class="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-zinc-600 hover:bg-zinc-100 transition cursor-pointer"
							>
								Detail
							</button>
							{#if trf.status === 'dikirim' && (trf.from_branch_id === currentBranchId || currentBranchId === 'all')}
								<button
									onclick={() => openCancelModal(trf)}
									class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-rose-600 hover:bg-rose-50 transition cursor-pointer"
								>
									<XCircle class="h-3.5 w-3.5" />
									Batalkan
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<div class="px-5 py-12 text-center text-xs text-zinc-400">
						<ArrowLeftRight class="h-10 w-10 mx-auto mb-2 text-zinc-200 stroke-1" />
						{activeView === 'keluar' ? 'Belum ada transfer keluar.' : 'Belum ada transfer masuk.'}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<!-- Modal Form Transfer Baru -->
{#if isFormOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h3 class="text-base font-bold text-zinc-900">Transfer Stok Baru</h3>
				<button
					onclick={() => isFormOpen = false}
					class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 transition cursor-pointer"
					aria-label="Tutup"
				>
					<XCircle class="h-4 w-4" />
				</button>
			</div>

			<div>
				<label for="transfer-branch" class="block font-semibold text-zinc-700 mb-1">Cabang Tujuan</label>
				<select
					id="transfer-branch"
					bind:value={toBranchId}
					class="w-full px-3 py-2 rounded-xl border border-zinc-200 focus:outline-hidden focus:border-emerald-500 text-sm"
				>
					<option value="" disabled>Pilih cabang tujuan...</option>
					{#each branches.filter(b => b.id !== currentBranchId) as b (b.id)}
						<option value={b.id}>{b.name} ({b.code})</option>
					{/each}
				</select>
			</div>

			<div class="space-y-2">
				<span class="block font-semibold text-zinc-700">Produk yang Dikirim</span>
				{#each draftRows as row, index}
					<div class="flex items-center gap-2">
						<select
							bind:value={row.product_id}
							class="flex-1 px-3 py-2 rounded-xl border border-zinc-200 focus:outline-hidden focus:border-emerald-500 text-sm"
						>
							{#each products as prod (prod.id)}
								<option value={prod.id}>{prod.name} (stok: {prod.stock})</option>
							{/each}
						</select>
						<input
							type="number"
							bind:value={row.quantity}
							min="1"
							class="w-20 px-3 py-2 rounded-xl border border-zinc-200 focus:outline-hidden focus:border-emerald-500 text-sm"
						/>
						<button
							onclick={() => removeRow(index)}
							class="p-2 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
							aria-label="Hapus baris"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
				<button
					onclick={addRow}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-zinc-300 text-xs font-semibold text-zinc-600 hover:border-emerald-500 hover:text-emerald-700 transition cursor-pointer"
				>
					<Plus class="h-3.5 w-3.5" />
					Tambah Produk
				</button>
			</div>

			<div>
				<label for="transfer-note" class="block font-semibold text-zinc-700 mb-1">Catatan (Opsional)</label>
				<input
					id="transfer-note"
					type="text"
					bind:value={transferNote}
					placeholder="Contoh: permintaan restock cabang"
					class="w-full px-3 py-2 rounded-xl border border-zinc-200 focus:outline-hidden focus:border-emerald-500 text-sm"
				/>
			</div>

			{#if formError}
				<div class="flex items-center gap-1.5 p-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-medium">
					<AlertCircle class="h-4 w-4 shrink-0" />
					<span>{formError}</span>
				</div>
			{/if}

			<div class="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
				<button
					onclick={() => isFormOpen = false}
					class="px-4 py-2 rounded-xl border border-zinc-200 text-zinc-700 hover:bg-zinc-50 font-semibold cursor-pointer"
				>
					Batal
				</button>
				<button
					onclick={confirmSend}
					class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
				>
					<Send class="h-4 w-4" />
					Kirim Transfer
				</button>
			</div>
		</div>
	</div>
{/if}


<!-- Modal Detail Transfer -->
{#if isDetailOpen && detailTransfer}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h3 class="text-base font-bold text-zinc-900">Detail Transfer</h3>
				<button
					onclick={() => isDetailOpen = false}
					class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 transition cursor-pointer"
					aria-label="Tutup"
				>
					<XCircle class="h-4 w-4" />
				</button>
			</div>

			<div class="text-xs space-y-1.5 p-3 rounded-xl bg-zinc-50">
				<div class="flex justify-between"><span class="text-zinc-500">No. Transfer:</span><span class="font-mono font-bold">{detailTransfer.transfer_no}</span></div>
				<div class="flex justify-between"><span class="text-zinc-500">Dari:</span><span class="font-semibold">{detailTransfer.from_branch_name || detailTransfer.from_branch_id}</span></div>
				<div class="flex justify-between"><span class="text-zinc-500">Ke:</span><span class="font-semibold">{detailTransfer.to_branch_name || detailTransfer.to_branch_id}</span></div>
				<div class="flex justify-between"><span class="text-zinc-500">Status:</span><span class="font-bold">{statusLabels[detailTransfer.status]}</span></div>
				<div class="flex justify-between"><span class="text-zinc-500">Dibuat:</span><span>{formatDateTime(detailTransfer.created_at)}</span></div>
				{#if detailTransfer.received_at}
					<div class="flex justify-between"><span class="text-zinc-500">Diterima:</span><span>{formatDateTime(detailTransfer.received_at)} oleh {detailTransfer.received_by_name || '-'}</span></div>
				{/if}
			</div>

			<div class="border border-zinc-100 rounded-xl overflow-hidden">
				<table class="w-full text-left text-xs">
					<thead class="bg-zinc-50 text-zinc-500 font-semibold">
						<tr>
							<th class="px-3 py-2">Produk</th>
							<th class="px-3 py-2 text-right">Dikirim</th>
							<th class="px-3 py-2 text-right">Diterima</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-zinc-100 font-medium text-zinc-700">
						{#each detailTransfer.items as it (it.id)}
							<tr>
								<td class="px-3 py-2">
									<div class="font-bold text-zinc-800">{it.product_name}</div>
									<div class="text-[10px] text-zinc-400 font-mono">{it.sku}</div>
								</td>
								<td class="px-3 py-2 text-right">{it.quantity}</td>
								<td class="px-3 py-2 text-right {it.quantity_received < it.quantity ? 'text-rose-600 font-bold' : ''}">
									{detailTransfer.status === 'dikirim' ? '-' : it.quantity_received}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if detailTransfer.status === 'dikirim'}
				<div class="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
					<Clock class="h-3.5 w-3.5 shrink-0" />
					<span>Barang diserahkan secara manual — dokumen serah terima dapat dicetak kapan pun.</span>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Modal Konfirmasi Batal -->
{#if isCancelOpen && cancelTransfer}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 space-y-4">
			<div class="flex items-center gap-2 text-rose-600 font-bold">
				<AlertCircle class="h-5 w-5" />
				<span>Batalkan Transfer</span>
			</div>
			<p class="text-sm text-zinc-600">
				Yakin ingin membatalkan transfer <span class="font-bold font-mono">{cancelTransfer.transfer_no}</span>?
				Stok sebanyak {cancelTransfer.items.reduce((s, it) => s + it.quantity, 0)} item akan dikembalikan ke cabang asal.
			</p>
			<div class="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
				<button
					onclick={() => isCancelOpen = false}
					class="px-4 py-2 rounded-xl border border-zinc-200 text-zinc-700 hover:bg-zinc-50 font-semibold cursor-pointer"
				>
					Kembali
				</button>
				<button
					onclick={confirmCancel}
					class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
				>
					Ya, Batalkan
				</button>
			</div>
		</div>
	</div>
{/if}


<!-- Modal Dokumen Serah Terima (Surat Jalan) -->
{#if isDocOpen && docTransfer}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h3 class="text-base font-bold text-zinc-900">Dokumen Serah Terima</h3>
				<button
					onclick={() => isDocOpen = false}
					class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 transition cursor-pointer"
					aria-label="Tutup"
				>
					<XCircle class="h-4 w-4" />
				</button>
			</div>

			<div id="transfer-document" class="rounded-xl border border-zinc-200 p-6 bg-white text-zinc-900 text-xs">
				<!-- Kop Dokumen -->
				<div class="text-center border-b-2 border-black pb-3">
					<h2 class="text-base font-black uppercase tracking-wide">{storeSettings?.name?.trim() || docTransfer.from_branch_name || 'KASIR MODERN'}</h2>
					{#if storeSettings?.address}
						<p class="text-[10px]">{storeSettings.address}</p>
					{/if}
					{#if storeSettings?.phone}
						<p class="text-[10px]">Telp. {storeSettings.phone}</p>
					{/if}
					<p class="mt-2 font-bold uppercase text-sm">Surat Jalan / Dokumen Serah Terima Barang</p>
				</div>

				<!-- Info Transfer -->
				<div class="grid grid-cols-2 gap-x-6 gap-y-1.5 py-3">
					<div class="flex justify-between gap-2"><span class="text-zinc-500">No. Dokumen</span><span class="font-bold font-mono">{docTransfer.transfer_no}</span></div>
					<div class="flex justify-between gap-2"><span class="text-zinc-500">Tanggal</span><span>{formatDateTime(docTransfer.created_at)}</span></div>
					<div class="flex justify-between gap-2"><span class="text-zinc-500">Dikirim Dari</span><span class="font-semibold">{docTransfer.from_branch_name || docTransfer.from_branch_id}</span></div>
					<div class="flex justify-between gap-2"><span class="text-zinc-500">Dikirim Ke</span><span class="font-semibold">{docTransfer.to_branch_name || docTransfer.to_branch_id}</span></div>
					<div class="flex justify-between gap-2"><span class="text-zinc-500">Status</span><span class="font-bold uppercase">{docTransfer.status}</span></div>
					{#if docTransfer.notes}
						<div class="flex justify-between gap-2 col-span-2"><span class="text-zinc-500">Catatan</span><span class="italic">{docTransfer.notes}</span></div>
					{/if}
				</div>

				<!-- Tabel Barang -->
				<table class="w-full border-collapse text-[11px]">
					<thead>
						<tr class="bg-zinc-100">
							<th class="border border-zinc-400 px-2 py-1.5 text-left w-8">No</th>
							<th class="border border-zinc-400 px-2 py-1.5 text-left">Nama Barang</th>
							<th class="border border-zinc-400 px-2 py-1.5 text-left">SKU</th>
							<th class="border border-zinc-400 px-2 py-1.5 text-right">Jumlah</th>
							<th class="border border-zinc-400 px-2 py-1.5 text-left">Satuan</th>
							{#if docTransfer.status !== 'dikirim'}
								<th class="border border-zinc-400 px-2 py-1.5 text-right">Diterima</th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each docTransfer.items as it, i (it.id)}
							<tr>
								<td class="border border-zinc-400 px-2 py-1.5">{i + 1}</td>
								<td class="border border-zinc-400 px-2 py-1.5 font-semibold">{it.product_name}</td>
								<td class="border border-zinc-400 px-2 py-1.5 font-mono">{it.sku}</td>
								<td class="border border-zinc-400 px-2 py-1.5 text-right font-bold">{it.quantity}</td>
								<td class="border border-zinc-400 px-2 py-1.5">{it.unit || '-'}</td>
								{#if docTransfer.status !== 'dikirim'}
									<td class="border border-zinc-400 px-2 py-1.5 text-right {it.quantity_received < it.quantity ? 'font-bold' : ''}">{it.quantity_received}</td>
								{/if}
							</tr>
						{/each}
						<tr class="bg-zinc-50 font-bold">
							<td class="border border-zinc-400 px-2 py-1.5" colspan={docTransfer.status !== 'dikirim' ? 3 : 3}>Total</td>
							<td class="border border-zinc-400 px-2 py-1.5 text-right">{docTransfer.items.reduce((s, it) => s + it.quantity, 0)}</td>
							<td class="border border-zinc-400 px-2 py-1.5"></td>
							{#if docTransfer.status !== 'dikirim'}
								<td class="border border-zinc-400 px-2 py-1.5 text-right">{docTransfer.items.reduce((s, it) => s + it.quantity_received, 0)}</td>
							{/if}
						</tr>
					</tbody>
				</table>

				<!-- Tanda Tangan -->
				<div class="grid grid-cols-2 gap-8 pt-8 mt-4">
					<div class="text-center">
						<p class="font-semibold">Diserahkan oleh,</p>
						<div class="h-16"></div>
						<p class="font-bold border-t border-zinc-400 pt-1 mx-4">{docTransfer.user_name}</p>
						<p class="text-[10px] text-zinc-500">{docTransfer.from_branch_name || docTransfer.from_branch_id}</p>
					</div>
					<div class="text-center">
						<p class="font-semibold">Diterima oleh,</p>
						<div class="h-16"></div>
						<p class="font-bold border-t border-zinc-400 pt-1 mx-4">{docTransfer.received_by_name || '..............................'}</p>
						<p class="text-[10px] text-zinc-500">{docTransfer.to_branch_name || docTransfer.to_branch_id}{docTransfer.received_at ? ' - ' + formatDateTime(docTransfer.received_at) : ''}</p>
					</div>
				</div>

				<p class="text-[9px] text-zinc-500 pt-4 text-center">
					Dokumen ini dicatat dalam sistem Kasir Modern ({docTransfer.transfer_no}). Barang dinyatakan diterima sesuai jumlah pada kolom "Diterima".
				</p>
			</div>

			<div class="flex items-center justify-end gap-2">
				<button
					onclick={() => isDocOpen = false}
					class="px-4 py-2 rounded-xl border border-zinc-200 text-zinc-700 hover:bg-zinc-50 font-semibold cursor-pointer"
				>
					Tutup
				</button>
				<button
					onclick={handlePrintDoc}
					class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
				>
					<Printer class="h-4 w-4" />
					Cetak Dokumen
				</button>
			</div>
		</div>
	</div>
{/if}
