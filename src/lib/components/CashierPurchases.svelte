<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import { formatRupiah, formatDateTime } from '../shift/index.js';
	import type { Product, Purchase, PurchaseItem } from '../types/index.js';
	import {
		Truck,
		Plus,
		Trash2,
		AlertCircle,
		CheckCircle2,
		Save,
		Package,
		Phone
	} from 'lucide-svelte';

	let products = $state<Product[]>([]);
	let purchases = $state<Purchase[]>([]);
	let isLoading = $state<boolean>(true);

	// Form pembelian
	let isFormOpen = $state<boolean>(false);
	let supplierName = $state<string>('');
	let supplierPhone = $state<string>('');
	let purchaseNote = $state<string>('');
	let formError = $state<string | null>(null);

	interface DraftRow {
		product_id: string;
		quantity: number;
		cost_price: number;
	}

	let draftRows = $state<DraftRow[]>([]);

	let draftTotal = $derived(
		draftRows.reduce((sum, r) => sum + (isNaN(r.quantity) ? 0 : r.quantity) * (isNaN(r.cost_price) ? 0 : r.cost_price), 0)
	);

	onMount(loadData);

	async function loadData() {
		isLoading = true;
		const branchId = authState.branch?.id || 'cb-01';
		const allProducts = await db.products.toArray();
		products = allProducts.filter(p => p.is_active && (p.branch_id === 'all' || p.branch_id === branchId));
		purchases = await db.purchases.orderBy('created_at').reverse().limit(10).toArray();
		isLoading = false;
	}

	function openForm() {
		supplierName = '';
		supplierPhone = '';
		purchaseNote = '';
		formError = null;
		draftRows = [{ product_id: products[0]?.id || '', quantity: 1, cost_price: products[0]?.cost_price || 0 }];
		isFormOpen = true;
	}

	function addRow() {
		draftRows = [...draftRows, { product_id: products[0]?.id || '', quantity: 1, cost_price: products[0]?.cost_price || 0 }];
	}

	function removeRow(index: number) {
		draftRows = draftRows.filter((_, i) => i !== index);
	}

	function onProductChange(index: number, productId: string) {
		const prod = products.find(p => p.id === productId);
		draftRows[index] = {
			...draftRows[index],
			product_id: productId,
			cost_price: prod?.cost_price ?? draftRows[index].cost_price
		};
	}

	async function confirmPurchase() {
		formError = null;

		if (!supplierName.trim()) {
			formError = 'Nama supplier wajib diisi';
			return;
		}
		const validRows = draftRows.filter(r => r.product_id && r.quantity > 0);
		if (validRows.length === 0) {
			formError = 'Tambahkan minimal satu produk dengan jumlah lebih dari 0';
			return;
		}
		if (validRows.some(r => isNaN(r.cost_price) || r.cost_price < 0)) {
			formError = 'Harga beli tidak boleh negatif';
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
		const branchId = authState.branch?.id || 'cb-01';
		const purchaseId = 'po-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
		const userId = authState.user?.id || 'usr-kasir';
		const userName = authState.user?.name || 'Kasir';

		const items: PurchaseItem[] = [];
		for (const row of validRows) {
			const prod = await db.products.get(row.product_id);
			if (!prod) {
				formError = 'Produk tidak ditemukan: ' + row.product_id;
				return;
			}
			const itemId = 'poi-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
			items.push({
				id: itemId,
				purchase_id: purchaseId,
				product_id: prod.id,
				product_name: prod.name,
				quantity: row.quantity,
				cost_price: row.cost_price,
				subtotal: row.quantity * row.cost_price
			});

			// Tambah stok lokal + perbarui harga beli terakhir
			const updatedProduct = {
				...prod,
				stock: prod.stock + row.quantity,
				cost_price: row.cost_price,
				updated_at: now,
				version: prod.version + 1
			};
			await db.products.put(updatedProduct);

			await db.sync_queue.add({
				id: 'sq-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
				entity: 'product',
				action: 'update',
				data: updatedProduct,
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			// Catat ledger stok (audit)
			await db.stock_movements.put({
				id: `mv-purchase-${itemId}`,
				branch_id: branchId,
				product_id: prod.id,
				quantity: row.quantity,
				type: 'purchase',
				reference_id: purchaseId,
				reason: `Pembelian dari supplier ${supplierName.trim()}`,
				user_id: userId,
				user_name: userName,
				created_at: now,
				synced: false
			});
		}

		const purchase: Purchase = {
			id: purchaseId,
			branch_id: branchId,
			branch_name: authState.branch?.name,
			supplier_name: supplierName.trim(),
			supplier_phone: supplierPhone.trim() || undefined,
			total: items.reduce((sum, it) => sum + it.subtotal, 0),
			note: purchaseNote.trim() || undefined,
			user_id: userId,
			user_name: userName,
			items,
			created_at: now,
			updated_at: now,
			synced: false
		};

		await db.purchases.add(purchase);

		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: branchId,
			branch_name: authState.branch?.name,
			user_id: userId,
			user_name: userName,
			role: 'cashier',
			action: 'purchase_stock',
			details: `Pembelian stok dari supplier "${purchase.supplier_name}": ${items.length} produk, total ${formatRupiah(purchase.total)}.`,
			timestamp: now,
			synced: false
		});

		isFormOpen = false;
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
				<Truck class="h-5 w-5 text-emerald-600" />
				Pembelian Stok (Supplier)
			</h1>
			<p class="text-xs text-zinc-500 mt-0.5">Catat stok masuk dari supplier. Stok dan harga beli produk otomatis diperbarui.</p>
		</div>
		<button
			onclick={openForm}
			disabled={products.length === 0}
			class="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-600/30 transition cursor-pointer"
		>
			<Plus class="h-4 w-4" />
			<span>Pembelian Baru</span>
		</button>
	</div>

	<!-- Riwayat Pembelian -->
	<div class="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
		<div class="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-100 bg-zinc-50/70">
			<Package class="h-4 w-4 text-zinc-400" />
			<h2 class="text-sm font-bold text-zinc-800">Riwayat Pembelian</h2>
		</div>
		{#if isLoading || purchases.length === 0}
			<div class="p-8 text-center text-zinc-400">
				<Truck class="h-10 w-10 mx-auto mb-2 stroke-1" />
				<p class="text-sm font-medium">Belum ada pembelian stok tercatat</p>
			</div>
		{:else}
			<div class="divide-y divide-zinc-100">
				{#each purchases as po}
					<div class="px-5 py-4 hover:bg-zinc-50/60">
						<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
							<div class="min-w-0">
								<p class="text-sm font-bold text-zinc-900 flex items-center gap-2">
									{po.supplier_name}
									{#if !po.synced}
										<span class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Menunggu sinkron</span>
									{/if}
								</p>
								<p class="text-[11px] text-zinc-400 mt-0.5">
									{formatDateTime(po.created_at)} • oleh {po.user_name}
									{#if po.supplier_phone}<span class="inline-flex items-center gap-1 ml-1"><Phone class="h-3 w-3" />{po.supplier_phone}</span>{/if}
								</p>
							</div>
							<p class="text-sm font-black text-emerald-700 whitespace-nowrap">{formatRupiah(po.total)}</p>
						</div>
						<div class="mt-2 flex flex-wrap gap-1.5">
							{#each po.items as it}
								<span class="rounded-lg bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
									{it.product_name} × {it.quantity} ({formatRupiah(it.cost_price)})
								</span>
							{/each}
						</div>
						{#if po.note}
							<p class="text-[11px] text-zinc-400 mt-1.5 italic">Catatan: {po.note}</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- Modal Pembelian Baru -->
{#if isFormOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto">
		<div class="relative w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl my-8">
			<div class="flex items-center gap-2 border-b border-zinc-100 pb-3 mb-4">
				<Truck class="h-5 w-5 text-emerald-600" />
				<h3 class="text-lg font-bold text-zinc-900">Pembelian Stok Baru</h3>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
				<div>
					<label for="supplierName" class="block text-xs font-semibold text-zinc-700 mb-1">Nama Supplier <span class="text-rose-500">*</span></label>
					<input
						id="supplierName"
						type="text"
						bind:value={supplierName}
						placeholder="Contoh: CV Sumber Rejeki"
						class="w-full px-3.5 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-hidden focus:border-emerald-500"
					/>
				</div>
				<div>
					<label for="supplierPhone" class="block text-xs font-semibold text-zinc-700 mb-1">Telepon Supplier (opsional)</label>
					<input
						id="supplierPhone"
						type="text"
						bind:value={supplierPhone}
						placeholder="Contoh: 0812-3456-7890"
						class="w-full px-3.5 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-hidden focus:border-emerald-500"
					/>
				</div>
			</div>

			<!-- Baris Item Pembelian -->
			<div class="space-y-2 mb-3">
				<div class="flex items-center justify-between">
					<p class="text-xs font-semibold text-zinc-700">Item Pembelian</p>
					<button
						onclick={addRow}
						class="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition cursor-pointer"
					>
						<Plus class="h-3 w-3" />
						Tambah Item
					</button>
				</div>

				{#each draftRows as row, index}
					<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-zinc-200 p-2.5">
						<select
							bind:value={row.product_id}
							onchange={(e) => onProductChange(index, (e.target as HTMLSelectElement).value)}
							class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-zinc-200 text-xs focus:outline-hidden focus:border-emerald-500"
						>
							{#each products as prod}
								<option value={prod.id}>{prod.name} ({prod.sku}) — stok {prod.stock}</option>
							{/each}
						</select>
						<input
							type="number"
							bind:value={row.quantity}
							min="1"
							placeholder="Qty"
							class="w-full sm:w-20 px-2.5 py-1.5 rounded-lg border border-zinc-200 text-xs font-semibold focus:outline-hidden focus:border-emerald-500"
						/>
						<input
							type="number"
							bind:value={row.cost_price}
							min="0"
							placeholder="Harga beli"
							class="w-full sm:w-32 px-2.5 py-1.5 rounded-lg border border-zinc-200 text-xs font-semibold focus:outline-hidden focus:border-emerald-500"
						/>
						<span class="text-xs font-bold text-zinc-700 sm:w-28 text-right whitespace-nowrap">
							{formatRupiah((isNaN(row.quantity) ? 0 : row.quantity) * (isNaN(row.cost_price) ? 0 : row.cost_price))}
						</span>
						<button
							onclick={() => removeRow(index)}
							disabled={draftRows.length === 1}
							class="h-7 w-7 shrink-0 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center hover:bg-rose-100 disabled:opacity-40 transition cursor-pointer"
							aria-label="Hapus baris"
						>
							<Trash2 class="h-3.5 w-3.5" />
						</button>
					</div>
				{/each}
			</div>

			<div class="mb-3">
				<label for="purchaseNote" class="block text-xs font-semibold text-zinc-700 mb-1">Catatan (opsional)</label>
				<input
					id="purchaseNote"
					type="text"
					bind:value={purchaseNote}
					placeholder="Contoh: No. surat jalan SJ-001"
					class="w-full px-3.5 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-hidden focus:border-emerald-500"
				/>
			</div>

			<div class="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 mb-3">
				<span class="text-xs font-bold text-emerald-800 uppercase tracking-wide">Total Pembelian</span>
				<span class="text-lg font-black text-emerald-700">{formatRupiah(draftTotal)}</span>
			</div>

			{#if formError}
				<div class="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200 mb-3">
					<AlertCircle class="h-4 w-4 shrink-0" />
					<span>{formError}</span>
				</div>
			{/if}

			<div class="flex items-center justify-end gap-3 pt-2">
				<button
					onclick={() => isFormOpen = false}
					class="px-4 py-2.5 rounded-xl border border-zinc-300 text-zinc-700 hover:bg-zinc-50 text-sm font-semibold transition"
				>
					Batal
				</button>
				<button
					onclick={confirmPurchase}
					class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-md shadow-emerald-600/30 transition cursor-pointer"
				>
					<Save class="h-4 w-4" />
					<span>Simpan Pembelian</span>
				</button>
			</div>
		</div>
	</div>
{/if}
