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
	import AdminPaymentSettings from '../lib/components/AdminPaymentSettings.svelte';
	import AdminDashboard from '../lib/components/AdminDashboard.svelte';
	import AdminCategories from '../lib/components/AdminCategories.svelte';

	let activeTab = $state<string>('pos');

	$effect(() => {
		if (authState.user) {
			if (authState.user.role === 'admin' && (activeTab === 'pos' || activeTab === 'products' || activeTab === 'history' || activeTab === 'shift' || activeTab === 'purchases' || activeTab === 'opname')) {
				activeTab = 'dashboard';
			} else if (authState.user.role === 'cashier' && (activeTab === 'users' || activeTab === 'branches' || activeTab === 'monitoring' || activeTab === 'dashboard' || activeTab === 'categories' || activeTab === 'payment')) {
				activeTab = 'pos';
			}
		}
	});

	function handleTabChange(tab: string) {
		activeTab = tab;
	}
</script>

{#if authState.isLoading}
	<div class="flex h-screen w-full items-center justify-center bg-slate-900 text-white">
		<div class="flex flex-col items-center gap-3">
			<div class="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
			<p class="text-sm font-semibold tracking-wide text-slate-300">Memuat Sistem Kasir Modern...</p>
		</div>
	</div>
{:else if !authState.user}
	<LoginScreen />
{:else}
	<!-- Layout Dua Kolom: Sidebar Navigasi di Kiri & Konten Utama di Kanan -->
	<div class="min-h-screen flex flex-col lg:flex-row bg-zinc-100/70">
		<!-- Sidebar Navigasi Responsif -->
		<Sidebar {activeTab} onTabChange={handleTabChange} />

		<!-- Area Konten Utama -->
		<main class="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
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
					<AdminPaymentSettings />
				{:else if activeTab === 'tax'}
					<AdminTaxSettings />
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
					<AdminPaymentSettings />
				{:else if activeTab === 'tax'}
					<AdminTaxSettings />
				{/if}
			{/if}
		</main>
	</div>
{/if}
