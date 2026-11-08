<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Expense, ExpenseCategory, Branch } from '../types/index.js';
	import {
		ReceiptText,
		Plus,
		Search,
		Filter,
		Trash2,
		Edit3,
		Calendar,
		DollarSign,
		Building2,
		Tag,
		FileText,
		User,
		CheckCircle2,
		AlertCircle,
		X,
		Download,
		TrendingDown,
		PieChart,
		RefreshCw
	} from 'lucide-svelte';

	export const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string; iconBg: string; description: string }[] = [
		{ id: 'listrik_air_internet', label: 'Listrik, Air & Internet', iconBg: 'bg-amber-100 text-amber-700', description: 'Tagihan PLN, PDAM, WiFi minimarket' },
		{ id: 'gaji_karyawan', label: 'Gaji & Upah Karyawan', iconBg: 'bg-blue-100 text-blue-700', description: 'Gaji kasir, staf gudang, lembur' },
		{ id: 'sewa_tempat', label: 'Sewa Tempat & Bangunan', iconBg: 'bg-purple-100 text-purple-700', description: 'Sewa ruko, kios, atau retribusi lokasi' },
		{ id: 'perlengkapan_kebersihan', label: 'Kebersihan & Sanitasi', iconBg: 'bg-teal-100 text-teal-700', description: 'Sapu, pel, sabun cuci, pewangi ruangan, trash bag' },
		{ id: 'kantong_plastik_kemasan', label: 'Plastik & Kertas Struk', iconBg: 'bg-emerald-100 text-emerald-700', description: 'Kantong belanja, thermal paper kasir, isolasi' },
		{ id: 'perawatan_perbaikan', label: 'Perawatan & Servis Alat', iconBg: 'bg-orange-100 text-orange-700', description: 'Servis AC minimarket, chiller, freezer, rak' },
		{ id: 'transportasi_logistik', label: 'Transportasi & Logistik', iconBg: 'bg-cyan-100 text-cyan-700', description: 'Bensin antar barang, uang parkir, kurir' },
		{ id: 'konsumsi_karyawan', label: 'Konsumsi & Operasional Harian', iconBg: 'bg-rose-100 text-rose-700', description: 'Air galon toko, konsumsi piket, kopi & teh' },
		{ id: 'lain_lain', label: 'Biaya Operasional Lainnya', iconBg: 'bg-gray-100 text-gray-700', description: 'Pengeluaran tak terduga minimarket lainnya' }
	];

	let expenses = $state<Expense[]>([]);
	let branches = $state<Branch[]>([]);
	let isLoading = $state<boolean>(false);
	let searchQuery = $state<string>('');
	let selectedCategoryFilter = $state<string>('all');
	let selectedBranchFilter = $state<string>('all');
	let filterStartDate = $state<string>('');
	let filterEndDate = $state<string>('');

	// Modal State
	let isModalOpen = $state<boolean>(false);
	let isEditing = $state<boolean>(false);
	let isSaving = $state<boolean>(false);
	let formError = $state<string | null>(null);

	// Form fields
	let formId = $state<string>('');
	let formBranchId = $state<string>('');
	let formCategory = $state<ExpenseCategory>('listrik_air_internet');
	let formAmount = $state<number | string>('');
	let formDescription = $state<string>('');
	let formRecipient = $state<string>('');
	let formReceiptNumber = $state<string>('');
	let formDate = $state<string>(getTodayDateString());

	function getTodayDateString(): string {
		const d = new Date();
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function formatRupiah(num: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(num);
	}

	function getCategoryMeta(catId: ExpenseCategory) {
		return EXPENSE_CATEGORIES.find(c => c.id === catId) || {
			id: catId,
			label: catId,
			iconBg: 'bg-gray-100 text-gray-700',
			description: ''
		};
	}

	onMount(async () => {
		if (authState.user?.role === 'cashier' && authState.branch?.id) {
			selectedBranchFilter = authState.branch.id;
		} else {
			selectedBranchFilter = 'all';
		}

		await loadInitialData();
	});

	async function loadInitialData() {
		isLoading = true;
		try {
			branches = await db.branches.toArray();
			await loadExpenses();
		} finally {
			isLoading = false;
		}
	}

	async function loadExpenses() {
		isLoading = true;
		try {
			let allExp = await db.expenses.toArray();

			// Jika online, coba ambil data terbaru dari backend D1
			if (navigator.onLine) {
				try {
					const branchParam = (authState.user?.role === 'cashier' && authState.branch?.id)
						? authState.branch.id
						: selectedBranchFilter;
					const res = await fetch(`/api/expenses?branch_id=${branchParam}&limit=200`);
					if (res.ok) {
						const result = await res.json() as any;
						if (result.success && Array.isArray(result.data) && result.data.length > 0) {
							for (const serverExp of result.data) {
								const exists = allExp.find(e => e.id === serverExp.id);
								if (!exists) {
									await db.expenses.put({ ...serverExp, synced: true });
									allExp.push({ ...serverExp, synced: true });
								}
							}
						}
					}
				} catch (serverErr) {
					console.warn('Gagal memuat pengeluaran dari server, memakai data offline lokal:', serverErr);
				}
			}

			// Filter cabang untuk kasir
			if (authState.user?.role === 'cashier' && authState.branch?.id) {
				allExp = allExp.filter(e => e.branch_id === authState.branch?.id);
			}

			// Urutkan pengeluaran terbaru di paling atas
			allExp.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
			expenses = allExp;
		} finally {
			isLoading = false;
		}
	}

	// Filter pengeluaran yang tampil
	let filteredExpenses = $derived(
		expenses.filter(item => {
			if (selectedBranchFilter !== 'all' && item.branch_id !== selectedBranchFilter) {
				return false;
			}
			if (selectedCategoryFilter !== 'all' && item.category !== selectedCategoryFilter) {
				return false;
			}
			if (filterStartDate && item.date < filterStartDate) {
				return false;
			}
			if (filterEndDate && item.date > filterEndDate) {
				return false;
			}
			if (searchQuery.trim() !== '') {
				const query = searchQuery.toLowerCase();
				const matchDesc = item.description.toLowerCase().includes(query);
				const matchRecip = (item.recipient || '').toLowerCase().includes(query);
				const matchNo = (item.receipt_number || '').toLowerCase().includes(query);
				const matchCat = getCategoryMeta(item.category).label.toLowerCase().includes(query);
				if (!matchDesc && !matchRecip && !matchNo && !matchCat) {
					return false;
				}
			}
			return true;
		})
	);

	// Metrik Pengeluaran Terfilter
	let totalExpenseAmount = $derived(
		filteredExpenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
	);

	let totalExpenseCount = $derived(filteredExpenses.length);

	let averageExpenseAmount = $derived(
		totalExpenseCount > 0 ? Math.round(totalExpenseAmount / totalExpenseCount) : 0
	);

	// Breakdown Pengeluaran per Kategori
	let categoryBreakdown = $derived.by(() => {
		const map: { [key: string]: { category: ExpenseCategory; label: string; count: number; total: number } } = {};

		for (const exp of filteredExpenses) {
			const cat = exp.category;
			if (!map[cat]) {
				const meta = getCategoryMeta(cat);
				map[cat] = { category: cat, label: meta.label, count: 0, total: 0 };
			}
			map[cat].count += 1;
			map[cat].total += Number(exp.amount) || 0;
		}

		return Object.values(map).sort((a, b) => b.total - a.total);
	});

	function openCreateModal() {
		isEditing = false;
		formId = 'exp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
		formBranchId = (authState.user?.role === 'cashier' && authState.branch?.id) ? authState.branch.id : (branches[0]?.id || 'cb-01');
		formCategory = 'listrik_air_internet';
		formAmount = '';
		formDescription = '';
		formRecipient = '';
		formReceiptNumber = '';
		formDate = getTodayDateString();
		formError = null;
		isModalOpen = true;
	}

	function openEditModal(item: Expense) {
		isEditing = true;
		formId = item.id;
		formBranchId = item.branch_id;
		formCategory = item.category;
		formAmount = item.amount;
		formDescription = item.description;
		formRecipient = item.recipient || '';
		formReceiptNumber = item.receipt_number || '';
		formDate = item.date;
		formError = null;
		isModalOpen = true;
	}

	function closeModal() {
		isModalOpen = false;
		formError = null;
	}

	async function saveExpense() {
		if (!formDescription.trim()) {
			formError = 'Keterangan pengeluaran wajib diisi';
			return;
		}
		const numericAmount = Number(formAmount);
		if (isNaN(numericAmount) || numericAmount <= 0) {
			formError = 'Nominal biaya harus berupa angka lebih dari 0';
			return;
		}
		if (!formDate) {
			formError = 'Tanggal pengeluaran wajib dipilih';
			return;
		}
		if (!formBranchId) {
			formError = 'Cabang harus ditentukan';
			return;
		}

		isSaving = true;
		formError = null;

		try {
			const branchObj = branches.find(b => b.id === formBranchId);
			const branchName = branchObj ? branchObj.name : (authState.branch?.name || 'Cabang');
			const now = new Date().toISOString();

			const expenseData: Expense = {
				id: formId,
				branch_id: formBranchId,
				branch_name: branchName,
				user_id: authState.user?.id || 'unknown',
				user_name: authState.user?.name || 'Kasir',
				category: formCategory,
				category_label: getCategoryMeta(formCategory).label,
				amount: numericAmount,
				description: formDescription.trim(),
				recipient: formRecipient.trim(),
				receipt_number: formReceiptNumber.trim(),
				date: formDate,
				created_at: isEditing ? (expenses.find(e => e.id === formId)?.created_at || now) : now,
				updated_at: now,
				synced: false
			};

			// Simpan ke IndexedDB lokal (Offline-First)
			await db.expenses.put(expenseData);

			// Tambahkan ke antrean sinkronisasi
			await db.sync_queue.add({
				id: 'sync-exp-' + formId + '-' + Date.now(),
				entity: 'expense',
				action: isEditing ? 'update' : 'insert',
				data: expenseData,
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			// Catat ke log aktivitas lokal
			await db.activity_logs.add({
				id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
				branch_id: formBranchId,
				branch_name: branchName,
				user_id: authState.user?.id || '',
				user_name: authState.user?.name || '',
				role: authState.user?.role || 'cashier',
				action: isEditing ? 'expense_updated' : 'expense_recorded',
				details: `${isEditing ? 'Memperbarui' : 'Mencatat'} pengeluaran: ${expenseData.description} (${formatRupiah(expenseData.amount)})`,
				timestamp: now,
				synced: false
			});

			await loadExpenses();
			syncEngine.updatePendingCount();

			// Jika online, sinkronkan ke Cloudflare D1
			if (syncEngine.isOnline) {
				syncEngine.triggerSync();
			}

			closeModal();
		} catch (err: any) {
			formError = err.message || 'Gagal menyimpan pengeluaran';
		} finally {
			isSaving = false;
		}
	}

	async function handleDelete(item: Expense) {
		const confirmDelete = confirm(`Apakah Anda yakin ingin menghapus pengeluaran "${item.description}" (${formatRupiah(item.amount)})?`);
		if (!confirmDelete) return;

		try {
			await db.expenses.delete(item.id);

			// Masukkan antrean hapus untuk D1
			await db.sync_queue.add({
				id: 'sync-del-exp-' + item.id + '-' + Date.now(),
				entity: 'expense',
				action: 'delete',
				data: { id: item.id },
				timestamp: Date.now(),
				retry_count: 0,
				status: 'pending'
			});

			const now = new Date().toISOString();
			await db.activity_logs.add({
				id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
				branch_id: item.branch_id,
				branch_name: item.branch_name,
				user_id: authState.user?.id || '',
				user_name: authState.user?.name || '',
				role: authState.user?.role || 'cashier',
				action: 'expense_deleted',
				details: `Menghapus pengeluaran operasional: ${item.description} (${formatRupiah(item.amount)})`,
				timestamp: now,
				synced: false
			});

			await loadExpenses();
			syncEngine.updatePendingCount();

			if (syncEngine.isOnline) {
				syncEngine.triggerSync();
			}
		} catch (err: any) {
			alert('Gagal menghapus pengeluaran: ' + err.message);
		}
	}

	function exportToCSV() {
		if (filteredExpenses.length === 0) {
			alert('Tidak ada data pengeluaran untuk diekspor!');
			return;
		}

		const headers = [
			'ID',
			'Tanggal',
			'Cabang',
			'Kategori Pengeluaran',
			'Deskripsi / Keperluan',
			'Nominal Biaya (Rp)',
			'Penerima / Vendor',
			'No. Bukti / Struk',
			'Dicatat Oleh'
		];

		const rows = filteredExpenses.map(e => [
			`"${e.id}"`,
			`"${e.date}"`,
			`"${e.branch_name || '-'}"`,
			`"${getCategoryMeta(e.category).label}"`,
			`"${(e.description || '').replace(/"/g, '""')}"`,
			e.amount,
			`"${(e.recipient || '-').replace(/"/g, '""')}"`,
			`"${(e.receipt_number || '-').replace(/"/g, '""')}"`,
			`"${(e.user_name || '-').replace(/"/g, '""')}"`
		]);

		const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
		const encodedUri = encodeURI(csvContent);
		const link = document.createElement('a');
		link.setAttribute('href', encodedUri);
		link.setAttribute('download', `Pengeluaran_Operasional_${getTodayDateString()}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}
</script>

<div class="space-y-6">
	<!-- Header Bar & Quick Actions -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
		<div>
			<div class="flex items-center gap-2">
				<div class="h-9 w-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
					<ReceiptText class="h-5 w-5" />
				</div>
				<div>
					<h2 class="text-xl font-bold text-gray-900 tracking-tight">Pengelolaan Pengeluaran & Biaya Operasional</h2>
					<p class="text-xs text-gray-500 mt-0.5">
						Pencatatan beban operasional minimarket (listrik, gaji karyawan, sewa, kebersihan, kantong belanja, dll.)
					</p>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-2.5">
			<button
				onclick={openCreateModal}
				class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white shadow-md shadow-rose-600/20 active:scale-95 transition cursor-pointer"
			>
				<Plus class="h-4 w-4" />
				<span>Catat Pengeluaran Baru</span>
			</button>

			<button
				onclick={exportToCSV}
				class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs transition cursor-pointer"
				title="Ekspor daftar pengeluaran ke CSV"
			>
				<Download class="h-4 w-4 text-gray-500" />
				<span class="hidden sm:inline">Ekspor CSV</span>
			</button>

			<button
				onclick={loadExpenses}
				class="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-500 transition cursor-pointer"
				title="Segarkan Data"
			>
				<RefreshCw class="h-4 w-4 {isLoading ? 'animate-spin text-rose-600' : ''}" />
			</button>
		</div>
	</div>

	<!-- KPI Summary Cards -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
		<!-- Total Pengeluaran -->
		<div class="bg-gradient-to-tr from-rose-600 to-pink-600 rounded-2xl p-5 text-white shadow-lg shadow-rose-600/20">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-rose-100">Total Biaya Operasional</p>
				<TrendingDown class="h-5 w-5 text-rose-200" />
			</div>
			<p class="text-2xl font-black mt-2">{formatRupiah(totalExpenseAmount)}</p>
			<p class="text-[11px] text-rose-100 mt-1">Akumulasi dari {totalExpenseCount} transaksi beban</p>
		</div>

		<!-- Jumlah Transaksi Pengeluaran -->
		<div class="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col justify-between">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-gray-500">Frekuensi Pengeluaran</p>
				<ReceiptText class="h-5 w-5 text-gray-400" />
			</div>
			<p class="text-2xl font-black text-gray-900 mt-2">{totalExpenseCount} Catatan</p>
			<p class="text-[11px] text-gray-400 mt-1">Rata-rata: {formatRupiah(averageExpenseAmount)} per entri</p>
		</div>

		<!-- Kategori Terbesar -->
		<div class="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-xs flex flex-col justify-between">
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold text-gray-500">Kategori Biaya Terbesar</p>
				<PieChart class="h-5 w-5 text-rose-500" />
			</div>
			{#if categoryBreakdown.length > 0}
				<div>
					<p class="text-lg font-bold text-gray-900 mt-1 truncate">{categoryBreakdown[0].label}</p>
					<p class="text-xs font-semibold text-rose-600 mt-0.5">{formatRupiah(categoryBreakdown[0].total)} ({totalExpenseAmount > 0 ? Math.round((categoryBreakdown[0].total / totalExpenseAmount) * 100) : 0}%)</p>
				</div>
			{:else}
				<p class="text-sm font-semibold text-gray-400 mt-2">Belum ada data biaya</p>
			{/if}
			<p class="text-[11px] text-gray-400 mt-1">Beban tertinggi dalam periode terpilih</p>
		</div>
	</div>

	<!-- Filter & Search Controls -->
	<div class="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs space-y-4">
		<div class="flex items-center gap-2 pb-2 border-b border-gray-100 text-xs font-bold text-gray-700">
			<Filter class="h-4 w-4 text-rose-600" />
			<span>Filter & Pencarian Pengeluaran</span>
		</div>

		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
			<!-- Cari Kata Kunci -->
			<div class="lg:col-span-2 relative">
				<label for="searchExp" class="block text-xs font-semibold text-gray-600 mb-1">Cari Keterangan / Vendor</label>
				<div class="relative">
					<Search class="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
					<input
						id="searchExp"
						type="text"
						bind:value={searchQuery}
						placeholder="Misal: Token listrik, sabun cuci, kertas struk..."
						class="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs text-gray-800 placeholder-gray-400 focus:outline-hidden focus:border-rose-500"
					/>
				</div>
			</div>

			<!-- Filter Kategori -->
			<div>
				<label for="filterCat" class="block text-xs font-semibold text-gray-600 mb-1">Kategori Beban</label>
				<select
					id="filterCat"
					bind:value={selectedCategoryFilter}
					class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-medium text-gray-700 focus:outline-hidden focus:border-rose-500"
				>
					<option value="all">Semua Kategori</option>
					{#each EXPENSE_CATEGORIES as cat}
						<option value={cat.id}>{cat.label}</option>
					{/each}
				</select>
			</div>

			<!-- Filter Cabang -->
			<div>
				<label for="filterBranch" class="block text-xs font-semibold text-gray-600 mb-1">Cabang Toko</label>
				{#if authState.user?.role === 'admin'}
					<select
						id="filterBranch"
						bind:value={selectedBranchFilter}
						class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-medium text-gray-700 focus:outline-hidden focus:border-indigo-500"
					>
						<option value="all">Semua Cabang</option>
						{#each branches as b}
							<option value={b.id}>{b.name}</option>
						{/each}
					</select>
				{:else}
					<input
						id="filterBranch"
						type="text"
						value={authState.branch?.name || 'Cabang Kasir'}
						disabled
						class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-100 text-xs font-medium text-gray-500 cursor-not-allowed"
					/>
				{/if}
			</div>

			<!-- Filter Tanggal Mulai -->
			<div>
				<label for="filterStart" class="block text-xs font-semibold text-gray-600 mb-1">Tanggal</label>
				<input
					id="filterStart"
					type="date"
					bind:value={filterStartDate}
					class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs text-gray-700 focus:outline-hidden focus:border-rose-500"
				/>
			</div>
		</div>
	</div>

	<!-- Tabel Daftar Pengeluaran & Rincian Kategori -->
	<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
		<!-- Tabel Pengeluaran (8 Kolom) -->
		<div class="lg:col-span-8 bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
			<div class="p-4 border-b border-gray-100 flex items-center justify-between">
				<div>
					<h3 class="font-bold text-gray-900 text-sm">Riwayat Beban Operasional</h3>
					<p class="text-xs text-gray-500">Daftar biaya operasional yang dikeluarkan oleh minimarket</p>
				</div>
				<span class="text-xs font-semibold px-2.5 py-1 bg-rose-50 text-rose-700 rounded-lg">
					Total: {formatRupiah(totalExpenseAmount)}
				</span>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full text-left text-xs">
					<thead class="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-100">
						<tr>
							<th class="px-4 py-3">Tanggal & Kategori</th>
							<th class="px-4 py-3">Keterangan / Keperluan</th>
							<th class="px-4 py-3">Cabang & Penerima</th>
							<th class="px-4 py-3 text-right">Nominal Biaya</th>
							<th class="px-4 py-3 text-center">Aksi</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100 font-medium text-gray-700">
						{#if filteredExpenses.length === 0}
							<tr>
								<td colspan="5" class="px-4 py-12 text-center text-gray-400">
									<div class="flex flex-col items-center justify-center gap-2">
										<ReceiptText class="h-8 w-8 text-gray-300" />
										<p>Belum ada catatan pengeluaran operasional yang sesuai filter.</p>
										<button
											onclick={openCreateModal}
											class="mt-1 text-xs font-bold text-rose-600 hover:text-rose-700 cursor-pointer"
										>
											+ Tambah Catatan Sekarang
										</button>
									</div>
								</td>
							</tr>
						{:else}
							{#each filteredExpenses as item}
								{@const catMeta = getCategoryMeta(item.category)}
								<tr class="hover:bg-gray-50/70 transition">
									<td class="px-4 py-3">
										<div class="space-y-1">
											<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold {catMeta.iconBg}">
												{catMeta.label}
											</span>
											<p class="text-gray-500 font-mono text-[11px] flex items-center gap-1">
												<Calendar class="h-3 w-3 text-gray-400" />
												{new Date(item.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
											</p>
										</div>
									</td>
									<td class="px-4 py-3 max-w-[220px]">
										<p class="font-bold text-gray-900 leading-tight">{item.description}</p>
										{#if item.receipt_number}
											<p class="text-[10px] text-gray-400 mt-0.5">No. Bukti: <span class="font-mono">{item.receipt_number}</span></p>
										{/if}
									</td>
									<td class="px-4 py-3">
										<p class="text-gray-800 text-[11px] flex items-center gap-1">
											<Building2 class="h-3 w-3 text-gray-400" />
											{item.branch_name || 'Semua Cabang'}
										</p>
										<p class="text-gray-400 text-[10px] mt-0.5">
											{item.recipient ? `Penerima: ${item.recipient}` : `Dicatat: ${item.user_name}`}
										</p>
									</td>
									<td class="px-4 py-3 text-right">
										<p class="font-bold text-rose-700 text-sm">{formatRupiah(item.amount)}</p>
										{#if !item.synced}
											<span class="inline-block mt-0.5 text-[9px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
												Offline
											</span>
										{/if}
									</td>
									<td class="px-4 py-3 text-center">
										<div class="flex items-center justify-center gap-1">
											<button
												onclick={() => openEditModal(item)}
												class="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
												title="Ubah Pengeluaran"
											>
												<Edit3 class="h-3.5 w-3.5" />
											</button>
											<button
												onclick={() => handleDelete(item)}
												class="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
												title="Hapus Pengeluaran"
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

		<!-- Breakdown Beban Kategori (4 Kolom) -->
		<div class="lg:col-span-4 bg-white rounded-2xl border border-gray-200/80 shadow-xs p-5 flex flex-col justify-between">
			<div>
				<div class="flex items-center justify-between mb-4">
					<h3 class="text-sm font-bold text-gray-900 flex items-center gap-2">
						<PieChart class="h-4 w-4 text-rose-600" />
						<span>Distribusi Beban Operasional</span>
					</h3>
					<span class="text-xs text-gray-400">{categoryBreakdown.length} Kategori</span>
				</div>

				<div class="space-y-3.5">
					{#if categoryBreakdown.length === 0}
						<p class="text-xs text-gray-400 text-center py-8">Belum ada pengeluaran pada rentang waktu ini.</p>
					{:else}
						{#each categoryBreakdown as cat}
							{@const pct = totalExpenseAmount > 0 ? Math.round((cat.total / totalExpenseAmount) * 100) : 0}
							<div>
								<div class="flex justify-between items-center text-xs mb-1">
									<span class="font-semibold text-gray-800">{cat.label}</span>
									<span class="font-bold text-rose-700">{formatRupiah(cat.total)} ({pct}%)</span>
								</div>
								<div class="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
									<div
										class="h-full bg-rose-500 rounded-full transition-all duration-300"
										style="width: {pct}%"
									></div>
								</div>
								<p class="text-[10px] text-gray-400 mt-1">{cat.count} kali pengeluaran</p>
							</div>
						{/each}
					{/if}
				</div>
			</div>

			<div class="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
				Pengeluaran ini mengurangi laba kotor toko dalam penghitungan laba bersih operasional.
			</div>
		</div>
	</div>
</div>

<!-- Modal Form Pengeluaran (Catat / Edit) -->
{#if isModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
		<div class="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
			<!-- Header Modal -->
			<div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
				<div class="flex items-center gap-2">
					<div class="h-8 w-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center">
						<ReceiptText class="h-4 w-4" />
					</div>
					<div>
						<h3 class="font-bold text-gray-900 text-base">
							{isEditing ? 'Ubah Catatan Pengeluaran' : 'Catat Pengeluaran Operasional'}
						</h3>
						<p class="text-xs text-gray-500">Biaya operasional toko minimarket</p>
					</div>
				</div>
				<button
					onclick={closeModal}
					class="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 transition cursor-pointer"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Body Modal -->
			<form onsubmit={(e) => { e.preventDefault(); saveExpense(); }} class="p-6 space-y-4">
				{#if formError}
					<div class="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
						<AlertCircle class="h-4 w-4 shrink-0" />
						<span>{formError}</span>
					</div>
				{/if}

				<!-- Tanggal & Cabang -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div>
						<label for="formExpDate" class="block text-xs font-semibold text-gray-700 mb-1">
							Tanggal Pengeluaran <span class="text-rose-500">*</span>
						</label>
						<input
							id="formExpDate"
							type="date"
							bind:value={formDate}
							required
							class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs text-gray-800 focus:outline-hidden focus:border-rose-500"
						/>
					</div>

					<div>
						<label for="formExpBranch" class="block text-xs font-semibold text-gray-700 mb-1">
							Cabang Toko <span class="text-rose-500">*</span>
						</label>
						{#if authState.user?.role === 'admin'}
							<select
								id="formExpBranch"
								bind:value={formBranchId}
								required
								class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-medium text-gray-800 focus:outline-hidden focus:border-indigo-500"
							>
								{#each branches as b}
									<option value={b.id}>{b.name}</option>
								{/each}
							</select>
						{:else}
							<input
								id="formExpBranch"
								type="text"
								value={authState.branch?.name || 'Cabang Kasir'}
								disabled
								class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-100 text-xs font-medium text-gray-500 cursor-not-allowed"
							/>
						{/if}
					</div>
				</div>

				<!-- Kategori Biaya -->
				<div>
					<label for="formExpCategory" class="block text-xs font-semibold text-gray-700 mb-1">
						Kategori Pengeluaran <span class="text-rose-500">*</span>
					</label>
					<select
						id="formExpCategory"
						bind:value={formCategory}
						required
						class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-medium text-gray-800 focus:outline-hidden focus:border-rose-500"
					>
						{#each EXPENSE_CATEGORIES as cat}
							<option value={cat.id}>{cat.label} - ({cat.description})</option>
						{/each}
					</select>
				</div>

				<!-- Nominal Biaya -->
				<div>
					<label for="formExpAmount" class="block text-xs font-semibold text-gray-700 mb-1">
						Nominal Biaya (Rp) <span class="text-rose-500">*</span>
					</label>
					<div class="relative">
						<span class="absolute left-3 top-2 text-xs font-bold text-gray-400">Rp</span>
						<input
							id="formExpAmount"
							type="number"
							bind:value={formAmount}
							placeholder="Misal: 150000"
							min="1"
							required
							class="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-900 focus:outline-hidden focus:border-rose-500"
						/>
					</div>
				</div>

				<!-- Deskripsi Pengeluaran -->
				<div>
					<label for="formExpDesc" class="block text-xs font-semibold text-gray-700 mb-1">
						Keterangan / Keperluan Lengkap <span class="text-rose-500">*</span>
					</label>
					<textarea
						id="formExpDesc"
						bind:value={formDescription}
						rows="2"
						placeholder="Contoh: Beli 2 roll kertas thermal kasir & kantong kresek ukuran sedang"
						required
						class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs text-gray-800 placeholder-gray-400 focus:outline-hidden focus:border-rose-500"
					></textarea>
				</div>

				<!-- Penerima / Vendor & No Bukti -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div>
						<label for="formExpRecipient" class="block text-xs font-semibold text-gray-700 mb-1">
							Penerima / Toko / Vendor (Opsional)
						</label>
						<input
							id="formExpRecipient"
							type="text"
							bind:value={formRecipient}
							placeholder="Misal: Toko Plastik Maju"
							class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs text-gray-800 focus:outline-hidden focus:border-rose-500"
						/>
					</div>

					<div>
						<label for="formExpReceiptNo" class="block text-xs font-semibold text-gray-700 mb-1">
							No. Nota / Bukti Struk (Opsional)
						</label>
						<input
							id="formExpReceiptNo"
							type="text"
							bind:value={formReceiptNumber}
							placeholder="Misal: STR-98124"
							class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-mono text-gray-800 focus:outline-hidden focus:border-rose-500"
						/>
					</div>
				</div>

				<!-- Footer Actions -->
				<div class="pt-4 border-t border-gray-100 flex items-center justify-end gap-2.5">
					<button
						type="button"
						onclick={closeModal}
						class="px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
					>
						Batal
					</button>

					<button
						type="submit"
						disabled={isSaving}
						class="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-xs font-bold text-white shadow-md shadow-rose-600/20 active:scale-95 transition cursor-pointer flex items-center gap-1.5"
					>
						{#if isSaving}
							<RefreshCw class="h-3.5 w-3.5 animate-spin" />
							<span>Menyimpan...</span>
						{:else}
							<CheckCircle2 class="h-3.5 w-3.5" />
							<span>{isEditing ? 'Simpan Perubahan' : 'Simpan Pengeluaran'}</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
