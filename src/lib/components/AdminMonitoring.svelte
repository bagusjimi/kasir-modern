<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { db } from '../db/index.js';
	import type { ActivityLog, Branch } from '../types/index.js';
	import {
		Activity,
		Building2,
		RefreshCw,
		ShoppingBag,
		UserCheck,
		Radio,
		DollarSign,
		TrendingUp,
		Package
	} from 'lucide-svelte';

	let activityLogs = $state<ActivityLog[]>([]);
	let branches = $state<Branch[]>([]);
	let selectedBranch = $state<string>('all');
	let isRefreshing = $state<boolean>(false);
	let autoRefreshTimer: number | null = null;

	// Statistik ringkasan cabang
	let branchStats = $state<{
		[branchId: string]: {
			txCount: number;
			totalRevenue: number;
			lastActivity: string;
		};
	}>({});

	onMount(async () => {
		await loadData();

		// Auto-refresh log setiap 10 detik untuk simulasi real-time monitoring
		autoRefreshTimer = window.setInterval(() => {
			loadData(false);
		}, 10000);
	});

	onDestroy(() => {
		if (autoRefreshTimer) {
			clearInterval(autoRefreshTimer);
		}
	});

	async function loadData(showLoading = true) {
		if (showLoading) isRefreshing = true;

		branches = await db.branches.toArray();

		// Jika online, coba ambil data monitoring real-time langsung dari endpoint backend D1
		let loadedFromServer = false;
		if (navigator.onLine) {
			try {
				const res = await fetch(`/api/monitoring?branch_id=${selectedBranch}`);
				if (res.ok) {
					const data = await res.json() as any;
					if (data.success) {
						if (data.activityLogs && data.activityLogs.length > 0) {
							activityLogs = data.activityLogs;
						}
						if (data.branchSummaries) {
							const statsMap: typeof branchStats = {};
							for (const b of branches) {
								const summary = data.branchSummaries.find((s: any) => s.branch_id === b.id);
								statsMap[b.id] = {
									txCount: summary ? Number(summary.total_transactions) : 0,
									totalRevenue: summary ? Number(summary.total_revenue) : 0,
									lastActivity: summary?.last_activity || '-'
								};
							}
							branchStats = statsMap;
							loadedFromServer = true;
						}
					}
				}
			} catch (e) {
				console.warn('Gagal memuat monitoring dari server D1, beralih ke cache lokal:', e);
			}
		}

		// Fallback ke IndexedDB lokal jika offline atau server belum merespon
		if (!loadedFromServer) {
			const allLogs = await db.activity_logs
				.reverse()
				.sortBy('timestamp');
			activityLogs = allLogs;

			const allTx = await db.transactions.toArray();
			const statsMap: typeof branchStats = {};

			for (const b of branches) {
				const bTx = allTx.filter(t => t.branch_id === b.id && t.status === 'completed');
				const totalRev = bTx.reduce((sum, t) => sum + t.total, 0);
				const lastTx = bTx.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

				statsMap[b.id] = {
					txCount: bTx.length,
					totalRevenue: totalRev,
					lastActivity: lastTx ? lastTx.created_at : '-'
				};
			}
			branchStats = statsMap;
		}

		if (showLoading) isRefreshing = false;
	}

	let filteredLogs = $derived(
		activityLogs.filter(log =>
			selectedBranch === 'all' || log.branch_id === selectedBranch
		)
	);

	let totalNetworkRevenue = $derived(
		Object.values(branchStats).reduce((sum, s) => sum + s.totalRevenue, 0)
	);

	let totalNetworkTransactions = $derived(
		Object.values(branchStats).reduce((sum, s) => sum + s.txCount, 0)
	);

	function formatRupiah(num: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(num);
	}
</script>

<div class="space-y-6">
	<!-- Top Bar Dashboard Admin -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
		<div>
			<div class="flex items-center gap-2">
				<h2 class="text-lg font-bold text-gray-900">Pemantauan Aktivitas Kasir Real-Time</h2>
				<span class="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 border border-rose-200 animate-pulse">
					<Radio class="h-3 w-3" /> LIVE
				</span>
			</div>
			<p class="text-xs text-gray-500 mt-0.5">
				Memantau seluruh aktivitas kasir cabang secara terpusat tanpa hak akses entri transaksi
			</p>
		</div>

		<div class="flex items-center gap-3">
			<select
				bind:value={selectedBranch}
				class="px-3.5 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 focus:outline-hidden focus:border-indigo-500"
			>
				<option value="all">Semua Cabang Toko</option>
				{#each branches as b}
					<option value={b.id}>{b.name} ({b.code})</option>
				{/each}
			</select>

			<button
				onclick={() => loadData(true)}
				disabled={isRefreshing}
				class="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
			>
				<RefreshCw class="h-3.5 w-3.5 {isRefreshing ? 'animate-spin text-indigo-600' : ''}" />
				<span>Segarkan</span>
			</button>
		</div>
	</div>

	<!-- Ringkasan Metrik Semua Cabang -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
		<div class="bg-gradient-to-tr from-indigo-700 to-indigo-500 rounded-2xl p-5 text-white shadow-lg shadow-indigo-600/20">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-indigo-100">Total Omset Seluruh Cabang</p>
				<DollarSign class="h-5 w-5 text-indigo-200" />
			</div>
			<p class="text-2xl font-black mt-2">{formatRupiah(totalNetworkRevenue)}</p>
			<p class="text-[11px] text-indigo-100 mt-1">{totalNetworkTransactions} transaksi tercatat</p>
		</div>

		<div class="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col justify-between">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-gray-500">Cabang Terdaftar</p>
				<Building2 class="h-5 w-5 text-gray-400" />
			</div>
			<p class="text-2xl font-bold text-gray-900 mt-2">{branches.length} Cabang</p>
			<p class="text-[11px] text-emerald-600 font-semibold mt-1">Semua status operasional aktif</p>
		</div>

		<div class="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col justify-between">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-gray-500">Aktivitas Terpantau</p>
				<TrendingUp class="h-5 w-5 text-gray-400" />
			</div>
			<p class="text-2xl font-bold text-gray-900 mt-2">{activityLogs.length} Peristiwa</p>
			<p class="text-[11px] text-gray-400 mt-1">Audit log sinkronisasi realtime</p>
		</div>
	</div>

	<!-- Kartu Ringkasan Per Cabang -->
	<div>
		<h3 class="text-sm font-bold text-gray-800 mb-3">Ringkasan Performa Cabang</h3>
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
			{#each branches as b}
				{@const stat = branchStats[b.id] || { txCount: 0, totalRevenue: 0, lastActivity: '-' }}
				<div class="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-xs hover:border-indigo-400 transition">
					<div class="flex items-center justify-between pb-2 border-b border-gray-100 mb-2.5">
						<span class="font-bold text-gray-900 text-xs">{b.name}</span>
						<span class="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
							{b.code}
						</span>
					</div>
					<div class="space-y-1 text-xs">
						<div class="flex justify-between text-gray-500">
							<span>Omset Cabang:</span>
							<span class="font-bold text-indigo-700">{formatRupiah(stat.totalRevenue)}</span>
						</div>
						<div class="flex justify-between text-gray-500">
							<span>Jumlah Transaksi:</span>
							<span class="font-semibold text-gray-800">{stat.txCount} nota</span>
						</div>
						<div class="flex justify-between text-gray-400 text-[10px] pt-1">
							<span>Aktivitas Terakhir:</span>
							<span>{stat.lastActivity !== '-' ? new Date(stat.lastActivity).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Stream Audit Log Aktivitas Kasir -->
	<div class="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
		<div class="p-4 border-b border-gray-100 flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Activity class="h-4 w-4 text-indigo-600" />
				<h3 class="font-bold text-gray-900 text-sm">Log Aktivitas Kasir & Transaksi</h3>
			</div>
			<span class="text-xs text-gray-400">Terakhir disinkronkan: baru saja</span>
		</div>

		<div class="divide-y divide-gray-100">
			{#if filteredLogs.length === 0}
				<div class="p-8 text-center text-gray-400 text-xs">
					Belum ada aktivitas kasir yang tercatat untuk cabang ini.
				</div>
			{:else}
				{#each filteredLogs as log}
					<div class="p-4 flex items-start justify-between gap-4 hover:bg-gray-50/70 transition">
						<div class="flex items-start gap-3">
							<div class="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
								{#if log.action === 'create_transaction'}
									<ShoppingBag class="h-4 w-4 text-emerald-600" />
								{:else if log.action === 'login' || log.action === 'logout'}
									<UserCheck class="h-4 w-4 text-indigo-600" />
								{:else if log.action.includes('product')}
									<Package class="h-4 w-4 text-amber-600" />
								{:else}
									<Activity class="h-4 w-4 text-gray-500" />
								{/if}
							</div>
							<div>
								<div class="flex items-center gap-2">
									<span class="font-bold text-gray-900 text-xs">{log.user_name}</span>
									<span class="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
										{log.branch_name || 'Cabang Pusat'}
									</span>
									<span class="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded uppercase">
										{log.action.replace('_', ' ')}
									</span>
								</div>
								<p class="text-xs text-gray-700 mt-1">{log.details}</p>
							</div>
						</div>

						<div class="text-right shrink-0">
							<span class="text-[11px] text-gray-400 font-medium">
								{new Date(log.timestamp).toLocaleString('id-ID', {
									hour: '2-digit',
									minute: '2-digit',
									second: '2-digit'
								})}
							</span>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

