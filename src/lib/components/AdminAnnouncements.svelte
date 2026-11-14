<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Announcement, Branch } from '../types/index.js';
	import Pagination from './Pagination.svelte';
	import {
		Megaphone,
		Plus,
		Edit3,
		Trash2,
		X,
		Building2,
		Globe,
		EyeOff,
		Eye,
		AlertCircle
	} from 'lucide-svelte';

	let announcements = $state<Announcement[]>([]);
	let branches = $state<Branch[]>([]);
	let searchQuery = $state<string>('');
	let page = $state<number>(1);
	let perPage = $state<number>(25);

	// Modal State
	let isModalOpen = $state<boolean>(false);
	let isEditing = $state<boolean>(false);
	let formId = $state<string>('');
	let formTitle = $state<string>('');
	let formBody = $state<string>('');
	let formBranchId = $state<string>('all');
	let formError = $state<string | null>(null);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		announcements = await db.announcements.toArray();
		branches = await db.branches.toArray();
		announcements.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
	}

	let filteredAnnouncements = $derived(
		announcements.filter(a =>
			searchQuery.trim() === '' ||
			a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.body.toLowerCase().includes(searchQuery.toLowerCase())
		)
	);

	let pagedAnnouncements = $derived(
		filteredAnnouncements.slice((page - 1) * perPage, page * perPage)
	);

	// Reset ke halaman pertama saat pencarian berubah
	$effect(() => {
		void searchQuery;
		page = 1;
	});

	function branchName(branchId: string): string {
		if (branchId === 'all') return 'Semua Cabang';
		return branches.find(b => b.id === branchId)?.name || 'Cabang tidak dikenal';
	}

	function formatDate(iso: string): string {
		if (!iso) return '-';
		return new Date(iso).toLocaleString('id-ID', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function openAddModal() {
		isEditing = false;
		formId = '';
		formTitle = '';
		formBody = '';
		formBranchId = 'all';
		formError = null;
		isModalOpen = true;
	}

	function openEditModal(an: Announcement) {
		isEditing = true;
		formId = an.id;
		formTitle = an.title;
		formBody = an.body;
		formBranchId = an.branch_id || 'all';
		formError = null;
		isModalOpen = true;
	}

	async function saveAnnouncement() {
		formError = null;

		const cleanTitle = formTitle.trim();
		const cleanBody = formBody.trim();

		if (!cleanTitle) {
			formError = 'Judul pengumuman wajib diisi';
			return;
		}
		if (!cleanBody) {
			formError = 'Isi pengumuman wajib diisi';
			return;
		}

		const now = new Date().toISOString();

		if (isEditing) {
			const existing = await db.announcements.get(formId);
			const updated: Announcement = {
				id: formId,
				branch_id: formBranchId,
				title: cleanTitle,
				body: cleanBody,
				created_by: existing?.created_by || authState.user?.id || 'admin',
				created_by_name: existing?.created_by_name || authState.user?.name || 'Administrator',
				is_active: existing?.is_active ?? true,
				created_at: existing?.created_at || now,
				updated_at: now,
				synced: false
			};

			await db.announcements.put(updated);
			await enqueueAnnouncement('update', updated);
			await logActivity('update_announcement', `Admin memperbarui info internal: ${updated.title}`);
		} else {
			const newAnnouncement: Announcement = {
				id: 'ann-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
				branch_id: formBranchId,
				title: cleanTitle,
				body: cleanBody,
				created_by: authState.user?.id || 'admin',
				created_by_name: authState.user?.name || 'Administrator',
				is_active: true,
				created_at: now,
				updated_at: now,
				synced: false
			};

			await db.announcements.put(newAnnouncement);
			await enqueueAnnouncement('insert', newAnnouncement);
			await logActivity('create_announcement', `Admin membuat info internal: ${newAnnouncement.title}`);
		}

		isModalOpen = false;
		await loadData();
		syncEngine.triggerSync();
	}

	async function toggleActive(an: Announcement) {
		const now = new Date().toISOString();
		const updated: Announcement = { ...an, is_active: !an.is_active, updated_at: now, synced: false };
		await db.announcements.put(updated);
		await enqueueAnnouncement('update', updated);
		await logActivity(
			updated.is_active ? 'activate_announcement' : 'deactivate_announcement',
			`Admin ${updated.is_active ? 'mengaktifkan kembali' : 'menonaktifkan'} info internal: ${updated.title}`
		);
		await loadData();
		syncEngine.triggerSync();
	}

	async function deleteAnnouncement(an: Announcement) {
		if (!confirm(`Yakin ingin menghapus pengumuman "${an.title}"? Kasir tidak akan melihatnya lagi.`)) {
			return;
		}

		await db.announcements.delete(an.id);
		await db.sync_queue.add({
			id: 'sq-' + Date.now(),
			entity: 'announcement',
			action: 'delete',
			data: { id: an.id },
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});
		await logActivity('delete_announcement', `Admin menghapus info internal: ${an.title}`);

		await loadData();
		syncEngine.triggerSync();
	}

	async function enqueueAnnouncement(action: 'insert' | 'update', data: Announcement) {
		await db.sync_queue.add({
			id: 'sq-' + Date.now(),
			entity: 'announcement',
			action,
			data,
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});
	}

	async function logActivity(action: string, details: string) {
		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
			branch_id: 'all',
			branch_name: 'Pusat (Admin)',
			user_id: authState.user?.id || 'admin',
			user_name: authState.user?.name || 'Administrator',
			role: 'admin',
			action,
			details,
			timestamp: new Date().toISOString(),
			synced: false
		});
	}
</script>

<div class="space-y-5">
	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-lg font-bold text-gray-900 flex items-center gap-2">
				<Megaphone class="h-5 w-5 text-emerald-600" />
				Info Internal
			</h2>
			<p class="text-xs text-gray-500 mt-0.5">
				Kirim pengumuman internal kepada kasir di semua cabang atau cabang tertentu.
			</p>
		</div>
		<button
			onclick={openAddModal}
			class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition cursor-pointer"
		>
			<Plus class="h-4 w-4" />
			Buat Pengumuman
		</button>
	</div>

	<!-- Pencarian -->
	<div class="relative max-w-sm">
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Cari judul atau isi pengumuman..."
			class="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-hidden focus:border-emerald-500"
		/>
	</div>

	<!-- Daftar Pengumuman -->
	<div class="rounded-2xl border border-gray-200 bg-white shadow-2xs overflow-hidden">
		{#if pagedAnnouncements.length === 0}
			<div class="flex flex-col items-center justify-center gap-2 py-14 text-center">
				<AlertCircle class="h-8 w-8 text-gray-300" />
				<p class="text-sm font-semibold text-gray-500">Belum ada pengumuman</p>
				<p class="text-xs text-gray-400">Buat pengumuman internal agar kasir mengetahui informasi terbaru.</p>
			</div>
		{:else}
			<ul class="divide-y divide-gray-100">
				{#each pagedAnnouncements as an (an.id)}
					<li class="p-4 hover:bg-gray-50/60 transition {an.is_active ? '' : 'opacity-60'}">
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<h3 class="text-sm font-bold text-gray-900">{an.title}</h3>
									{#if an.is_active}
										<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">Aktif</span>
									{:else}
										<span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 border border-gray-200">Nonaktif</span>
									{/if}
								</div>
								<p class="mt-1 text-xs text-gray-600 whitespace-pre-line line-clamp-3">{an.body}</p>
								<div class="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
									<span class="inline-flex items-center gap-1">
										{#if an.branch_id === 'all'}
											<Globe class="h-3 w-3" />
										{:else}
											<Building2 class="h-3 w-3" />
										{/if}
										{branchName(an.branch_id)}
									</span>
									<span>{formatDate(an.created_at)}</span>
									<span class="text-gray-400">oleh {an.created_by_name || 'Admin'}</span>
								</div>
							</div>
							<div class="flex items-center gap-1 shrink-0">
								<button
									onclick={() => toggleActive(an)}
									class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition cursor-pointer"
									title={an.is_active ? 'Nonaktifkan pengumuman' : 'Aktifkan pengumuman'}
								>
									{#if an.is_active}
										<EyeOff class="h-4 w-4" />
									{:else}
										<Eye class="h-4 w-4" />
									{/if}
								</button>
								<button
									onclick={() => openEditModal(an)}
									class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-emerald-600 transition cursor-pointer"
									title="Ubah pengumuman"
								>
									<Edit3 class="h-4 w-4" />
								</button>
								<button
									onclick={() => deleteAnnouncement(an)}
									class="rounded-lg p-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
									title="Hapus pengumuman"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
			<Pagination bind:page bind:perPage totalItems={filteredAnnouncements.length} label="pengumuman" />
		{/if}
	</div>
</div>

<!-- Modal Form Pengumuman -->
{#if isModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<div class="absolute inset-0 bg-gray-900/40 backdrop-blur-xs" role="presentation" onclick={() => (isModalOpen = false)}></div>
		<div class="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl">
			<div class="flex items-center justify-between border-b border-gray-100 px-5 py-4">
				<h3 class="text-sm font-bold text-gray-900">
					{isEditing ? 'Ubah Pengumuman' : 'Buat Pengumuman Baru'}
				</h3>
				<button
					onclick={() => (isModalOpen = false)}
					class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition cursor-pointer"
					aria-label="Tutup"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="space-y-4 px-5 py-4">
				{#if formError}
					<div class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
						{formError}
					</div>
				{/if}

				<div>
					<label for="ann-title" class="mb-1 block text-xs font-semibold text-gray-700">Judul</label>
					<input
						id="ann-title"
						type="text"
						bind:value={formTitle}
						placeholder="Contoh: Rapat singkat sebelum shift pagi"
						class="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-hidden focus:border-emerald-500"
					/>
				</div>

				<div>
					<label for="ann-body" class="mb-1 block text-xs font-semibold text-gray-700">Isi Pengumuman</label>
					<textarea
						id="ann-body"
						bind:value={formBody}
						rows="5"
						placeholder="Tulis informasi internal yang perlu diketahui kasir..."
						class="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-hidden focus:border-emerald-500 resize-y"
					></textarea>
				</div>

				<div>
					<label for="ann-branch" class="mb-1 block text-xs font-semibold text-gray-700">Tujuan</label>
					<select
						id="ann-branch"
						bind:value={formBranchId}
						class="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs text-gray-700 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
					>
						<option value="all">Semua Cabang</option>
						{#each branches as b (b.id)}
							<option value={b.id}>{b.name} ({b.code})</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
				<button
					onclick={() => (isModalOpen = false)}
					class="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
				>
					Batal
				</button>
				<button
					onclick={saveAnnouncement}
					class="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition cursor-pointer"
				>
					{isEditing ? 'Simpan Perubahan' : 'Terbitkan'}
				</button>
			</div>
		</div>
	</div>
{/if}
