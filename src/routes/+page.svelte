<script lang="ts">
	import { authState } from '../lib/stores/auth.svelte.js';
	import Sidebar from '../lib/components/Sidebar.svelte';
	import LoginScreen from '../lib/components/LoginScreen.svelte';
	import CashierPOS from '../lib/components/CashierPOS.svelte';
	import CashierProducts from '../lib/components/CashierProducts.svelte';
	import CashierHistory from '../lib/components/CashierHistory.svelte';
	import AdminUsers from '../lib/components/AdminUsers.svelte';
	import AdminMonitoring from '../lib/components/AdminMonitoring.svelte';
	import ComprehensiveReport from '../lib/components/ComprehensiveReport.svelte';
	import ExpenseManagement from '../lib/components/ExpenseManagement.svelte';

	let activeTab = $state<string>('pos');

	$effect(() => {
		if (authState.user) {
			if (authState.user.role === 'admin' && (activeTab === 'pos' || activeTab === 'products' || activeTab === 'history')) {
				activeTab = 'users';
			} else if (authState.user.role === 'cashier' && (activeTab === 'users' || activeTab === 'monitoring')) {
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
		<main class="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto overflow-y-auto">
			{#if authState.user.role === 'cashier'}
				{#if activeTab === 'pos'}
					<CashierPOS />
				{:else if activeTab === 'products'}
					<CashierProducts />
				{:else if activeTab === 'history'}
					<CashierHistory />
				{:else if activeTab === 'expenses'}
					<ExpenseManagement />
				{:else if activeTab === 'reports'}
					<ComprehensiveReport />
				{/if}
			{:else if authState.user.role === 'admin'}
				{#if activeTab === 'users'}
					<AdminUsers />
				{:else if activeTab === 'monitoring'}
					<AdminMonitoring />
				{:else if activeTab === 'expenses'}
					<ExpenseManagement />
				{:else if activeTab === 'reports'}
					<ComprehensiveReport />
				{/if}
			{/if}
		</main>
	</div>
{/if}
