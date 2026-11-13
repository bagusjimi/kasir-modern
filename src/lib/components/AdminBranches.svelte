<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Branch, User, Product } from '../types/index.js';
	import {
		Building2,
		Plus,
		Edit3,
		Trash2,
		Search,
		Users,
		Package,
		AlertCircle,
		X,
		MapPin,
		Phone
	} from 'lucide-svelte';

	let branches = $state<Branch[]>([]);
	let users = $state<User[]>([]);
	let products = $state<Product[]>([]);
	let searchQuery = $state<string>('');

	// Modal State
	let isModalOpen = $state<boolean>(false);
	let isEditing = $state<boolean>(false);
	let formId = $state<string>('');
	let formCode = $state<string>('');
	let formName = $state<string>('');
	let formAddress = $state<string>('');
	let formPhone = $state<string>('');
	let formError = $state<string | null>(null);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		branches = await db.branches.toArray();
		users = await db.users.toArray();
		products = await db.products.toArray();
	}

	let filteredBranches = $derived(
		branches.filter(b =>
			searchQuery.trim() === '' ||
			b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			b.code.toLowerCase().includes(searchQuery.toLowerCase())
		)
	);

	function countUsers(branchId: string): number {
		return users.filter(u => u.branch_id === branchId).length;
	}

	function countProducts(branchId: string): number {
		return products.filter(p => p.branch_id === branchId).length;
	}

	function openAddModal() {
		isEditing = false;
		formId = '';
		formCode = '';
		formName = '';
		formAddress = '';
		formPhone = '';
		formError = null;
		isModalOpen = true;
	}

	function openEditModal(branch: Branch) {
		isEditing = true;
		formId = branch.id;
		formCode = branch.code;
		formName = branch.name;
		formAddress = branch.address || '';
		formPhone = branch.phone || '';
		formError = null;
		isModalOpen = true;
	}

	async function saveBranch() {
		formError = null;

		const cleanCode = formCode.trim().toUpperCase();
		const cleanName = formName.trim();

		if (!cleanCode) {
			formError = 'Kode cabang wajib diisi';
			return;
		}
		if (!/^[A-Z0-9_-]+$/.test(cleanCode)) {
			formError = 'Kode cabang hanya boleh huruf besar, angka, garis, dan garis bawah';
			return;
		}
		if (!cleanName) {
			formError = 'Nama cabang wajib diisi';
			return;
		}

		const duplicateCode = branches.find(b => b.code === cleanCode && b.id !== formId);
		if (duplicateCode) {
			formError = `Kode cabang "${cleanCode}" sudah dipakai oleh cabang lain`;
			return;
		}

		const now = new Date().toISOString();

		if (isEditing) {
			const existing = await db.branches.get(formId);
			const updatedBranch: Branch = {
				id: formId,
				code: cleanCode,
				name: cleanName,
				address: formAddress.trim(),
				phone: formPhone.trim(),
				created_at: existing?.created_at || now,
				updated_at: now
			};

			await db.branches.put(updatedBranch);

			await db.sync_queue.add({
				id: 'sq-' + Date.now(),
				entity: 'branch',
				action: 'update',
				data: updatedBranch,
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			await db.activity_logs.add({
				id: 'act-' + Date.now(),
				branch_id: 'all',
				branch_name: 'Pusat (Admin)',
				user_id: authState.user?.id || 'admin',
				user_name: authState.user?.name || 'Administrator',
				role: 'admin',
				action: 'update_branch',
				details: `Admin memperbarui data cabang: ${updatedBranch.name} (${updatedBranch.code})`,
				timestamp: now,
				synced: false
			});
		} else {
			const newBranch: Branch = {
				id: 'cb-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
				code: cleanCode,
				name: cleanName,
				address: formAddress.trim(),
				phone: formPhone.trim(),
				created_at: now,
				updated_at: now
			};

			await db.branches.put(newBranch);

			await db.sync_queue.add({
				id: 'sq-' + Date.now(),
				entity: 'branch',
				action: 'insert',
				data: newBranch,
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			await db.activity_logs.add({
				id: 'act-' + Date.now(),
				branch_id: 'all',
				branch_name: 'Pusat (Admin)',
				user_id: authState.user?.id || 'admin',
				user_name: authState.user?.name || 'Administrator',
				role: 'admin',
				action: 'create_branch',
				details: `Admin membuat cabang baru: ${newBranch.name} (${newBranch.code})`,
				timestamp: now,
				synced: false
			});
		}

		isModalOpen = false;
		await loadData();
		syncEngine.triggerSync();
	}

	async function deleteBranch(branch: Branch) {
		const linkedUsers = countUsers(branch.id);
		const linkedProducts = countProducts(branch.id);

		if (linkedUsers > 0 || linkedProducts > 0) {
			alert(
				`Cabang "${branch.name}" tidak dapat dihapus karena masih dipakai oleh ${linkedUsers} pengguna dan ${linkedProducts} produk. Pindahkan atau hapus terlebih dahulu data yang terkait.`
			);
			return;
		}

		if (!confirm(`Yakin ingin menghapus cabang "${branch.name} (${branch.code})"? Tindakan ini tidak dapat dibatalkan.`)) {
			return;
		}

		const now = new Date().toISOString();

		await db.branches.delete(branch.id);

		await db.sync_queue.add({
			id: 'sq-' + Date.now(),
			entity: 'branch',
			action: 'delete',
			data: { id: branch.id },
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});

		await db.activity_logs.add({
			id: 'act-' + Date.now(),
			branch_id: 'all',
			branch_name: 'Pusat (Admin)',
			user_id: authState.user?.id || 'admin',
			user_name: authState.user?.name || 'Administrator',
			role: 'admin',
			action: 'delete_branch',
			details: `Admin menghapus cabang: ${branch.name} (${branch.code})`,
			timestamp: now,
			synced: false
		});

		await loadData();
		syncEngine.triggerSync();
	}
</script>

<div class="space-y-6">
	<!-- Top Bar -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
		<div>
			<h2 class="text-lg font-bold text-gray-900">Manajemen Cabang</h2>
			<p class="text-xs text-gray-500 mt-0.5">Tambah, ubah, dan hapus lokasi cabang toko beserta informasi kontaknya</p>
		</div>

		<div class="flex items-center gap-3">
			<div class="relative flex-1 sm:w-64">
				<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Cari nama atau kode cabang..."
					class="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-hidden focus:border-indigo-500"
				/>
			</div>

			<button
				onclick={openAddModal}
				class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 active:scale-95 transition cursor-pointer"
			>
				<Plus class="h-4 w-4" />
				<span>Tambah Cabang</span>
			</button>
		</div>
	</div>

	<!-- Grid Cabang -->
	<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
		{#each filteredBranches as branch (branch.id)}
			<div class="bg-white rounded-2xl border border-gray-200/80 shadow-xs p-5 flex flex-col gap-3">
				<div class="flex items-start justify-between gap-2">
					<div class="flex items-center gap-2.5">
						<div class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
							<Building2 class="h-5 w-5" />
						</div>
						<div>
							<div class="font-bold text-gray-900 text-sm">{branch.name}</div>
							<div class="text-[11px] text-gray-400 font-mono">{branch.code}</div>
						</div>
					</div>
					<div class="flex items-center gap-1">
						<button
							onclick={() => openEditModal(branch)}
							class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 font-semibold transition cursor-pointer"
							aria-label="Ubah cabang"
						>
							<Edit3 class="h-3.5 w-3.5" />
						</button>
						<button
							onclick={() => deleteBranch(branch)}
							class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold transition cursor-pointer"
							aria-label="Hapus cabang"
						>
							<Trash2 class="h-3.5 w-3.5" />
						</button>
					</div>
				</div>

				<div class="space-y-1.5 text-xs text-gray-600">
					{#if branch.address}
						<div class="flex items-start gap-1.5">
							<MapPin class="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />
							<span>{branch.address}</span>
						</div>
					{/if}
					{#if branch.phone}
						<div class="flex items-center gap-1.5">
							<Phone class="h-3.5 w-3.5 text-gray-400 shrink-0" />
							<span>{branch.phone}</span>
						</div>
					{/if}
					{#if !branch.address && !branch.phone}
						<span class="text-gray-400 italic">Tidak ada informasi kontak</span>
					{/if}
				</div>

				<div class="flex items-center gap-2 pt-2 border-t border-gray-100 text-[11px] font-semibold">
					<span class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700 border border-indigo-100">
						<Users class="h-3 w-3" /> {countUsers(branch.id)} pengguna
					</span>
					<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 border border-emerald-100">
						<Package class="h-3 w-3" /> {countProducts(branch.id)} produk
					</span>
				</div>
			</div>
		{:else}
			<div class="col-span-full bg-white rounded-2xl border border-dashed border-gray-300 p-10 text-center text-xs text-gray-400">
				Tidak ada cabang yang cocok dengan pencarian.
			</div>
		{/each}
	</div>
</div>

<!-- Modal Tambah / Edit Cabang -->
{#if isModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
				<h3 class="text-base font-bold text-gray-900">
					{isEditing ? 'Ubah Data Cabang' : 'Tambah Cabang Baru'}
				</h3>
				<button onclick={() => isModalOpen = false} class="text-gray-400 hover:text-gray-600">
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-3.5 text-xs">
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="formCode" class="block font-semibold text-gray-700 mb-1">Kode Cabang</label>
						<input
							id="formCode"
							type="text"
							bind:value={formCode}
							placeholder="Contoh: CB04"
							class="w-full px-3 py-2 rounded-xl border border-gray-200 font-mono uppercase focus:outline-hidden focus:border-indigo-500"
						/>
					</div>

					<div>
						<label for="formName" class="block font-semibold text-gray-700 mb-1">Nama Cabang</label>
						<input
							id="formName"
							type="text"
							bind:value={formName}
							placeholder="Contoh: Cabang Yogyakarta"
							class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-indigo-500"
						/>
					</div>
				</div>

				<div>
					<label for="formAddress" class="block font-semibold text-gray-700 mb-1">Alamat (Opsional)</label>
					<input
						id="formAddress"
						type="text"
						bind:value={formAddress}
						placeholder="Contoh: Jl. Malioboro No. 10, Yogyakarta"
						class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-indigo-500"
					/>
				</div>

				<div>
					<label for="formPhone" class="block font-semibold text-gray-700 mb-1">Telepon (Opsional)</label>
					<input
						id="formPhone"
						type="text"
						bind:value={formPhone}
						placeholder="Contoh: 0274-123456"
						class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-indigo-500"
					/>
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
						onclick={saveBranch}
						class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition"
					>
						Simpan Cabang
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
