<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import { hashPin } from '../auth/pin.js';
	import type { User, Branch, Role } from '../types/index.js';
	import {
		UserPlus,
		Users,
		Edit3,
		Trash2,
		ShieldCheck,
		Search,
		Building2,
		KeyRound,
		AlertCircle,
		X
	} from 'lucide-svelte';

	let users = $state<User[]>([]);
	let branches = $state<Branch[]>([]);
	let searchQuery = $state<string>('');

	// Modal State
	let isModalOpen = $state<boolean>(false);
	let isEditing = $state<boolean>(false);
	let formId = $state<string>('');
	let formUsername = $state<string>('');
	let formName = $state<string>('');
	let formRole = $state<Role>('cashier');
	let formBranchId = $state<string>('');
	let formPin = $state<string>('');
	let formActive = $state<boolean>(true);
	let formError = $state<string | null>(null);

	onMount(async () => {
		await loadUsersAndBranches();
	});

	async function loadUsersAndBranches() {
		branches = await db.branches.toArray();
		users = await db.users.toArray();
	}

	let filteredUsers = $derived(
		users.filter(u =>
			searchQuery.trim() === '' ||
			u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			u.username.toLowerCase().includes(searchQuery.toLowerCase())
		)
	);

	function openAddModal() {
		isEditing = false;
		formId = '';
		formUsername = '';
		formName = '';
		formRole = 'cashier';
		formBranchId = branches[0]?.id || '';
		formPin = '';
		formActive = true;
		formError = null;
		isModalOpen = true;
	}

	function openEditModal(user: User) {
		isEditing = true;
		formId = user.id;
		formUsername = user.username;
		formName = user.name;
		formRole = user.role;
		formBranchId = user.branch_id;
		formPin = '';
		formActive = user.active;
		formError = null;
		isModalOpen = true;
	}

	async function saveUser() {
		formError = null;

		if (!formUsername.trim()) {
			formError = 'Username wajib diisi';
			return;
		}
		if (!formName.trim()) {
			formError = 'Nama lengkap wajib diisi';
			return;
		}
		if (formRole === 'cashier' && !formBranchId) {
			formError = 'Cabang wajib dipilih. Buat cabang terlebih dahulu di menu Kelola Cabang.';
			return;
		}
		if (!isEditing && (!formPin.trim() || formPin.trim().length < 4)) {
			formError = 'PIN kasir minimal 4 digit';
			return;
		}
		if (isEditing && formPin.trim() && formPin.trim().length < 4) {
			formError = 'PIN kasir minimal 4 digit';
			return;
		}

		const now = new Date().toISOString();

		if (isEditing) {
			const currentUser = users.find(u => u.id === formId);
			const pinValue = formPin.trim() ? await hashPin(formPin.trim()) : (currentUser?.pin || '');
			const updatedUser: User = {
				id: formId,
				username: formUsername.trim().toLowerCase(),
				name: formName.trim(),
				role: formRole,
				branch_id: formRole === 'admin' ? 'all' : formBranchId,
				pin: pinValue,
				active: formActive,
				created_at: currentUser?.created_at || now,
				updated_at: now
			};

			await db.users.put(updatedUser);

			await db.sync_queue.add({
				id: 'sq-' + Date.now(),
				entity: 'user',
				action: 'update',
				data: updatedUser,
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
				action: 'update_user',
				details: `Admin memperbarui data user: ${updatedUser.name} (${updatedUser.role})`,
				timestamp: now,
				synced: false
			});
		} else {
			// Cek duplikasi username
			const exists = users.some(u => u.username.toLowerCase() === formUsername.trim().toLowerCase());
			if (exists) {
				formError = 'Username sudah digunakan, silakan pilih yang lain';
				return;
			}

			const newUser: User = {
				id: 'usr-' + Date.now(),
				username: formUsername.trim().toLowerCase(),
				name: formName.trim(),
				role: formRole,
				branch_id: formRole === 'admin' ? 'all' : formBranchId,
				pin: await hashPin(formPin.trim()),
				active: true,
				created_at: now,
				updated_at: now
			};

			await db.users.add(newUser);

			await db.sync_queue.add({
				id: 'sq-' + Date.now(),
				entity: 'user',
				action: 'insert',
				data: newUser,
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
				action: 'create_user',
				details: `Admin menambahkan pengguna baru: ${newUser.name} (${newUser.role})`,
				timestamp: now,
				synced: false
			});
		}

		await syncEngine.updatePendingCount();
		await loadUsersAndBranches();
		isModalOpen = false;

		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
	}

	async function deleteUser(user: User) {
		if (user.id === authState.user?.id) {
			alert('Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.');
			return;
		}

		if (confirm(`Apakah Anda yakin ingin menghapus akun pengguna "${user.name}"?`)) {
			await db.users.delete(user.id);

			await db.sync_queue.add({
				id: 'sq-' + Date.now(),
				entity: 'user',
				action: 'delete',
				data: { id: user.id },
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
				action: 'delete_user',
				details: `Admin menghapus pengguna ${user.name} (${user.username})`,
				timestamp: new Date().toISOString(),
				synced: false
			});

			await syncEngine.updatePendingCount();
			await loadUsersAndBranches();
		}
	}

	function getBranchName(branchId: string): string {
		if (branchId === 'all') return 'Semua Cabang (Global Admin)';
		const b = branches.find(item => item.id === branchId);
		return b ? `${b.name} (${b.code})` : branchId;
	}
</script>

<div class="space-y-6">
	<!-- Top Bar -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
		<div>
			<h2 class="text-lg font-bold text-gray-900">Manajemen Pengguna Sistem</h2>
			<p class="text-xs text-gray-500 mt-0.5">Tambah, ubah hak akses, reset PIN, dan kelola penempatan cabang kasir</p>
		</div>

		<div class="flex items-center gap-3">
			<div class="relative flex-1 sm:w-64">
				<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Cari nama atau username..."
					class="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-hidden focus:border-indigo-500"
				/>
			</div>

			<button
				onclick={openAddModal}
				class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 active:scale-95 transition cursor-pointer"
			>
				<UserPlus class="h-4 w-4" />
				<span>Tambah Pengguna</span>
			</button>
		</div>
	</div>

	<!-- Tabel Pengguna -->
	<div class="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-left text-xs">
				<thead class="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-100">
					<tr>
						<th class="px-5 py-3.5">Nama & Username</th>
						<th class="px-5 py-3.5">Peran (Role)</th>
						<th class="px-5 py-3.5">Penugasan Cabang</th>
						<th class="px-5 py-3.5">PIN Masuk</th>
						<th class="px-5 py-3.5">Status Akun</th>
						<th class="px-5 py-3.5 text-right">Aksi</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100 font-medium text-gray-700">
					{#each filteredUsers as user}
						<tr class="hover:bg-gray-50/60 transition">
							<td class="px-5 py-3.5">
								<div class="font-bold text-gray-900">{user.name}</div>
								<div class="text-[11px] text-gray-400 font-mono">@{user.username}</div>
							</td>
							<td class="px-5 py-3.5">
								{#if user.role === 'admin'}
									<span class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 border border-indigo-200">
										<ShieldCheck class="h-3 w-3" /> Admin
									</span>
								{:else}
									<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
										Kasir
									</span>
								{/if}
							</td>
							<td class="px-5 py-3.5">
								<div class="flex items-center gap-1.5 text-gray-600">
									<Building2 class="h-3.5 w-3.5 text-gray-400 shrink-0" />
									<span>{getBranchName(user.branch_id)}</span>
								</div>
							</td>
							<td class="px-5 py-3.5">
								<span class="font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded text-[11px] tracking-widest">
									&bull;&bull;&bull;&bull;
								</span>
							</td>
							<td class="px-5 py-3.5">
								<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold {user.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
									{user.active ? 'Aktif' : 'Dinonaktifkan'}
								</span>
							</td>
							<td class="px-5 py-3.5 text-right space-x-1">
								<button
									onclick={() => openEditModal(user)}
									class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 font-semibold transition cursor-pointer"
								>
									<Edit3 class="h-3.5 w-3.5" />
									<span>Ubah</span>
								</button>
								{#if user.id !== authState.user?.id}
									<button
										onclick={() => deleteUser(user)}
										class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold transition cursor-pointer"
									>
										<Trash2 class="h-3.5 w-3.5" />
										<span>Hapus</span>
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>

<!-- Modal Tambah / Edit Pengguna -->
{#if isModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
				<h3 class="text-base font-bold text-gray-900">
					{isEditing ? 'Ubah Data Pengguna' : 'Tambah Pengguna Baru'}
				</h3>
				<button onclick={() => isModalOpen = false} class="text-gray-400 hover:text-gray-600">
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-3.5 text-xs">
				<div>
					<label for="formUsername" class="block font-semibold text-gray-700 mb-1">Username Masuk</label>
					<input
						id="formUsername"
						type="text"
						bind:value={formUsername}
						placeholder="Contoh: kasir_jaksel"
						disabled={isEditing}
						class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-indigo-500 disabled:bg-gray-100 disabled:text-gray-500"
					/>
				</div>

				<div>
					<label for="formName" class="block font-semibold text-gray-700 mb-1">Nama Lengkap</label>
					<input
						id="formName"
						type="text"
						bind:value={formName}
						placeholder="Contoh: Siti Rahmawati"
						class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-indigo-500"
					/>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="formRole" class="block font-semibold text-gray-700 mb-1">Peran Akun</label>
						<select
							id="formRole"
							bind:value={formRole}
							class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-indigo-500 font-semibold"
						>
							<option value="cashier">Kasir Cabang</option>
							<option value="admin">Administrator</option>
						</select>
					</div>

					<div>
						<label for="formPin" class="block font-semibold text-gray-700 mb-1">PIN / Sandi Masuk</label>
						<input
							id="formPin"
							type="text"
							bind:value={formPin}
							placeholder="4-6 digit angka"
							class="w-full px-3 py-2 rounded-xl border border-gray-200 font-mono tracking-widest focus:outline-hidden focus:border-indigo-500"
						/>
					</div>
				</div>

				{#if formRole === 'cashier'}
					<div>
						<label for="formBranchId" class="block font-semibold text-gray-700 mb-1">Penugasan Cabang</label>
						<select
							id="formBranchId"
							bind:value={formBranchId}
							class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-indigo-500"
						>
							{#each branches as b}
								<option value={b.id}>{b.name} ({b.code})</option>
							{/each}
						</select>
					</div>
				{/if}

				{#if isEditing}
					<div class="flex items-center gap-2 pt-1">
						<input
							id="formActive"
							type="checkbox"
							bind:checked={formActive}
							class="rounded text-indigo-600 focus:ring-indigo-500"
						/>
						<label for="formActive" class="text-xs font-semibold text-gray-700 cursor-pointer">
							Akun Aktif (Dapat masuk ke aplikasi)
						</label>
					</div>
				{/if}

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
						onclick={saveUser}
						class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition"
					>
						Simpan Data
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

