<script lang="ts">
        import { onMount } from 'svelte';
        import { authState } from '../stores/auth.svelte.js';
        import { syncEngine } from '../sync/index.js';
        import { announcementStore } from '../stores/announcements.svelte.js';
        import InstallPrompt from './InstallPrompt.svelte';
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
                AlertTriangle,
                Info,
                Menu,
                X,
                Clock,
                Truck,
                ClipboardList,
                LayoutDashboard,
                Tags,
                ArrowLeftRight,
                Wallet,
                Megaphone,
                DatabaseBackup
        } from 'lucide-svelte';

        interface Props {
                activeTab: string;
                onTabChange: (tab: string) => void;
        }

        let { activeTab, onTabChange }: Props = $props();

        type NavItem = { id: string; label: string; icon: typeof Store };
        type NavGroup = { label: string; items: NavItem[] };

        const cashierNav: NavGroup[] = [
                {
                        label: 'Operasional',
                        items: [
                                { id: 'pos', label: 'Kasir (POS)', icon: ShoppingCart },
                                { id: 'products', label: 'Produk & Inventaris', icon: Package },
                                { id: 'history', label: 'Riwayat Transaksi', icon: Receipt },
                                { id: 'shift', label: 'Shift Kasir', icon: Clock }
                        ]
                },
                {
                        label: 'Persediaan',
                        items: [
                                { id: 'purchases', label: 'Pembelian Stok', icon: Truck },
                                { id: 'opname', label: 'Stok Opname', icon: ClipboardList },
                                { id: 'transfers', label: 'Transfer Stok', icon: ArrowLeftRight }
                        ]
                },
                {
                        label: 'Keuangan & Lainnya',
                        items: [
                                { id: 'expenses', label: 'Pengeluaran Toko', icon: ReceiptText },
                                { id: 'reports', label: 'Laporan Finansial', icon: BarChart3 },
                                { id: 'payment', label: 'Metode Pembayaran', icon: Wallet },
                                { id: 'announcements', label: 'Info Internal', icon: Megaphone }
                        ]
                }
        ];

        const adminNav: NavGroup[] = [
                {
                        label: 'Ringkasan',
                        items: [
                                { id: 'dashboard', label: 'Beranda', icon: LayoutDashboard },
                                { id: 'monitoring', label: 'Pemantauan Kasir', icon: Activity }
                        ]
                },
                {
                        label: 'Kelola Toko',
                        items: [
                                { id: 'users', label: 'Kelola Pengguna', icon: Users },
                                { id: 'branches', label: 'Kelola Cabang', icon: Building2 },
                                { id: 'categories', label: 'Kategori', icon: Tags }
                        ]
                },
                {
                        label: 'Persediaan',
                        items: [
                                { id: 'transfers', label: 'Transfer Stok', icon: ArrowLeftRight },
                                { id: 'expenses', label: 'Pengeluaran Toko', icon: ReceiptText }
                        ]
                },
                {
                        label: 'Laporan & Pengaturan',
                        items: [
                                { id: 'reports', label: 'Laporan Komprehensif', icon: BarChart3 },
                                { id: 'payment', label: 'Metode Pembayaran', icon: Wallet },
                                { id: 'tax', label: 'Pengaturan Usaha', icon: Receipt },
                                { id: 'backup', label: 'Backup & Ekspor', icon: DatabaseBackup },
                                { id: 'announcements', label: 'Info Internal', icon: Megaphone }
                        ]
                }
        ];

        const navGroups = $derived(authState.user?.role === 'admin' ? adminNav : cashierNav);

        // State untuk membuka/menutup drawer menu di tampilan layar seluler (mobile)
        let isMobileOpen = $state<boolean>(false);
        let syncMessage = $state<string | null>(null);
        let logoutNotice = $state<string | null>(null);

        /**
         * Tombol keluar di sidebar.
         * - Mode admin: keluar dari mode admin (perangkat tetap terikat cabang).
         * - Ada shift terbuka: JANGAN lepas perangkat (shift jadi yatim & Z-Report hilang);
         *   arahkan ke menu Shift untuk menutup shift lebih dulu.
         * - Tidak ada operator: lepas perangkat dari cabang, dengan konfirmasi.
         */
        function handleLogoutClick() {
                if (authState.mode === 'admin') {
                        authState.exitAdmin();
                        return;
                }
                if (authState.operator) {
                        selectTab('shift');
                        logoutNotice = 'Tutup shift (Z-Report) dulu sebelum melepas perangkat dari cabang.';
                        setTimeout(() => (logoutNotice = null), 6000);
                        return;
                }
                if (confirm('Lepas perangkat ini dari cabang? Anda perlu menginisialisasi ulang perangkat untuk memakainya lagi.')) {
                        authState.logout();
                }
        }

        onMount(() => {
                refreshAnnouncements();
                // Muat ulang daftar pengumuman secara berkala agar badge info internal tetap akurat
                const timer = setInterval(() => {
                        refreshAnnouncements();
                }, 30000);
                return () => clearInterval(timer);
        });

        async function refreshAnnouncements() {
                await announcementStore.load(authState.user?.id);
        }

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
<header class="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-gray-100/10 bg-gray-950 px-4 lg:hidden">
        <div class="flex items-center gap-3">
                <button
                        onclick={() => (isMobileOpen = !isMobileOpen)}
                        class="flex h-9 w-9 items-center justify-center rounded-md border border-gray-100/15 text-gray-300 transition hover:bg-white/5 active:scale-95 cursor-pointer"
                        aria-label="Buka atau Tutup Menu"
                >
                        {#if isMobileOpen}
                                <X class="h-5 w-5" />
                        {:else}
                                <Menu class="h-5 w-5" />
                        {/if}
                </button>

                <div class="flex items-center gap-2.5">
                        <div class="flex h-8 w-8 items-center justify-center rounded-sm border border-gray-100/25 text-gray-100">
                                <Store class="h-4 w-4" />
                        </div>
                        <div class="leading-tight">
                                <p class="font-display text-sm font-semibold tracking-tight text-gray-50">Kasir Modern</p>
                                <p class="max-w-[150px] truncate text-[10px] text-gray-500">
                                        {authState.branch?.name || (authState.user?.role === 'admin' ? 'Monitoring Pusat' : 'Cabang')}
                                </p>
                        </div>
                </div>
        </div>

        <div class="flex items-center gap-2">
                {#if syncEngine.isOnline}
                        <span class="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-emerald-300" title="Terhubung ke jaringan">
                                <Wifi class="h-3 w-3" />
                        </span>
                {:else}
                        <span class="inline-flex animate-pulse items-center rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-rose-300" title="Tidak terhubung ke jaringan">
                                <WifiOff class="h-3 w-3" />
                        </span>
                {/if}

                <button
                        onclick={handleSyncNow}
                        disabled={!syncEngine.isOnline || syncEngine.isSyncing}
                        class="relative flex h-8 w-8 items-center justify-center rounded-md border border-gray-100/15 text-gray-300 transition hover:bg-white/5 disabled:opacity-40 cursor-pointer"
                        title="Sinkronkan data"
                >
                        <RefreshCw class="h-3.5 w-3.5 {syncEngine.isSyncing ? 'animate-spin text-emerald-300' : ''}" />
                        {#if syncEngine.pendingCount > 0}
                                <span class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
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
                class="fixed inset-0 z-40 bg-gray-950/50 backdrop-blur-xs lg:hidden"
                role="presentation"
        ></div>
{/if}

<!-- ========================================================================= -->
<!-- SIDEBAR: punggung buku kas (tinta pekat, penanda vermilion)               -->
<!-- Desktop: kolom tetap · Mobile: laci geser                                 -->
<!-- ========================================================================= -->
<aside
        class="fixed inset-y-0 left-0 z-50 flex w-[17.5rem] shrink-0 flex-col border-r border-gray-950/40 bg-gray-950 text-gray-400 transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:self-start lg:translate-x-0 {isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}"
>
        <div
                class="pointer-events-none absolute inset-0 opacity-50"
                style="background-image: radial-gradient(420px 220px at 50% -10%, rgba(31,78,62,0.35), transparent 70%);"
        ></div>

        <!-- Identitas & cabang -->
        <div class="relative border-b border-gray-100/10 px-5 py-5">
                <div class="flex items-start justify-between gap-2">
                        <div class="flex items-center gap-3">
                                <div class="stamp flex h-10 w-10 items-center justify-center text-gray-100">
                                        <Store class="h-5 w-5" />
                                </div>
                                <div class="leading-tight">
                                        <p class="font-display text-base font-semibold tracking-tight text-gray-50">Kasir Modern</p>
                                        <p class="eyebrow text-[9px] text-gray-500">
                                                {authState.user?.role === 'admin' ? 'Admin Pusat' : 'Operator Toko'}
                                        </p>
                                </div>
                        </div>
                        <button
                                onclick={() => (isMobileOpen = false)}
                                class="rounded-md p-1.5 text-gray-500 transition hover:bg-white/5 hover:text-gray-200 lg:hidden cursor-pointer"
                                aria-label="Tutup Menu"
                        >
                                <X class="h-5 w-5" />
                        </button>
                </div>

                <div class="mt-4 border border-dashed border-gray-100/15 px-3 py-2.5">
                        <div class="flex items-center gap-2 text-xs font-semibold text-gray-200">
                                <Building2 class="h-3.5 w-3.5 shrink-0 text-gray-500" />
                                <span class="truncate">
                                        {authState.branch?.name || (authState.user?.role === 'admin' ? 'Semua Cabang Toko' : '-')}
                                </span>
                        </div>
                        <div class="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
                                {#if authState.branch?.code}
                                        <span>{authState.branch.code}</span>
                                        <span class="text-gray-700">/</span>
                                {/if}
                                {#if authState.device}
                                        <span class="truncate" title="Perangkat/terminal">{authState.device.name}</span>
                                {:else}
                                        <span class="text-emerald-400">Siap beroperasi</span>
                                {/if}
                        </div>
                </div>
        </div>

        <!-- Navigasi -->
        <nav class="relative flex-1 overflow-y-auto px-3 py-4">
                {#each navGroups as group (group.label)}
                        <div class="mb-5">
                                <p class="eyebrow mb-1.5 px-2 text-[9px] text-gray-600">{group.label}</p>
                                <div class="space-y-0.5">
                                        {#each group.items as item (item.id)}
                                                {@const isActive = activeTab === item.id}
                                                <button
                                                        onclick={() => selectTab(item.id)}
                                                        aria-current={isActive ? 'page' : undefined}
                                                        class="group relative flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left text-[13px] transition {isActive ? 'bg-white/[0.07] font-semibold text-gray-50' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'}"
                                                >
                                                        <span
                                                                class="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-rose-500 transition-opacity {isActive ? 'opacity-100' : 'opacity-0'}"
                                                        ></span>
                                                        <item.icon class="h-4 w-4 shrink-0 {isActive ? 'text-emerald-300' : 'text-gray-500 group-hover:text-gray-300'}" />
                                                        <span class="flex-1 truncate">{item.label}</span>
                                                        {#if item.id === 'announcements' && announcementStore.unreadCount > 0 && !isActive}
                                                                <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                                                                        {announcementStore.unreadCount}
                                                                </span>
                                                        {/if}
                                                </button>
                                        {/each}
                                </div>
                        </div>
                {/each}
        </nav>

        <!-- Koneksi & sinkronisasi -->
        <div class="relative border-t border-gray-100/10 px-4 py-4">
                <div class="mb-2 flex items-center justify-between">
                        <p class="eyebrow text-[9px] text-gray-600">Sinkronisasi</p>
                        {#if syncEngine.isOnline}
                                <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                                        <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Terhubung
                                </span>
                        {:else}
                                <span class="inline-flex animate-pulse items-center gap-1 text-[10px] font-semibold text-rose-400">
                                        <span class="h-1.5 w-1.5 rounded-full bg-rose-400"></span> Terputus
                                </span>
                        {/if}
                </div>

                <button
                        onclick={handleSyncNow}
                        disabled={!syncEngine.isOnline || syncEngine.isSyncing}
                        class="flex w-full items-center justify-center gap-2 rounded-sm border border-gray-100/15 px-3 py-2 text-[11px] font-semibold text-gray-300 transition hover:border-gray-100/25 hover:bg-white/5 disabled:opacity-40 cursor-pointer"
                >
                        <RefreshCw class="h-3.5 w-3.5 {syncEngine.isSyncing ? 'animate-spin text-emerald-300' : ''}" />
                        <span>{syncEngine.isSyncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}</span>
                        {#if syncEngine.pendingCount > 0}
                                <span class="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                                        {syncEngine.pendingCount}
                                </span>
                        {/if}
                </button>

                {#if syncMessage}
                        <p class="mt-2 text-center text-[10px] font-medium text-emerald-400">{syncMessage}</p>
                {/if}
                {#if syncEngine.lastError}
                        <div class="mt-2 flex items-center gap-1 text-[10px] text-rose-400">
                                <AlertTriangle class="h-3 w-3 shrink-0" />
                                <span class="truncate">{syncEngine.lastError}</span>
                        </div>
                {/if}
                {#if syncEngine.lastNotice}
                        <div class="mt-2 flex items-center gap-1 text-[10px] text-amber-400">
                                <Info class="h-3 w-3 shrink-0" />
                                <span class="truncate">{syncEngine.lastNotice}</span>
                        </div>
                {/if}

                <div class="mt-3">
                        <InstallPrompt />
                </div>
        </div>

        <!-- Pengguna -->
        <div class="relative border-t border-gray-100/10 bg-black/20 px-4 py-3.5">
                <div class="flex items-center justify-between gap-2">
                        <div class="flex min-w-0 items-center gap-3">
                                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-gray-100/20 font-display text-xs font-semibold uppercase text-gray-200">
                                        {authState.user?.name ? authState.user.name.slice(0, 2) : 'US'}
                                </div>
                                <div class="min-w-0 leading-tight">
                                        <p class="truncate text-xs font-semibold text-gray-100">{authState.user?.name}</p>
                                        <p class="text-[10px] text-gray-500">
                                                {authState.mode === 'admin' ? 'Admin' : authState.operator ? 'Operator Kasir' : 'Belum ada operator'}
                                        </p>
                                </div>
                        </div>

                        <button
                                onclick={handleLogoutClick}
                                class="rounded-md p-2 text-gray-500 transition hover:bg-rose-500/10 hover:text-rose-400 cursor-pointer"
                                title={authState.mode === 'admin'
                                        ? 'Keluar dari mode Admin'
                                        : authState.operator
                                                ? 'Tutup shift dulu sebelum melepas perangkat'
                                                : 'Lepas Perangkat dari Cabang'}
                                aria-label="Keluar"
                        >
                                <LogOut class="h-4 w-4" />
                        </button>
                </div>
                {#if logoutNotice}
                        <p class="mt-2 text-[10px] leading-snug text-amber-400">{logoutNotice}</p>
                {/if}
        </div>
</aside>
