<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Branch, Product, StockTransfer, StockTransferItem } from '../types/index.js';
	import {
		ArrowLeftRight,
		Plus,
		Search,
		Building2,
		AlertCircle,
		CheckCircle2,
		X,
		Clock,
		Truck,
		CheckCircle,
		XCircle,
		Eye,
		RotateCcw,
		Trash2,
		Package
	} from 'lucide-svelte';

	let transfers = $state<StockTransfer[]>([]);
	let branches = $state<Branch[]>([]);
	let products = $state<Product[]>([]);
	let isLoading = $state<boolean>(false);
	let searchQuery = $state<string>('');
	let statusFilter = $state<string>('all');
	let branchFilter = $state<string>('all');
	let notification = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	// Modal Create Transfer
	let isCreateModalOpen = $state<boolean>(false);
	let sourceBranchId = $state<string>('');
	let destinationBranchId = $state<string>('');
	let transferNotes = $state<string>('');
	let transferItems = $state<{ product_id: string; quantity: number }[]>([]);
	let isSubmitting = $state<boolean>(false);
	let createError = $state<string | null>(null);

	// Modal Detail Transfer
	let isDetailModalOpen = $state<boolean>(false);
	let selectedTransfer = $state<StockTransfer | null>(null);

	// Modal Konfirmasi Terima / Batalkan
	let isActionModalOpen = $state<boolean>(false);
	let actionType = $state<'receive' | 'cancel'>('receive');
	let actionTransfer = $state<StockTransfer | null>(null);
	let actionNotes = $state<string>('');
	let isProcessingAction = $state<boolean>(false);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		isLoading = true;
		try {
			branches = await db.branches.toArray();
			products = await db.products.toArray();

			// Ambil transfers dari server API jika online
			if (syncEngine.isOnline) {
				try {
					const res = await fetch('/api/transfers');
					if (res.ok) {
						const resData = (await res.json()) as any;
						if (resData.success && Array.isArray(resData.data)) {
							transfers = resData.data;
							// Cache ke IndexedDB
							await db.stock_transfers.clear();
							await db.stock_transfers.bulkPut(transfers);
							isLoading = false;
							return;
						}
					}
				} catch (e) {
					console.warn('Gagal memuat transfers dari API, fallback ke Dexie:', e);
				}
			}

			// Fallback ke Dexie lokal
			transfers = await db.stock_transfers.reverse().toArray();
		} catch (err: any) {
			console.error('Error loadData stock transfers:', err);
			notification = { type: 'error', message: 'Gagal memuat data transfer: ' + err.message };
		} finally {
			isLoading = false;
		}
	}

	let filteredTransfers = $derived(
		transfers.filter((t) => {
			const matchesSearch =
				searchQuery.trim() === '' ||
				t.transfer_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
				(t.source_branch_name && t.source_branch_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
				(t.destination_branch_name && t.destination_branch_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
				(t.notes && t.notes.toLowerCase().includes(searchQuery.toLowerCase()));

			const matchesStatus = statusFilter === 'all' || t.status === statusFilter;

			const matchesBranch =
				branchFilter === 'all' ||
				t.source_branch_id === branchFilter ||
				t.destination_branch_id === branchFilter;

			return matchesSearch && matchesStatus && matchesBranch;
		})
	);

	// Produk yang tersedia di sourceBranchId terpilih
	let availableSourceProducts = $derived(
		products.filter((p) => {
			if (!sourceBranchId) return true;
			return p.branch_id === sourceBranchId || p.branch_id === 'all';
		})
	);

	function openCreateModal() {
		if (branches.length < 2) {
			notification = {
				type: 'error',
				message: 'Diperlukan minimal 2 cabang toko untuk melakukan transfer stok.'
			};
			return;
		}

		sourceBranchId = branches[0]?.id || '';
		destinationBranchId = branches[1]?.id || '';
		transferNotes = '';
		transferItems = [];
		createError = null;

		// Tambahkan 1 baris item awal jika produk tersedia
		if (availableSourceProducts.length > 0) {
			transferItems.push({
				product_id: availableSourceProducts[0].id,
				quantity: 1
			});
		}

		isCreateModalOpen = true;
	}

	function addItemRow() {
		if (availableSourceProducts.length === 0) return;
		// Pilih produk pertama yang belum dimasukkan jika ada
		const existingIds = new Set(transferItems.map((it) => it.product_id));
		const nextProd = availableSourceProducts.find((p) => !existingIds.has(p.id)) || availableSourceProducts[0];

		transferItems.push({
			product_id: nextProd.id,
			quantity: 1
		});
	}

	function removeItemRow(index: number) {
		transferItems.splice(index, 1);
	}

	function getProductStock(productId: string): number {
		const prod = products.find((p) => p.id === productId);
		return prod ? prod.stock : 0;
	}

	function getProductUnit(productId: string): string {
		const prod = products.find((p) => p.id === productId);
		return prod ? prod.unit : 'pcs';
	}

	function getProductName(productId: string): string {
		const prod = products.find((p) => p.id === productId);
		return prod ? `${prod.name} (${prod.sku})` : productId;
	}

	function handleSourceBranchChange(newSourceId: string) {
		sourceBranchId = newSourceId;
		if (destinationBranchId === newSourceId) {
			const other = branches.find((b) => b.id !== newSourceId);
			destinationBranchId = other ? other.id : '';
		}
		// Reset items row karena list produk cabang berubah
		transferItems = [];
		if (availableSourceProducts.length > 0) {
			transferItems.push({
				product_id: availableSourceProducts[0].id,
				quantity: 1
			});
		}
	}

	async function submitTransfer() {
		createError = null;

		if (!sourceBranchId || !destinationBranchId) {
			createError = 'Pilih toko asal dan toko tujuan.';
			return;
		}

		if (sourceBranchId === destinationBranchId) {
			createError = 'Toko asal dan toko tujuan tidak boleh sama.';
			return;
		}

		if (transferItems.length === 0) {
			createError = 'Pilih minimal 1 produk yang ingin ditransfer.';
			return;
		}

		// Validasi jumlah dan stok
		for (const item of transferItems) {
			if (!item.product_id) {
				createError = 'Pastikan semua produk telah dipilih.';
				return;
			}
			const qty = Number(item.quantity);
			if (isNaN(qty) || qty <= 0) {
				createError = 'Jumlah item transfer harus minimal 1.';
				return;
			}

			const currentStock = getProductStock(item.product_id);
			if (qty > currentStock) {
				const prodName = getProductName(item.product_id);
				createError = `Jumlah transfer untuk ${prodName} (${qty}) melebihi stok yang tersedia (${currentStock}).`;
				return;
			}
		}

		isSubmitting = true;

		try {
			const payload = {
				source_branch_id: sourceBranchId,
				destination_branch_id: destinationBranchId,
				notes: transferNotes.trim(),
				created_by: authState.user?.id || 'admin',
				created_by_name: authState.user?.name || 'Administrator',
				items: transferItems.map((it) => ({
					product_id: it.product_id,
					quantity_sent: Number(it.quantity)
				}))
			};

			const res = await fetch('/api/transfers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const data = (await res.json()) as any;

			if (!res.ok || !data.success) {
				throw new Error(data.message || 'Gagal membuat transfer stok');
			}

			notification = {
				type: 'success',
				message: `Transfer berhasil dibuat! Nomor Surat Jalan: ${data.data.transfer_number}`
			};

			isCreateModalOpen = false;
			await loadData();
		} catch (err: any) {
			createError = err.message || 'Terjadi kesalahan saat memproses transfer stok';
		} finally {
			isSubmitting = false;
		}
	}

	function openDetailModal(transfer: StockTransfer) {
		selectedTransfer = transfer;
		isDetailModalOpen = true;
	}

	function openActionModal(transfer: StockTransfer, type: 'receive' | 'cancel') {
		actionTransfer = transfer;
		actionType = type;
		actionNotes = '';
		isActionModalOpen = true;
	}

	async function submitAction() {
		if (!actionTransfer) return;
		isProcessingAction = true;

		try {
			const url =
				actionType === 'receive'
					? `/api/transfers/${actionTransfer.id}/receive`
					: `/api/transfers/${actionTransfer.id}/cancel`;

			const payload =
				actionType === 'receive'
					? {
							received_by: authState.user?.id || 'admin',
							received_by_name: authState.user?.name || 'Administrator',
							notes: actionNotes.trim()
						}
					: {
							cancelled_by: authState.user?.id || 'admin',
							cancelled_by_name: authState.user?.name || 'Administrator',
							reason: actionNotes.trim()
						};

			const res = await fetch(url, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const data = (await res.json()) as any;

			if (!res.ok || !data.success) {
				throw new Error(data.message || 'Gagal memproses aksi transfer');
			}

			notification = {
				type: 'success',
				message: data.message || 'Aksi transfer berhasil dieksekusi'
			};

			isActionModalOpen = false;
			actionTransfer = null;
			await loadData();
		} catch (err: any) {
			notification = {
				type: 'error',
				message: err.message || 'Terjadi kesalahan'
			};
		} finally {
			isProcessingAction = false;
		}
	}

	function getBranchName(branchId: string): string {
		const b = branches.find((item) => item.id === branchId);
		return b ? b.name : branchId;
	}

	function getStatusBadge(status: string) {
		switch (status) {
			case 'in_transit':
				return {
					label: 'Dalam Perjalanan (In-Transit)',
					class: 'bg-amber-50 text-amber-700 border-amber-200',
					icon: Truck
				};
			case 'completed':
				return {
					label: 'Selesai Diterima',
					class: 'bg-emerald-50 text-emerald-700 border-emerald-200',
					icon: CheckCircle
				};
			case 'cancelled':
				return {
					label: 'Dibatalkan',
					class: 'bg-rose-50 text-rose-700 border-rose-200',
					icon: XCircle
				};
			default:
				return {
					label: 'Pending',
					class: 'bg-blue-50 text-blue-700 border-blue-200',
					icon: Clock
				};
		}
	}
</script>

<div class="space-y-6">
	<!-- Top Bar & Header -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
		<div>
			<div class="flex items-center gap-2">
				<div class="p-2 rounded-xl bg-indigo-50 text-indigo-600">
					<ArrowLeftRight class="h-6 w-6" />
				</div>
				<div>
					<h2 class="text-lg font-bold text-gray-900">Transfer Antar Toko (Stock Transfer)</h2>
					<p class="text-xs text-gray-500 mt-0.5">Kelola mutasi dan distribusi stok produk antar cabang dengan validasi stok otomatis</p>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-2.5">
			<button
				onclick={loadData}
				disabled={isLoading}
				class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition cursor-pointer"
				title="Muat ulang riwayat"
			>
				<RotateCcw class="h-3.5 w-3.5 {isLoading ? 'animate-spin' : ''}" />
				<span>Refresh</span>
			</button>

			<button
				onclick={openCreateModal}
				class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 active:scale-95 transition cursor-pointer"
			>
				<Plus class="h-4 w-4" />
				<span>Buat Transfer Baru</span>
			</button>
		</div>
	</div>

	<!-- Notifikasi Toast / Alert -->
	{#if notification}
		<div
			class="p-4 rounded-2xl flex items-start gap-3 transition-all {notification.type === 'success'
				? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
				: 'bg-rose-50 border border-rose-200 text-rose-800'}"
		>
			{#if notification.type === 'success'}
				<CheckCircle2 class="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
			{:else}
				<AlertCircle class="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
			{/if}
			<div class="flex-1 text-xs font-medium">
				{notification.message}
			</div>
			<button
				onclick={() => (notification = null)}
				class="text-xs opacity-60 hover:opacity-100 font-bold ml-2 cursor-pointer"
			>
				✕
			</button>
		</div>
	{/if}

	<!-- Filter & Search Toolbar -->
	<div class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
		<div class="relative flex-1 min-w-[220px]">
			<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Cari nomor surat jalan, toko asal, toko tujuan..."
				class="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-hidden focus:border-indigo-500"
			/>
		</div>

		<div class="flex items-center gap-2 flex-wrap">
			<!-- Filter Status -->
			<div class="flex items-center gap-1.5">
				<span class="text-gray-500 font-semibold">Status:</span>
				<select
					bind:value={statusFilter}
					class="px-2.5 py-2 rounded-xl border border-gray-200 text-xs font-semibold focus:outline-hidden focus:border-indigo-500 bg-white"
				>
					<option value="all">Semua Status</option>
					<option value="in_transit">Dalam Perjalanan (In-Transit)</option>
					<option value="completed">Selesai Diterima</option>
					<option value="cancelled">Dibatalkan</option>
				</select>
			</div>

			<!-- Filter Cabang -->
			<div class="flex items-center gap-1.5">
				<span class="text-gray-500 font-semibold">Cabang:</span>
				<select
					bind:value={branchFilter}
					class="px-2.5 py-2 rounded-xl border border-gray-200 text-xs font-semibold focus:outline-hidden focus:border-indigo-500 bg-white max-w-[180px] truncate"
				>
					<option value="all">Semua Cabang</option>
					{#each branches as b}
						<option value={b.id}>{b.name}</option>
					{/each}
				</select>
			</div>
		</div>
	</div>

	<!-- Tabel Riwayat Transfer -->
	<div class="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-left text-xs">
				<thead class="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-100">
					<tr>
						<th class="px-5 py-3.5">No. Surat Jalan</th>
						<th class="px-5 py-3.5">Toko Asal (Pengirim)</th>
						<th class="px-5 py-3.5">Toko Tujuan (Penerima)</th>
						<th class="px-5 py-3.5">Tanggal Dibuat</th>
						<th class="px-5 py-3.5">Status Pengiriman</th>
						<th class="px-5 py-3.5 text-right">Aksi</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100 font-medium text-gray-700">
					{#if filteredTransfers.length === 0}
						<tr>
							<td colspan="6" class="px-5 py-12 text-center text-gray-400">
								<ArrowLeftRight class="h-10 w-10 mx-auto mb-2 text-gray-300 stroke-1" />
								<p>Belum ada riwayat transfer stok yang sesuai.</p>
							</td>
						</tr>
					{:else}
						{#each filteredTransfers as transfer}
							{@const badge = getStatusBadge(transfer.status)}
							{@const BadgeIcon = badge.icon}
							<tr class="hover:bg-gray-50/60 transition">
								<td class="px-5 py-3.5">
									<div class="font-bold text-gray-900 font-mono tracking-wide">{transfer.transfer_number}</div>
									{#if transfer.notes}
										<div class="text-[11px] text-gray-400 truncate max-w-[200px]" title={transfer.notes}>
											{transfer.notes}
										</div>
									{/if}
								</td>
								<td class="px-5 py-3.5">
									<div class="flex items-center gap-1.5 text-gray-800 font-semibold">
										<Building2 class="h-3.5 w-3.5 text-gray-400 shrink-0" />
										<span>{transfer.source_branch_name || getBranchName(transfer.source_branch_id)}</span>
									</div>
								</td>
								<td class="px-5 py-3.5">
									<div class="flex items-center gap-1.5 text-gray-800 font-semibold">
										<Building2 class="h-3.5 w-3.5 text-indigo-500 shrink-0" />
										<span>{transfer.destination_branch_name || getBranchName(transfer.destination_branch_id)}</span>
									</div>
								</td>
								<td class="px-5 py-3.5 text-gray-500 whitespace-nowrap">
									{new Date(transfer.created_at).toLocaleDateString('id-ID', {
										day: '2-digit',
										month: 'short',
										year: 'numeric',
										hour: '2-digit',
										minute: '2-digit'
									})}
								</td>
								<td class="px-5 py-3.5 whitespace-nowrap">
									<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border {badge.class}">
										<BadgeIcon class="h-3 w-3" />
										<span>{badge.label}</span>
									</span>
								</td>
								<td class="px-5 py-3.5 text-right whitespace-nowrap space-x-1">
									<!-- Tombol Detail -->
									<button
										onclick={() => openDetailModal(transfer)}
										class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 font-semibold transition cursor-pointer"
										title="Lihat Detail Produk"
									>
										<Eye class="h-3.5 w-3.5 text-gray-500" />
										<span>Detail</span>
									</button>

									<!-- Tombol Terima Barang (Hanya jika in_transit atau pending) -->
									{#if transfer.status === 'in_transit' || transfer.status === 'pending'}
										<button
											onclick={() => openActionModal(transfer, 'receive')}
											class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs transition cursor-pointer"
											title="Konfirmasi Penerimaan Barang di Toko Tujuan"
										>
											<CheckCircle class="h-3.5 w-3.5" />
											<span>Terima Barang</span>
										</button>

										<!-- Tombol Batalkan -->
										<button
											onclick={() => openActionModal(transfer, 'cancel')}
											class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold transition cursor-pointer"
											title="Batalkan transfer dan kembalikan stok"
										>
											<XCircle class="h-3.5 w-3.5" />
											<span>Batalkan</span>
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>

<!-- ========================================================================= -->
<!-- MODAL BUAT TRANSFER BARU                                                  -->
<!-- ========================================================================= -->
{#if isCreateModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
			<!-- Header Modal -->
			<div class="flex items-center justify-between border-b border-gray-100 p-5">
				<div class="flex items-center gap-2">
					<div class="p-2 rounded-xl bg-indigo-50 text-indigo-600">
						<ArrowLeftRight class="h-5 w-5" />
					</div>
					<div>
						<h3 class="text-base font-bold text-gray-900">Buat Transfer Stok Baru</h3>
						<p class="text-xs text-gray-500">Mutasi produk antar toko dengan pemotongan stok otomatis di cabang sumber</p>
					</div>
				</div>
				<button
					onclick={() => (isCreateModalOpen = false)}
					class="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Body Modal (Scrollable) -->
			<div class="p-5 overflow-y-auto space-y-4 text-xs">
				<!-- Pilih Toko Asal & Toko Tujuan -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
					<div>
						<label for="sourceBranchSelect" class="block font-bold text-gray-700 mb-1.5">
							Toko Asal (Sumber Pengirim)
						</label>
						<select
							id="sourceBranchSelect"
							value={sourceBranchId}
							onchange={(e) => handleSourceBranchChange(e.currentTarget.value)}
							class="w-full px-3 py-2 rounded-xl border border-gray-200 font-semibold focus:outline-hidden focus:border-indigo-500 bg-white"
						>
							{#each branches as b}
								<option value={b.id}>{b.name} ({b.code})</option>
							{/each}
						</select>
					</div>

					<div>
						<label for="destBranchSelect" class="block font-bold text-gray-700 mb-1.5">
							Toko Tujuan (Penerima Barang)
						</label>
						<select
							id="destBranchSelect"
							bind:value={destinationBranchId}
							class="w-full px-3 py-2 rounded-xl border border-gray-200 font-semibold focus:outline-hidden focus:border-indigo-500 bg-white"
						>
							{#each branches.filter((b) => b.id !== sourceBranchId) as b}
								<option value={b.id}>{b.name} ({b.code})</option>
							{/each}
						</select>
					</div>
				</div>

				<!-- Catatan Transfer -->
				<div>
					<label for="transferNotesInput" class="block font-semibold text-gray-700 mb-1">
						Catatan / Keterangan Transfer (Opsional)
					</label>
					<input
						id="transferNotesInput"
						type="text"
						bind:value={transferNotes}
						placeholder="Contoh: Pemenuhan stok mendesak akhir pekan, rotasi produk"
						class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-indigo-500"
					/>
				</div>

				<!-- Rincian Produk yang Ditransfer -->
				<div class="space-y-2 pt-2">
					<div class="flex items-center justify-between">
						<span class="font-bold text-gray-900 text-xs">Daftar Produk yang Ingin Ditransfer:</span>
						<button
							type="button"
							onclick={addItemRow}
							class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-xs transition cursor-pointer"
						>
							<Plus class="h-3.5 w-3.5" />
							<span>Tambah Item</span>
						</button>
					</div>

					<div class="border border-gray-200 rounded-xl overflow-hidden">
						<table class="w-full text-left text-xs">
							<thead class="bg-gray-100/70 text-gray-600 font-semibold border-b border-gray-200">
								<tr>
									<th class="px-3 py-2">Produk Toko Asal</th>
									<th class="px-3 py-2 w-32">Stok Tersedia</th>
									<th class="px-3 py-2 w-36">Qty Transfer</th>
									<th class="px-2 py-2 text-center w-12">Hapus</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-100 font-medium">
								{#if transferItems.length === 0}
									<tr>
										<td colspan="4" class="px-4 py-6 text-center text-gray-400">
											Klik "Tambah Item" untuk memilih produk yang ingin dikirim.
										</td>
									</tr>
								{:else}
									{#each transferItems as item, idx}
										{@const prodStock = getProductStock(item.product_id)}
										{@const prodUnit = getProductUnit(item.product_id)}
										<tr class="hover:bg-gray-50/50">
											<td class="px-3 py-2">
												<select
													bind:value={item.product_id}
													class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 focus:outline-hidden focus:border-indigo-500 bg-white"
												>
													{#each availableSourceProducts as p}
														<option value={p.id}>
															{p.name} ({p.sku}) — Stok: {p.stock} {p.unit}
														</option>
													{/each}
												</select>
											</td>
											<td class="px-3 py-2 text-gray-700 whitespace-nowrap">
												<span class="font-bold {prodStock <= 0 ? 'text-rose-600' : 'text-emerald-700'}">
													{prodStock} {prodUnit}
												</span>
											</td>
											<td class="px-3 py-2">
												<div class="flex items-center gap-1.5">
													<input
														type="number"
														bind:value={item.quantity}
														min="1"
														max={prodStock}
														class="w-20 px-2 py-1 rounded-lg border text-center font-bold text-gray-900 focus:outline-hidden focus:border-indigo-500 {item.quantity > prodStock ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-gray-200'}"
													/>
													<span class="text-gray-500 font-medium">{prodUnit}</span>
												</div>
												{#if item.quantity > prodStock}
													<span class="text-[10px] text-rose-600 block mt-0.5">Melebihi stok</span>
												{/if}
											</td>
											<td class="px-2 py-2 text-center">
												<button
													type="button"
													onclick={() => removeItemRow(idx)}
													class="p-1 text-gray-400 hover:text-rose-600 rounded hover:bg-rose-50 transition cursor-pointer"
													title="Hapus baris"
												>
													<Trash2 class="h-4 w-4" />
												</button>
											</td>
										</tr>
									{/each}
								{/if}
							</tbody>
						</table>
					</div>
				</div>

				{#if createError}
					<div class="flex items-center gap-1.5 p-3 rounded-xl bg-rose-50 text-rose-700 text-xs font-medium border border-rose-200">
						<AlertCircle class="h-4 w-4 shrink-0" />
						<span>{createError}</span>
					</div>
				{/if}
			</div>

			<!-- Footer Modal -->
			<div class="flex items-center justify-between border-t border-gray-100 p-4 bg-gray-50/50">
				<p class="text-[11px] text-gray-500">
					* Stok produk toko asal akan otomatis berkurang dengan status <strong class="text-amber-700">in-transit</strong>.
				</p>
				<div class="flex items-center gap-2">
					<button
						onclick={() => (isCreateModalOpen = false)}
						class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-100 font-semibold cursor-pointer"
					>
						Batal
					</button>
					<button
						onclick={submitTransfer}
						disabled={isSubmitting || transferItems.length === 0}
						class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold transition cursor-pointer shadow-md shadow-indigo-600/20"
					>
						{isSubmitting ? 'Memproses Transfer...' : 'Kirim Stok (Transfer)'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ========================================================================= -->
<!-- MODAL DETAIL TRANSFER                                                     -->
<!-- ========================================================================= -->
{#if isDetailModalOpen && selectedTransfer}
	{@const badge = getStatusBadge(selectedTransfer.status)}
	{@const BadgeIcon = badge.icon}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-gray-100 p-5">
				<div>
					<div class="flex items-center gap-2">
						<h3 class="text-base font-bold text-gray-900 font-mono">
							#{selectedTransfer.transfer_number}
						</h3>
						<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border {badge.class}">
							<BadgeIcon class="h-3 w-3" />
							<span>{badge.label}</span>
						</span>
					</div>
					<p class="text-xs text-gray-500 mt-0.5">Rincian surat jalan mutasi barang antar toko</p>
				</div>
				<button
					onclick={() => (isDetailModalOpen = false)}
					class="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Body -->
			<div class="p-5 overflow-y-auto space-y-4 text-xs">
				<div class="grid grid-cols-2 gap-4 p-4 rounded-xl bg-gray-50 border border-gray-100">
					<div>
						<span class="text-gray-400 block text-[11px]">Toko Asal (Pengirim)</span>
						<span class="font-bold text-gray-900 text-sm">{selectedTransfer.source_branch_name || getBranchName(selectedTransfer.source_branch_id)}</span>
					</div>
					<div>
						<span class="text-gray-400 block text-[11px]">Toko Tujuan (Penerima)</span>
						<span class="font-bold text-indigo-700 text-sm">{selectedTransfer.destination_branch_name || getBranchName(selectedTransfer.destination_branch_id)}</span>
					</div>
					<div>
						<span class="text-gray-400 block text-[11px]">Waktu Dibuat</span>
						<span class="text-gray-700 font-medium">
							{new Date(selectedTransfer.created_at).toLocaleString('id-ID')}
						</span>
					</div>
					<div>
						<span class="text-gray-400 block text-[11px]">Dibuat Oleh</span>
						<span class="text-gray-700 font-medium">{selectedTransfer.created_by_name || 'Admin'}</span>
					</div>
					{#if selectedTransfer.notes}
						<div class="col-span-2 pt-2 border-t border-gray-200">
							<span class="text-gray-400 block text-[11px]">Catatan / Keterangan</span>
							<p class="text-gray-800 italic mt-0.5">{selectedTransfer.notes}</p>
						</div>
					{/if}
				</div>

				<div>
					<span class="font-bold text-gray-900 text-xs block mb-2">Item Barang yang Ditransfer:</span>
					<div class="border border-gray-200 rounded-xl overflow-hidden">
						<table class="w-full text-left text-xs">
							<thead class="bg-gray-100/70 text-gray-600 font-semibold border-b border-gray-200">
								<tr>
									<th class="px-4 py-2.5">Produk</th>
									<th class="px-4 py-2.5 text-center">Qty Dikirim</th>
									<th class="px-4 py-2.5 text-center">Qty Diterima</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-100 font-medium">
								{#if !selectedTransfer.items || selectedTransfer.items.length === 0}
									<tr>
										<td colspan="3" class="px-4 py-4 text-center text-gray-400">
											Tidak ada data rincian item.
										</td>
									</tr>
								{:else}
									{#each selectedTransfer.items as it}
										<tr class="hover:bg-gray-50/50">
											<td class="px-4 py-2.5">
												<div class="font-bold text-gray-900">{it.product_name || getProductName(it.product_id)}</div>
												<div class="text-[11px] text-gray-400 font-mono">{it.sku || it.product_id}</div>
											</td>
											<td class="px-4 py-2.5 text-center font-bold text-gray-800">
												{it.quantity_sent} {it.unit || 'pcs'}
											</td>
											<td class="px-4 py-2.5 text-center font-bold">
												{#if it.quantity_received !== null && it.quantity_received !== undefined}
													<span class="text-emerald-700">{it.quantity_received} {it.unit || 'pcs'}</span>
												{:else}
													<span class="text-amber-600 italic">Menunggu Penerimaan</span>
												{/if}
											</td>
										</tr>
									{/each}
								{/if}
							</tbody>
						</table>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-end border-t border-gray-100 p-4 bg-gray-50/50">
				<button
					onclick={() => (isDetailModalOpen = false)}
					class="px-5 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold cursor-pointer"
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ========================================================================= -->
<!-- MODAL AKSI KONFIRMASI (TERIMA BARANG / BATALKAN)                          -->
<!-- ========================================================================= -->
{#if isActionModalOpen && actionTransfer}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center gap-3 mb-4">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl {actionType === 'receive' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}">
					{#if actionType === 'receive'}
						<CheckCircle class="h-6 w-6" />
					{:else}
						<XCircle class="h-6 w-6" />
					{/if}
				</div>
				<div>
					<h3 class="text-base font-bold text-gray-900">
						{actionType === 'receive' ? 'Konfirmasi Terima Barang' : 'Batalkan Transfer Stok?'}
					</h3>
					<p class="text-xs text-gray-500 font-mono">#{actionTransfer.transfer_number}</p>
				</div>
			</div>

			<div class="text-xs space-y-3 mb-5">
				{#if actionType === 'receive'}
					<p class="text-gray-600 leading-relaxed">
						Dengan mengonfirmasi, seluruh produk dalam surat jalan ini akan <strong>ditambahkan ke stok inventaris cabang tujuan</strong> (<span class="font-bold text-indigo-700">{actionTransfer.destination_branch_name || getBranchName(actionTransfer.destination_branch_id)}</span>) dan status transfer berubah menjadi <strong>Selesai</strong>.
					</p>
				{:else}
					<p class="text-gray-600 leading-relaxed">
						Apakah Anda yakin ingin membatalkan pengiriman ini? Seluruh stok produk yang sempat dipotong akan <strong>dikembalikan ke cabang asal</strong> (<span class="font-bold text-gray-800">{actionTransfer.source_branch_name || getBranchName(actionTransfer.source_branch_id)}</span>).
					</p>
				{/if}

				<div>
					<label for="actionNotesInput" class="block font-semibold text-gray-700 mb-1">
						{actionType === 'receive' ? 'Catatan Penerimaan (Opsional)' : 'Alasan Pembatalan (Opsional)'}
					</label>
					<input
						id="actionNotesInput"
						type="text"
						bind:value={actionNotes}
						placeholder={actionType === 'receive' ? 'Contoh: Diterima lengkap sesuai surat jalan' : 'Contoh: Salah kirim cabang'}
						class="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-hidden focus:border-indigo-500"
					/>
				</div>
			</div>

			<div class="flex items-center justify-end gap-2">
				<button
					onclick={() => { isActionModalOpen = false; actionTransfer = null; }}
					class="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-xs cursor-pointer"
				>
					Batal
				</button>
				<button
					onclick={submitAction}
					disabled={isProcessingAction}
					class="px-5 py-2 rounded-xl text-white font-bold text-xs transition cursor-pointer shadow-md {actionType === 'receive' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'}"
				>
					{isProcessingAction
						? 'Memproses...'
						: actionType === 'receive'
							? 'Konfirmasi Terima'
							: 'Ya, Batalkan Transfer'}
				</button>
			</div>
		</div>
	</div>
{/if}
