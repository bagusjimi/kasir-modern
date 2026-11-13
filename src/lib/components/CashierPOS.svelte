<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import type { Product, Category, CartItem, Transaction, TransactionItem, PaymentMethod, TaxSettings } from '../types/index.js';
	import ReceiptModal from './ReceiptModal.svelte';
	import {
		Search,
		Plus,
		Minus,
		Trash2,
		CreditCard,
		Banknote,
		QrCode,
		CheckCircle,
		AlertCircle,
		ShoppingBag,
		ArrowRight
	} from 'lucide-svelte';

	let products = $state<Product[]>([]);
	let categories = $state<Category[]>([]);
	let selectedCategory = $state<string>('all');
	let searchQuery = $state<string>('');

	// Keranjang Belanja & Pengaturan Pajak
	let cart = $state<CartItem[]>([]);
	let discount = $state<number>(0);
	let taxSettings = $state<TaxSettings>({
		enabled: true,
		rate: 11,
		name: 'PPN'
	});

	let taxRate = $derived(taxSettings.enabled ? taxSettings.rate / 100 : 0);
	let taxLabel = $derived(
		taxSettings.enabled && taxSettings.rate > 0
			? `${taxSettings.name} (${taxSettings.rate}%)`
			: 'Bebas Pajak (0%)'
	);

	// Modal Pembayaran
	let isPaymentModalOpen = $state<boolean>(false);
	let paymentMethod = $state<PaymentMethod>('cash');
	let amountPaid = $state<number>(0);
	let customerName = $state<string>('');
	let paymentError = $state<string | null>(null);

	// Modal Struk Setelah Transaksi Sukses
	let completedTransaction = $state<Transaction | null>(null);

	onMount(async () => {
		await loadProductsAndCategories();
		await loadTaxSettings();
	});

	async function loadTaxSettings() {
		try {
			const setting = await db.app_settings.get('tax_settings');
			if (setting && setting.value) {
				taxSettings = setting.value as TaxSettings;
			}
		} catch (e) {
			console.warn('Gagal memuat pengaturan pajak di kasir:', e);
		}
	}

	async function loadProductsAndCategories() {
		categories = await db.categories.toArray();
		const allProducts = await db.products.toArray();
		// Kasir hanya melihat produk aktif yang berlaku untuk semua cabang atau cabang aktifnya
		const branchId = authState.branch?.id || 'cb-01';
		products = allProducts.filter(
			p => p.is_active && (p.branch_id === 'all' || p.branch_id === branchId)
		);
	}

	let filteredProducts = $derived(
		products.filter(p => {
			const matchCategory = selectedCategory === 'all' || p.category === selectedCategory;
			const matchSearch =
				searchQuery.trim() === '' ||
				p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
				(p.barcode && p.barcode.includes(searchQuery));
			return matchCategory && matchSearch;
		})
	);

	let subtotal = $derived(cart.reduce((sum, item) => sum + item.subtotal, 0));
	let taxAmount = $derived(Math.round(Math.max(0, subtotal - discount) * taxRate));
	let totalAmount = $derived(Math.max(0, subtotal - discount + taxAmount));
	let changeAmount = $derived(Math.max(0, amountPaid - totalAmount));

	function addToCart(product: Product) {
		if (product.stock <= 0) return;

		const existing = cart.find(item => item.product.id === product.id);
		if (existing) {
			if (existing.quantity >= product.stock) {
				alert(`Stok produk "${product.name}" hanya tersisa ${product.stock}`);
				return;
			}
			existing.quantity += 1;
			existing.subtotal = existing.quantity * product.price;
			cart = [...cart];
		} else {
			cart = [
				...cart,
				{
					product,
					quantity: 1,
					subtotal: product.price
				}
			];
		}
	}

	function updateQuantity(productId: string, delta: number) {
		const idx = cart.findIndex(item => item.product.id === productId);
		if (idx === -1) return;

		const item = cart[idx];
		const newQty = item.quantity + delta;

		if (newQty <= 0) {
			cart = cart.filter(i => i.product.id !== productId);
		} else if (newQty > item.product.stock) {
			alert(`Stok tidak mencukupi (sisa ${item.product.stock})`);
		} else {
			item.quantity = newQty;
			item.subtotal = newQty * item.product.price;
			cart = [...cart];
		}
	}

	function clearCart() {
		cart = [];
		discount = 0;
	}

	function openPayment() {
		if (cart.length === 0) return;
		amountPaid = totalAmount; // Default uang pas
		paymentError = null;
		isPaymentModalOpen = true;
	}

	async function processTransaction() {
		paymentError = null;

		if (paymentMethod === 'cash' && amountPaid < totalAmount) {
			paymentError = `Nominal uang tunai kurang dari total belanja (${formatRupiah(totalAmount)})`;
			return;
		}

		const now = new Date();
		const dateCode = now.toISOString().slice(0, 10).replace(/-/g, '');
		const branchCode = authState.branch?.code || 'CB01';
		const randomNum = Math.floor(1000 + Math.random() * 9000);
		const invoiceNo = `INV/${dateCode}/${branchCode}/${randomNum}`;

		const txId = 'tx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

		const items: TransactionItem[] = cart.map(item => ({
			id: 'txi-' + Math.random().toString(36).substring(2, 9),
			transaction_id: txId,
			product_id: item.product.id,
			product_name: item.product.name,
			price: item.product.price,
			cost_price: item.product.cost_price,
			quantity: item.quantity,
			subtotal: item.subtotal,
			notes: item.notes || ''
		}));

		const transaction: Transaction = {
			id: txId,
			invoice_no: invoiceNo,
			branch_id: authState.branch?.id || 'cb-01',
			branch_name: authState.branch?.name || 'Cabang Utama',
			cashier_id: authState.user?.id || 'usr-kasir',
			cashier_name: authState.user?.name || 'Kasir',
			customer_name: customerName.trim() || undefined,
			subtotal,
			discount,
			tax: taxAmount,
			total: totalAmount,
			payment_method: paymentMethod,
			amount_paid: paymentMethod === 'cash' ? amountPaid : totalAmount,
			change: paymentMethod === 'cash' ? changeAmount : 0,
			status: 'completed',
			items,
			created_at: now.toISOString(),
			updated_at: now.toISOString(),
			synced: false
		};

		// 1. Simpan Transaksi & Detail ke IndexedDB
		await db.transactions.add(transaction);
		await db.transaction_items.bulkAdd(items);

		// 2. Kurangi stok produk secara lokal + catat ledger stok (audit)
		for (const item of items) {
			const prod = await db.products.get(item.product_id);
			if (prod) {
				const newStock = Math.max(0, prod.stock - item.quantity);
				await db.products.update(prod.id, {
					stock: newStock,
					updated_at: now.toISOString()
				});
			}

			await db.stock_movements.put({
				id: `mv-sale-${item.id}`,
				branch_id: transaction.branch_id,
				product_id: item.product_id,
				quantity: -item.quantity,
				type: 'sale',
				reference_id: txId,
				user_id: transaction.cashier_id,
				user_name: transaction.cashier_name,
				created_at: now.toISOString(),
				synced: false
			});
		}

		// 3. Tambahkan ke Log Aktivitas
		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: transaction.branch_id,
			branch_name: transaction.branch_name,
			user_id: transaction.cashier_id,
			user_name: transaction.cashier_name,
			role: 'cashier',
			action: 'create_transaction',
			details: `Transaksi ${invoiceNo} berhasil (${items.length} item, total ${formatRupiah(totalAmount)}).`,
			timestamp: now.toISOString(),
			synced: false
		});

		// 4. Update antrean sinkronisasi
		await syncEngine.updatePendingCount();

		// Refresh data produk lokal
		await loadProductsAndCategories();

		// Reset state keranjang & tutup modal bayar
		cart = [];
		discount = 0;
		customerName = '';
		isPaymentModalOpen = false;

		// Buka modal cetak struk
		completedTransaction = transaction;

		// Jalankan auto-sync background jika online
		if (syncEngine.isOnline) {
			syncEngine.triggerSync();
		}
	}

	function formatRupiah(num: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(num);
	}
</script>

<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-5rem)]">
	<!-- Kolom Kiri: Katalog Produk (7 Kolom pada Desktop) -->
	<div class="lg:col-span-7 xl:col-span-8 flex flex-col h-full bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
		<!-- Search & Filter Bar -->
		<div class="p-4 border-b border-gray-100 space-y-3">
			<div class="relative">
				<Search class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Cari produk berdasarkan nama, SKU, atau barcode..."
					class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-sm transition outline-hidden"
				/>
			</div>

			<!-- Filter Kategori Tabs -->
			<div class="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
				<button
					onclick={() => selectedCategory = 'all'}
					class="px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition {selectedCategory === 'all' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
				>
					Semua Kategori
				</button>
				{#each categories as cat}
					<button
						onclick={() => selectedCategory = cat.name}
						class="px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition {selectedCategory === cat.name ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
					>
						{cat.name}
					</button>
				{/each}
			</div>
		</div>

		<!-- Grid Produk -->
		<div class="flex-1 overflow-y-auto p-4">
			{#if filteredProducts.length === 0}
				<div class="flex flex-col items-center justify-center h-64 text-gray-400">
					<ShoppingBag class="h-12 w-12 mb-2 stroke-1" />
					<p class="text-sm font-medium">Tidak ada produk ditemukan</p>
					<p class="text-xs text-gray-400 mt-1">Coba cari dengan kata kunci lain atau pilih kategori berbeda.</p>
				</div>
			{:else}
				<div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5">
					{#each filteredProducts as product}
						<button
							onclick={() => addToCart(product)}
							disabled={product.stock <= 0}
							class="group relative flex flex-col justify-between rounded-xl border border-gray-200/90 bg-white p-3.5 text-left transition hover:border-emerald-500 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-98"
						>
							<div>
								<div class="flex items-start justify-between gap-1 mb-1.5">
									<span class="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
										{product.category}
									</span>
									<span class="text-[11px] font-semibold {product.stock <= 5 ? 'text-rose-600 bg-rose-50' : 'text-gray-500 bg-gray-100'} px-2 py-0.5 rounded-md">
										Stok: {product.stock}
									</span>
								</div>
								<h3 class="font-bold text-gray-800 text-sm line-clamp-2 group-hover:text-emerald-600 transition">
									{product.name}
								</h3>
								<p class="text-[11px] text-gray-400 mt-0.5">{product.sku}</p>
							</div>

							<div class="mt-3 flex items-center justify-between border-t border-gray-100 pt-2">
								<span class="text-sm font-bold text-emerald-600">
									{formatRupiah(product.price)}
								</span>
								<div class="h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition">
									<Plus class="h-4 w-4" />
								</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Kolom Kanan: Keranjang Kasir (5 Kolom pada Desktop) -->
	<div class="lg:col-span-5 xl:col-span-4 flex flex-col h-full bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
		<!-- Header Keranjang -->
		<div class="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/70">
			<div class="flex items-center gap-2">
				<h2 class="font-bold text-gray-900 text-base">Pesanan Baru</h2>
				<span class="flex h-5 items-center justify-center rounded-full bg-emerald-100 px-2 text-xs font-bold text-emerald-800">
					{cart.length} item
				</span>
			</div>
			{#if cart.length > 0}
				<button
					onclick={clearCart}
					class="text-xs font-medium text-rose-600 hover:text-rose-700 flex items-center gap-1 transition cursor-pointer"
				>
					<Trash2 class="h-3.5 w-3.5" />
					<span>Kosongkan</span>
				</button>
			{/if}
		</div>

		<!-- Daftar Item Keranjang -->
		<div class="flex-1 overflow-y-auto p-4 divide-y divide-gray-100">
			{#if cart.length === 0}
				<div class="flex flex-col items-center justify-center h-full text-gray-400 py-12">
					<ShoppingBag class="h-12 w-12 mb-3 stroke-1 text-gray-300" />
					<p class="text-sm font-semibold text-gray-600">Keranjang masih kosong</p>
					<p class="text-xs text-gray-400 mt-1 text-center max-w-[200px]">Pilih produk di samping untuk menambahkan ke pesanan.</p>
				</div>
			{:else}
				{#each cart as item}
					<div class="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
						<div class="flex-1 min-w-0">
							<h4 class="text-sm font-semibold text-gray-800 truncate">{item.product.name}</h4>
							<p class="text-xs text-gray-500">{formatRupiah(item.product.price)} / {item.product.unit}</p>
							<div class="mt-1 flex items-center gap-2">
								<input
									type="text"
									bind:value={item.notes}
									placeholder="Catatan (opsional)..."
									class="w-full text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-600 placeholder-gray-400 focus:outline-hidden focus:border-emerald-500"
								/>
							</div>
						</div>

						<div class="flex flex-col items-end gap-1.5">
							<span class="text-sm font-bold text-gray-800">{formatRupiah(item.subtotal)}</span>
							<div class="flex items-center gap-1.5 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
								<button
									onclick={() => updateQuantity(item.product.id, -1)}
									class="h-6 w-6 rounded bg-white text-gray-600 flex items-center justify-center shadow-2xs hover:bg-gray-200 transition"
								>
									<Minus class="h-3 w-3" />
								</button>
								<span class="w-6 text-center text-xs font-bold text-gray-800">{item.quantity}</span>
								<button
									onclick={() => updateQuantity(item.product.id, 1)}
									class="h-6 w-6 rounded bg-white text-gray-600 flex items-center justify-center shadow-2xs hover:bg-gray-200 transition"
								>
									<Plus class="h-3 w-3" />
								</button>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<!-- Kalkulasi Subtotal, Diskon, Pajak & Tombol Bayar -->
		{#if cart.length > 0}
			<div class="border-t border-gray-200 bg-gray-50/80 p-4 space-y-2.5">
				<div class="flex justify-between text-xs text-gray-600">
					<span>Subtotal</span>
					<span class="font-medium text-gray-800">{formatRupiah(subtotal)}</span>
				</div>

				<div class="flex items-center justify-between text-xs text-gray-600">
					<span>Diskon (Rp)</span>
					<input
						type="number"
						bind:value={discount}
						min="0"
						class="w-24 text-right px-2 py-1 rounded border border-gray-200 text-xs font-semibold text-rose-600 focus:outline-hidden focus:border-emerald-500"
					/>
				</div>

				<div class="flex justify-between text-xs text-gray-600">
					<span>{taxLabel}</span>
					<span class="font-medium text-gray-800">{formatRupiah(taxAmount)}</span>
				</div>

				<div class="border-t border-gray-200 pt-2 flex justify-between items-center">
					<div>
						<p class="text-xs text-gray-500">Total Tagihan</p>
						<p class="text-xl font-black text-emerald-700">{formatRupiah(totalAmount)}</p>
					</div>
					<button
						onclick={openPayment}
						class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/30 active:scale-95 transition cursor-pointer"
					>
						<span>Bayar</span>
						<ArrowRight class="h-4 w-4" />
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Modal Pembayaran -->
{#if isPaymentModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
			<div class="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
				<h3 class="text-lg font-bold text-gray-900">Pembayaran Transaksi</h3>
				<span class="text-sm font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
					{formatRupiah(totalAmount)}
				</span>
			</div>

			<!-- Input Nama Pelanggan -->
			<div class="mb-4">
				<label for="customerName" class="block text-xs font-semibold text-gray-700 mb-1">Nama Pelanggan (Opsional)</label>
				<input
					id="customerName"
					type="text"
					bind:value={customerName}
					placeholder="Contoh: Pak Anton / Meja 05"
					class="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500"
				/>
			</div>

			<!-- Pilihan Metode Pembayaran -->
			<div class="mb-5">
				<span class="block text-xs font-semibold text-gray-700 mb-2">Metode Pembayaran</span>
				<div class="grid grid-cols-3 gap-3">
					<button
						onclick={() => paymentMethod = 'cash'}
						class="flex flex-col items-center justify-center p-3 rounded-xl border transition {paymentMethod === 'cash' ? 'border-emerald-600 bg-emerald-50 text-emerald-700 font-bold' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}"
					>
						<Banknote class="h-5 w-5 mb-1" />
						<span class="text-xs">Tunai (Cash)</span>
					</button>
					<button
						onclick={() => paymentMethod = 'qris'}
						class="flex flex-col items-center justify-center p-3 rounded-xl border transition {paymentMethod === 'qris' ? 'border-emerald-600 bg-emerald-50 text-emerald-700 font-bold' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}"
					>
						<QrCode class="h-5 w-5 mb-1" />
						<span class="text-xs">QRIS Dinamis</span>
					</button>
					<button
						onclick={() => paymentMethod = 'transfer'}
						class="flex flex-col items-center justify-center p-3 rounded-xl border transition {paymentMethod === 'transfer' ? 'border-emerald-600 bg-emerald-50 text-emerald-700 font-bold' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}"
					>
						<CreditCard class="h-5 w-5 mb-1" />
						<span class="text-xs">Transfer Bank</span>
					</button>
				</div>
			</div>

			<!-- Rincian Tunai -->
			{#if paymentMethod === 'cash'}
				<div class="space-y-3 bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4">
					<div>
						<label for="amountPaid" class="block text-xs font-semibold text-gray-700 mb-1">Nominal Uang Diterima</label>
						<input
							id="amountPaid"
							type="number"
							bind:value={amountPaid}
							class="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-lg font-bold text-gray-900 focus:outline-hidden focus:border-emerald-500"
						/>
					</div>

					<!-- Tombol Cepat Pecahan Uang -->
					<div class="flex flex-wrap gap-1.5">
						<button
							onclick={() => amountPaid = totalAmount}
							class="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition"
						>
							Uang Pas
						</button>
						<button
							onclick={() => amountPaid = 50000}
							class="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition"
						>
							Rp 50.000
						</button>
						<button
							onclick={() => amountPaid = 100000}
							class="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition"
						>
							Rp 100.000
						</button>
						<button
							onclick={() => amountPaid = 200000}
							class="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition"
						>
							Rp 200.000
						</button>
					</div>

					<div class="flex justify-between items-center pt-2 border-t border-gray-200 text-sm font-semibold">
						<span class="text-gray-600">Kembalian:</span>
						<span class="{changeAmount < 0 ? 'text-rose-600' : 'text-emerald-700'} text-base font-bold">
							{formatRupiah(changeAmount)}
						</span>
					</div>
				</div>
			{:else if paymentMethod === 'qris'}
				<div class="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-xl border border-gray-200 mb-4 text-center">
					<div class="h-32 w-32 bg-white p-2 rounded-xl border border-gray-300 flex items-center justify-center shadow-xs mb-2">
						<QrCode class="h-24 w-24 text-gray-800" />
					</div>
					<p class="text-xs font-semibold text-gray-800">Scan QRIS menggunakan BCA, Mandiri, GoPay, OVO, atau ShopeePay</p>
					<p class="text-[11px] text-gray-500 mt-1">Total: <span class="font-bold text-emerald-700">{formatRupiah(totalAmount)}</span></p>
				</div>
			{:else if paymentMethod === 'transfer'}
				<div class="p-4 bg-gray-50 rounded-xl border border-gray-200 mb-4 text-xs space-y-2 text-gray-700">
					<div class="font-semibold text-gray-900">Rekening Tujuan Toko:</div>
					<div class="flex justify-between">
						<span>Bank Central Asia (BCA):</span>
						<span class="font-bold">8800-1234-5678</span>
					</div>
					<div class="flex justify-between">
						<span>Atas Nama:</span>
						<span class="font-bold">PT KASIR MODERN INDONESIA</span>
					</div>
				</div>
			{/if}

			{#if paymentError}
				<div class="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200 mb-4">
					<AlertCircle class="h-4 w-4 shrink-0" />
					<span>{paymentError}</span>
				</div>
			{/if}

			<div class="flex items-center justify-end gap-3 pt-2">
				<button
					onclick={() => isPaymentModalOpen = false}
					class="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-semibold transition"
				>
					Batal
				</button>
				<button
					onclick={processTransaction}
					class="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-md shadow-emerald-600/30 transition cursor-pointer"
				>
					<CheckCircle class="h-4 w-4" />
					<span>Konfirmasi Pembayaran</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Struk Transaksi Sukses -->
<ReceiptModal
	transaction={completedTransaction}
	onClose={() => completedTransaction = null}
/>

