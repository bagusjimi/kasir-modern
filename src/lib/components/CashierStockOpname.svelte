<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import { formatRupiah, formatDateTime } from '../shift/index.js';
	import type { Product, StockCount, StockCountItem } from '../types/index.js';
	import {
		ClipboardList,
		Search,
		AlertCircle,
		CheckCircle2,
		Save,
		History as HistoryIcon,
		RefreshCw
	} from 'lucide-svelte';

	let products = $state<Product[]>([]);
	let counts = $state<StockCount[]>([]);
	let isLoading = $state<boolean>(true);
	let searchQuery = $state<string>('');

	// Penghitungan opname berjalan
	let counted: Record<string, number> = $state({});
	let opnameNote = $state<string>('');
	let opnameError = $state<string | null>(null);
	let isSaving = $state<boolean>(false);
	let successMessage = $state<string | null>(null);

	let differences = $derived(
		products
			.map(p => {
				const countedQty = counted[p.id];
				if (countedQty === undefined || isNaN(countedQty)) return null;
				const difference = countedQty - p.stock;
				return { product: p, systemQty: p.stock, countedQty, difference };
			})
			.filter((d): d is { product: Product; systemQty: number; countedQty: number; difference: number } => d !== null && d.difference !== 0)
	);

	let filteredProducts = $derived(
		products.filter(p =>
			searchQuery.trim() === '' ||
			p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			p.sku.toLowerCase().includes(searchQuery.toLowerCase())
		)
	);

	onMount(loadData);

	async function loadData() {
		isLoading = true;
		const branchId = authState.branch?.id || 'cb-01';
		const allProducts = await db.products.toArray();
		products = allProducts.filter(p => p.is_active && (p.branch_id === 'all' || p.branch_id === branchId));
		counts = await db.stock_counts.orderBy('created_at').reverse().limit(5).toArray();
		counted = {};
		opnameNote = '';
		isLoading = false;
	}

	function resetCounted() {
		counted = {};
		opnameError = null;
	}

	async function confirmOpname() {
		opnameError = null;
		successMessage = null;

		if (differences.length === 0) {
			opnameError = 'Tidak ada selisih yang perlu disesuaikan. Isi jumlah fisik pada produk yang ingin disesuaikan.';
			return;
		}
		if (differences.some(d => d.countedQty < 0 || isNaN(d.countedQty))) {
			opnameError = 'Jumlah fisik tidak boleh negatif';
			return;
		}

		isSaving = true;
		const now = new Date().toISOString();
		const branchId = authState.branch?.id || 'cb-01';
		const userId = authState.user?.id || 'usr-kasir';
		const userName = authState.user?.name || 'Kasir';
		const opnameId = 'so-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

		const items: StockCountItem[] = [];
		for (const diff of differences) {
			const prod = await db.products.get(diff.product.id);
			if (!prod) continue;

			const itemId = 'sci-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
			items.push({
				id: itemId,
				stock_count_id: opnameId,
				product_id: prod.id,
				product_name: prod.name,
				system_qty: diff.systemQty,
				counted_qty: diff.countedQty,
				difference: diff.difference
			});

			// Samakan stok sistem dengan hitungan fisik
			const updatedProduct = {
				...prod,
				stock: diff.countedQty,
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

			// Catat ledger stok (audit) dengan selisih bertanda
			await db.stock_movements.put({
				id: `mv-opname-${itemId}`,
				branch_id: branchId,
				product_id: prod.id,
				quantity: diff.difference,
				type: 'opname',
				reference_id: opnameId,
				reason: `Opname: sistem ${diff.systemQty}, fisik ${diff.countedQty}`,
				user_id: userId,
				user_name: userName,
				created_at: now,
				synced: false
			});
		}

		const stockCount: StockCount = {
			id: opnameId,
			branch_id: branchId,
			branch_name: authState.branch?.name,
			note: opnameNote.trim() || undefined,
			user_id: userId,
			user_name: userName,
			items,
			total_difference_qty: items.reduce((sum, it) => sum + it.difference, 0),
			created_at: now,
			synced: false
		};

		await db.stock_counts.add(stockCount);

		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: branchId,
			branch_name: authState.branch?.name,
			user_id: userId,
			user_name: userName,
			role: 'cashier',
			action: 'stock_opname',
			details: `Stok opname disimpan: ${items.length} produk disesuaikan (total selisih ${stockCount.total_difference_qty} unit).`,
			timestamp: now,
			synced: false
		});

		isSaving = false;
		successMessage = `Opname berhasil disimpan: ${items.length} produk disesuaikan.`;
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
				<ClipboardList class="h-5 w-5 text-emerald-600" />
				Stok Opname
			</h1>
			<p class="text-xs text-zinc-500 mt-0.5">Hitung stok fisik, lalu sesuaikan stok sistem dengan selisih yang tercatat di ledger audit.</p>
		</div>
		<button
			onclick={confirmOpname}
			disabled={isSaving || differences.length === 0}
			class="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-600/30 transition cursor-pointer"
		>
			<Save class="h-4 w-4" />
			<span>{isSaving ? 'Menyimpan...' : `Simpan Opname (${differences.length} selisih)`}</span>
		</button>
	</div>

	{#if successMessage}
		<div class="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700 border border-emerald-200">
			<CheckCircle2 class="h-4 w-4 shrink-0" />
			<span>{successMessage}</span>
		</div>
	{/if}

	<!-- Tabel Penghitungan -->
	<div class="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 border-b border-zinc-100 bg-zinc-50/70">
			<div class="flex items-center gap-2">
				<ClipboardList class="h-4 w-4 text-zinc-400" />
				<h2 class="text-sm font-bold text-zinc-800">Penghitungan Fisik</h2>
			</div>
			<div class="flex items-center gap-2">
				<div class="relative">
					<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Cari produk..."
						class="w-full sm:w-56 pl-9 pr-3 py-1.5 rounded-lg border border-zinc-200 text-xs focus:outline-hidden focus:border-emerald-500"
					/>
				</div>
				<button
					onclick={resetCounted}
					class="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-50 transition cursor-pointer"
				>
					<RefreshCw class="h-3 w-3" />
					Reset
				</button>
			</div>
		</div>

		{#if isLoading || filteredProducts.length === 0}
			<div class="p-8 text-center text-zinc-400">
				<ClipboardList class="h-10 w-10 mx-auto mb-2 stroke-1" />
				<p class="text-sm font-medium">{isLoading ? 'Memuat produk...' : 'Tidak ada produk ditemukan'}</p>
			</div>
		{:else}
			<div class="overflow-x-auto max-h-[480px] overflow-y-auto">
				<table class="w-full text-sm">
					<thead class="sticky top-0 bg-white">
						<tr class="text-left text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
							<th class="px-5 py-2.5 font-semibold">Produk</th>
							<th class="px-3 py-2.5 font-semibold text-center">Stok Sistem</th>
							<th class="px-3 py-2.5 font-semibold text-center">Stok Fisik</th>
							<th class="px-5 py-2.5 font-semibold text-center">Selisih</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-zinc-100">
						{#each filteredProducts as prod (prod.id)}
							{@const countedQty = counted[prod.id]}
							{@const diff = countedQty === undefined || isNaN(countedQty) ? null : countedQty - prod.stock}
							<tr class="hover:bg-zinc-50/60">
								<td class="px-5 py-2.5">
									<p class="text-xs font-bold text-zinc-800 truncate max-w-[240px]">{prod.name}</p>
									<p class="text-[10px] text-zinc-400">{prod.sku} • {formatRupiah(prod.price)}</p>
								</td>
								<td class="px-3 py-2.5 text-center text-xs font-bold text-zinc-700">{prod.stock}</td>
								<td class="px-3 py-2.5 text-center">
									<input
										type="number"
										min="0"
										bind:value={counted[prod.id]}
										placeholder={String(prod.stock)}
										class="w-20 mx-auto px-2 py-1 rounded-lg border border-zinc-200 text-xs font-semibold text-center focus:outline-hidden focus:border-emerald-500 {diff !== null && diff !== 0 ? 'border-amber-400 bg-amber-50' : ''}"
									/>
								</td>
								<td class="px-5 py-2.5 text-center text-xs font-black {diff === null || diff === 0 ? 'text-zinc-300' : diff > 0 ? 'text-emerald-600' : 'text-rose-600'}">
									{diff === null || diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${diff}`}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="px-5 py-3 border-t border-zinc-100 bg-zinc-50/70">
			<label for="opnameNote" class="block text-[11px] font-semibold text-zinc-600 mb-1">Catatan Opname (opsional)</label>
			<input
				id="opnameNote"
				type="text"
				bind:value={opnameNote}
				placeholder="Contoh: opname bulanan, ada 1 produk rusak"
				class="w-full px-3 py-1.5 rounded-lg border border-zinc-200 text-xs focus:outline-hidden focus:border-emerald-500"
			/>
		</div>
	</div>

	{#if opnameError}
		<div class="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
			<AlertCircle class="h-4 w-4 shrink-0" />
			<span>{opnameError}</span>
		</div>
	{/if}

	<!-- Riwayat Opname -->
	<div class="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
		<div class="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-100 bg-zinc-50/70">
			<HistoryIcon class="h-4 w-4 text-zinc-400" />
			<h2 class="text-sm font-bold text-zinc-800">Riwayat Opname</h2>
		</div>
		{#if counts.length === 0}
			<div class="p-8 text-center text-zinc-400">
				<ClipboardList class="h-10 w-10 mx-auto mb-2 stroke-1" />
				<p class="text-sm font-medium">Belum ada riwayat opname</p>
			</div>
		{:else}
			<div class="divide-y divide-zinc-100">
				{#each counts as sc}
					<div class="px-5 py-3.5 hover:bg-zinc-50/60">
						<div class="flex items-center justify-between gap-2">
							<div class="min-w-0">
								<p class="text-xs font-bold text-zinc-800">
									{formatDateTime(sc.created_at)} • oleh {sc.user_name}
									{#if !sc.synced}
										<span class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Menunggu sinkron</span>
									{/if}
								</p>
								<p class="text-[11px] text-zinc-400 mt-0.5">{sc.items.length} produk disesuaikan</p>
							</div>
							<span class="text-xs font-black {sc.total_difference_qty === 0 ? 'text-emerald-600' : 'text-rose-600'} whitespace-nowrap">
								Total selisih: {sc.total_difference_qty > 0 ? '+' : ''}{sc.total_difference_qty}
							</span>
						</div>
						<div class="mt-1.5 flex flex-wrap gap-1.5">
							{#each sc.items as it}
								<span class="rounded-lg bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
									{it.product_name}: {it.system_qty} → {it.counted_qty} ({it.difference > 0 ? '+' : ''}{it.difference})
								</span>
							{/each}
						</div>
						{#if sc.note}
							<p class="text-[11px] text-zinc-400 mt-1 italic">Catatan: {sc.note}</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
