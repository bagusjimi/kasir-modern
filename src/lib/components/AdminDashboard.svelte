<script lang="ts">
	import { onMount } from 'svelte';
	import { syncEngine } from '../sync/index.svelte.js';
	import {
		LayoutDashboard,
		ShoppingCart,
		Wallet,
		TrendingUp,
		Package,
		Boxes,
		AlertTriangle,
		Building2,
		RefreshCw,
		WifiOff,
		Users
	} from 'lucide-svelte';

	interface DashboardData {
		today: { tx_count: number; total_sales: number; gross_profit: number; items_sold: number };
		trend: { day: string; tx_count: number; total_sales: number }[];
		branches: { branch_id: string; branch_name: string; tx_count: number; total_sales: number }[];
		cashiers: { cashier_id: string; cashier_name: string; branch_name: string; tx_count: number; total_sales: number; total_discount: number }[];
		low_stock: { id: string; name: string; sku: string; stock: number; min_stock: number; branch_id: string }[];
		counts: { active_products: number; categories: number };
		stock_recap: { branch_id: string; branch_name: string; product_count: number; total_units: number; stock_value: number }[];
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

	const totalStockValue = $derived(
		data ? data.stock_recap.reduce((sum, s) => sum + s.stock_value, 0) : 0
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
        <!-- Kepala halaman -->
        <div class="flex flex-col justify-between gap-4 border-b border-gray-300/70 pb-5 sm:flex-row sm:items-end">
                <div>
                        <p class="eyebrow text-gray-400">
                                Beranda · {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                        <h1 class="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900">Ringkasan hari ini</h1>
                        <p class="mt-1 text-xs text-gray-500">Performa penjualan seluruh cabang, diambil langsung dari server.</p>
                </div>

                <button
                        onclick={loadDashboard}
                        disabled={isLoading}
                        class="inline-flex items-center gap-1.5 self-start rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-xs transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-60 sm:self-auto cursor-pointer"
                >
                        <RefreshCw class="h-3.5 w-3.5 {isLoading ? 'animate-spin' : ''}" />
                        <span>Segarkan</span>
                </button>
        </div>

        {#if !syncEngine.isOnline}
                <div class="flex items-start gap-3 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-amber-900">
                        <WifiOff class="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                        <p class="text-xs leading-relaxed">
                                Sedang tidak terhubung. Beranda menampilkan data dari server — transaksi yang belum tersinkronisasi akan muncul setelah koneksi pulih.
                        </p>
                </div>
        {/if}

        {#if loadError}
                <div class="border-l-2 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-900">{loadError}</div>
        {:else if isLoading && !data}
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {#each Array(4) as _, i}
                                <div class="h-28 animate-pulse rounded-lg border border-gray-200 bg-white" style="--i: {i}"></div>
                        {/each}
                </div>
        {:else if data}
                <!-- Baris angka hari ini -->
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div class="reveal relative rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-xs" style="--i: 0">
                                <span class="absolute right-4 top-3 font-mono text-[10px] text-gray-300">01</span>
                                <div class="flex items-center gap-2">
                                        <Wallet class="h-3.5 w-3.5 text-emerald-700" />
                                        <span class="eyebrow text-[9px] text-gray-400">Penjualan</span>
                                </div>
                                <div class="mt-2 h-px w-full bg-gray-900/10"></div>
                                <p class="num mt-2 text-xl font-semibold tracking-tight text-gray-900">{formatRupiah(data.today.total_sales)}</p>
                        </div>
                        <div class="reveal relative rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-xs" style="--i: 1">
                                <span class="absolute right-4 top-3 font-mono text-[10px] text-gray-300">02</span>
                                <div class="flex items-center gap-2">
                                        <ShoppingCart class="h-3.5 w-3.5 text-emerald-700" />
                                        <span class="eyebrow text-[9px] text-gray-400">Transaksi</span>
                                </div>
                                <div class="mt-2 h-px w-full bg-gray-900/10"></div>
                                <p class="num mt-2 text-xl font-semibold tracking-tight text-gray-900">{data.today.tx_count}</p>
                        </div>
                        <div class="reveal relative rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-xs" style="--i: 2">
                                <span class="absolute right-4 top-3 font-mono text-[10px] text-gray-300">03</span>
                                <div class="flex items-center gap-2">
                                        <TrendingUp class="h-3.5 w-3.5 text-emerald-700" />
                                        <span class="eyebrow text-[9px] text-gray-400">Laba kotor</span>
                                </div>
                                <div class="mt-2 h-px w-full bg-gray-900/10"></div>
                                <p class="num mt-2 text-xl font-semibold tracking-tight text-gray-900">{formatRupiah(data.today.gross_profit)}</p>
                        </div>
                        <div class="reveal relative rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-xs" style="--i: 3">
                                <span class="absolute right-4 top-3 font-mono text-[10px] text-gray-300">04</span>
                                <div class="flex items-center gap-2">
                                        <Package class="h-3.5 w-3.5 text-amber-600" />
                                        <span class="eyebrow text-[9px] text-gray-400">Item terjual</span>
                                </div>
                                <div class="mt-2 h-px w-full bg-gray-900/10"></div>
                                <p class="num mt-2 text-xl font-semibold tracking-tight text-gray-900">{data.today.items_sold}</p>
                        </div>
                </div>

                <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
                        <!-- Tren 7 hari -->
                        <div class="reveal rounded-lg border border-gray-200 bg-white p-5 shadow-xs lg:col-span-2" style="--i: 4">
                                <div class="flex items-baseline justify-between gap-3 border-b border-dashed border-gray-200 pb-3">
                                        <div>
                                                <p class="eyebrow text-gray-400">Tujuh hari terakhir</p>
                                                <h2 class="mt-0.5 text-base font-semibold text-gray-900">Tren penjualan</h2>
                                        </div>
                                        <span class="num text-[11px] text-gray-500">
                                                total {formatRupiah(data.trend.reduce((sum, t) => sum + t.total_sales, 0))}
                                        </span>
                                </div>
                                {#if data.trend.length === 0}
                                        <p class="py-10 text-center text-xs text-gray-400">Belum ada transaksi dalam 7 hari terakhir.</p>
                                {:else}
                                        <div class="mt-5 flex h-44 items-end justify-between gap-2 border-b border-gray-900/15 pb-0">
                                                {#each data.trend as t, i (t.day)}
                                                        <div class="group flex h-full flex-1 flex-col items-center justify-end gap-1.5" title="{formatDay(t.day)}: {formatRupiah(t.total_sales)} ({t.tx_count} transaksi)">
                                                                <span class="num text-[9px] font-medium text-gray-400 opacity-0 transition group-hover:opacity-100">
                                                                        {t.total_sales > 0 ? formatRupiah(t.total_sales) : '—'}
                                                                </span>
                                                                <div
                                                                        class="sweep w-full max-w-9 rounded-t-sm {t.total_sales > 0 ? 'bg-emerald-700 group-hover:bg-emerald-600' : 'bg-gray-200'}"
                                                                        style="--i: {i}; height: {Math.max((t.total_sales / maxTrend) * 100, 2)}%"
                                                                ></div>
                                                        </div>
                                                {/each}
                                        </div>
                                        <div class="mt-2 flex justify-between gap-2">
                                                {#each data.trend as t (t.day)}
                                                        <span class="flex-1 text-center font-mono text-[9px] uppercase tracking-wide text-gray-400">{formatDay(t.day)}</span>
                                                {/each}
                                        </div>
                                {/if}
                        </div>

                        <!-- Stok menipis -->
                        <div class="reveal rounded-lg border border-gray-200 bg-white p-5 shadow-xs" style="--i: 5">
                                <div class="flex items-center justify-between gap-2 border-b border-dashed border-gray-200 pb-3">
                                        <div class="flex items-center gap-2">
                                                <AlertTriangle class="h-3.5 w-3.5 text-amber-600" />
                                                <h2 class="text-base font-semibold text-gray-900">Stok menipis</h2>
                                        </div>
                                        <span class="font-mono text-[10px] font-semibold text-amber-700">{data.low_stock.length}</span>
                                </div>
                                {#if data.low_stock.length === 0}
                                        <p class="py-8 text-center text-xs text-gray-400">Semua stok aman. Atur stok minimum di form produk untuk mengaktifkan peringatan.</p>
                                {:else}
                                        <ul class="mt-1 max-h-64 divide-y divide-dashed divide-gray-200 overflow-y-auto">
                                                {#each data.low_stock as p (p.id)}
                                                        <li class="flex items-center justify-between gap-2 py-2.5">
                                                                <div class="min-w-0">
                                                                        <p class="truncate text-xs font-semibold text-gray-800">{p.name}</p>
                                                                        <p class="font-mono text-[10px] text-gray-400">{p.sku}</p>
                                                                </div>
                                                                <span class="shrink-0 rounded-sm border border-rose-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-700">
                                                                        {p.stock} / {p.min_stock}
                                                                </span>
                                                        </li>
                                                {/each}
                                        </ul>
                                {/if}
                        </div>
                </div>

                <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
                        <!-- Penjualan per cabang -->
                        <div class="reveal rounded-lg border border-gray-200 bg-white p-5 shadow-xs lg:col-span-2" style="--i: 6">
                                <div class="flex items-center gap-2 border-b border-dashed border-gray-200 pb-3">
                                        <Building2 class="h-3.5 w-3.5 text-emerald-700" />
                                        <h2 class="text-base font-semibold text-gray-900">Penjualan per cabang</h2>
                                        <span class="eyebrow ml-auto text-[9px] text-gray-400">Hari ini</span>
                                </div>
                                {#if data.branches.length === 0}
                                        <p class="py-8 text-center text-xs text-gray-400">Belum ada transaksi hari ini di semua cabang.</p>
                                {:else}
                                        <div class="overflow-x-auto">
                                                <table class="mt-1 w-full text-left text-xs">
                                                        <thead>
                                                                <tr class="border-b border-gray-900/15">
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Cabang</th>
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Nota</th>
                                                                        <th class="eyebrow py-2 text-right text-[9px] font-medium text-gray-400">Penjualan</th>
                                                                </tr>
                                                        </thead>
                                                        <tbody class="divide-y divide-gray-100">
                                                                {#each data.branches as b (b.branch_id)}
                                                                        <tr class="transition hover:bg-gray-50">
                                                                                <td class="py-2.5 pr-4 font-semibold text-gray-900">{b.branch_name}</td>
                                                                                <td class="num py-2.5 pr-4 text-gray-500">{b.tx_count}</td>
                                                                                <td class="num py-2.5 text-right font-semibold text-emerald-800">{formatRupiah(b.total_sales)}</td>
                                                                        </tr>
                                                                {/each}
                                                        </tbody>
                                                </table>
                                        </div>
                                {/if}
                        </div>

                        <!-- Kinerja kasir -->
                        <div class="reveal rounded-lg border border-gray-200 bg-white p-5 shadow-xs lg:col-span-2" style="--i: 7">
                                <div class="flex items-center gap-2 border-b border-dashed border-gray-200 pb-3">
                                        <Users class="h-3.5 w-3.5 text-emerald-700" />
                                        <h2 class="text-base font-semibold text-gray-900">Kinerja kasir</h2>
                                        <span class="eyebrow ml-auto text-[9px] text-gray-400">Hari ini</span>
                                </div>
                                {#if data.cashiers.length === 0}
                                        <p class="py-8 text-center text-xs text-gray-400">Belum ada transaksi hari ini untuk dievaluasi.</p>
                                {:else}
                                        <div class="overflow-x-auto">
                                                <table class="mt-1 w-full text-left text-xs">
                                                        <thead>
                                                                <tr class="border-b border-gray-900/15">
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Kasir</th>
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Cabang</th>
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Nota</th>
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Diskon</th>
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Rata-rata</th>
                                                                        <th class="eyebrow py-2 text-right text-[9px] font-medium text-gray-400">Omzet</th>
                                                                </tr>
                                                        </thead>
                                                        <tbody class="divide-y divide-gray-100">
                                                                {#each data.cashiers as c (c.cashier_id)}
                                                                        <tr class="transition hover:bg-gray-50">
                                                                                <td class="py-2.5 pr-4 font-semibold text-gray-900">{c.cashier_name}</td>
                                                                                <td class="py-2.5 pr-4 text-gray-500">{c.branch_name}</td>
                                                                                <td class="num py-2.5 pr-4 text-gray-600">{c.tx_count}</td>
                                                                                <td class="num py-2.5 pr-4 {c.total_discount > 0 ? 'text-rose-600' : 'text-gray-300'}">{c.total_discount > 0 ? formatRupiah(c.total_discount) : '—'}</td>
                                                                                <td class="num py-2.5 pr-4 text-gray-600">{formatRupiah(Math.round(c.total_sales / c.tx_count))}</td>
                                                                                <td class="num py-2.5 text-right font-semibold text-emerald-800">{formatRupiah(c.total_sales)}</td>
                                                                        </tr>
                                                                {/each}
                                                        </tbody>
                                                </table>
                                        </div>
                                {/if}
                        </div>

                        <!-- Nilai stok -->
                        <div class="reveal rounded-lg border border-gray-200 bg-white p-5 shadow-xs lg:col-span-2" style="--i: 8">
                                <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed border-gray-200 pb-3">
                                        <div class="flex items-center gap-2">
                                                <Boxes class="h-3.5 w-3.5 text-emerald-700" />
                                                <h2 class="text-base font-semibold text-gray-900">Stok per cabang</h2>
                                        </div>
                                        <span class="font-mono text-[10px] text-gray-500">
                                                modal jaringan <span class="font-semibold text-gray-900">{formatRupiah(totalStockValue)}</span>
                                        </span>
                                </div>
                                {#if data.stock_recap.length === 0}
                                        <p class="py-8 text-center text-xs text-gray-400">Belum ada produk terdaftar di semua cabang.</p>
                                {:else}
                                        <div class="overflow-x-auto">
                                                <table class="mt-1 w-full text-left text-xs">
                                                        <thead>
                                                                <tr class="border-b border-gray-900/15">
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Cabang</th>
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Jenis</th>
                                                                        <th class="eyebrow py-2 pr-4 text-[9px] font-medium text-gray-400">Unit</th>
                                                                        <th class="eyebrow py-2 text-right text-[9px] font-medium text-gray-400">Nilai stok</th>
                                                                </tr>
                                                        </thead>
                                                        <tbody class="divide-y divide-gray-100">
                                                                {#each data.stock_recap as s (s.branch_id)}
                                                                        <tr class="transition hover:bg-gray-50">
                                                                                <td class="py-2.5 pr-4 font-semibold text-gray-900">{s.branch_name}</td>
                                                                                <td class="num py-2.5 pr-4 text-gray-600">{s.product_count}</td>
                                                                                <td class="num py-2.5 pr-4 text-gray-600">{s.total_units}</td>
                                                                                <td class="num py-2.5 text-right font-semibold text-emerald-800">{formatRupiah(s.stock_value)}</td>
                                                                        </tr>
                                                                {/each}
                                                        </tbody>
                                                </table>
                                        </div>
                                {/if}
                        </div>

                        <!-- Master data -->
                        <div class="reveal rounded-lg border border-gray-200 bg-white p-5 shadow-xs" style="--i: 9">
                                <div class="border-b border-dashed border-gray-200 pb-3">
                                        <p class="eyebrow text-gray-400">Indeks</p>
                                        <h2 class="mt-0.5 text-base font-semibold text-gray-900">Master data</h2>
                                </div>
                                <div class="leader mt-3">
                                        <span class="text-xs text-gray-500">Produk aktif</span>
                                        <span class="num text-lg font-semibold text-gray-900">{data.counts.active_products}</span>
                                </div>
                                <div class="leader mt-2">
                                        <span class="text-xs text-gray-500">Kategori</span>
                                        <span class="num text-lg font-semibold text-gray-900">{data.counts.categories}</span>
                                </div>
                                <p class="mt-4 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
                                        Data diambil langsung dari server saat halaman dibuka. Gunakan tombol Segarkan untuk memuat data terbaru.
                                </p>
                        </div>
                </div>
        {/if}
</div>
