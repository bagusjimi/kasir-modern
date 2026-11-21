<script lang="ts">
	import { authState } from '../lib/stores/auth.svelte.js';
	import Sidebar from '../lib/components/Sidebar.svelte';
	import LoginScreen from '../lib/components/LoginScreen.svelte';
	import CashierPOS from '../lib/components/CashierPOS.svelte';
	import CashierProducts from '../lib/components/CashierProducts.svelte';
	import CashierHistory from '../lib/components/CashierHistory.svelte';
	import CashierShift from '../lib/components/CashierShift.svelte';
	import CashierPurchases from '../lib/components/CashierPurchases.svelte';
	import CashierStockOpname from '../lib/components/CashierStockOpname.svelte';
	import CashierTransfers from '../lib/components/CashierTransfers.svelte';
	import AdminUsers from '../lib/components/AdminUsers.svelte';
	import AdminBranches from '../lib/components/AdminBranches.svelte';
	import AdminMonitoring from '../lib/components/AdminMonitoring.svelte';
	import ComprehensiveReport from '../lib/components/ComprehensiveReport.svelte';
	import ExpenseManagement from '../lib/components/ExpenseManagement.svelte';
	import AdminTaxSettings from '../lib/components/AdminTaxSettings.svelte';
	import PaymentSettings from '../lib/components/PaymentSettings.svelte';
	import AdminDashboard from '../lib/components/AdminDashboard.svelte';
	import AdminCategories from '../lib/components/AdminCategories.svelte';
	import AdminAnnouncements from '../lib/components/AdminAnnouncements.svelte';
	import CashierAnnouncements from '../lib/components/CashierAnnouncements.svelte';
	import AdminBackup from '../lib/components/AdminBackup.svelte';
	import OperatorLock from '../lib/components/OperatorLock.svelte';

	let activeTab = $state<string>('pos');

	$effect(() => {
		if (authState.user) {
			if (authState.user.role === 'admin' && (activeTab === 'pos' || activeTab === 'products' || activeTab === 'history' || activeTab === 'shift' || activeTab === 'purchases' || activeTab === 'opname')) {
				activeTab = 'dashboard';
			} else if (authState.user.role === 'cashier' && (activeTab === 'users' || activeTab === 'branches' || activeTab === 'monitoring' || activeTab === 'dashboard' || activeTab === 'categories')) {
				activeTab = 'pos';
			}
		}
	});

	function handleTabChange(tab: string) {
		activeTab = tab;
	}
</script>

{#if authState.isLoading}
	<div class="flex h-screen w-full flex-col items-center justify-center bg-gray-950">
		<div class="stamp flex h-14 w-14 items-center justify-center text-gray-100">
			<span class="font-display text-xl font-semibold">KM</span>
		</div>
		<p class="mt-6 font-display text-lg font-semibold tracking-tight text-gray-100">Kasir Modern</p>
		<p class="eyebrow mt-1 text-[9px] text-gray-500">Membuka buku kas</p>
		<div class="mt-6 h-px w-40 overflow-hidden bg-gray-100/10">
			<div class="h-px w-1/2 animate-pulse bg-rose-500"></div>
		</div>
	</div>
{:else if !authState.user}
	<LoginScreen />
{:else if authState.mode === 'cashier' && !authState.operator}
	<!-- Perangkat sudah terikat cabang, tetapi belum ada operator pemegang laci -->
	<OperatorLock />
{:else}
	<!-- Layout Dua Kolom: Sidebar Navigasi di Kiri & Konten Utama di Kanan -->
	<div class="flex min-h-screen flex-col lg:flex-row">
		<!-- Sidebar Navigasi Responsif -->
		<Sidebar {activeTab} onTabChange={handleTabChange} />

		<!-- Area Konten Utama -->
		<main class="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
			{#if authState.user.role === 'cashier'}
				{#if activeTab === 'pos'}
					<CashierPOS />
				{:else if activeTab === 'products'}
					<CashierProducts />
				{:else if activeTab === 'history'}
					<CashierHistory />
				{:else if activeTab === 'shift'}
					<CashierShift />
				{:else if activeTab === 'purchases'}
					<CashierPurchases />
				{:else if activeTab === 'opname'}
					<CashierStockOpname />
				{:else if activeTab === 'transfers'}
					<CashierTransfers />
				{:else if activeTab === 'expenses'}
					<ExpenseManagement />
				{:else if activeTab === 'reports'}
					<ComprehensiveReport />
				{:else if activeTab === 'payment'}
					<PaymentSettings />
				{:else if activeTab === 'tax'}
					<AdminTaxSettings />
				{:else if activeTab === 'announcements'}
					<CashierAnnouncements />
				{/if}
			{:else if authState.user.role === 'admin'}
				{#if activeTab === 'dashboard'}
					<AdminDashboard />
				{:else if activeTab === 'users'}
					<AdminUsers />
				{:else if activeTab === 'categories'}
					<AdminCategories />
				{:else if activeTab === 'transfers'}
					<CashierTransfers />
				{:else if activeTab === 'branches'}
					<AdminBranches />
				{:else if activeTab === 'monitoring'}
					<AdminMonitoring />
				{:else if activeTab === 'expenses'}
					<ExpenseManagement />
				{:else if activeTab === 'reports'}
					<ComprehensiveReport />
				{:else if activeTab === 'payment'}
					<PaymentSettings />
				{:else if activeTab === 'tax'}
					<AdminTaxSettings />
				{:else if activeTab === 'announcements'}
					<AdminAnnouncements />
				{:else if activeTab === 'backup'}
					<AdminBackup />
				{/if}
			{/if}
		</main>
	</div>
{/if}
