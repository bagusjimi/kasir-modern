<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Product, Category } from '../types/index.js';
	import {
		Plus,
		Edit3,
		Search,
		Package,
		AlertCircle,
		CheckCircle2,
		X
	} from 'lucide-svelte';

	let products = $state<Product[]>([]);
	let categories = $state<Category[]>([]);
	let searchQuery = $state<string>('');

	// Modal Form Tambah / Edit Produk
	let isModalOpen = $state<boolean>(false);
	let isEditing = $state<boolean>(false);
	let formId = $state<string>('');
	let formName = $state<string>('');
	let formCategory = $state<string>('Makanan');
	let formSku = $state<string>('');
	let formPrice = $state<number>(0);
	let formCostPrice = $state<number>(0);
	let formStock = $state<number>(0);
	let formUnit = $state<string>('pcs');
	let formError = $state<string | null>(null);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		categories = await db.categories.toArray();
		const allProducts = await db.products.toArray();
		const branchId = authState.branch?.id || 'cb-01';
		products = allProducts.filter(
			p => p.branch_id === 'all' || p.branch_id === branchId
		);
	}

	let filteredProducts = $derived(
		products.filter(p =>
			searchQuery.trim() === '' ||
			p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			p.sku.toLowerCase().includes(searchQuery.toLowerCase())
		)
	);

	function openAddModal() {
		isEditing = false;
		formId = '';
		formName = '';
		formCategory = categories[0]?.name || 'Makanan';
		formSku = 'PRD-' + Math.floor(100 + Math.random() * 900);
		formPrice = 0;
		formCostPrice = 0;
		formStock = 10;
		formUnit = 'pcs';
		formError = null;
		isModalOpen = true;
	}

	function openEditModal(prod: Product) {
		isEditing = true;
		formId = prod.id;
		formName = prod.name;
		formCategory = prod.category;
		formSku = prod.sku;
		formPrice = prod.price;
		formCostPrice = prod.cost_price;
		formStock = prod.stock;
		formUnit = prod.unit;
		formError = null;
		isModalOpen = true;
	}

	async function saveProduct() {
		formError = null;
		if (!formName.trim()) {
			formError = 'Nama produk wajib diisi';
			return;
		}
		if (formPrice <= 0) {
			formError = 'Harga jual harus lebih besar dari 0';
			return;
		}

		const now = new Date().toISOString();
		const branchId = authState.branch?.id || 'cb-01';

		if (isEditing) {
			const existing = await db.products.get(formId);
			if (!existing) return;

			const updatedProduct: Product = {
				...existing,
				name: formName.trim(),
				category: formCategory,
				sku: formSku.trim(),
				price: Number(formPrice),
				cost_price: Number(formCostPrice),
				stock: Number(formStock),
				unit: formUnit.trim(),
				updated_at: now,
				version: existing.version + 1
			};

			await db.products.put(updatedProduct);

			// Catat ke antrean sinkronisasi
			await db.sync_queue.add({
				id: 'sq-' + Date.now(),
				entity: 'product',
				action: 'update',
				data: updatedProduct,
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			await db.activity_logs.add({
				id: 'act-' + Date.now(),
				branch_id: branchId,
				branch_name: authState.branch?.name,
				user_id: authState.user?.id || 'usr-kasir',
				user_name: authState.user?.name || 'Kasir',
				role: 'cashier',
				action: 'update_product',
				details: `Memperbarui produk ${formName} (Stok: ${formStock}, Harga: ${formPrice})`,
				timestamp: now,
				synced: false
			});
		} else {
			const newId = 'prod-' + Date.now();
			const newProduct: Product = {
				id: newId,
				branch_id: branchId,
				sku: formSku.trim(),
				name: formName.trim(),
				category: formCategory,
				price: Number(formPrice),
				cost_price: Number(formCostPrice),
				stock: Number(formStock),
				unit: formUnit.trim(),
				is_active: true,
				created_at: now,
				updated_at: now,
				version: 1
			};

			await db.products.add(newProduct);

			await db.sync_queue.add({
				id: 'sq-' + Date.now(),
				entity: 'product',
				action: 'insert',
				data: newProduct,
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			await db.activity_logs.add({
				id: 'act-' + Date.now(),
				branch_id: branchId,
				branch_name: authState.branch?.name,
				user_id: authState.user?.id || 'usr-kasir',
				user_name: authState.user?.name || 'Kasir',
				role: 'cashier',
				action: 'create_product',
				details: `Menambahkan produk baru: ${formName} (${formUnit})`,
				timestamp: now,
				synced: false
			});
		}

		await syncEngine.updatePendingCount();
		await loadData();
		isModalOpen = false;

		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
	}

	async function toggleProductStatus(prod: Product) {
		const newStatus = !prod.is_active;
		await db.products.update(prod.id, {
			is_active: newStatus,
			updated_at: new Date().toISOString()
		});
		await loadData();
	}

	function formatRupiah(num: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(num);
	}
</script>

<div class="space-y-6">
	<!-- Top Bar -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
		<div>
			<h2 class="text-lg font-bold text-gray-900">Manajemen Produk & Stok</h2>
			<p class="text-xs text-gray-500 mt-0.5">Kelola ketersediaan inventaris cabang {authState.branch?.name || 'Lokal'}</p>
		</div>

		<div class="flex items-center gap-3">
			<div class="relative flex-1 sm:w-64">
				<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Cari nama / SKU..."
					class="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-hidden focus:border-emerald-500"
				/>
			</div>

			<button
				onclick={openAddModal}
				class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-md shadow-emerald-600/20 active:scale-95 transition cursor-pointer"
			>
				<Plus class="h-4 w-4" />
				<span>Tambah Produk</span>
			</button>
		</div>
	</div>

	<!-- Tabel Produk -->
	<div class="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-left text-xs">
				<thead class="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-100">
					<tr>
						<th class="px-5 py-3.5">Produk</th>
						<th class="px-5 py-3.5">Kategori</th>
						<th class="px-5 py-3.5">Harga Modal</th>
						<th class="px-5 py-3.5">Harga Jual</th>
						<th class="px-5 py-3.5">Sisa Stok</th>
						<th class="px-5 py-3.5">Status</th>
						<th class="px-5 py-3.5 text-right">Aksi</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100 font-medium text-gray-700">
					{#if filteredProducts.length === 0}
						<tr>
							<td colspan="7" class="px-5 py-12 text-center text-gray-400">
								<Package class="h-10 w-10 mx-auto mb-2 text-gray-300 stroke-1" />
								Tidak ada data produk yang sesuai.
							</td>
						</tr>
					{:else}
						{#each filteredProducts as prod}
							<tr class="hover:bg-gray-50/60 transition">
								<td class="px-5 py-3.5">
									<div class="font-bold text-gray-900">{prod.name}</div>
									<div class="text-[11px] text-gray-400 font-mono">{prod.sku}</div>
								</td>
								<td class="px-5 py-3.5">
									<span class="bg-gray-100 text-gray-700 px-2.5 py-0.5 rounded-md font-semibold text-[11px]">
										{prod.category}
									</span>
								</td>
								<td class="px-5 py-3.5 text-gray-500">{formatRupiah(prod.cost_price)}</td>
								<td class="px-5 py-3.5 font-bold text-emerald-600">{formatRupiah(prod.price)}</td>
								<td class="px-5 py-3.5">
									<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold {prod.stock <= 5 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}">
										{prod.stock} {prod.unit}
									</span>
								</td>
								<td class="px-5 py-3.5">
									<button
										onclick={() => toggleProductStatus(prod)}
										class="cursor-pointer text-[11px] font-semibold px-2 py-0.5 rounded-md {prod.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}"
									>
										{prod.is_active ? 'Aktif' : 'Nonaktif'}
									</button>
								</td>
								<td class="px-5 py-3.5 text-right">
									<button
										onclick={() => openEditModal(prod)}
										class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 font-semibold transition cursor-pointer"
									>
										<Edit3 class="h-3.5 w-3.5" />
										<span>Edit</span>
									</button>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>

<!-- Modal Tambah / Edit Produk -->
{#if isModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
				<h3 class="text-base font-bold text-gray-900">
					{isEditing ? 'Ubah Informasi Produk' : 'Tambah Produk Baru'}
				</h3>
				<button onclick={() => isModalOpen = false} class="text-gray-400 hover:text-gray-600">
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-3.5 text-xs">
				<div>
					<label for="formName" class="block font-semibold text-gray-700 mb-1">Nama Produk</label>
					<input
						id="formName"
						type="text"
						bind:value={formName}
						placeholder="Contoh: Kopi Susu Senja"
						class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-emerald-500"
					/>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="formCategory" class="block font-semibold text-gray-700 mb-1">Kategori</label>
						<select
							id="formCategory"
							bind:value={formCategory}
							class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-emerald-500"
						>
							{#each categories as cat}
								<option value={cat.name}>{cat.name}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="formSku" class="block font-semibold text-gray-700 mb-1">SKU / Kode</label>
						<input
							id="formSku"
							type="text"
							bind:value={formSku}
							class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-emerald-500"
						/>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="formCostPrice" class="block font-semibold text-gray-700 mb-1">Harga Modal (Rp)</label>
						<input
							id="formCostPrice"
							type="number"
							bind:value={formCostPrice}
							class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-emerald-500"
						/>
					</div>
					<div>
						<label for="formPrice" class="block font-semibold text-gray-700 mb-1">Harga Jual (Rp)</label>
						<input
							id="formPrice"
							type="number"
							bind:value={formPrice}
							class="w-full px-3 py-2 rounded-xl border border-gray-200 font-bold text-emerald-600 focus:outline-hidden focus:border-emerald-500"
						/>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="formStock" class="block font-semibold text-gray-700 mb-1">Jumlah Stok</label>
						<input
							id="formStock"
							type="number"
							bind:value={formStock}
							class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-emerald-500"
						/>
					</div>
					<div>
						<label for="formUnit" class="block font-semibold text-gray-700 mb-1">Satuan (Unit)</label>
						<input
							id="formUnit"
							type="text"
							bind:value={formUnit}
							placeholder="pcs, cup, porsi"
							class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-emerald-500"
						/>
					</div>
				</div>

				{#if formError}
					<div class="flex items-center gap-1.5 p-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-medium">
						<AlertCircle class="h-4 w-4 shrink-0" />
						<span>{formError}</span>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
					<button
						onclick={() => isModalOpen = false}
						class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold"
					>
						Batal
					</button>
					<button
						onclick={saveProduct}
						class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition"
					>
						Simpan Produk
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

