<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { announcementStore } from '../stores/announcements.svelte.js';
	import type { Announcement, Branch } from '../types/index.js';
	import Pagination from './Pagination.svelte';
	import {
		Megaphone,
		Building2,
		Globe,
		Bell,
		AlertCircle
	} from 'lucide-svelte';

	let announcements = $state<Announcement[]>([]);
	let branches = $state<Branch[]>([]);
	let page = $state<number>(1);
	let perPage = $state<number>(25);

	onMount(() => {
		const reload = async () => {
			branches = await db.branches.toArray();
			await announcementStore.load(authState.user?.id);
			announcements = announcementStore.items;
		};

		reload();

		// Tandai semua pengumuman sebagai sudah dibaca setelah tampil
		announcementStore.markAllRead(authState.user?.id);

		// Segarkan daftar secara berkala agar pengumuman yang dihapus/dinonaktifkan
		// admin ikut hilang tanpa harus pindah tab
		const timer = setInterval(reload, 30000);
		return () => clearInterval(timer);
	});

	function branchName(branchId: string): string {
		if (branchId === 'all') return 'Semua Cabang';
		return branches.find(b => b.id === branchId)?.name || 'Cabang';
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

	function isNew(an: Announcement): boolean {
		return !announcementStore.lastReadAt || (an.created_at || '') > announcementStore.lastReadAt;
	}

	let pagedAnnouncements = $derived(
		announcements.slice((page - 1) * perPage, page * perPage)
	);
</script>

<div class="space-y-5">
	<!-- Header -->
	<div>
		<h2 class="text-lg font-bold text-gray-900 flex items-center gap-2">
			<Megaphone class="h-5 w-5 text-emerald-600" />
			Info Internal
		</h2>
		<p class="text-xs text-gray-500 mt-0.5">
			Pengumuman dari admin pusat untuk kasir. Perangkat perlu tersinkronisasi untuk menerima info terbaru.
		</p>
	</div>

	<!-- Daftar Pengumuman -->
	<div class="rounded-2xl border border-gray-200 bg-white shadow-2xs overflow-hidden">
		{#if pagedAnnouncements.length === 0}
			<div class="flex flex-col items-center justify-center gap-2 py-14 text-center">
				<AlertCircle class="h-8 w-8 text-gray-300" />
				<p class="text-sm font-semibold text-gray-500">Belum ada informasi internal</p>
				<p class="text-xs text-gray-400">Pengumuman dari admin pusat akan tampil di sini.</p>
			</div>
		{:else}
			<ul class="divide-y divide-gray-100">
				{#each pagedAnnouncements as an (an.id)}
					<li class="p-4 hover:bg-gray-50/60 transition">
						<div class="flex items-start gap-3">
							<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {isNew(an) ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}">
								<Bell class="h-4 w-4" />
							</div>
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<h3 class="text-sm font-bold text-gray-900">{an.title}</h3>
									{#if isNew(an)}
										<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">Baru</span>
									{/if}
								</div>
								<p class="mt-1 text-xs text-gray-600 whitespace-pre-line">{an.body}</p>
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
									<span class="text-gray-400">dari {an.created_by_name || 'Admin Pusat'}</span>
								</div>
							</div>
						</div>
					</li>
				{/each}
			</ul>
			<Pagination bind:page bind:perPage totalItems={announcements.length} label="pengumuman" />
		{/if}
	</div>
</div>
