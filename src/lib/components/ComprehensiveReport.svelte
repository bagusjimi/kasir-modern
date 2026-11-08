<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import type { Transaction, Branch, Product } from '../types/index.js';
	import {
		Calendar,
		TrendingUp,
		DollarSign,
		ShoppingBag,
		CreditCard,
		Download,
		Printer,
		FileSpreadsheet,
		RefreshCw,
		Layers,
		Award,
		Percent,
		Building2,
		Wallet,
		QrCode,
		ArrowUpRight,
		Filter
	} from 'lucide-svelte';

	// State Filter
	let presetRange = $state<'all' | 'today' | 'yesterday' | '7days' | '30days' | 'thisMonth' | 'custom'>('all');
	let startDate = $state<string>('');
	let endDate = $state<string>('');
	let selectedBranchId = $state<string>('all');
	let selectedPaymentMethod = $state<string>('all');
	let isLoading = $state<boolean>(false);

	// Data
	let branches = $state<Branch[]>([]);
	let transactions = $state<Transaction[]>([]);
	let products = $state<Product[]>([]);

	function getTodayDateString(): string {
		const d = new Date();
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function getPastDateString(daysAgo: number): string {
		const d = new Date();
		d.setDate(d.getDate() - daysAgo);
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function getStartOfMonthString(): string {
		const d = new Date();
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		return `${year}-${month}-01`;
	}

	function applyPreset(preset: typeof presetRange) {
		presetRange = preset;
		const today = getTodayDateString();
		if (preset === 'all') {
			startDate = '';
			endDate = '';
		} else if (preset === 'today') {
			startDate = today;
			endDate = today;
		} else if (preset === 'yesterday') {
			const yest = getPastDateString(1);
			startDate = yest;
			endDate = yest;
		} else if (preset === '7days') {
			startDate = getPastDateString(6);
			endDate = today;
		} else if (preset === '30days') {
			startDate = getPastDateString(29);
			endDate = today;
		} else if (preset === 'thisMonth') {
			startDate = getStartOfMonthString();
			endDate = today;
		}
	}

	onMount(async () => {
		// Jika kasir, kunci cabang ke cabang tempat dia ditugaskan
		if (authState.user?.role === 'cashier' && authState.branch?.id) {
			selectedBranchId = authState.branch.id;
		} else {
			selectedBranchId = 'all';
		}

		await loadInitialData();
	});

	async function loadInitialData() {
		isLoading = true;
		try {
			branches = await db.branches.toArray();
			products = await db.products.toArray();
			await loadTransactions();
		} finally {
			isLoading = false;
		}
	}

	async function loadTransactions() {
		isLoading = true;
		try {
			// 1. Ambil seluruh transaksi dari IndexedDB lokal terlebih dahulu
			let allTx = await db.transactions.toArray();

			// 2. Jika online, coba ambil data dari endpoint backend D1 untuk menyinkronkan transaksi terbaru
			if (navigator.onLine) {
				try {
					const branchParam = (authState.user?.role === 'cashier' && authState.branch?.id)
						? authState.branch.id
						: selectedBranchId;
					const res = await fetch(`/api/transactions?branch_id=${branchParam}&limit=200`);
					if (res.ok) {
						const result = await res.json() as any;
						if (result.success && Array.isArray(result.data) && result.data.length > 0) {
							// Simpan transaksi server ke IndexedDB lokal agar cache terupdate
							for (const serverTx of result.data) {
								const exists = allTx.find(t => t.id === serverTx.id);
								if (!exists) {
									await db.transactions.put({ ...serverTx, synced: true });
									allTx.push({ ...serverTx, synced: true });
								}
							}
						}
					}
				} catch (serverErr) {
					console.warn('Gagal memuat transaksi dari server, menggunakan cache lokal:', serverErr);
				}
			}

			// Kasir hanya bisa melihat transaksi cabangnya
			if (authState.user?.role === 'cashier' && authState.branch?.id) {
				allTx = allTx.filter(t => t.branch_id === authState.branch?.id);
			}

			transactions = allTx;
		} finally {
			isLoading = false;
		}
	}

	// Filter Transaksi Berdasarkan Kriteria
	let filteredTransactions = $derived(
		transactions.filter(tx => {
			if (tx.status !== 'completed') return false;

			// Filter Cabang
			if (selectedBranchId !== 'all' && tx.branch_id !== selectedBranchId) {
				return false;
			}

			// Filter Metode Pembayaran
			if (selectedPaymentMethod !== 'all' && tx.payment_method !== selectedPaymentMethod) {
				return false;
			}

			// Filter Rentang Tanggal
			const txDate = tx.created_at.slice(0, 10);
			if (startDate && txDate < startDate) return false;
			if (endDate && txDate > endDate) return false;

			return true;
		})
	);

	// Metrik Utama (KPIs)
	let totalRevenue = $derived(
		filteredTransactions.reduce((sum, tx) => sum + (tx.total || 0), 0)
	);

	let totalGrossCost = $derived(
		filteredTransactions.reduce((sum, tx) => {
			const txCost = tx.items ? tx.items.reduce((s, it) => s + ((it.cost_price || 0) * (it.quantity || 1)), 0) : 0;
			return sum + txCost;
		}, 0)
	);

	let grossProfit = $derived(
		Math.max(0, totalRevenue - totalGrossCost)
	);

	let profitMarginPercentage = $derived(
		totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0'
	);

	let totalTransactionsCount = $derived(filteredTransactions.length);

	let averageOrderValue = $derived(
		totalTransactionsCount > 0 ? Math.round(totalRevenue / totalTransactionsCount) : 0
	);

	let totalItemsSold = $derived(
		filteredTransactions.reduce((sum, tx) => {
			const itemsCount = tx.items ? tx.items.reduce((s, it) => s + (it.quantity || 0), 0) : 0;
			return sum + itemsCount;
		}, 0)
	);

	let totalDiscount = $derived(
		filteredTransactions.reduce((sum, tx) => sum + (tx.discount || 0), 0)
	);

	let totalTax = $derived(
		filteredTransactions.reduce((sum, tx) => sum + (tx.tax || 0), 0)
	);

	// Distribusi Metode Pembayaran
	let paymentBreakdown = $derived.by(() => {
		const res = {
			cash: { count: 0, amount: 0, label: 'Tunai (Cash)' },
			qris: { count: 0, amount: 0, label: 'QRIS' },
			transfer: { count: 0, amount: 0, label: 'Transfer Bank' }
		};

		for (const tx of filteredTransactions) {
			const m = tx.payment_method || 'cash';
			if (res[m]) {
				res[m].count += 1;
				res[m].amount += tx.total;
			}
		}

		return [
			{ key: 'cash', ...res.cash, percentage: totalRevenue > 0 ? Math.round((res.cash.amount / totalRevenue) * 100) : 0 },
			{ key: 'qris', ...res.qris, percentage: totalRevenue > 0 ? Math.round((res.qris.amount / totalRevenue) * 100) : 0 },
			{ key: 'transfer', ...res.transfer, percentage: totalRevenue > 0 ? Math.round((res.transfer.amount / totalRevenue) * 100) : 0 }
		];
	});

	// Peringkat Produk Terlaris (Top Selling Products)
	let topProducts = $derived.by(() => {
		const map: { [prodId: string]: { name: string; quantity: number; revenue: number; cost: number; profit: number } } = {};

		for (const tx of filteredTransactions) {
			if (!tx.items) continue;
			for (const item of tx.items) {
				const id = item.product_id || item.product_name;
				if (!map[id]) {
					map[id] = {
						name: item.product_name,
						quantity: 0,
						revenue: 0,
						cost: 0,
						profit: 0
					};
				}
				map[id].quantity += item.quantity || 0;
				map[id].revenue += item.subtotal || 0;
				const itemCost = (item.cost_price || 0) * (item.quantity || 0);
				map[id].cost += itemCost;
				map[id].profit += (item.subtotal || 0) - itemCost;
			}
		}

		return Object.values(map)
			.sort((a, b) => b.revenue - a.revenue)
			.slice(0, 8);
	});

	// Analisis Penjualan Berdasarkan Kategori
	let categoryBreakdown = $derived.by(() => {
		const map: { [cat: string]: { name: string; count: number; revenue: number } } = {};

		// Buat lookup produk ke kategori
		const productCatMap: { [prodId: string]: string } = {};
		for (const p of products) {
			productCatMap[p.id] = p.category || 'Lainnya';
			productCatMap[p.name] = p.category || 'Lainnya';
		}

		for (const tx of filteredTransactions) {
			if (!tx.items) continue;
			for (const item of tx.items) {
				const catName = productCatMap[item.product_id] || productCatMap[item.product_name] || 'Lainnya';
				if (!map[catName]) {
					map[catName] = { name: catName, count: 0, revenue: 0 };
				}
				map[catName].count += item.quantity || 0;
				map[catName].revenue += item.subtotal || 0;
			}
		}

		return Object.values(map).sort((a, b) => b.revenue - a.revenue);
	});

	// Penjualan Harian untuk Grafik Tren (Daily Trend)
	let dailyTrend = $derived.by(() => {
		const map: { [date: string]: { date: string; revenue: number; txCount: number } } = {};

		for (const tx of filteredTransactions) {
			const d = tx.created_at.slice(0, 10);
			if (!map[d]) {
				map[d] = { date: d, revenue: 0, txCount: 0 };
			}
			map[d].revenue += tx.total;
			map[d].txCount += 1;
		}

		const sorted = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
		const maxRevenue = Math.max(...sorted.map(s => s.revenue), 1);

		return sorted.map(s => ({
			...s,
			formattedDate: new Date(s.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
			heightPercent: Math.max(8, Math.round((s.revenue / maxRevenue) * 100))
		}));
	});

	function formatRupiah(num: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(num);
	}

	function handlePrint() {
		window.print();
	}

	function exportToCSV() {
		if (filteredTransactions.length === 0) {
			alert('Tidak ada data untuk diekspor!');
			return;
		}

		const headers = [
			'No. Invoice',
			'Tanggal Transaksi',
			'Waktu',
			'Cabang',
			'Kasir',
			'Pelanggan',
			'Metode Pembayaran',
			'Subtotal',
			'Diskon',
			'Pajak',
			'Total Belanja',
			'Jumlah Item'
		];

		const rows = filteredTransactions.map(tx => [
			`"${tx.invoice_no}"`,
			`"${tx.created_at.slice(0, 10)}"`,
			`"${new Date(tx.created_at).toLocaleTimeString('id-ID')}"`,
			`"${tx.branch_name || '-'}"`,
			`"${tx.cashier_name || '-'}"`,
			`"${tx.customer_name || '-'}"`,
			`"${tx.payment_method.toUpperCase()}"`,
			tx.subtotal,
			tx.discount,
			tx.tax,
			tx.total,
			tx.items ? tx.items.reduce((s, i) => s + i.quantity, 0) : 0
		]);

		const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
		const encodedUri = encodeURI(csvContent);
		const link = document.createElement('a');
		link.setAttribute('href', encodedUri);
		link.setAttribute('download', `Laporan_Kasir_${startDate}_sd_${endDate}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}
</script>

<div class="space-y-6 print:m-0 print:p-0">
	<!-- Header Bar & Action Buttons -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs print:shadow-none print:border-none print:p-0 print:mb-4">
		<div>
			<div class="flex items-center gap-2">
				<div class="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center print:hidden">
					<TrendingUp class="h-4 w-4" />
				</div>
				<h2 class="text-xl font-bold text-gray-900 tracking-tight">Laporan Penjualan Komprehensif</h2>
			</div>
			<p class="text-xs text-gray-500 mt-1">
				Analisis performa omset, laba kotor, metode pembayaran, dan produk terlaris
				{#if authState.user?.role === 'cashier'}
					• Cabang: <span class="font-semibold text-emerald-700">{authState.branch?.name || 'Cabang Lokal'}</span>
				{/if}
			</p>
		</div>

		<!-- Action Export & Print -->
		<div class="flex items-center gap-2.5 print:hidden">
			<button
				onclick={handlePrint}
				class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs transition cursor-pointer"
				title="Cetak format cetak struk/dokumen laporan"
			>
				<Printer class="h-4 w-4 text-gray-500" />
				<span>Cetak Laporan</span>
			</button>

			<button
				onclick={exportToCSV}
				class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white shadow-md shadow-emerald-600/20 active:scale-95 transition cursor-pointer"
				title="Unduh data dalam format file Excel/CSV"
			>
				<FileSpreadsheet class="h-4 w-4" />
				<span>Ekspor CSV</span>
			</button>

			<button
				onclick={loadTransactions}
				class="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-500 transition cursor-pointer"
				title="Muat Ulang Data"
			>
				<RefreshCw class="h-4 w-4 {isLoading ? 'animate-spin text-emerald-600' : ''}" />
			</button>
		</div>
	</div>

	<!-- Filter Panel: Rentang Tanggal, Cabang, Metode Pembayaran -->
	<div class="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs space-y-4 print:hidden">
		<div class="flex items-center gap-2 pb-2 border-b border-gray-100 text-xs font-bold text-gray-700">
			<Filter class="h-4 w-4 text-emerald-600" />
			<span>Filter & Kustomisasi Periode Laporan</span>
		</div>

		<!-- Tombol Cepat Periode (Presets) -->
		<div class="flex flex-wrap items-center gap-1.5">
			<button
				onclick={() => applyPreset('all')}
				class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer {presetRange === 'all' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
			>
				Semua Waktu
			</button>
			<button
				onclick={() => applyPreset('today')}
				class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer {presetRange === 'today' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
			>
				Hari Ini
			</button>
			<button
				onclick={() => applyPreset('yesterday')}
				class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer {presetRange === 'yesterday' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
			>
				Kemarin
			</button>
			<button
				onclick={() => applyPreset('7days')}
				class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer {presetRange === '7days' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
			>
				7 Hari Terakhir
			</button>
			<button
				onclick={() => applyPreset('30days')}
				class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer {presetRange === '30days' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
			>
				30 Hari Terakhir
			</button>
			<button
				onclick={() => applyPreset('thisMonth')}
				class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer {presetRange === 'thisMonth' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
			>
				Bulan Ini
			</button>
			<button
				onclick={() => presetRange = 'custom'}
				class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer {presetRange === 'custom' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
			>
				Rentang Khusus
			</button>
		</div>

		<!-- Form Kontrol Filter -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
			<div>
				<label for="reportStartDate" class="block text-xs font-semibold text-gray-600 mb-1">Dari Tanggal</label>
				<input
					id="reportStartDate"
					type="date"
					bind:value={startDate}
					onchange={() => presetRange = 'custom'}
					class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 focus:outline-hidden focus:border-emerald-500"
				/>
			</div>

			<div>
				<label for="reportEndDate" class="block text-xs font-semibold text-gray-600 mb-1">Sampai Tanggal</label>
				<input
					id="reportEndDate"
					type="date"
					bind:value={endDate}
					onchange={() => presetRange = 'custom'}
					class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 focus:outline-hidden focus:border-emerald-500"
				/>
			</div>

			<!-- Filter Cabang (Hanya Admin yang dapat memilih cabang lain) -->
			<div>
				<label for="reportBranch" class="block text-xs font-semibold text-gray-600 mb-1">Cabang Toko</label>
				{#if authState.user?.role === 'admin'}
					<select
						id="reportBranch"
						bind:value={selectedBranchId}
						class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 focus:outline-hidden focus:border-indigo-500"
					>
						<option value="all">Semua Cabang Toko</option>
						{#each branches as b}
							<option value={b.id}>{b.name} ({b.code})</option>
						{/each}
					</select>
				{:else}
					<input
						id="reportBranch"
						type="text"
						value={authState.branch?.name || 'Cabang Kasir'}
						disabled
						class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-100 text-xs font-semibold text-gray-500 cursor-not-allowed"
					/>
				{/if}
			</div>

			<!-- Filter Metode Pembayaran -->
			<div>
				<label for="reportPayment" class="block text-xs font-semibold text-gray-600 mb-1">Metode Pembayaran</label>
				<select
					id="reportPayment"
					bind:value={selectedPaymentMethod}
					class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 focus:outline-hidden focus:border-emerald-500"
				>
					<option value="all">Semua Metode Pembayaran</option>
					<option value="cash">Tunai (Cash)</option>
					<option value="qris">QRIS Dinamis</option>
					<option value="transfer">Transfer Bank</option>
				</select>
			</div>
		</div>
	</div>

	<!-- Info Periode Cetak (Hanya tampil saat print) -->
	<div class="hidden print:block border-b border-gray-300 pb-3 mb-4 text-xs text-gray-600">
		<p><strong>Periode Laporan:</strong> {startDate} s/d {endDate}</p>
		<p><strong>Cabang:</strong> {selectedBranchId === 'all' ? 'Semua Cabang' : (branches.find(b => b.id === selectedBranchId)?.name || selectedBranchId)}</p>
		<p><strong>Waktu Cetak:</strong> {new Date().toLocaleString('id-ID')}</p>
	</div>

	<!-- 1. EXECUTIVE KPI SUMMARY CARDS -->
	<div class="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
		<!-- Total Revenue -->
		<div class="bg-gradient-to-tr from-emerald-600 to-teal-600 rounded-2xl p-5 text-white shadow-lg shadow-emerald-600/20 col-span-2 sm:col-span-1 print:border print:border-gray-300 print:text-gray-900 print:bg-none print:shadow-none">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-emerald-100 print:text-gray-600">Total Pendapatan (Omset)</p>
				<DollarSign class="h-5 w-5 text-emerald-200 print:hidden" />
			</div>
			<p class="text-2xl font-black mt-2 print:text-xl">{formatRupiah(totalRevenue)}</p>
			<p class="text-[11px] text-emerald-100 print:text-gray-500 mt-1">Dari {totalTransactionsCount} transaksi selesai</p>
		</div>

		<!-- Gross Profit & Margin -->
		<div class="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col justify-between col-span-2 sm:col-span-1">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-gray-500">Estimasi Laba Kotor</p>
				<span class="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
					<Percent class="h-3 w-3" /> {profitMarginPercentage}% Margin
				</span>
			</div>
			<p class="text-2xl font-black text-gray-900 mt-2 print:text-xl">{formatRupiah(grossProfit)}</p>
			<p class="text-[11px] text-gray-400 mt-1">Berdasarkan HPP / Harga Modal</p>
		</div>

		<!-- Average Order Value (AOV) -->
		<div class="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col justify-between">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-gray-500">Rata-rata Nota (AOV)</p>
				<ShoppingBag class="h-4 w-4 text-gray-400 print:hidden" />
			</div>
			<p class="text-2xl font-bold text-gray-900 mt-2 print:text-xl">{formatRupiah(averageOrderValue)}</p>
			<p class="text-[11px] text-gray-400 mt-1">Per transaksi keranjang</p>
		</div>

		<!-- Total Item & Diskon -->
		<div class="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col justify-between">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-gray-500">Total Kuantitas Terjual</p>
				<Layers class="h-4 w-4 text-gray-400 print:hidden" />
			</div>
			<p class="text-2xl font-bold text-gray-900 mt-2 print:text-xl">{totalItemsSold} Unit</p>
			<p class="text-[11px] text-gray-400 mt-1">Diskon: {formatRupiah(totalDiscount)} • PB1: {formatRupiah(totalTax)}</p>
		</div>
	</div>

	<!-- 2. ANALISIS METODE PEMBAYARAN & KATEGORI -->
	<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
		<!-- Distribusi Metode Pembayaran (5 Kolom) -->
		<div class="lg:col-span-5 bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col justify-between">
			<div>
				<div class="flex items-center justify-between mb-4">
					<h3 class="text-sm font-bold text-gray-900 flex items-center gap-2">
						<Wallet class="h-4 w-4 text-emerald-600" />
						<span>Distribusi Metode Pembayaran</span>
					</h3>
					<span class="text-xs text-gray-400">{totalTransactionsCount} Nota</span>
				</div>

				<div class="space-y-4">
					{#each paymentBreakdown as pay}
						<div>
							<div class="flex justify-between items-center text-xs mb-1.5">
								<span class="font-semibold text-gray-700 flex items-center gap-1.5">
									{#if pay.key === 'cash'}
										<DollarSign class="h-3.5 w-3.5 text-emerald-600" />
									{:else if pay.key === 'qris'}
										<QrCode class="h-3.5 w-3.5 text-blue-600" />
									{:else}
										<CreditCard class="h-3.5 w-3.5 text-purple-600" />
									{/if}
									{pay.label}
								</span>
								<div class="text-right">
									<span class="font-bold text-gray-900">{formatRupiah(pay.amount)}</span>
									<span class="text-[11px] text-gray-400 ml-1">({pay.percentage}%)</span>
								</div>
							</div>
							<div class="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
								<div
									class="h-full rounded-full transition-all duration-500 {pay.key === 'cash' ? 'bg-emerald-500' : pay.key === 'qris' ? 'bg-blue-500' : 'bg-purple-500'}"
									style="width: {pay.percentage}%"
								></div>
							</div>
							<p class="text-[10px] text-gray-400 mt-1">{pay.count} kali transaksi</p>
						</div>
					{/each}
				</div>
			</div>

			<div class="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500 flex justify-between">
				<span>Total Terverifikasi:</span>
				<span class="font-bold text-gray-900">{formatRupiah(totalRevenue)}</span>
			</div>
		</div>

		<!-- Grafik Tren Penjualan Harian (7 Kolom) -->
		<div class="lg:col-span-7 bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col justify-between">
			<div class="flex items-center justify-between mb-4">
				<h3 class="text-sm font-bold text-gray-900 flex items-center gap-2">
					<TrendingUp class="h-4 w-4 text-emerald-600" />
					<span>Tren Penjualan Harian</span>
				</h3>
				<span class="text-xs text-gray-400">{dailyTrend.length} Hari Aktif</span>
			</div>

			{#if dailyTrend.length === 0}
				<div class="flex flex-col items-center justify-center h-48 text-gray-400 text-xs">
					Belum ada catatan penjualan pada rentang tanggal yang dipilih.
				</div>
			{:else}
				<div class="flex items-end gap-2 h-48 pt-6 pb-2 px-2 overflow-x-auto">
					{#each dailyTrend as day}
						<div class="flex-1 flex flex-col items-center min-w-[36px] h-full justify-end group relative">
							<!-- Tooltip Hover -->
							<div class="opacity-0 group-hover:opacity-100 transition absolute bottom-full mb-1 z-10 bg-gray-900 text-white text-[10px] font-semibold py-1 px-2 rounded pointer-events-none whitespace-nowrap shadow-md">
								<p>{day.date}</p>
								<p class="text-emerald-400">{formatRupiah(day.revenue)}</p>
								<p class="text-gray-300">{day.txCount} nota</p>
							</div>

							<!-- Bar Visual -->
							<div
								class="w-full max-w-[28px] bg-gradient-to-t from-emerald-600 to-teal-400 rounded-t-md transition-all duration-300 hover:brightness-110"
								style="height: {day.heightPercent}%"
							></div>

							<span class="text-[10px] text-gray-500 mt-2 font-medium truncate w-full text-center">
								{day.formattedDate}
							</span>
						</div>
					{/each}
				</div>
			{/if}

			<div class="mt-2 pt-2 border-t border-gray-100 flex justify-between text-[11px] text-gray-400">
				<span>Grafik menunjukkan nominal akumulasi omset per tanggal</span>
				<span class="font-medium text-emerald-700">Rata-rata: {dailyTrend.length > 0 ? formatRupiah(Math.round(totalRevenue / dailyTrend.length)) : 0} / hari</span>
			</div>
		</div>
	</div>

	<!-- 3. TOP SELLING PRODUCTS & KATEGORI BREAKDOWN -->
	<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
		<!-- Top Selling Products (7 Kolom) -->
		<div class="lg:col-span-7 bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
			<div class="p-4 border-b border-gray-100 flex items-center justify-between">
				<h3 class="text-sm font-bold text-gray-900 flex items-center gap-2">
					<Award class="h-4 w-4 text-amber-500" />
					<span>Produk Terlaris (Top Selling)</span>
				</h3>
				<span class="text-xs text-gray-400">Peringkat berdasarkan kontribusi omset</span>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full text-left text-xs">
					<thead class="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-100">
						<tr>
							<th class="px-4 py-3">Peringkat & Produk</th>
							<th class="px-4 py-3 text-center">Terjual</th>
							<th class="px-4 py-3">Total Omset</th>
							<th class="px-4 py-3 text-right">Laba Kotor</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100 font-medium text-gray-700">
						{#if topProducts.length === 0}
							<tr>
								<td colspan="4" class="px-4 py-8 text-center text-gray-400">
									Belum ada produk yang terjual dalam periode ini.
								</td>
							</tr>
						{:else}
							{#each topProducts as prod, idx}
								<tr class="hover:bg-gray-50/70 transition">
									<td class="px-4 py-3">
										<div class="flex items-center gap-2.5">
											<span class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold {idx === 0 ? 'bg-amber-100 text-amber-800' : idx === 1 ? 'bg-slate-200 text-slate-800' : idx === 2 ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-600'}">
												{idx + 1}
											</span>
											<span class="font-bold text-gray-900">{prod.name}</span>
										</div>
									</td>
									<td class="px-4 py-3 text-center">
										<span class="inline-block bg-gray-100 text-gray-800 px-2 py-0.5 rounded font-semibold text-[11px]">
											{prod.quantity}
										</span>
									</td>
									<td class="px-4 py-3 font-semibold text-emerald-700">{formatRupiah(prod.revenue)}</td>
									<td class="px-4 py-3 text-right font-bold text-gray-900">{formatRupiah(prod.profit)}</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Breakdown Penjualan Kategori (5 Kolom) -->
		<div class="lg:col-span-5 bg-white rounded-2xl border border-gray-200/80 shadow-xs p-5 flex flex-col justify-between">
			<div>
				<div class="flex items-center justify-between mb-4">
					<h3 class="text-sm font-bold text-gray-900 flex items-center gap-2">
						<Layers class="h-4 w-4 text-emerald-600" />
						<span>Penjualan per Kategori</span>
					</h3>
					<span class="text-xs text-gray-400">{categoryBreakdown.length} Kategori</span>
				</div>

				<div class="space-y-3.5">
					{#if categoryBreakdown.length === 0}
						<p class="text-xs text-gray-400 text-center py-8">Tidak ada data kategori.</p>
					{:else}
						{#each categoryBreakdown as cat}
							{@const catPct = totalRevenue > 0 ? Math.round((cat.revenue / totalRevenue) * 100) : 0}
							<div>
								<div class="flex justify-between items-center text-xs mb-1">
									<span class="font-semibold text-gray-800">{cat.name}</span>
									<span class="font-bold text-emerald-700">{formatRupiah(cat.revenue)} ({catPct}%)</span>
								</div>
								<div class="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
									<div
										class="h-full bg-emerald-600 rounded-full"
										style="width: {catPct}%"
									></div>
								</div>
								<p class="text-[10px] text-gray-400 mt-1">{cat.count} item terjual</p>
							</div>
						{/each}
					{/if}
				</div>
			</div>

			<div class="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
				Kontribusi kategori terhadap portofolio penjualan
			</div>
		</div>
	</div>

	<!-- 4. TABEL RINCIAN TRANSAKSI PERIODE -->
	<div class="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
		<div class="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
			<div>
				<h3 class="font-bold text-gray-900 text-sm">Rincian Transaksi Sesuai Filter</h3>
				<p class="text-xs text-gray-500">Menampilkan {filteredTransactions.length} transaksi yang memenuhi kriteria filter</p>
			</div>

			<span class="text-xs font-semibold px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg">
				Total: {formatRupiah(totalRevenue)}
			</span>
		</div>

		<div class="overflow-x-auto">
			<table class="w-full text-left text-xs">
				<thead class="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-100">
					<tr>
						<th class="px-4 py-3">No. Invoice</th>
						<th class="px-4 py-3">Tanggal & Waktu</th>
						<th class="px-4 py-3">Cabang</th>
						<th class="px-4 py-3">Kasir</th>
						<th class="px-4 py-3">Metode</th>
						<th class="px-4 py-3">Diskon</th>
						<th class="px-4 py-3">Pajak</th>
						<th class="px-4 py-3 text-right">Total Akhir</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100 font-medium text-gray-700">
					{#if filteredTransactions.length === 0}
						<tr>
							<td colspan="8" class="px-4 py-10 text-center text-gray-400">
								Tidak ada data transaksi yang cocok dengan filter tanggal/cabang ini.
							</td>
						</tr>
					{:else}
						{#each filteredTransactions as tx}
							<tr class="hover:bg-gray-50/60 transition">
								<td class="px-4 py-3 font-mono font-bold text-gray-900">{tx.invoice_no}</td>
								<td class="px-4 py-3 text-gray-500">
									{new Date(tx.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
									<span class="text-[10px] text-gray-400">
										{new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
									</span>
								</td>
								<td class="px-4 py-3">{tx.branch_name || '-'}</td>
								<td class="px-4 py-3">{tx.cashier_name || '-'}</td>
								<td class="px-4 py-3">
									<span class="uppercase font-semibold text-[10px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-700">
										{tx.payment_method}
									</span>
								</td>
								<td class="px-4 py-3 text-rose-600">{tx.discount > 0 ? formatRupiah(tx.discount) : '-'}</td>
								<td class="px-4 py-3 text-gray-500">{tx.tax > 0 ? formatRupiah(tx.tax) : '-'}</td>
								<td class="px-4 py-3 text-right font-bold text-emerald-700">{formatRupiah(tx.total)}</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>
