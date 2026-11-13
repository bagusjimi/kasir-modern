<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Product, Category, StockMovement } from '../types/index.js';
	import {
		Plus,
		Edit3,
		Trash2,
		PackagePlus,
		Search,
		Package,
		AlertCircle,
		CheckCircle2,
		History,
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
	let formCategory = $state<string>('');
	let newCategoryName = $state<string>('');
	let formSku = $state<string>('');
	let formPrice = $state<number>(0);
	let formCostPrice = $state<number>(0);
	let formStock = $state<number>(0);
	let formUnit = $state<string>('pcs');
	let formError = $state<string | null>(null);

	// Modal Restock
	let isRestockModalOpen = $state<boolean>(false);
	let restockProduct = $state<Product | null>(null);
	let restockQuantity = $state<number>(10);
	let restockNotes = $state<string>('');
	let restockError = $state<string | null>(null);

	// Modal Konfirmasi Hapus Produk
	let isDeleteModalOpen = $state<boolean>(false);
	let productToDelete = $state<Product | null>(null);

	// Modal Riwayat Stok (Audit)
	let isHistoryModalOpen = $state<boolean>(false);
	let historyProduct = $state<Product | null>(null);
	let productMovements = $state<StockMovement[]>([]);

	const movementLabels: Record<string, string> = {
		sale: 'Penjualan',
		restock: 'Restock',
		void: 'Pembatalan',
		return: 'Retur',
		purchase: 'Pembelian',
		opname: 'Opname',
		adjustment: 'Penyesuaian'
	};

	onMount(async () => {
		await loadData();
	});

	// Muat ulang daftar setiap kali sinkronisasi selesai, agar kategori dan
	// produk dari perangkat lain langsung tampil tanpa perlu refresh halaman.
	$effect(() => {
		if (syncEngine.lastSyncedAt) {
			loadData();
		}
	});

	async function loadData() {
		categories = (await db.categories.toArray()).sort((a, b) => a.name.localeCompare(b.name));

		// Saat online, tarik kategori langsung dari server agar pilihan kategori
		// selalu lengkap tanpa menunggu siklus sinkronisasi berikutnya.
		if (syncEngine.isOnline) {
			try {
				const res = await fetch('/api/categories');
				if (res.ok) {
					const json: any = await res.json();
					if (json?.success && Array.isArray(json.data) && json.data.length > 0) {
						await db.categories.bulkPut(json.data);
						categories = (await db.categories.toArray()).sort((a, b) => a.name.localeCompare(b.name));
					}
				}
			} catch (e) {
				console.warn('Gagal menarik kategori dari server:', e);
			}
		}

		const allProducts = await db.products.toArray();
		const branchId = authState.branch?.id || authState.user?.branch_id || 'all';
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
		formCategory = categories[0]?.name || '';
		newCategoryName = '';
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
		newCategoryName = '';
		formSku = prod.sku;
		formPrice = prod.price;
		formCostPrice = prod.cost_price;
		formStock = prod.stock;
		formUnit = prod.unit;
		formError = null;
		isModalOpen = true;
	}

	function openRestockModal(prod: Product) {
		restockProduct = prod;
		restockQuantity = 10;
		restockNotes = '';
		restockError = null;
		isRestockModalOpen = true;
	}

	function openDeleteModal(prod: Product) {
		productToDelete = prod;
		isDeleteModalOpen = true;
	}

	async function openHistoryModal(prod: Product) {
		historyProduct = prod;
		const list = await db.stock_movements.where('product_id').equals(prod.id).toArray();
		productMovements = list
			.sort((a, b) => b.created_at.localeCompare(a.created_at))
			.slice(0, 50);
		isHistoryModalOpen = true;
	}

	async function confirmDeleteProduct() {
		if (!productToDelete) return;

		const prod = productToDelete;
		const now = new Date().toISOString();
		const branchId = authState.branch?.id || authState.user?.branch_id || 'all';

		// 1. Hapus dari IndexedDB lokal
		await db.products.delete(prod.id);

		// 2. Tambahkan ke antrean sinkronisasi
		await db.sync_queue.add({
			id: 'sq-' + Date.now(),
			entity: 'product',
			action: 'delete',
			data: { id: prod.id, name: prod.name, sku: prod.sku },
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});

		// 3. Log aktivitas kasir
		await db.activity_logs.add({
			id: 'act-' + Date.now(),
			branch_id: branchId,
			branch_name: authState.branch?.name,
			user_id: authState.user?.id || '-',
			user_name: authState.user?.name || 'Kasir',
			role: 'cashier',
			action: 'delete_product',
			details: `Menghapus produk: ${prod.name} (SKU: ${prod.sku})`,
			timestamp: now,
			synced: false
		});

		await syncEngine.updatePendingCount();
		await loadData();
		isDeleteModalOpen = false;
		productToDelete = null;

		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
	}

	async function handleRestock() {
		restockError = null;
		if (!restockProduct) return;

		const qty = Number(restockQuantity);
		if (isNaN(qty) || qty <= 0) {
			restockError = 'Jumlah restock harus lebih dari 0';
			return;
		}

		const prod = await db.products.get(restockProduct.id);
		if (!prod) {
			restockError = 'Produk tidak ditemukan';
			return;
		}

		const now = new Date().toISOString();
		const branchId = authState.branch?.id || authState.user?.branch_id || 'all';
		const oldStock = prod.stock;
		const newStock = oldStock + qty;

		const updatedProduct: Product = {
			...prod,
			stock: newStock,
			updated_at: now,
			version: prod.version + 1
		};

		// 1. Perbarui stok lokal di IndexedDB + catat ledger stok (audit)
		await db.products.put(updatedProduct);

		await db.stock_movements.put({
			id: `mv-restock-${prod.id}-${Date.now()}`,
			branch_id: branchId,
			product_id: prod.id,
			quantity: qty,
			type: 'restock',
			reason: restockNotes.trim() || undefined,
			user_id: authState.user?.id || '-',
			user_name: authState.user?.name || 'Kasir',
			created_at: now,
			synced: false
		});

		// 2. Catat ke antrean sinkronisasi
		await db.sync_queue.add({
			id: 'sq-' + Date.now(),
			entity: 'product',
			action: 'update',
			data: updatedProduct,
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});

		// 3. Catat ke Activity Logs
		const noteSuffix = restockNotes.trim() ? ` - Catatan: ${restockNotes.trim()}` : '';
		await db.activity_logs.add({
			id: 'act-' + Date.now(),
			branch_id: branchId,
			branch_name: authState.branch?.name,
			user_id: authState.user?.id || '-',
			user_name: authState.user?.name || 'Kasir',
			role: 'cashier',
			action: 'restock_product',
			details: `Restock produk ${prod.name}: +${qty} ${prod.unit} (Stok: ${oldStock} -> ${newStock})${noteSuffix}`,
			timestamp: now,
			synced: false
		});

		await syncEngine.updatePendingCount();
		await loadData();
		isRestockModalOpen = false;
		restockProduct = null;

		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
	}

	async function registerCategory(categoryName: string) {
		const catName = categoryName.trim();
		if (!catName) return;
		const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
		const catId = 'cat-' + (slug || Date.now().toString(36));
		const existing = await db.categories.get(catId);
		if (existing) {
			if (existing.name !== catName) {
				await db.categories.update(catId, { name: catName });
			}
			return;
		}
		await db.categories.put({ id: catId, name: catName });
		await db.sync_queue.add({
			id: 'sq-' + Date.now() + '-cat',
			entity: 'category',
			action: 'insert',
			data: { id: catId, name: catName },
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});
	}

	async function saveProduct() {
		formError = null;
		if (formCategory === '__new__') {
			if (!newCategoryName.trim()) {
				formError = 'Nama kategori baru wajib diisi';
				return;
			}
			formCategory = newCategoryName.trim();
		}
		if (!formName.trim()) {
			formError = 'Nama produk wajib diisi';
			return;
		}
		if (!formCategory.trim()) {
			formError = 'Kategori wajib diisi';
			return;
		}
		if (formPrice <= 0) {
			formError = 'Harga jual harus lebih besar dari 0';
			return;
		}

		const now = new Date().toISOString();
		const branchId = authState.branch?.id || authState.user?.branch_id || 'all';

		await registerCategory(formCategory);

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
				user_id: authState.user?.id || '-',
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
				user_id: authState.user?.id || '-',
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
			<p class="text-xs text-gray-500 mt-0.5">Kelola ketersediaan inventaris cabang {authState.branch?.name || '-'}</p>
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
								<td class="px-5 py-3.5 text-right whitespace-nowrap">
									<button
										onclick={() => openHistoryModal(prod)}
										class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 font-semibold transition cursor-pointer mr-1.5"
										title="Riwayat Pergerakan Stok"
									>
										<History class="h-3.5 w-3.5" />
										<span>Riwayat</span>
									</button>
									<button
										onclick={() => openRestockModal(prod)}
										class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold transition cursor-pointer mr-1.5"
										title="Restock Tambah Stok"
									>
										<PackagePlus class="h-3.5 w-3.5" />
										<span>Restock</span>
									</button>
									<button
										onclick={() => openEditModal(prod)}
										class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 font-semibold transition cursor-pointer mr-1.5"
										title="Ubah Produk"
									>
										<Edit3 class="h-3.5 w-3.5" />
										<span>Edit</span>
									</button>
									<button
										onclick={() => openDeleteModal(prod)}
										class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold transition cursor-pointer"
										title="Hapus Produk"
									>
										<Trash2 class="h-3.5 w-3.5" />
										<span>Hapus</span>
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
							class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white focus:outline-hidden focus:border-emerald-500"
						>
							<option value="" disabled>Pilih kategori</option>
							{#each categories as cat}
								<option value={cat.name}>{cat.name}</option>
							{/each}
							{#if formCategory && formCategory !== '__new__' && !categories.some(c => c.name === formCategory)}
								<option value={formCategory}>{formCategory}</option>
							{/if}
							<option value="__new__">+ Kategori baru...</option>
						</select>
						{#if formCategory === '__new__'}
							<input
								type="text"
								bind:value={newCategoryName}
								placeholder="Nama kategori baru"
								class="w-full px-3 py-2 mt-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-emerald-500"
							/>
						{/if}
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
						class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold cursor-pointer"
					>
						Batal
					</button>
					<button
						onclick={saveProduct}
						class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition cursor-pointer"
					>
						Simpan Produk
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Restock Produk -->
{#if isRestockModalOpen && restockProduct}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
						<PackagePlus class="h-4 w-4" />
					</div>
					<h3 class="text-base font-bold text-gray-900">Restock Produk</h3>
				</div>
				<button onclick={() => isRestockModalOpen = false} class="text-gray-400 hover:text-gray-600 cursor-pointer">
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-4 text-xs">
				<!-- Info Produk Saat Ini -->
				<div class="rounded-xl bg-gray-50 p-3 border border-gray-100 flex items-center justify-between">
					<div>
						<p class="font-bold text-gray-900 text-sm">{restockProduct.name}</p>
						<p class="text-[11px] text-gray-400 font-mono mt-0.5">{restockProduct.sku} • {restockProduct.category}</p>
					</div>
					<div class="text-right">
						<span class="text-[10px] text-gray-500 block">Stok Sekarang</span>
						<span class="font-bold text-gray-800 text-sm">{restockProduct.stock} {restockProduct.unit}</span>
					</div>
				</div>

				<!-- Input Kuantitas Restock -->
				<div>
					<label for="restockQuantity" class="block font-semibold text-gray-700 mb-1">
						Jumlah Masuk ({restockProduct.unit})
					</label>
					<input
						id="restockQuantity"
						type="number"
						bind:value={restockQuantity}
						min="1"
						class="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-bold text-base text-gray-900 focus:outline-hidden focus:border-emerald-500"
					/>
				</div>

				<!-- Tombol Cepat Jumlah -->
				<div class="flex flex-wrap gap-2">
					{#each [5, 10, 20, 50, 100] as amount}
						<button
							type="button"
							onclick={() => restockQuantity = amount}
							class="px-2.5 py-1 rounded-lg border text-xs font-semibold transition cursor-pointer {restockQuantity === amount ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}"
						>
							+{amount}
						</button>
					{/each}
				</div>

				<!-- Hasil Estimasi Stok Setelah Restock -->
				<div class="flex items-center justify-between p-3 rounded-xl bg-emerald-50/70 border border-emerald-100 text-emerald-900">
					<span class="font-medium text-xs">Estimasi Stok Akhir:</span>
					<span class="font-bold text-sm">
						{Math.max(0, restockProduct.stock + (Number(restockQuantity) || 0))} {restockProduct.unit}
					</span>
				</div>

				<!-- Catatan Restock -->
				<div>
					<label for="restockNotes" class="block font-semibold text-gray-700 mb-1">
						Catatan / Keterangan Restock (Opsional)
					</label>
					<input
						id="restockNotes"
						type="text"
						bind:value={restockNotes}
						placeholder="Contoh: Pengiriman supplier mingguan, restock gudang"
						class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-emerald-500"
					/>
				</div>

				{#if restockError}
					<div class="flex items-center gap-1.5 p-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-medium">
						<AlertCircle class="h-4 w-4 shrink-0" />
						<span>{restockError}</span>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
					<button
						onclick={() => isRestockModalOpen = false}
						class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold cursor-pointer"
					>
						Batal
					</button>
					<button
						onclick={handleRestock}
						class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition cursor-pointer shadow-md shadow-emerald-600/20"
					>
						Konfirmasi Restock
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Riwayat Pergerakan Stok -->
{#if isHistoryModalOpen && historyProduct}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
						<History class="h-4 w-4" />
					</div>
					<div>
						<h3 class="text-base font-bold text-gray-900">Riwayat Pergerakan Stok</h3>
						<p class="text-[11px] text-gray-400">{historyProduct.name} • {historyProduct.sku}</p>
					</div>
				</div>
				<button onclick={() => isHistoryModalOpen = false} class="text-gray-400 hover:text-gray-600 cursor-pointer">
					<X class="h-5 w-5" />
				</button>
			</div>

			{#if productMovements.length === 0}
				<p class="text-xs text-gray-400 text-center py-8">Belum ada pergerakan stok tercatat untuk produk ini.</p>
			{:else}
				<div class="max-h-80 overflow-y-auto divide-y divide-gray-100 text-xs">
					{#each productMovements as mv}
						<div class="flex items-center justify-between py-2.5">
							<div>
								<div class="flex items-center gap-2">
									<span class="font-semibold {mv.quantity >= 0 ? 'text-emerald-700' : 'text-rose-700'}">
										{mv.quantity >= 0 ? '+' : ''}{mv.quantity} {historyProduct.unit}
									</span>
									<span class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
										{movementLabels[mv.type] || mv.type}
									</span>
								</div>
								{#if mv.reason}
									<p class="text-[11px] text-gray-500 mt-0.5">{mv.reason}</p>
								{/if}
							</div>
							<div class="text-right text-[11px] text-gray-400">
								<div>{new Date(mv.created_at).toLocaleString('id-ID')}</div>
								<div>{mv.user_name}</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex items-center justify-end pt-3 border-t border-gray-100 mt-3">
				<button
					onclick={() => isHistoryModalOpen = false}
					class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-xs cursor-pointer"
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Konfirmasi Hapus Produk -->
{#if isDeleteModalOpen && productToDelete}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center gap-3 mb-3">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
					<Trash2 class="h-5 w-5" />
				</div>
				<div>
					<h3 class="text-base font-bold text-gray-900">Hapus Produk?</h3>
					<p class="text-xs text-gray-500">Tindakan ini tidak dapat dibatalkan</p>
				</div>
			</div>

			<div class="my-4 rounded-xl bg-gray-50 p-3 border border-gray-100 text-xs space-y-1">
				<div class="font-bold text-gray-800">{productToDelete.name}</div>
				<div class="text-gray-500 font-mono text-[11px]">{productToDelete.sku} • {productToDelete.category}</div>
				<div class="text-gray-500 text-[11px]">Sisa Stok: <span class="font-bold text-gray-700">{productToDelete.stock} {productToDelete.unit}</span></div>
			</div>

			<p class="text-xs text-gray-600 mb-5 leading-relaxed">
				Apakah Anda yakin ingin menghapus produk ini dari daftar inventaris? Riwayat transaksi sebelumnya tetap tersimpan secara aman.
			</p>

			<div class="flex items-center justify-end gap-2">
				<button
					onclick={() => { isDeleteModalOpen = false; productToDelete = null; }}
					class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-xs cursor-pointer"
				>
					Batal
				</button>
				<button
					onclick={confirmDeleteProduct}
					class="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition cursor-pointer shadow-md shadow-rose-600/20"
				>
					Hapus Produk
				</button>
			</div>
		</div>
	</div>
{/if}
