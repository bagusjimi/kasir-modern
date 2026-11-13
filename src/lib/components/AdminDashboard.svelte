<script lang="ts">
	import { onMount } from 'svelte';
	import { syncEngine } from '../sync/index.svelte.js';
	import {
		LayoutDashboard,
		ShoppingCart,
		Wallet,
		TrendingUp,
		Package,
		AlertTriangle,
		Building2,
		RefreshCw,
		WifiOff
	} from 'lucide-svelte';

	interface DashboardData {
		today: { tx_count: number; total_sales: number; gross_profit: number; items_sold: number };
		trend: { day: string; tx_count: number; total_sales: number }[];
		branches: { branch_id: string; branch_name: string; tx_count: number; total_sales: number }[];
		low_stock: { id: string; name: string; sku: string; stock: number; min_stock: number; branch_id: string }[];
		counts: { active_products: number; categories: number };
	}

	let data = $state<DashboardData | null>(null);
	let isLoading = $state<boolean>(true);
	let loadError = $state<string | null>(null);

	function formatRupiah(amount: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(amount);
	}

	function formatDay(day: string): string {
		try {
			return new Date(day + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
		} catch {
			return day;
		}
	}

	const maxTrend = $derived(
		data && data.trend.length > 0 ? Math.max(...data.trend.map((t) => t.total_sales), 1) : 1
	);

	async function loadDashboard() {
		isLoading = true;
		loadError = null;
		try {
			const res = await fetch('/api/dashboard');
			const result = (await res.json()) as { success: boolean; data?: DashboardData; message?: string };
			if (result.success && result.data) {
				data = result.data;
			} else {
				loadError = result.message || 'Gagal memuat data dashboard';
			}
		} catch (err: any) {
			loadError = err.message || 'Gagal terhubung ke server';
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		loadDashboard();
	});
</script>

<div class="space-y-6">
	<!-- Page Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div class="flex items-center gap-2">
			<div class="p-2 rounded-xl bg-emerald-100 text-emerald-800">
				<LayoutDashboard class="h-6 w-6" />
			</div>
			<div>
				<h1 class="text-2xl font-black text-gray-900 tracking-tight">Beranda Admin</h1>
				<p class="text-xs text-gray-500">Ringkasan performa penjualan seluruh cabang hari ini.</p>
			</div>
		</div>

		<button
			onclick={loadDashboard}
			disabled={isLoading}
			class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition cursor-pointer"
		>
			<RefreshCw class="h-3.5 w-3.5 {isLoading ? 'animate-spin' : ''}" />
			<span>Segarkan</span>
		</button>
	</div>

	{#if !syncEngine.isOnline}
		<div class="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 flex items-start gap-3">
			<WifiOff class="h-5 w-5 shrink-0 mt-0.5" />
			<div class="text-sm font-medium">
				Sedang offline. Beranda menampilkan data dari server — transaksi yang belum tersinkronisasi akan muncul setelah koneksi pulih.
			</div>
		</div>
	{/if}

	{#if loadError}
		<div class="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-medium">
			{loadError}
		</div>
	{:else if isLoading && !data}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			{#each Array(4) as _}
				<div class="h-28 rounded-2xl bg-white border border-gray-200 animate-pulse"></div>
			{/each}
		</div>
	{:else if data}
		<!-- KPI Hari Ini -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			<div class="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs">
				<div class="flex items-center justify-between">
					<span class="text-xs font-bold uppercase tracking-wider text-gray-400">Penjualan Hari Ini</span>
					<Wallet class="h-4 w-4 text-emerald-500" />
				</div>
				<p class="mt-2 text-xl font-black text-gray-900">{formatRupiah(data.today.total_sales)}</p>
			</div>
			<div class="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs">
				<div class="flex items-center justify-between">
					<span class="text-xs font-bold uppercase tracking-wider text-gray-400">Transaksi</span>
					<ShoppingCart class="h-4 w-4 text-indigo-500" />
				</div>
				<p class="mt-2 text-xl font-black text-gray-900">{data.today.tx_count}</p>
			</div>
			<div class="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs">
				<div class="flex items-center justify-between">
					<span class="text-xs font-bold uppercase tracking-wider text-gray-400">Laba Kotor</span>
					<TrendingUp class="h-4 w-4 text-emerald-500" />
				</div>
				<p class="mt-2 text-xl font-black text-gray-900">{formatRupiah(data.today.gross_profit)}</p>
			</div>
			<div class="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs">
				<div class="flex items-center justify-between">
					<span class="text-xs font-bold uppercase tracking-wider text-gray-400">Item Terjual</span>
					<Package class="h-4 w-4 text-amber-500" />
				</div>
				<p class="mt-2 text-xl font-black text-gray-900">{data.today.items_sold}</p>
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Tren 7 Hari -->
			<div class="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-6 shadow-xs">
				<h2 class="text-sm font-bold text-gray-900 mb-4">Tren Penjualan 7 Hari Terakhir</h2>
				{#if data.trend.length === 0}
					<p class="text-xs text-gray-400 py-8 text-center">Belum ada transaksi dalam 7 hari terakhir.</p>
				{:else}
					<div class="flex items-end justify-between gap-2 h-40">
						{#each data.trend as t (t.day)}
							<div class="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
								<span class="text-[9px] font-semibold text-gray-500">{t.total_sales > 0 ? formatRupiah(t.total_sales) : ''}</span>
								<div
									class="w-full max-w-10 rounded-t-lg bg-emerald-500/80 hover:bg-emerald-600 transition"
									style="height: {Math.max((t.total_sales / maxTrend) * 100, 2)}%"
									title="{formatDay(t.day)}: {formatRupiah(t.total_sales)} ({t.tx_count} transaksi)"
								></div>
								<span class="text-[9px] text-gray-400 whitespace-nowrap">{formatDay(t.day)}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Stok Menipis -->
			<div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs">
				<div class="flex items-center gap-2 mb-4">
					<AlertTriangle class="h-4 w-4 text-amber-500" />
					<h2 class="text-sm font-bold text-gray-900">Stok Menipis</h2>
					<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{data.low_stock.length}</span>
				</div>
				{#if data.low_stock.length === 0}
					<p class="text-xs text-gray-400 py-6 text-center">Semua stok aman. Atur stok minimum di form produk untuk mengaktifkan peringatan.</p>
				{:else}
					<ul class="space-y-2.5 max-h-72 overflow-y-auto">
						{#each data.low_stock as p (p.id)}
							<li class="flex items-center justify-between gap-2 text-xs">
								<div class="min-w-0">
									<p class="font-bold text-gray-800 truncate">{p.name}</p>
									<p class="text-[10px] text-gray-400 font-mono">{p.sku}</p>
								</div>
								<span class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700">
									{p.stock} / min {p.min_stock}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Rekap per Cabang -->
			<div class="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-6 shadow-xs">
				<div class="flex items-center gap-2 mb-4">
					<Building2 class="h-4 w-4 text-indigo-500" />
					<h2 class="text-sm font-bold text-gray-900">Penjualan per Cabang Hari Ini</h2>
				</div>
				{#if data.branches.length === 0}
					<p class="text-xs text-gray-400 py-6 text-center">Belum ada transaksi hari ini di semua cabang.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-left text-xs">
							<thead class="text-gray-500 font-semibold border-b border-gray-100">
								<tr>
									<th class="py-2 pr-4">Cabang</th>
									<th class="py-2 pr-4">Transaksi</th>
									<th class="py-2 text-right">Total Penjualan</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-100 font-medium text-gray-700">
								{#each data.branches as b (b.branch_id)}
									<tr>
										<td class="py-2.5 pr-4 font-bold text-gray-900">{b.branch_name}</td>
										<td class="py-2.5 pr-4">{b.tx_count}</td>
										<td class="py-2.5 text-right font-bold text-emerald-600">{formatRupiah(b.total_sales)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<!-- Ringkasan Master Data -->
			<div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4">
				<h2 class="text-sm font-bold text-gray-900">Ringkasan Master Data</h2>
				<div class="flex items-center justify-between text-xs">
					<span class="text-gray-500 font-medium">Produk Aktif</span>
					<span class="font-black text-gray-900 text-base">{data.counts.active_products}</span>
				</div>
				<div class="flex items-center justify-between text-xs">
					<span class="text-gray-500 font-medium">Kategori</span>
					<span class="font-black text-gray-900 text-base">{data.counts.categories}</span>
				</div>
				<p class="text-[11px] text-gray-400 leading-relaxed pt-2 border-t border-gray-100">
					Data diambil langsung dari server saat halaman dibuka. Gunakan tombol Segarkan untuk memuat data terbaru.
				</p>
			</div>
		</div>
	{/if}
</div>
