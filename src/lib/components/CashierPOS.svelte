<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { cartStore } from '../stores/cart.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import { getOpenShiftForDevice } from '../shift/index.js';
	import type { Product, Category, Transaction, TransactionItem, PaymentMethod, TaxSettings, PaymentSettings, Shift } from '../types/index.js';
	import ReceiptModal from './ReceiptModal.svelte';
	import {
		Plus,
		Minus,
		Trash2,
		CreditCard,
		Banknote,
		QrCode,
		CheckCircle,
		AlertCircle,
		ShoppingBag,
		ArrowRight,
		Clock,
		Barcode
	} from 'lucide-svelte';

	let products = $state<Product[]>([]);
	let categories = $state<Category[]>([]);
	let selectedCategory = $state<string>('all');
	let searchQuery = $state<string>('');

	// Scan barcode / SKU ke keranjang (alat pemindai tipe keyboard wedge mengetik lalu Enter)
	let scanFeedback = $state<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
	let scanSuggestions = $state<Product[]>([]);
	let activeSuggestion = $state<number>(-1);
	let scanInput: HTMLInputElement | undefined = $state();
	let scanTimeout: ReturnType<typeof setTimeout> | undefined;

	// Keranjang tersimpan di cartStore (persisten antar menu & muat ulang halaman)
	let taxSettings = $state<TaxSettings>({
		enabled: true,
		rate: 11,
		name: 'PPN'
	});

	// Pengaturan metode pembayaran non-tunai (dikendalikan admin pusat)
	let paymentSettings = $state<PaymentSettings | null>(null);
	let qrisEnabled = $derived(paymentSettings?.qris?.enabled === true);
	let transferEnabled = $derived(paymentSettings?.transfer?.enabled === true);

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

	// Shift kasir aktif (transaksi hanya bisa diproses saat shift terbuka)
	let openShift = $state<Shift | null>(null);

	onMount(async () => {
		cartStore.init(authState.branch?.id || authState.user?.branch_id || 'all');
		await loadProductsAndCategories();
		await loadTaxSettings();
		await loadPaymentSettings();
		await loadOpenShift();
		scanInput?.focus();
	});

	// Muat ulang pengaturan pajak & pembayaran setiap kali sinkronisasi selesai,
	// agar perubahan dari sisi admin ikut diterapkan di perangkat kasir.
	$effect(() => {
		if (syncEngine.lastSyncedAt) {
			loadTaxSettings();
			loadPaymentSettings();
		}
	});

	async function loadOpenShift() {
		// Shift terikat perangkat/toko; identitas operator diambil dari shift itu.
		openShift = (await getOpenShiftForDevice(authState.device?.id || '')) || null;
	}

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

	async function loadPaymentSettings() {
		try {
			const setting = await db.app_settings.get('payment_settings');
			if (setting && setting.value) {
				paymentSettings = setting.value as PaymentSettings;
				// Metode yang dinonaktifkan admin tidak boleh terpilih saat modal dibuka
				if (!qrisEnabled && paymentMethod === 'qris') paymentMethod = 'cash';
				if (!transferEnabled && paymentMethod === 'transfer') paymentMethod = 'cash';
			}
		} catch (e) {
			console.warn('Gagal memuat pengaturan pembayaran di kasir:', e);
		}
	}

	async function loadProductsAndCategories() {
		categories = await db.categories.toArray();
		const allProducts = await db.products.toArray();
		// Kasir hanya melihat produk aktif yang berlaku untuk semua cabang atau cabang aktifnya
		const branchId = authState.branch?.id || authState.user?.branch_id || 'all';
		products = allProducts.filter(
			p => p.is_active && p.branch_id === branchId
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

	let subtotal = $derived(cartStore.items.reduce((sum, item) => sum + item.subtotal, 0));
	let taxAmount = $derived(Math.round(Math.max(0, subtotal - cartStore.discount) * taxRate));
	let totalAmount = $derived(Math.max(0, subtotal - cartStore.discount + taxAmount));
	let changeAmount = $derived(Math.max(0, amountPaid - totalAmount));

	function showScanFeedback(type: 'success' | 'error' | 'warning', message: string) {
		scanFeedback = { type, message };
		clearTimeout(scanTimeout);
		scanTimeout = setTimeout(() => (scanFeedback = null), 2500);
	}

	function addScannedProduct(product: Product) {
		if (product.stock <= 0) {
			scanSuggestions = [];
			activeSuggestion = -1;
			searchQuery = '';
			showScanFeedback('error', `Stok "${product.name}" habis`);
			return;
		}
		addToCart(product);
		searchQuery = '';
		scanSuggestions = [];
		activeSuggestion = -1;
		showScanFeedback('success', `${product.name} masuk keranjang`);
		scanInput?.focus();
	}

	function pickSuggestion(product: Product) {
		addScannedProduct(product);
	}

	function handleScan(event: KeyboardEvent) {
		// Navigasi keyboard pada daftar saran: panah untuk memilih, Enter untuk mengambil
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (scanSuggestions.length === 0) return;
			event.preventDefault();
			const dir = event.key === 'ArrowDown' ? 1 : -1;
			activeSuggestion = (activeSuggestion + dir + scanSuggestions.length) % scanSuggestions.length;
			return;
		}
		if (event.key === 'Escape') {
			scanSuggestions = [];
			activeSuggestion = -1;
			searchQuery = '';
			return;
		}
		if (event.key !== 'Enter') return;
		const query = searchQuery.trim();
		if (!query) return;

		// Jika daftar saran terbuka, Enter mengambil saran yang aktif
		if (scanSuggestions.length > 0) {
			const pick = scanSuggestions[activeSuggestion >= 0 ? activeSuggestion : 0];
			if (pick) addScannedProduct(pick);
			return;
		}

		const lower = query.toLowerCase();
		// Prioritas pencocokan: barcode persis, lalu SKU persis
		let match = products.find(p => p.barcode && p.barcode === query);
		if (!match) match = products.find(p => p.sku.toLowerCase() === lower);

		if (match) {
			addScannedProduct(match);
			return;
		}

		// Fallback: cocokkan nama produk yang mengandung query
		const nameMatches = products.filter(p => p.name.toLowerCase().includes(lower));
		if (nameMatches.length === 1) {
			addScannedProduct(nameMatches[0]);
			return;
		}
		if (nameMatches.length > 1) {
			scanSuggestions = nameMatches.slice(0, 6);
			activeSuggestion = -1;
			showScanFeedback('warning', `${nameMatches.length} produk cocok — pilih salah satu di bawah`);
			return;
		}

		scanSuggestions = [];
		activeSuggestion = -1;
		showScanFeedback('error', `Produk dengan kode "${query}" tidak ditemukan`);
	}

	function addToCart(product: Product) {
		cartStore.add(product);
	}

	function updateQuantity(productId: string, delta: number) {
		cartStore.updateQuantity(productId, delta);
	}

	function clearCart() {
		cartStore.clear();
	}

	function openPayment() {
		if (cartStore.items.length === 0) return;
		if (!openShift) {
			paymentError = 'Belum ada shift aktif. Buka shift terlebih dahulu di menu Shift Kasir.';
			return;
		}
		if ((paymentMethod === 'qris' && !qrisEnabled) || (paymentMethod === 'transfer' && !transferEnabled)) {
			paymentMethod = 'cash';
		}
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

		// QRIS statis: kasir wajib memastikan dana sudah masuk sebelum konfirmasi,
		// dan QR statis harus sudah diatur oleh admin
		if (paymentMethod === 'qris') {
			if (!paymentSettings?.qris?.image) {
				paymentError = 'QRIS statis belum diatur oleh Admin. Gunakan metode lain atau hubungi Admin.';
				return;
			}
		}

		const now = new Date();
		const dateCode = now.toISOString().slice(0, 10).replace(/-/g, '');
		const branchCode = authState.branch?.code || '-';
		const timeCode = now.toISOString().slice(11, 23).replace(/[:.]/g, '');
		const invoiceNo = `INV/${dateCode}/${branchCode}/${timeCode}`;

		const txId = 'tx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

		const items: TransactionItem[] = cartStore.items.map(item => ({
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
			branch_id: authState.branch?.id || authState.user?.branch_id || 'all',
			branch_name: authState.branch?.name || '-',
			cashier_id: authState.user?.id || '-',
			cashier_name: authState.user?.name || 'Kasir',
			customer_name: customerName.trim() || undefined,
			subtotal,
			discount: cartStore.discount,
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

		// Jejak audit diskon: tercatat terpisah agar bisa dievaluasi admin pusat
		if (cartStore.discount > 0) {
			await db.activity_logs.add({
				id: 'act-' + Date.now() + '-d' + Math.random().toString(36).substring(2, 7),
				branch_id: transaction.branch_id,
				branch_name: transaction.branch_name,
				user_id: transaction.cashier_id,
				user_name: transaction.cashier_name,
				role: 'cashier',
				action: 'discount_applied',
				details: `Diskon ${formatRupiah(cartStore.discount)} diberikan pada transaksi ${invoiceNo} (subtotal ${formatRupiah(subtotal)}).`,
				timestamp: now.toISOString(),
				synced: false
			});
		}

		// 4. Update antrean sinkronisasi
		await syncEngine.updatePendingCount();

		// Refresh data produk lokal
		await loadProductsAndCategories();

		// Reset keranjang & tutup modal bayar
		cartStore.clear();
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
{#if !openShift}
        <div class="mb-4 flex items-start gap-3 border-l-2 border-amber-500 bg-amber-50 px-4 py-3">
                <Clock class="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                        <p class="text-sm font-semibold text-amber-900">Belum ada shift aktif</p>
                        <p class="mt-0.5 text-xs text-amber-800">Buka shift di menu <strong>Shift Kasir</strong> dengan setoran awal sebelum memproses transaksi.</p>
                </div>
        </div>
{/if}

<div class="grid h-[calc(100vh-6.5rem)] grid-cols-1 gap-5 lg:h-[calc(100vh-3.5rem)] lg:grid-cols-12">
        <!-- Katalog produk -->
        <section class="reveal flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xs lg:col-span-7 xl:col-span-8">
                <div class="border-b border-gray-200 px-4 pb-3 pt-4 sm:px-5">
                        <div class="flex items-baseline justify-between gap-3">
                                <div>
                                        <p class="eyebrow text-gray-400">Katalog</p>
                                        <h1 class="mt-0.5 text-xl font-semibold tracking-tight text-gray-900">Pilih barang</h1>
                                </div>
                                <span class="font-mono text-[10px] uppercase tracking-wider text-gray-400">
                                        {filteredProducts.length} produk
                                </span>
                        </div>

                        <!-- Satu kotak: filter langsung, Enter untuk memindai/menambahkan -->
                        <div class="relative mt-3">
                                <Barcode class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                <input
                                        type="text"
                                        bind:this={scanInput}
                                        bind:value={searchQuery}
                                        onkeydown={handleScan}
                                        placeholder="Pindai kode batang / cari nama atau SKU, lalu Enter..."
                                        class="w-full rounded-md border border-gray-300 bg-gray-50 py-2.5 pl-9 pr-4 text-sm text-gray-900 transition placeholder:text-gray-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-600/15 focus:outline-hidden"
                                />
                                {#if scanFeedback}
                                        <div class="absolute left-0 right-0 top-full z-20 mt-1.5 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-white shadow-lg {scanFeedback.type === 'success' ? 'bg-emerald-600' : scanFeedback.type === 'error' ? 'bg-rose-600' : 'bg-amber-500'}">
                                                {#if scanFeedback.type === 'success'}
                                                        <CheckCircle class="h-4 w-4 shrink-0" />
                                                {:else}
                                                        <AlertCircle class="h-4 w-4 shrink-0" />
                                                {/if}
                                                {scanFeedback.message}
                                        </div>
                                {/if}
                                {#if scanSuggestions.length > 0}
                                        <div class="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                                                <p class="border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-medium text-gray-500">Beberapa produk cocok — gunakan panah ↑↓ lalu Enter:</p>
                                                {#each scanSuggestions as sugg, i (sugg.id)}
                                                        <button
                                                                onclick={() => pickSuggestion(sugg)}
                                                                class="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition {i === activeSuggestion ? 'bg-emerald-50 font-semibold' : 'hover:bg-gray-50'}"
                                                        >
                                                                <span class="font-medium text-gray-800">{sugg.name}</span>
                                                                <span class="font-mono text-[11px] text-gray-400">{sugg.sku}</span>
                                                        </button>
                                                {/each}
                                        </div>
                                {/if}
                        </div>

                        <!-- Filter kategori -->
                        <div class="mt-3 flex items-center gap-4 overflow-x-auto scrollbar-none">
                                <button
                                        onclick={() => selectedCategory = 'all'}
                                        class="shrink-0 border-b-2 pb-1.5 text-xs font-semibold transition {selectedCategory === 'all' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-700'}"
                                >
                                        Semua
                                </button>
                                {#each categories as cat}
                                        <button
                                                onclick={() => selectedCategory = cat.name}
                                                class="shrink-0 whitespace-nowrap border-b-2 pb-1.5 text-xs font-semibold transition {selectedCategory === cat.name ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-700'}"
                                        >
                                                {cat.name}
                                        </button>
                                {/each}
                        </div>
                </div>

                <!-- Grid produk -->
                <div class="min-h-0 flex-1 overflow-y-auto p-4">
                        {#if filteredProducts.length === 0}
                                <div class="flex h-64 flex-col items-center justify-center text-gray-400">
                                        <ShoppingBag class="mb-2 h-10 w-10 stroke-1 text-gray-300" />
                                        <p class="text-sm font-medium text-gray-600">Tidak ada produk ditemukan</p>
                                        <p class="mt-1 text-xs text-gray-400">Coba kata kunci lain atau pilih kategori berbeda.</p>
                                </div>
                        {:else}
                                <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                                        {#each filteredProducts as product, i (product.id)}
                                                <button
                                                        onclick={() => addToCart(product)}
                                                        disabled={product.stock <= 0}
                                                        class="group relative flex flex-col justify-between rounded-md border border-gray-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-gray-900 hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:border-gray-200 disabled:hover:shadow-none cursor-pointer"
                                                >
                                                        <div>
                                                                <div class="mb-1.5 flex items-center justify-between gap-1">
                                                                        <span class="truncate font-mono text-[9px] uppercase tracking-wider text-gray-400">{product.category}</span>
                                                                        <span class="shrink-0 font-mono text-[10px] font-medium {product.stock <= 5 ? 'text-rose-600' : 'text-gray-400'}">
                                                                                {product.stock <= 5 ? 'sisa ' : ''}{product.stock}
                                                                        </span>
                                                                </div>
                                                                <h3 class="line-clamp-2 text-[13px] font-semibold leading-snug text-gray-900 transition group-hover:text-emerald-800">
                                                                        {product.name}
                                                                </h3>
                                                                <p class="mt-0.5 truncate font-mono text-[10px] text-gray-400">{product.sku}</p>
                                                        </div>

                                                        <div class="mt-3 flex items-end justify-between gap-2 border-t border-dashed border-gray-200 pt-2">
                                                                <span class="num text-sm font-semibold text-gray-900">
                                                                        {formatRupiah(product.price)}
                                                                </span>
                                                                <span class="flex h-6 w-6 items-center justify-center rounded-sm border border-gray-300 text-gray-500 transition group-hover:border-emerald-600 group-hover:bg-emerald-600 group-hover:text-white">
                                                                        <Plus class="h-3.5 w-3.5" />
                                                                </span>
                                                        </div>
                                                </button>
                                        {/each}
                                </div>
                        {/if}
                </div>
        </section>

        <!-- Nota / keranjang -->
        <section class="reveal flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xs lg:col-span-5 xl:col-span-4" style="--i: 1">
                <div class="flex items-center justify-between border-b border-gray-900/10 bg-gray-50 px-4 py-3">
                        <div class="flex items-baseline gap-2">
                                <h2 class="text-base font-semibold tracking-tight text-gray-900">Nota</h2>
                                <span class="font-mono text-[10px] uppercase tracking-wider text-gray-400">
                                        {cartStore.items.length} item
                                </span>
                        </div>
                        {#if cartStore.items.length > 0}
                                <button
                                        onclick={clearCart}
                                        class="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 transition hover:text-rose-800 cursor-pointer"
                                >
                                        <Trash2 class="h-3.5 w-3.5" />
                                        <span>Kosongkan</span>
                                </button>
                        {/if}
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto px-4">
                        {#if cartStore.items.length === 0}
                                <div class="flex h-full flex-col items-center justify-center py-12 text-center text-gray-400">
                                        <ShoppingBag class="mb-3 h-10 w-10 stroke-1 text-gray-300" />
                                        <p class="text-sm font-semibold text-gray-600">Keranjang masih kosong</p>
                                        <p class="mt-1 max-w-[210px] text-xs text-gray-400">Pilih produk di samping untuk menambahkan ke pesanan.</p>
                                </div>
                        {:else}
                                {#each cartStore.items as item (item.product.id)}
                                        <div class="border-b border-dashed border-gray-200 py-3 last:border-b-0">
                                                <div class="flex items-start justify-between gap-2">
                                                        <div class="min-w-0 flex-1">
                                                                <h4 class="truncate text-[13px] font-semibold text-gray-900">{item.product.name}</h4>
                                                                <p class="mt-0.5 font-mono text-[10px] text-gray-400">{formatRupiah(item.product.price)} / {item.product.unit}</p>
                                                        </div>
                                                        <button
                                                                onclick={() => cartStore.removeItem(item.product.id)}
                                                                title="Hapus item dari keranjang"
                                                                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-gray-300 transition hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                                                        >
                                                                <Trash2 class="h-3.5 w-3.5" />
                                                        </button>
                                                </div>
                                                <div class="mt-2 flex items-center justify-between gap-2">
                                                        <div class="flex items-center rounded-sm border border-gray-300">
                                                                <button
                                                                        onclick={() => updateQuantity(item.product.id, -1)}
                                                                        class="flex h-7 w-7 items-center justify-center text-gray-600 transition hover:bg-gray-100"
                                                                >
                                                                        <Minus class="h-3 w-3" />
                                                                </button>
                                                                <span class="num w-8 border-x border-gray-300 py-1 text-center text-xs font-semibold text-gray-900">{item.quantity}</span>
                                                                <button
                                                                        onclick={() => updateQuantity(item.product.id, 1)}
                                                                        class="flex h-7 w-7 items-center justify-center text-gray-600 transition hover:bg-gray-100"
                                                                >
                                                                        <Plus class="h-3 w-3" />
                                                                </button>
                                                        </div>
                                                        <span class="num text-sm font-semibold text-gray-900">{formatRupiah(item.subtotal)}</span>
                                                </div>
                                                <input
                                                        type="text"
                                                        bind:value={item.notes}
                                                        placeholder="Catatan (opsional)..."
                                                        class="mt-1.5 w-full rounded-sm border border-transparent bg-gray-50 px-2 py-1 text-[11px] text-gray-700 placeholder:text-gray-400 transition focus:border-gray-300 focus:bg-white focus:outline-hidden"
                                                />
                                        </div>
                                {/each}
                        {/if}
                </div>

                <!-- Total -->
                {#if cartStore.items.length > 0}
                        <div class="border-t border-dashed border-gray-300 bg-gray-50/80 px-4 py-3.5">
                                <div class="leader py-0.5">
                                        <span class="text-xs text-gray-500">Subtotal</span>
                                        <span class="num text-xs font-medium text-gray-800">{formatRupiah(subtotal)}</span>
                                </div>

                                <div class="leader py-0.5">
                                        <span class="flex items-center gap-1.5 text-xs text-gray-500">
                                                Diskon
                                                <span class="font-mono text-[10px] text-gray-400">Rp</span>
                                        </span>
                                        <input
                                                type="number"
                                                bind:value={cartStore.discount}
                                                min="0"
                                                class="num w-24 rounded-sm border border-gray-300 bg-white px-2 py-0.5 text-right text-xs font-semibold text-rose-600 transition focus:border-emerald-600 focus:outline-hidden"
                                        />
                                </div>

                                <div class="leader py-0.5">
                                        <span class="text-xs text-gray-500">{taxLabel}</span>
                                        <span class="num text-xs font-medium text-gray-800">{formatRupiah(taxAmount)}</span>
                                </div>

                                <div class="mt-2.5 flex items-end justify-between gap-3 border-t border-gray-900/15 pt-2.5">
                                        <div>
                                                <p class="eyebrow text-[9px] text-gray-400">Total tagihan</p>
                                                <p class="num mt-0.5 text-xl font-semibold tracking-tight text-emerald-800">{formatRupiah(totalAmount)}</p>
                                        </div>
                                        <button
                                                onclick={openPayment}
                                                class="group inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:translate-y-px cursor-pointer"
                                        >
                                                <span>Bayar</span>
                                                <ArrowRight class="h-4 w-4 transition group-hover:translate-x-0.5" />
                                        </button>
                                </div>
                        </div>
                {/if}
        </section>
</div>

<!-- Modal pembayaran -->
{#if isPaymentModalOpen}
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-xs">
                <div class="reveal max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-2xl">
                        <div class="flex items-start justify-between gap-3 border-b border-gray-200 px-6 py-4">
                                <div>
                                        <p class="eyebrow text-gray-400">Nota {formatRupiah(totalAmount)}</p>
                                        <h3 class="mt-0.5 text-lg font-semibold tracking-tight text-gray-900">Pembayaran</h3>
                                </div>
                                <button onclick={() => (isPaymentModalOpen = false)} class="rounded-sm p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 cursor-pointer" aria-label="Tutup">
                                        <Plus class="h-4 w-4 rotate-45" />
                                </button>
                        </div>

                        <div class="space-y-5 px-6 py-5">
                                <div>
                                        <label for="customerName" class="eyebrow mb-1.5 block text-[9px] text-gray-400">Nama Pelanggan (Opsional)</label>
                                        <input
                                                id="customerName"
                                                type="text"
                                                bind:value={customerName}
                                                placeholder="Contoh: Pak Anton / Meja 05"
                                                class="w-full rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 focus:outline-hidden"
                                        />
                                </div>

                                <div>
                                        <span class="eyebrow mb-2 block text-[9px] text-gray-400">Metode Pembayaran</span>
                                        <div class="grid grid-cols-3 gap-2">
                                                <button
                                                        onclick={() => paymentMethod = 'cash'}
                                                        class="flex flex-col items-center justify-center gap-1 rounded-md border px-2 py-3 text-[11px] transition {paymentMethod === 'cash' ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}"
                                                >
                                                        <Banknote class="h-5 w-5" />
                                                        <span>Tunai</span>
                                                </button>
                                                {#if qrisEnabled}
                                                        <button
                                                                onclick={() => paymentMethod = 'qris'}
                                                                class="flex flex-col items-center justify-center gap-1 rounded-md border px-2 py-3 text-[11px] transition {paymentMethod === 'qris' ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}"
                                                        >
                                                                <QrCode class="h-5 w-5" />
                                                                <span>QRIS</span>
                                                        </button>
                                                {/if}
                                                {#if transferEnabled}
                                                        <button
                                                                onclick={() => paymentMethod = 'transfer'}
                                                                class="flex flex-col items-center justify-center gap-1 rounded-md border px-2 py-3 text-[11px] transition {paymentMethod === 'transfer' ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}"
                                                        >
                                                                <CreditCard class="h-5 w-5" />
                                                                <span>Transfer</span>
                                                        </button>
                                                {/if}
                                        </div>
                                </div>

                                {#if paymentMethod === 'cash'}
                                        <div class="border border-gray-200 bg-gray-50 px-4 py-4">
                                                <label for="amountPaid" class="eyebrow mb-1.5 block text-[9px] text-gray-400">Uang Diterima</label>
                                                <input
                                                        id="amountPaid"
                                                        type="number"
                                                        bind:value={amountPaid}
                                                        class="num w-full rounded-md border border-gray-300 bg-white px-3.5 py-2.5 text-lg font-semibold text-gray-900 transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 focus:outline-hidden"
                                                />

                                                <div class="mt-2 flex flex-wrap gap-1.5">
                                                        <button
                                                                onclick={() => amountPaid = totalAmount}
                                                                class="rounded-sm border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-emerald-600 hover:text-emerald-800"
                                                        >
                                                                Uang pas
                                                        </button>
                                                        <button
                                                                onclick={() => amountPaid = 50000}
                                                                class="num rounded-sm border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-emerald-600 hover:text-emerald-800"
                                                        >
                                                                50.000
                                                        </button>
                                                        <button
                                                                onclick={() => amountPaid = 100000}
                                                                class="num rounded-sm border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-emerald-600 hover:text-emerald-800"
                                                        >
                                                                100.000
                                                        </button>
                                                        <button
                                                                onclick={() => amountPaid = 200000}
                                                                class="num rounded-sm border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-emerald-600 hover:text-emerald-800"
                                                        >
                                                                200.000
                                                        </button>
                                                </div>

                                                <div class="leader mt-3 border-t border-gray-200 pt-2.5">
                                                        <span class="text-xs font-medium text-gray-600">Kembalian</span>
                                                        <span class="num text-base font-semibold {changeAmount < 0 ? 'text-rose-600' : 'text-emerald-800'}">
                                                                {formatRupiah(changeAmount)}
                                                        </span>
                                                </div>
                                        </div>
                                {:else if paymentMethod === 'qris'}
                                        {#if paymentSettings?.qris?.image}
                                                <div class="flex flex-col items-center justify-center border border-gray-200 bg-gray-50 px-6 py-5 text-center">
                                                        <img
                                                                src={paymentSettings.qris.image}
                                                                alt="QRIS Merchant"
                                                                class="mb-2 h-44 w-44 rounded-md border border-gray-300 bg-white object-contain p-2"
                                                        />
                                                        {#if paymentSettings.qris.merchant_name}
                                                                <p class="text-xs font-semibold text-gray-900">{paymentSettings.qris.merchant_name}</p>
                                                        {/if}
                                                        <p class="mt-1 text-xs text-gray-600">Minta pelanggan memindai QRIS dan membayar sesuai nominal</p>
                                                        <p class="mt-1 font-mono text-[11px] text-gray-500">Total <span class="font-semibold text-emerald-800">{formatRupiah(totalAmount)}</span></p>
                                                        <p class="mt-2 border-l-2 border-amber-500 bg-amber-50 px-2.5 py-1.5 text-left text-[11px] text-amber-800">Pastikan notifikasi dana masuk terlihat sebelum menekan konfirmasi.</p>
                                                </div>
                                        {:else}
                                                <div class="flex flex-col items-center justify-center border border-amber-300 bg-amber-50 px-6 py-5 text-center">
                                                        <QrCode class="mb-2 h-9 w-9 text-amber-600" />
                                                        <p class="text-xs font-semibold text-amber-900">QRIS statis belum diatur oleh Admin</p>
                                                        <p class="mt-1 text-[11px] text-amber-800">Atur gambar QR di menu Metode Pembayaran (Admin) atau gunakan metode lain.</p>
                                                </div>
                                        {/if}
                                {:else if paymentMethod === 'transfer'}
                                        <div class="space-y-2 border border-gray-200 bg-gray-50 px-4 py-3.5 text-xs text-gray-700">
                                                <div class="eyebrow text-[9px] text-gray-400">Rekening tujuan toko</div>
                                                {#if paymentSettings?.transfer?.bank_name || paymentSettings?.transfer?.account_number}
                                                        <div class="leader">
                                                                <span>{paymentSettings?.transfer?.bank_name || 'Bank'}</span>
                                                                <span class="num font-semibold text-gray-900">{paymentSettings?.transfer?.account_number}</span>
                                                        </div>
                                                        {#if paymentSettings?.transfer?.account_name}
                                                                <div class="leader">
                                                                        <span>Atas nama</span>
                                                                        <span class="font-semibold text-gray-900">{paymentSettings.transfer.account_name}</span>
                                                                </div>
                                                        {/if}
                                                {:else}
                                                        <p class="text-amber-800">Rekening transfer belum diatur oleh Admin.</p>
                                                {/if}
                                        </div>
                                {/if}

                                {#if paymentError}
                                        <div class="flex items-center gap-2 border-l-2 border-rose-500 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                                                <AlertCircle class="h-4 w-4 shrink-0" />
                                                <span>{paymentError}</span>
                                        </div>
                                {/if}
                        </div>

                        <div class="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-4">
                                <button
                                        onclick={() => isPaymentModalOpen = false}
                                        class="rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 cursor-pointer"
                                >
                                        Batal
                                </button>
                                <button
                                        onclick={processTransaction}
                                        class="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:translate-y-px cursor-pointer"
                                >
                                        <CheckCircle class="h-4 w-4" />
                                        <span>Konfirmasi Pembayaran</span>
                                </button>
                        </div>
                </div>
        </div>
{/if}

<!-- Modal struk transaksi sukses -->
<ReceiptModal
        transaction={completedTransaction}
        onClose={() => completedTransaction = null}
/>
