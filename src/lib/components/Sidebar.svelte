<script lang="ts">
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.js';
	import {
		Store,
		Users,
		Activity,
		ShoppingCart,
		Package,
		Receipt,
		ReceiptText,
		BarChart3,
		Wifi,
		WifiOff,
		RefreshCw,
		LogOut,
		Building2,
		ShieldCheck,
		AlertTriangle,
		Info,
		Menu,
		X,
		ChevronRight,
		Clock,
		Truck,
		ClipboardList,
		LayoutDashboard,
		Tags,
		ArrowLeftRight,
		Wallet
	} from 'lucide-svelte';

	interface Props {
		activeTab: string;
		onTabChange: (tab: string) => void;
	}

	let { activeTab, onTabChange }: Props = $props();

	// State untuk membuka/menutup drawer menu di tampilan layar seluler (mobile)
	let isMobileOpen = $state<boolean>(false);
	let syncMessage = $state<string | null>(null);

	async function handleSyncNow() {
		const res = await syncEngine.triggerSync();
		syncMessage = res.message;
		setTimeout(() => {
			syncMessage = null;
		}, 3000);
	}

	function selectTab(tab: string) {
		onTabChange(tab);
		isMobileOpen = false; // Otomatis tutup drawer di mobile setelah memilih menu
	}
</script>

<!-- ========================================================================= -->
<!-- HEADER MOBILE (Tampil hanya di layar kecil / mobile < lg)                  -->
<!-- ========================================================================= -->
<header class="lg:hidden sticky top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/95 px-4 backdrop-blur-md shadow-2xs">
	<!-- Tombol Hamburger & Identitas Brand Mini -->
	<div class="flex items-center gap-3">
		<button
			onclick={() => (isMobileOpen = !isMobileOpen)}
			class="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 active:scale-95 transition cursor-pointer"
			aria-label="Toggle Menu Sidebar"
		>
			{#if isMobileOpen}
				<X class="h-5 w-5" />
			{:else}
				<Menu class="h-5 w-5" />
			{/if}
		</button>

		<div class="flex items-center gap-2">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white shadow-xs">
				<Store class="h-4 w-4" />
			</div>
			<div>
				<h1 class="text-sm font-bold text-zinc-900 tracking-tight leading-tight">Kasir Modern</h1>
				<p class="text-[10px] text-zinc-500 truncate max-w-[150px]">
					{authState.branch?.name || (authState.user?.role === 'admin' ? 'Monitoring Pusat' : 'Cabang')}
				</p>
			</div>
		</div>
	</div>

	<!-- Status Jaringan & Sinkronisasi di Mobile Topbar -->
	<div class="flex items-center gap-2">
		{#if syncEngine.isOnline}
			<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200" title="Online">
				<Wifi class="h-3 w-3" />
			</span>
		{:else}
			<span class="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 border border-rose-200 animate-pulse" title="Offline Mode">
				<WifiOff class="h-3 w-3" />
			</span>
		{/if}

		<button
			onclick={handleSyncNow}
			disabled={!syncEngine.isOnline || syncEngine.isSyncing}
			class="relative flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition cursor-pointer"
			title="Sinkronkan data"
		>
			<RefreshCw class="h-3.5 w-3.5 {syncEngine.isSyncing ? 'animate-spin text-emerald-600' : ''}" />
			{#if syncEngine.pendingCount > 0}
				<span class="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
					{syncEngine.pendingCount}
				</span>
			{/if}
		</button>
	</div>
</header>

<!-- Backdrop Overlay untuk Mobile saat Sidebar terbuka -->
{#if isMobileOpen}
	<div
		onclick={() => (isMobileOpen = false)}
		class="fixed inset-0 z-40 bg-zinc-900/40 backdrop-blur-xs transition-opacity lg:hidden"
		role="presentation"
	></div>
{/if}

<!-- ========================================================================= -->
<!-- SIDEBAR NAVIGATION UTAMA (Desktop: Sticky Sidebar, Mobile: Slide-in Drawer) -->
<!-- Warna Netral (Zinc/Slate) dengan aksen halus untuk sentuhan modern elegan  -->
<!-- ========================================================================= -->
<aside
	class="fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col justify-between border-r border-zinc-200/90 bg-zinc-50/95 backdrop-blur-md transition-transform duration-200 ease-in-out lg:sticky lg:top-0 lg:h-screen lg:self-start lg:translate-x-0 {isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}"
>
	<!-- Bagian Atas: Identitas Brand & Informasi Cabang -->
	<div class="flex flex-col p-5 pb-3">
		<div class="flex items-center justify-between">
			<!-- Logo & Judul Aplikasi -->
			<div class="flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-md shadow-zinc-900/10">
					<Store class="h-5 w-5" />
				</div>
				<div>
					<div class="flex items-center gap-1.5">
						<span class="text-base font-extrabold text-zinc-900 tracking-tight">Kasir Modern</span>
						{#if authState.user?.role === 'admin'}
							<span class="inline-flex items-center rounded-md bg-zinc-200/80 px-1.5 py-0.5 text-[10px] font-bold text-zinc-800 uppercase tracking-wider">
								Admin
							</span>
						{:else}
							<span class="inline-flex items-center rounded-md bg-emerald-100/80 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
								Kasir
							</span>
						{/if}
					</div>
					<p class="text-[11px] text-zinc-500 font-medium">Sistem Minimarket Modern</p>
				</div>
			</div>

			<!-- Tombol Tutup (Hanya di layar mobile) -->
			<button
				onclick={() => (isMobileOpen = false)}
				class="lg:hidden p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition cursor-pointer"
				aria-label="Tutup Menu"
			>
				<X class="h-5 w-5" />
			</button>
		</div>

		<!-- Kartu Informasi Cabang Toko Aktif -->
		<div class="mt-4 rounded-xl border border-zinc-200/70 bg-white p-3 shadow-2xs">
			<div class="flex items-center gap-2 text-xs font-semibold text-zinc-800">
				<Building2 class="h-3.5 w-3.5 text-zinc-500 shrink-0" />
				<span class="truncate">
					{authState.branch?.name || (authState.user?.role === 'admin' ? 'Semua Cabang Toko' : '-')}
				</span>
			</div>
			{#if authState.branch?.code}
				<div class="mt-1 flex items-center justify-between text-[11px] text-zinc-400">
					<span>Kode: <strong class="text-zinc-600 font-mono">{authState.branch.code}</strong></span>
					<span class="text-zinc-300">•</span>
					<span class="text-emerald-600 font-medium">Siap Beroperasi</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Bagian Tengah: Menu Navigasi Vertikal -->
	<div class="flex-1 overflow-y-auto px-4 py-2 space-y-6">
		<div>
			<p class="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
				Menu Operasional
			</p>

			<nav class="space-y-1">
				{#if authState.user?.role === 'cashier'}
					<!-- POS Kasir -->
					<button
						onclick={() => selectTab('pos')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'pos' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<ShoppingCart class="h-4 w-4 {activeTab === 'pos' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Kasir (POS)</span>
						</div>
						{#if activeTab === 'pos'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Produk & Stok -->
					<button
						onclick={() => selectTab('products')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'products' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Package class="h-4 w-4 {activeTab === 'products' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Produk & Inventaris</span>
						</div>
						{#if activeTab === 'products'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Riwayat Transaksi -->
					<button
						onclick={() => selectTab('history')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'history' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Receipt class="h-4 w-4 {activeTab === 'history' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Riwayat Transaksi</span>
						</div>
						{#if activeTab === 'history'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Shift Kasir -->
					<button
						onclick={() => selectTab('shift')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'shift' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Clock class="h-4 w-4 {activeTab === 'shift' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Shift Kasir</span>
						</div>
						{#if activeTab === 'shift'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Pembelian Stok dari Supplier -->
					<button
						onclick={() => selectTab('purchases')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'purchases' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Truck class="h-4 w-4 {activeTab === 'purchases' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Pembelian Stok</span>
						</div>
						{#if activeTab === 'purchases'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Stok Opname -->
					<button
						onclick={() => selectTab('opname')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'opname' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<ClipboardList class="h-4 w-4 {activeTab === 'opname' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Stok Opname</span>
						</div>
						{#if activeTab === 'opname'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Transfer Stok Antar Cabang -->
					<button
						onclick={() => selectTab('transfers')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'transfers' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<ArrowLeftRight class="h-4 w-4 {activeTab === 'transfers' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Transfer Stok</span>
						</div>
						{#if activeTab === 'transfers'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Pengeluaran Operasional Minimarket -->
					<button
						onclick={() => selectTab('expenses')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'expenses' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<ReceiptText class="h-4 w-4 {activeTab === 'expenses' ? 'text-rose-400' : 'text-zinc-400'}" />
							<span>Pengeluaran Toko</span>
						</div>
						{#if activeTab === 'expenses'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Laporan Penjualan -->
					<button
						onclick={() => selectTab('reports')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'reports' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<BarChart3 class="h-4 w-4 {activeTab === 'reports' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Laporan Finansial</span>
						</div>
						{#if activeTab === 'reports'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Metode Pembayaran Toko (QRIS statis & transfer milik toko ini) -->
					<button
						onclick={() => selectTab('payment')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'payment' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Wallet class="h-4 w-4 {activeTab === 'payment' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Metode Pembayaran</span>
						</div>
						{#if activeTab === 'payment'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>
				{:else if authState.user?.role === 'admin'}
					<!-- Beranda Admin -->
					<button
						onclick={() => selectTab('dashboard')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'dashboard' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<LayoutDashboard class="h-4 w-4 {activeTab === 'dashboard' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Beranda</span>
						</div>
						{#if activeTab === 'dashboard'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Kelola Pengguna -->
					<button
						onclick={() => selectTab('users')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'users' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Users class="h-4 w-4 {activeTab === 'users' ? 'text-indigo-400' : 'text-zinc-400'}" />
							<span>Kelola Pengguna</span>
						</div>
						{#if activeTab === 'users'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Kelola Cabang -->
					<button
						onclick={() => selectTab('branches')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'branches' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Building2 class="h-4 w-4 {activeTab === 'branches' ? 'text-indigo-400' : 'text-zinc-400'}" />
							<span>Kelola Cabang</span>
						</div>
						{#if activeTab === 'branches'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Manajemen Kategori -->
					<button
						onclick={() => selectTab('categories')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'categories' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Tags class="h-4 w-4 {activeTab === 'categories' ? 'text-indigo-400' : 'text-zinc-400'}" />
							<span>Kategori</span>
						</div>
						{#if activeTab === 'categories'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Transfer Stok Antar Cabang (Admin) -->
					<button
						onclick={() => selectTab('transfers')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'transfers' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<ArrowLeftRight class="h-4 w-4 {activeTab === 'transfers' ? 'text-indigo-400' : 'text-zinc-400'}" />
							<span>Transfer Stok</span>
						</div>
						{#if activeTab === 'transfers'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Monitoring Aktivitas Kasir -->
					<button
						onclick={() => selectTab('monitoring')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'monitoring' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Activity class="h-4 w-4 {activeTab === 'monitoring' ? 'text-indigo-400' : 'text-zinc-400'}" />
							<span>Monitoring Kasir</span>
						</div>
						{#if activeTab === 'monitoring'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Pengeluaran Operasional Minimarket (Admin View) -->
					<button
						onclick={() => selectTab('expenses')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'expenses' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<ReceiptText class="h-4 w-4 {activeTab === 'expenses' ? 'text-rose-400' : 'text-zinc-400'}" />
							<span>Pengeluaran Toko</span>
						</div>
						{#if activeTab === 'expenses'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Laporan Penjualan (Admin View) -->
					<button
						onclick={() => selectTab('reports')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'reports' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<BarChart3 class="h-4 w-4 {activeTab === 'reports' ? 'text-indigo-400' : 'text-zinc-400'}" />
							<span>Laporan Komprehensif</span>
						</div>
						{#if activeTab === 'reports'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Metode Pembayaran (Admin View) -->
					<button
						onclick={() => selectTab('payment')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'payment' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Wallet class="h-4 w-4 {activeTab === 'payment' ? 'text-indigo-400' : 'text-zinc-400'}" />
							<span>Metode Pembayaran</span>
						</div>
						{#if activeTab === 'payment'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>

					<!-- Pengaturan Pajak (Admin View) -->
					<button
						onclick={() => selectTab('tax')}
						class="w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer {activeTab === 'tax' ? 'bg-zinc-900 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900'}"
					>
						<div class="flex items-center gap-3">
							<Receipt class="h-4 w-4 {activeTab === 'tax' ? 'text-emerald-400' : 'text-zinc-400'}" />
							<span>Pengaturan Usaha</span>
						</div>
						{#if activeTab === 'tax'}
							<ChevronRight class="h-3.5 w-3.5 text-zinc-400" />
						{/if}
					</button>
				{/if}
			</nav>
		</div>

		<!-- Status Jaringan & Sinkronisasi -->
		<div>
			<p class="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
				Sinkronisasi & Offline
			</p>

			<div class="rounded-xl border border-zinc-200/70 bg-white p-3 space-y-2.5 shadow-2xs">
				<!-- Status Online / Offline -->
				<div class="flex items-center justify-between text-xs">
					<span class="text-zinc-500 font-medium">Status Koneksi</span>
					{#if syncEngine.isOnline}
						<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
							<Wifi class="h-3 w-3" /> Online
						</span>
					{:else}
						<span class="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200 animate-pulse">
							<WifiOff class="h-3 w-3" /> Offline
						</span>
					{/if}
				</div>

				<!-- Tombol Trigger Sinkronisasi -->
				<button
					onclick={handleSyncNow}
					disabled={!syncEngine.isOnline || syncEngine.isSyncing}
					class="w-full flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 disabled:opacity-50 transition cursor-pointer"
				>
					<RefreshCw class="h-3.5 w-3.5 {syncEngine.isSyncing ? 'animate-spin text-emerald-600' : 'text-zinc-500'}" />
					<span>{syncEngine.isSyncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}</span>
					{#if syncEngine.pendingCount > 0}
						<span class="rounded-full bg-amber-500 px-1.5 py-0.2 text-[9px] font-bold text-white">
							{syncEngine.pendingCount}
						</span>
					{/if}
				</button>

				{#if syncMessage}
					<p class="text-[10px] text-emerald-600 font-medium text-center">{syncMessage}</p>
				{/if}
				{#if syncEngine.lastError}
					<div class="flex items-center gap-1 text-[10px] text-rose-600">
						<AlertTriangle class="h-3 w-3 shrink-0" />
						<span class="truncate">{syncEngine.lastError}</span>
					</div>
				{/if}
				{#if syncEngine.lastNotice}
					<div class="flex items-center gap-1 text-[10px] text-amber-600">
						<Info class="h-3 w-3 shrink-0" />
						<span class="truncate">{syncEngine.lastNotice}</span>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Bagian Bawah: Profil Pengguna & Logout -->
	<div class="border-t border-zinc-200/90 p-4 bg-white/70">
		<div class="flex items-center justify-between">
			<!-- User Info -->
			<div class="flex items-center gap-3 overflow-hidden">
				<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-200 text-zinc-700 font-bold text-xs uppercase">
					{authState.user?.name ? authState.user.name.slice(0, 2) : 'US'}
				</div>
				<div class="min-w-0">
					<p class="text-xs font-bold text-zinc-900 truncate leading-tight">{authState.user?.name}</p>
					<p class="text-[11px] text-zinc-400 capitalize">{authState.user?.role}</p>
				</div>
			</div>

			<!-- Tombol Logout -->
			<button
				onclick={() => authState.logout()}
				class="rounded-xl p-2 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
				title="Keluar dari Sistem"
				aria-label="Logout"
			>
				<LogOut class="h-4 w-4" />
			</button>
		</div>
	</div>
</aside>
