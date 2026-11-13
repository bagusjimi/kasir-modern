<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.svelte.js';
	import type { Category, Product } from '../types/index.js';
	import {
		Tags,
		Plus,
		Pencil,
		Trash2,
		CheckCircle2,
		AlertCircle,
		X,
		Search
	} from 'lucide-svelte';

	let categories = $state<Category[]>([]);
	let productCounts = $state<Record<string, number>>({});
	let searchQuery = $state<string>('');
	let isLoading = $state<boolean>(true);
	let isSaving = $state<boolean>(false);
	let notification = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	// Modal Rename
	let isRenameOpen = $state<boolean>(false);
	let renameId = $state<string>('');
	let renameName = $state<string>('');
	let renameError = $state<string | null>(null);

	// Modal Konfirmasi Hapus
	let isDeleteOpen = $state<boolean>(false);
	let deleteCategory = $state<Category | null>(null);

	const filteredCategories = $derived(
		categories.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
	);

	async function loadCategories() {
		isLoading = true;
		try {
			const [cats, products] = await Promise.all([
				db.categories.orderBy('name').toArray(),
				db.products.toArray()
			]);
			categories = cats;
			const counts: Record<string, number> = {};
			for (const p of products) {
				if (p.category) counts[p.category] = (counts[p.category] || 0) + 1;
			}
			productCounts = counts;
		} catch (err) {
			console.error('Gagal memuat kategori:', err);
		} finally {
			isLoading = false;
		}
	}

	function openRenameModal(cat: Category) {
		renameId = cat.id;
		renameName = cat.name;
		renameError = null;
		isRenameOpen = true;
	}

	function openDeleteModal(cat: Category) {
		deleteCategory = cat;
	}

	async function saveRename() {
		renameError = null;
		const newName = renameName.trim();
		if (!newName) {
			renameError = 'Nama kategori tidak boleh kosong';
			return;
		}

		const duplicate = categories.find((c) => c.name.toLowerCase() === newName.toLowerCase() && c.id !== renameId);
		if (duplicate) {
			renameError = 'Kategori dengan nama tersebut sudah ada';
			return;
		}

		isSaving = true;
		try {
			const existing = await db.categories.get(renameId);
			if (!existing) {
				renameError = 'Kategori tidak ditemukan';
				return;
			}

			const oldName = existing.name;
			const now = new Date().toISOString();

			// Update kategori (id tetap, nama berubah)
			await db.categories.put({
				id: existing.id,
				name: newName,
				updated_at: now
			});
			await db.sync_queue.add({
				id: 'sq-' + Date.now() + '-cat',
				entity: 'category',
				action: 'update',
				data: { id: existing.id, name: newName, updated_at: now },
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			// Perbarui semua produk yang memakai nama lama
			if (oldName !== newName) {
				const affected = await db.products.where('category').equals(oldName).toArray();
				for (const prod of affected as Product[]) {
					const updatedProduct: Product = {
						...prod,
						category: newName,
						updated_at: now,
						version: (prod.version || 1) + 1
					};
					await db.products.put(updatedProduct);
					await db.sync_queue.add({
						id: 'sq-' + Date.now() + '-' + prod.id,
						entity: 'product',
						action: 'update',
						data: updatedProduct,
						timestamp: Date.now(),
						retry_count: 0,
						status: 'pending'
					});
				}
			}

			if (authState.user) {
				await db.activity_logs.add({
					id: 'act-' + Date.now(),
					branch_id: authState.user.branch_id || 'all',
					branch_name: 'Pusat',
					user_id: authState.user.id,
					user_name: authState.user.name,
					role: authState.user.role,
					action: 'update_category',
					details: `Mengubah nama kategori: ${oldName} menjadi ${newName}`,
					timestamp: now,
					synced: false
				});
			}

			isRenameOpen = false;
			notification = { type: 'success', message: `Kategori berhasil diubah menjadi "${newName}"` };
			await loadCategories();
			syncEngine.triggerSync();
		} catch (err: any) {
			renameError = err.message || 'Gagal menyimpan kategori';
		} finally {
			isSaving = false;
		}
	}

	async function confirmDelete() {
		if (!deleteCategory) return;
		isSaving = true;
		try {
			await db.categories.delete(deleteCategory.id);
			await db.sync_queue.add({
				id: 'sq-' + Date.now() + '-cat',
				entity: 'category',
				action: 'delete',
				data: { id: deleteCategory.id },
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			if (authState.user) {
				await db.activity_logs.add({
					id: 'act-' + Date.now(),
					branch_id: authState.user.branch_id || 'all',
					branch_name: 'Pusat',
					user_id: authState.user.id,
					user_name: authState.user.name,
					role: authState.user.role,
					action: 'delete_category',
					details: `Menghapus kategori: ${deleteCategory.name}`,
					timestamp: new Date().toISOString(),
					synced: false
				});
			}

			notification = { type: 'success', message: `Kategori "${deleteCategory.name}" berhasil dihapus` };
			isDeleteOpen = false;
			deleteCategory = null;
			await loadCategories();
			syncEngine.triggerSync();
		} catch (err: any) {
			notification = { type: 'error', message: err.message || 'Gagal menghapus kategori' };
		} finally {
			isSaving = false;
		}
	}

	function dismissNotification() {
		notification = null;
	}

	onMount(() => {
		loadCategories();
	});
</script>

<div class="space-y-6">
	<!-- Page Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div class="flex items-center gap-2">
			<div class="p-2 rounded-xl bg-emerald-100 text-emerald-800">
				<Tags class="h-6 w-6" />
			</div>
			<div>
				<h1 class="text-2xl font-black text-gray-900 tracking-tight">Manajemen Kategori</h1>
				<p class="text-xs text-gray-500">Kelola daftar kategori produk agar konsisten di semua cabang dan mudah dianalisis.</p>
			</div>
		</div>
	</div>

	<!-- Notifikasi -->
	{#if notification}
		<div
			class="p-4 rounded-2xl flex items-start gap-3 transition-all {notification.type === 'success'
				? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
				: 'bg-rose-50 border border-rose-200 text-rose-800'}"
		>
			{#if notification.type === 'success'}
				<CheckCircle2 class="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
			{:else}
				<AlertCircle class="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
			{/if}
			<div class="flex-1 text-sm font-medium">
				{notification.message}
			</div>
			<button
				onclick={dismissNotification}
				class="text-xs opacity-60 hover:opacity-100 font-bold ml-2 cursor-pointer"
			>
				&#10005;
			</button>
		</div>
	{/if}

	<!-- Pencarian -->
	<div class="relative max-w-sm">
		<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Cari kategori..."
			class="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm"
		/>
	</div>

	<!-- Daftar Kategori -->
	<div class="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-left text-xs">
				<thead class="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-100">
					<tr>
						<th class="px-5 py-3.5">Kategori</th>
						<th class="px-5 py-3.5">Jumlah Produk</th>
						<th class="px-5 py-3.5 text-right">Aksi</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100 font-medium text-gray-700">
					{#if isLoading}
						<tr>
							<td colspan="3" class="px-5 py-12 text-center text-gray-400">Memuat kategori...</td>
						</tr>
					{:else if filteredCategories.length === 0}
						<tr>
							<td colspan="3" class="px-5 py-12 text-center text-gray-400">
								<Tags class="h-10 w-10 mx-auto mb-2 text-gray-300 stroke-1" />
								{searchQuery ? 'Tidak ada kategori yang sesuai pencarian.' : 'Belum ada kategori. Kategori dibuat otomatis saat produk disimpan.'}
							</td>
						</tr>
					{:else}
						{#each filteredCategories as cat (cat.id)}
							<tr class="hover:bg-gray-50/60 transition">
								<td class="px-5 py-3.5">
									<span class="bg-gray-100 text-gray-700 px-2.5 py-0.5 rounded-md font-semibold text-[11px]">
										{cat.name}
									</span>
								</td>
								<td class="px-5 py-3.5">
									<span class="font-bold text-gray-900">{productCounts[cat.name] || 0}</span>
									<span class="text-gray-400">produk</span>
								</td>
								<td class="px-5 py-3.5">
									<div class="flex items-center justify-end gap-1.5">
										<button
											onclick={() => openRenameModal(cat)}
											class="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
											title="Ubah nama kategori"
										>
											<Pencil class="h-3.5 w-3.5" />
										</button>
										<button
											onclick={() => openDeleteModal(cat)}
											class="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
											title="Hapus kategori"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Modal Rename -->
	{#if isRenameOpen}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
			<div class="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 space-y-4">
				<div class="flex items-center justify-between">
					<h3 class="text-base font-bold text-gray-900">Ubah Nama Kategori</h3>
					<button
						onclick={() => isRenameOpen = false}
						class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition cursor-pointer"
						aria-label="Tutup"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
				<div>
					<label for="rename-category-input" class="block font-semibold text-gray-700 mb-1">Nama Kategori</label>
					<input
						id="rename-category-input"
						type="text"
						bind:value={renameName}
						class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-emerald-500"
					/>
					{#if renameError}
						<div class="flex items-center gap-1.5 mt-2 p-2 rounded-lg bg-rose-50 text-rose-700 text-xs font-medium">
							<AlertCircle class="h-4 w-4 shrink-0" />
							<span>{renameError}</span>
						</div>
					{/if}
					<p class="text-[11px] text-gray-400 mt-2">
						Semua produk yang memakai nama lama akan otomatis diperbarui ke nama baru dan disinkronkan.
					</p>
				</div>
				<div class="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
					<button
						onclick={() => isRenameOpen = false}
						class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold cursor-pointer"
					>
						Batal
					</button>
					<button
						onclick={saveRename}
						disabled={isSaving}
						class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-60"
					>
						{isSaving ? 'Menyimpan...' : 'Simpan'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal Konfirmasi Hapus -->
	{#if isDeleteOpen && deleteCategory}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
			<div class="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 space-y-4">
				<div class="flex items-center gap-2 text-rose-600 font-bold">
					<AlertCircle class="h-5 w-5" />
					<span>Hapus Kategori</span>
				</div>
				{#if (productCounts[deleteCategory.name] || 0) > 0}
					<p class="text-sm text-gray-600">
						Kategori <span class="font-bold">"{deleteCategory.name}"</span> masih dipakai oleh
						<span class="font-bold">{productCounts[deleteCategory.name]} produk</span>.
						Pindahkan produk ke kategori lain terlebih dahulu sebelum menghapus.
					</p>
					<div class="flex items-center justify-end pt-2 border-t border-gray-100">
						<button
							onclick={() => isDeleteOpen = false}
							class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold cursor-pointer"
						>
							Tutup
						</button>
					</div>
				{:else}
					<p class="text-sm text-gray-600">
						Yakin ingin menghapus kategori <span class="font-bold">"{deleteCategory.name}"</span>? Tindakan ini juga akan dihapus dari semua perangkat saat tersinkronisasi.
					</p>
					<div class="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
						<button
							onclick={() => isDeleteOpen = false}
							class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold cursor-pointer"
						>
							Batal
						</button>
						<button
							onclick={confirmDelete}
							disabled={isSaving}
							class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer disabled:opacity-60"
						>
							{isSaving ? 'Menghapus...' : 'Hapus'}
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
