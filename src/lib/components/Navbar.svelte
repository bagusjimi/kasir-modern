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
		Info
	} from 'lucide-svelte';

	interface Props {
		activeTab: string;
		onTabChange: (tab: string) => void;
	}

	let { activeTab, onTabChange }: Props = $props();

	let syncMessage = $state<string | null>(null);

	async function handleSyncNow() {
		const res = await syncEngine.triggerSync();
		syncMessage = res.message;
		setTimeout(() => {
			syncMessage = null;
		}, 3000);
	}
</script>

<header class="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-md shadow-xs">
	<div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
		<!-- Brand & Branch Info -->
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-md shadow-emerald-500/20">
				<Store class="h-5 w-5" />
			</div>
			<div>
				<div class="flex items-center gap-2">
					<h1 class="text-lg font-bold text-gray-900 tracking-tight">Kasir Modern</h1>
					{#if authState.user?.role === 'admin'}
						<span class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 border border-indigo-200">
							<ShieldCheck class="h-3 w-3" /> Admin
						</span>
					{:else}
						<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
							Kasir
						</span>
					{/if}
				</div>
				<div class="flex items-center gap-1.5 text-xs text-gray-500">
					<Building2 class="h-3.5 w-3.5" />
					<span>{authState.branch?.name || (authState.user?.role === 'admin' ? 'Monitoring Semua Cabang' : 'Pusat')}</span>
				</div>
			</div>
		</div>

		<!-- Nav Tabs -->
		<nav class="hidden md:flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-sm font-medium">
			{#if authState.user?.role === 'cashier'}
				<button
					onclick={() => onTabChange('pos')}
					class="flex items-center gap-2 rounded-lg px-3.5 py-1.5 transition {activeTab === 'pos' ? 'bg-white text-emerald-600 font-semibold shadow-xs' : 'text-gray-600 hover:text-gray-900'}"
				>
					<ShoppingCart class="h-4 w-4" />
					<span>Kasir (POS)</span>
				</button>
				<button
					onclick={() => onTabChange('products')}
					class="flex items-center gap-2 rounded-lg px-3.5 py-1.5 transition {activeTab === 'products' ? 'bg-white text-emerald-600 font-semibold shadow-xs' : 'text-gray-600 hover:text-gray-900'}"
				>
					<Package class="h-4 w-4" />
					<span>Produk & Stok</span>
				</button>
				<button
					onclick={() => onTabChange('history')}
					class="flex items-center gap-2 rounded-lg px-3.5 py-1.5 transition {activeTab === 'history' ? 'bg-white text-emerald-600 font-semibold shadow-xs' : 'text-gray-600 hover:text-gray-900'}"
				>
					<Receipt class="h-4 w-4" />
					<span>Riwayat Transaksi</span>
				</button>
				<button
					onclick={() => onTabChange('expenses')}
					class="flex items-center gap-2 rounded-lg px-3.5 py-1.5 transition {activeTab === 'expenses' ? 'bg-white text-rose-600 font-semibold shadow-xs' : 'text-gray-600 hover:text-gray-900'}"
				>
					<ReceiptText class="h-4 w-4" />
					<span>Pengeluaran</span>
				</button>
				<button
					onclick={() => onTabChange('reports')}
					class="flex items-center gap-2 rounded-lg px-3.5 py-1.5 transition {activeTab === 'reports' ? 'bg-white text-emerald-600 font-semibold shadow-xs' : 'text-gray-600 hover:text-gray-900'}"
				>
					<BarChart3 class="h-4 w-4" />
					<span>Laporan</span>
				</button>
			{:else if authState.user?.role === 'admin'}
				<button
					onclick={() => onTabChange('users')}
					class="flex items-center gap-2 rounded-lg px-3.5 py-1.5 transition {activeTab === 'users' ? 'bg-white text-indigo-600 font-semibold shadow-xs' : 'text-gray-600 hover:text-gray-900'}"
				>
					<Users class="h-4 w-4" />
					<span>Kelola Pengguna</span>
				</button>
				<button
					onclick={() => onTabChange('monitoring')}
					class="flex items-center gap-2 rounded-lg px-3.5 py-1.5 transition {activeTab === 'monitoring' ? 'bg-white text-indigo-600 font-semibold shadow-xs' : 'text-gray-600 hover:text-gray-900'}"
				>
					<Activity class="h-4 w-4" />
					<span>Monitoring Aktivitas</span>
				</button>
				<button
					onclick={() => onTabChange('expenses')}
					class="flex items-center gap-2 rounded-lg px-3.5 py-1.5 transition {activeTab === 'expenses' ? 'bg-white text-rose-600 font-semibold shadow-xs' : 'text-gray-600 hover:text-gray-900'}"
				>
					<ReceiptText class="h-4 w-4" />
					<span>Pengeluaran</span>
				</button>
				<button
					onclick={() => onTabChange('reports')}
					class="flex items-center gap-2 rounded-lg px-3.5 py-1.5 transition {activeTab === 'reports' ? 'bg-white text-indigo-600 font-semibold shadow-xs' : 'text-gray-600 hover:text-gray-900'}"
				>
					<BarChart3 class="h-4 w-4" />
					<span>Laporan</span>
				</button>
			{/if}
		</nav>

		<!-- Status Sync, Offline Indicator & User Profile -->
		<div class="flex items-center gap-2 sm:gap-3">
			<!-- Online / Offline Badge -->
			{#if syncEngine.isOnline}
				<div class="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200/60" title="Terhubung ke Internet">
					<Wifi class="h-3.5 w-3.5" />
					<span class="hidden sm:inline">Online</span>
				</div>
			{:else}
				<div class="flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 border border-rose-200/60 animate-pulse" title="Tidak ada koneksi internet. Data disimpan di IndexedDB lokal.">
					<WifiOff class="h-3.5 w-3.5" />
					<span class="hidden sm:inline">Offline Mode</span>
				</div>
			{/if}

			<!-- Sync Button & Pending Indicator -->
			<button
				onclick={handleSyncNow}
				disabled={!syncEngine.isOnline || syncEngine.isSyncing}
				class="relative flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 disabled:opacity-50 transition cursor-pointer"
				title="Klik untuk menyinkronkan data lokal ke cloud"
			>
				<RefreshCw class="h-3.5 w-3.5 text-gray-500 {syncEngine.isSyncing ? 'animate-spin text-emerald-600' : ''}" />
				<span class="hidden sm:inline">{syncEngine.isSyncing ? 'Menyinkronkan...' : 'Sinkron'}</span>
				{#if syncEngine.pendingCount > 0}
					<span class="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white shadow-xs">
						{syncEngine.pendingCount}
					</span>
				{/if}
			</button>

			<!-- User & Logout -->
			<div class="flex items-center gap-2 pl-2 border-l border-gray-200">
				<div class="text-right hidden sm:block">
					<p class="text-xs font-bold text-gray-800 leading-tight">{authState.user?.name}</p>
					<p class="text-[10px] text-gray-500 capitalize">{authState.user?.role}</p>
				</div>
				<button
					onclick={() => authState.logout()}
					class="rounded-xl p-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
					title="Keluar (Logout)"
					aria-label="Logout"
				>
					<LogOut class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>

	<!-- Mobile Tabs Navigation -->
	<div class="flex md:hidden border-t border-gray-100 bg-gray-50 px-2 py-1.5 justify-around text-xs font-medium">
		{#if authState.user?.role === 'cashier'}
			<button
				onclick={() => onTabChange('pos')}
				class="flex flex-1 items-center justify-center gap-1 py-1 rounded-lg {activeTab === 'pos' ? 'bg-white text-emerald-600 font-bold shadow-xs' : 'text-gray-600'}"
			>
				<ShoppingCart class="h-3.5 w-3.5" />
				<span>Kasir</span>
			</button>
			<button
				onclick={() => onTabChange('products')}
				class="flex flex-1 items-center justify-center gap-1 py-1 rounded-lg {activeTab === 'products' ? 'bg-white text-emerald-600 font-bold shadow-xs' : 'text-gray-600'}"
			>
				<Package class="h-3.5 w-3.5" />
				<span>Produk</span>
			</button>
			<button
				onclick={() => onTabChange('history')}
				class="flex flex-1 items-center justify-center gap-1 py-1 rounded-lg {activeTab === 'history' ? 'bg-white text-emerald-600 font-bold shadow-xs' : 'text-gray-600'}"
			>
				<Receipt class="h-3.5 w-3.5" />
				<span>Riwayat</span>
			</button>
			<button
				onclick={() => onTabChange('expenses')}
				class="flex flex-1 items-center justify-center gap-1 py-1 rounded-lg {activeTab === 'expenses' ? 'bg-white text-rose-600 font-bold shadow-xs' : 'text-gray-600'}"
			>
				<ReceiptText class="h-3.5 w-3.5" />
				<span>Biaya</span>
			</button>
			<button
				onclick={() => onTabChange('reports')}
				class="flex flex-1 items-center justify-center gap-1 py-1 rounded-lg {activeTab === 'reports' ? 'bg-white text-emerald-600 font-bold shadow-xs' : 'text-gray-600'}"
			>
				<BarChart3 class="h-3.5 w-3.5" />
				<span>Laporan</span>
			</button>
		{:else if authState.user?.role === 'admin'}
			<button
				onclick={() => onTabChange('users')}
				class="flex flex-1 items-center justify-center gap-1 py-1 rounded-lg {activeTab === 'users' ? 'bg-white text-indigo-600 font-bold shadow-xs' : 'text-gray-600'}"
			>
				<Users class="h-3.5 w-3.5" />
				<span>User</span>
			</button>
			<button
				onclick={() => onTabChange('monitoring')}
				class="flex flex-1 items-center justify-center gap-1 py-1 rounded-lg {activeTab === 'monitoring' ? 'bg-white text-indigo-600 font-bold shadow-xs' : 'text-gray-600'}"
			>
				<Activity class="h-3.5 w-3.5" />
				<span>Aktivitas</span>
			</button>
			<button
				onclick={() => onTabChange('expenses')}
				class="flex flex-1 items-center justify-center gap-1 py-1 rounded-lg {activeTab === 'expenses' ? 'bg-white text-rose-600 font-bold shadow-xs' : 'text-gray-600'}"
			>
				<ReceiptText class="h-3.5 w-3.5" />
				<span>Biaya</span>
			</button>
			<button
				onclick={() => onTabChange('reports')}
				class="flex flex-1 items-center justify-center gap-1 py-1 rounded-lg {activeTab === 'reports' ? 'bg-white text-indigo-600 font-bold shadow-xs' : 'text-gray-600'}"
			>
				<BarChart3 class="h-3.5 w-3.5" />
				<span>Laporan</span>
			</button>
		{/if}
	</div>

	<!-- Notifikasi Toast Sinkronisasi -->
	{#if syncMessage}
		<div class="bg-emerald-600 px-4 py-1.5 text-center text-xs font-medium text-white transition">
			{syncMessage}
		</div>
	{/if}
	{#if syncEngine.lastError}
		<div class="flex items-center justify-center gap-1.5 bg-rose-600 px-4 py-1.5 text-center text-xs font-medium text-white">
			<AlertTriangle class="h-3.5 w-3.5" />
			<span>Sinkronisasi ditunda: {syncEngine.lastError}</span>
		</div>
	{/if}
	{#if syncEngine.lastNotice}
		<div class="flex items-center justify-center gap-1.5 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white">
			<Info class="h-3.5 w-3.5" />
			<span>{syncEngine.lastNotice}</span>
		</div>
	{/if}
</header>

