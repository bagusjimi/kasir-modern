<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Branch, Transaction, Expense, StockMovement, ActivityLog, Product } from '../types/index.js';
	import { downloadCsv, downloadJson, fileTimestamp } from '../utils/export.js';
	import {
		DatabaseBackup,
		Download,
		FileSpreadsheet,
		FileJson,
		Calendar,
		Building2,
		Info
	} from 'lucide-svelte';

	let branches = $state<Branch[]>([]);
	let filterBranchId = $state<string>('all');
	let filterStart = $state<string>('');
	let filterEnd = $state<string>('');
	let lastExportInfo = $state<string | null>(null);

	onMount(async () => {
		branches = await db.branches.toArray();

		// Rentang default: 30 hari terakhir
		const today = new Date();
		const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
		const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
		filterStart = toIsoDate(monthAgo);
		filterEnd = toIsoDate(today);
	});

	function inDateRange(dateIso: string | undefined): boolean {
		if (!filterStart && !filterEnd) return true;
		const day = (dateIso || '').slice(0, 10);
		if (!day) return false;
		if (filterStart && day < filterStart) return false;
		if (filterEnd && day > filterEnd) return false;
		return true;
	}

	function branchLabel(branchId: string): string {
		if (branchId === 'all') return 'Semua Cabang';
		const b = branches.find(x => x.id === branchId);
		return b ? `${b.name} (${b.code})` : branchId;
	}

	async function logExport(details: string) {
		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
			branch_id: 'all',
			branch_name: 'Pusat (Admin)',
			user_id: authState.user?.id || 'admin',
			user_name: authState.user?.name || 'Administrator',
			role: 'admin',
			action: 'export_data',
			details,
			timestamp: new Date().toISOString(),
			synced: false
		});
		syncEngine.triggerSync();
	}

	function showInfo(msg: string) {
		lastExportInfo = msg;
		setTimeout(() => (lastExportInfo = null), 5000);
	}

	async function exportTransactions() {
		const txs = (await db.transactions.toArray())
			.filter(t => inDateRange(t.created_at))
			.filter(t => filterBranchId === 'all' || t.branch_id === filterBranchId)
			.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

		if (txs.length === 0) return showInfo('Tidak ada transaksi pada rentang yang dipilih.');

		downloadCsv(
			`kasir-modern_transaksi_${filterStart || 'awal'}_${filterEnd || 'kini'}_${fileTimestamp()}.csv`,
			['No Invoice', 'Tanggal', 'Cabang', 'Kasir', 'Pelanggan', 'Subtotal', 'Diskon', 'Pajak', 'Total', 'Metode Bayar', 'Status'],
			txs.map(t => [
				t.invoice_no,
				t.created_at,
				t.branch_name || branchLabel(t.branch_id),
				t.cashier_name,
				t.customer_name || '',
				t.subtotal,
				t.discount,
				t.tax,
				t.total,
				t.payment_method,
				t.status
			])
		);
		await logExport(`Ekspor ${txs.length} transaksi ke CSV (${filterStart || 'awal'} s.d. ${filterEnd || 'kini'}, cabang: ${branchLabel(filterBranchId)})`);
	}

	async function exportTransactionItems() {
		const txs = (await db.transactions.toArray())
			.filter(t => inDateRange(t.created_at))
			.filter(t => filterBranchId === 'all' || t.branch_id === filterBranchId);
		const txById = new Map(txs.map(t => [t.id, t]));

		const items = await db.transaction_items.toArray();
		const rows: (string | number | null | undefined)[][] = [];
		for (const it of items) {
			const tx = txById.get(it.transaction_id);
			if (!tx) continue;
			rows.push([
				tx.invoice_no,
				tx.created_at,
				tx.branch_name || branchLabel(tx.branch_id),
				it.product_name,
				it.quantity,
				it.price,
				it.cost_price,
				it.subtotal
			]);
		}
		rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));

		if (rows.length === 0) return showInfo('Tidak ada item transaksi pada rentang yang dipilih.');

		downloadCsv(
			`kasir-modern_item_transaksi_${filterStart || 'awal'}_${filterEnd || 'kini'}_${fileTimestamp()}.csv`,
			['No Invoice', 'Tanggal', 'Cabang', 'Produk', 'Jumlah', 'Harga Jual', 'Harga Modal', 'Subtotal'],
			rows
		);
		await logExport(`Ekspor ${rows.length} baris item transaksi ke CSV (${filterStart || 'awal'} s.d. ${filterEnd || 'kini'}, cabang: ${branchLabel(filterBranchId)})`);
	}

	async function exportProducts() {
		const products = (await db.products.toArray())
			.filter(p => filterBranchId === 'all' || p.branch_id === filterBranchId)
			.sort((a, b) => a.name.localeCompare(b.name));

		if (products.length === 0) return showInfo('Tidak ada produk untuk cabang yang dipilih.');

		downloadCsv(
			`kasir-modern_produk_stok_${fileTimestamp()}.csv`,
			['SKU', 'Barcode', 'Nama Produk', 'Kategori', 'Cabang', 'Stok', 'Stok Minimum', 'Satuan', 'Harga Jual', 'Harga Modal', 'Nilai Stok (Modal)'],
			products.map((p: Product) => [
				p.sku,
				p.barcode || '',
				p.name,
				p.category,
				branchLabel(p.branch_id),
				p.stock,
				p.min_stock ?? 0,
				p.unit,
				p.price,
				p.cost_price,
				p.stock * p.cost_price
			])
		);
		await logExport(`Ekspor ${products.length} produk & stok ke CSV (cabang: ${branchLabel(filterBranchId)})`);
	}

	async function exportExpenses() {
		const expenses = (await db.expenses.toArray())
			.filter((e: Expense) => inDateRange(e.date))
			.filter((e: Expense) => filterBranchId === 'all' || e.branch_id === filterBranchId)
			.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

		if (expenses.length === 0) return showInfo('Tidak ada pengeluaran pada rentang yang dipilih.');

		downloadCsv(
			`kasir-modern_pengeluaran_${filterStart || 'awal'}_${filterEnd || 'kini'}_${fileTimestamp()}.csv`,
			['Tanggal', 'Cabang', 'Kategori', 'Jumlah', 'Keterangan', 'Penerima', 'No. Bukti', 'Dicatat Oleh'],
			expenses.map(e => [
				e.date,
				e.branch_name || branchLabel(e.branch_id),
				e.category_label || e.category,
				e.amount,
				e.description,
				e.recipient || '',
				e.receipt_number || '',
				e.user_name
			])
		);
		await logExport(`Ekspor ${expenses.length} pengeluaran ke CSV (${filterStart || 'awal'} s.d. ${filterEnd || 'kini'}, cabang: ${branchLabel(filterBranchId)})`);
	}

	async function exportStockMovements() {
		const movements = (await db.stock_movements.toArray())
			.filter((m: StockMovement) => inDateRange(m.created_at))
			.filter((m: StockMovement) => filterBranchId === 'all' || m.branch_id === filterBranchId)
			.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

		if (movements.length === 0) return showInfo('Tidak ada mutasi stok pada rentang yang dipilih.');

		const products = await db.products.toArray();
		const productName = new Map(products.map(p => [p.id, p.name]));

		downloadCsv(
			`kasir-modern_mutasi_stok_${filterStart || 'awal'}_${filterEnd || 'kini'}_${fileTimestamp()}.csv`,
			['Waktu', 'Cabang', 'Produk', 'Jenis Mutasi', 'Jumlah (masuk+/keluar-)', 'Referensi', 'Alasan', 'Oleh'],
			movements.map(m => [
				m.created_at,
				branchLabel(m.branch_id),
				productName.get(m.product_id) || m.product_id,
				m.type,
				m.quantity,
				m.reference_id || '',
				m.reason || '',
				m.user_name
			])
		);
		await logExport(`Ekspor ${movements.length} mutasi stok ke CSV (${filterStart || 'awal'} s.d. ${filterEnd || 'kini'}, cabang: ${branchLabel(filterBranchId)})`);
	}

	async function exportActivityLogs() {
		const logs = (await db.activity_logs.toArray())
			.filter((l: ActivityLog) => inDateRange(l.timestamp))
			.filter((l: ActivityLog) => filterBranchId === 'all' || l.branch_id === filterBranchId)
			.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

		if (logs.length === 0) return showInfo('Tidak ada catatan aktivitas pada rentang yang dipilih.');

		downloadCsv(
			`kasir-modern_log_aktivitas_${filterStart || 'awal'}_${filterEnd || 'kini'}_${fileTimestamp()}.csv`,
			['Waktu', 'Cabang', 'Pengguna', 'Peran', 'Aksi', 'Detail'],
			logs.map(l => [
				l.timestamp,
				l.branch_name || branchLabel(l.branch_id),
				l.user_name,
				l.role,
				l.action,
				l.details
			])
		);
		await logExport(`Ekspor ${logs.length} catatan aktivitas ke CSV (${filterStart || 'awal'} s.d. ${filterEnd || 'kini'}, cabang: ${branchLabel(filterBranchId)})`);
	}

	async function exportFullBackup() {
		const [
			branchesData, users, products, categories, transactions, transactionItems,
			expenses, stockMovements, transactionAdjustments, shifts, purchases,
			stockCounts, stockTransfers, announcements, activityLogs, appSettings
		] = await Promise.all([
			db.branches.toArray(), db.users.toArray(), db.products.toArray(), db.categories.toArray(),
			db.transactions.toArray(), db.transaction_items.toArray(), db.expenses.toArray(),
			db.stock_movements.toArray(), db.transaction_adjustments.toArray(), db.shifts.toArray(),
			db.purchases.toArray(), db.stock_counts.toArray(), db.stock_transfers.toArray(),
			db.announcements.toArray(), db.activity_logs.toArray(), db.app_settings.toArray()
		]);

		downloadJson(`kasir-modern_backup_lengkap_${fileTimestamp()}.json`, {
			exported_at: new Date().toISOString(),
			app: 'Kasir Modern',
			data: {
				branches: branchesData,
				users,
				products,
				categories,
				transactions,
				transaction_items: transactionItems,
				expenses,
				stock_movements: stockMovements,
				transaction_adjustments: transactionAdjustments,
				shifts,
				purchases,
				stock_counts: stockCounts,
				stock_transfers: stockTransfers,
				announcements,
				activity_logs: activityLogs,
				app_settings: appSettings
			}
		});
		await logExport('Unduh backup lengkap seluruh data (JSON)');
	}

	const exportCards = [
		{
			id: 'transactions',
			title: 'Transaksi',
			description: 'Ringkasan setiap transaksi: invoice, tanggal, cabang, kasir, nilai, metode bayar, dan status.',
			action: exportTransactions
		},
		{
			id: 'transaction_items',
			title: 'Item Transaksi',
			description: 'Rincian per produk dari setiap transaksi, untuk analisis produk terlaris dan laba.',
			action: exportTransactionItems
		},
		{
			id: 'products',
			title: 'Produk & Stok',
			description: 'Katalog produk beserta stok, harga jual, harga modal, dan nilai stok saat ini.',
			action: exportProducts
		},
		{
			id: 'expenses',
			title: 'Pengeluaran',
			description: 'Catatan pengeluaran operasional per cabang sesuai rentang tanggal.',
			action: exportExpenses
		},
		{
			id: 'stock_movements',
			title: 'Mutasi Stok',
			description: 'Kartu stok: penjualan, pembelian, opname, retur, dan transfer antar cabang.',
			action: exportStockMovements
		},
		{
			id: 'activity_logs',
			title: 'Log Aktivitas',
			description: 'Jejak audit seluruh aktivitas pengguna sesuai rentang tanggal.',
			action: exportActivityLogs
		}
	];
</script>

<div class="space-y-5">
	<!-- Header -->
	<div>
		<h2 class="text-lg font-bold text-gray-900 flex items-center gap-2">
			<DatabaseBackup class="h-5 w-5 text-emerald-600" />
			Backup &amp; Ekspor Data
		</h2>
		<p class="text-xs text-gray-500 mt-0.5">
			Unduh data untuk pengamanan atau analisis lebih lanjut di Excel. Ekspor menggunakan data yang sudah tersinkronisasi di perangkat ini.
		</p>
	</div>

	{#if lastExportInfo}
		<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700 flex items-center gap-2">
			<Info class="h-4 w-4 shrink-0" />
			{lastExportInfo}
		</div>
	{/if}

	<!-- Filter -->
	<div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-2xs">
		<div class="flex flex-wrap items-end gap-4">
			<div>
				<label for="bk-start" class="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-700">
					<Calendar class="h-3.5 w-3.5 text-gray-400" />
					Dari Tanggal
				</label>
				<input
					id="bk-start"
					type="date"
					bind:value={filterStart}
					class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 focus:outline-hidden focus:border-emerald-500"
				/>
			</div>
			<div>
				<label for="bk-end" class="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-700">
					<Calendar class="h-3.5 w-3.5 text-gray-400" />
					Sampai Tanggal
				</label>
				<input
					id="bk-end"
					type="date"
					bind:value={filterEnd}
					class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 focus:outline-hidden focus:border-emerald-500"
				/>
			</div>
			<div>
				<label for="bk-branch" class="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-700">
					<Building2 class="h-3.5 w-3.5 text-gray-400" />
					Cabang
				</label>
				<select
					id="bk-branch"
					bind:value={filterBranchId}
					class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
				>
					<option value="all">Semua Cabang</option>
					{#each branches as b (b.id)}
						<option value={b.id}>{b.name} ({b.code})</option>
					{/each}
				</select>
			</div>
			<p class="text-[11px] text-gray-400 pb-1.5">Filter tanggal berlaku untuk transaksi, item, pengeluaran, mutasi stok, dan log aktivitas.</p>
		</div>
	</div>

	<!-- Kartu Ekspor CSV -->
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each exportCards as card (card.id)}
			<div class="flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-2xs">
				<div>
					<div class="flex items-center gap-2">
						<FileSpreadsheet class="h-4 w-4 text-emerald-600" />
						<h3 class="text-sm font-bold text-gray-900">{card.title}</h3>
					</div>
					<p class="mt-1.5 text-xs text-gray-500 leading-relaxed">{card.description}</p>
				</div>
				<button
					onclick={card.action}
					class="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition cursor-pointer"
				>
					<Download class="h-3.5 w-3.5" />
					Unduh CSV
				</button>
			</div>
		{/each}
	</div>

	<!-- Backup Lengkap JSON -->
	<div class="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<div class="flex items-center gap-2">
					<FileJson class="h-4 w-4 text-amber-700" />
					<h3 class="text-sm font-bold text-gray-900">Backup Lengkap (JSON)</h3>
				</div>
				<p class="mt-1.5 text-xs text-gray-600 leading-relaxed max-w-2xl">
					Mengunduh seluruh data aplikasi (cabang, pengguna, produk, kategori, transaksi, stok, pengeluaran, shift, pembelian, opname, transfer, pengumuman, log, dan pengaturan) dalam satu berkas JSON. Simpan berkas ini di tempat aman sebagai cadangan menyeluruh.
				</p>
			</div>
			<button
				onclick={exportFullBackup}
				class="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 px-4 py-2 text-xs font-semibold text-white shadow-xs transition cursor-pointer"
			>
				<Download class="h-3.5 w-3.5" />
				Unduh Backup Lengkap
			</button>
		</div>
	</div>
</div>
