import { db } from '../db/index.js';
import type { SyncStatus, Transaction, ActivityLog, Expense } from '../types/index.js';

interface SyncApiResponse {
	success: boolean;
	message?: string;
	syncedAt?: string;
	serverUpdates?: {
		products?: any[];
		users?: any[];
		branches?: any[];
		categories?: any[];
		expenses?: any[];
		stock_movements?: any[];
		shifts?: any[];
		purchases?: any[];
		stock_counts?: any[];
		tax_settings?: any;
	};
}

export class SyncEngine {
	isOnline = $state<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
	isSyncing = $state<boolean>(false);
	lastSyncedAt = $state<string | null>(null);
	pendingCount = $state<number>(0);
	lastError = $state<string | null>(null);

	private syncIntervalTimer: number | null = null;

	constructor() {
		if (typeof window !== 'undefined') {
			this.isOnline = navigator.onLine;
			this.lastSyncedAt = localStorage.getItem('kasir_last_synced_at');

			// Migrasi: pull users lama tidak membawa kolom pin sehingga hash PIN lokal
			// tertimpa hilang. Paksa satu kali full sync agar hash PIN dipulihkan.
			if (!localStorage.getItem('kasir_users_pin_resync_v1')) {
				this.lastSyncedAt = null;
				localStorage.setItem('kasir_users_pin_resync_v1', '1');
			}

			window.addEventListener('online', () => {
				this.isOnline = true;
				this.lastError = null;
				this.triggerSync();
			});

			window.addEventListener('offline', () => {
				this.isOnline = false;
			});

			// Periksa jumlah antrean saat inisialisasi
			this.updatePendingCount();

			// Auto sync setiap 60 detik jika online
			this.syncIntervalTimer = window.setInterval(() => {
				if (this.isOnline && !this.isSyncing) {
					this.triggerSync();
				}
			}, 60000);
		}
	}

	async updatePendingCount(): Promise<number> {
		try {
			const unsyncedTx = await db.transactions.filter(t => !t.synced).count();
			const unsyncedExp = await db.expenses.filter(e => !e.synced).count();
			const unsyncedLogs = await db.activity_logs.filter(l => !l.synced).count();
			const unsyncedMv = await db.stock_movements.filter(m => !m.synced).count();
			const unsyncedShifts = await db.shifts.filter(s => !s.synced).count();
			const unsyncedPo = await db.purchases.filter(p => !p.synced).count();
			const unsyncedSc = await db.stock_counts.filter(s => !s.synced).count();
			const queueCount = await db.sync_queue.where('status').equals('pending').count();
			this.pendingCount = unsyncedTx + unsyncedExp + unsyncedLogs + unsyncedMv + unsyncedShifts + unsyncedPo + unsyncedSc + queueCount;
			return this.pendingCount;
		} catch (e) {
			console.warn('Gagal menghitung antrean sync:', e);
			return 0;
		}
	}

	async triggerSync(): Promise<{ success: boolean; message: string }> {
		if (!this.isOnline) {
			return { success: false, message: 'Perangkat sedang dalam mode offline' };
		}

		if (this.isSyncing) {
			return { success: true, message: 'Sinkronisasi sedang berlangsung...' };
		}

		this.isSyncing = true;
		this.lastError = null;

		try {
			await this.updatePendingCount();

			// 1. Ambil transaksi yang belum tersinkron
			const pendingTransactions = await db.transactions
				.filter(t => !t.synced)
				.toArray();

			// 2. Ambil pengeluaran operasional yang belum tersinkron
			const pendingExpenses = await db.expenses
				.filter(e => !e.synced)
				.toArray();

			// 3. Ambil log aktivitas yang belum tersinkron
			const pendingLogs = await db.activity_logs
				.filter(l => !l.synced)
				.limit(50)
				.toArray();

			// 4. Ambil ledger stok yang belum tersinkron
			const pendingMovements = await db.stock_movements
				.filter(m => !m.synced)
				.limit(100)
				.toArray();

			// 5. Ambil shift kasir yang belum tersinkron
			const pendingShifts = await db.shifts
				.filter(s => !s.synced)
				.toArray();

			// 6. Ambil pembelian stok yang belum tersinkron
			const pendingPurchases = await db.purchases
				.filter(p => !p.synced)
				.toArray();

			// 7. Ambil stok opname yang belum tersinkron
			const pendingStockCounts = await db.stock_counts
				.filter(s => !s.synced)
				.toArray();

			// 8. Ambil antrean perubahan umum (produk, user, expense, void/retur, dll.)
			const queueItems = await db.sync_queue
				.where('status')
				.equals('pending')
				.limit(50)
				.toArray();

			// Payload yang akan dikirim ke server
			const payload = {
				transactions: pendingTransactions,
				expenses: pendingExpenses,
				activity_logs: pendingLogs,
				stock_movements: pendingMovements,
				shifts: pendingShifts,
				purchases: pendingPurchases,
				stock_counts: pendingStockCounts,
				queue: queueItems,
				lastSyncedAt: this.lastSyncedAt
			};

			const response = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (response.status === 401) {
				throw new Error('Sesi tidak valid atau sudah berakhir. Silakan keluar lalu masuk kembali saat perangkat online.');
			}

			if (!response.ok) {
				throw new Error(`Server merespons kode status ${response.status}`);
			}

			const result = (await response.json()) as SyncApiResponse;

			if (result.success) {
				// Tandai transaksi sebagai tersinkron
				if (pendingTransactions.length > 0) {
					for (const tx of pendingTransactions) {
						await db.transactions.update(tx.id, { synced: true });
					}
				}

				// Tandai pengeluaran sebagai tersinkron
				if (pendingExpenses.length > 0) {
					for (const exp of pendingExpenses) {
						await db.expenses.update(exp.id, { synced: true });
					}
				}

				// Tandai activity logs sebagai tersinkron
				if (pendingLogs.length > 0) {
					for (const log of pendingLogs) {
						await db.activity_logs.update(log.id, { synced: true });
					}
				}

				// Tandai ledger stok sebagai tersinkron
				if (pendingMovements.length > 0) {
					for (const mv of pendingMovements) {
						await db.stock_movements.update(mv.id, { synced: true });
					}
				}

				// Tandai shift, pembelian, dan opname sebagai tersinkron
				if (pendingShifts.length > 0) {
					for (const sh of pendingShifts) {
						await db.shifts.update(sh.id, { synced: true });
					}
				}
				if (pendingPurchases.length > 0) {
					for (const po of pendingPurchases) {
						await db.purchases.update(po.id, { synced: true });
					}
				}
				if (pendingStockCounts.length > 0) {
					for (const sc of pendingStockCounts) {
						await db.stock_counts.update(sc.id, { synced: true });
					}
				}

				// Bersihkan queue
				if (queueItems.length > 0) {
					const queueIds = queueItems.map(q => q.id);
					await db.sync_queue.bulkDelete(queueIds);
				}

				// Terapkan data yang ditarik dari server (Pull Updates)
				if (result.serverUpdates) {
					if (result.serverUpdates.products && result.serverUpdates.products.length > 0) {
						await db.products.bulkPut(result.serverUpdates.products);
					}
					if (result.serverUpdates.users && result.serverUpdates.users.length > 0) {
						const serverUsers = result.serverUpdates.users;
						const existingUsers = await db.users.bulkGet(serverUsers.map(u => u.id));
						const mergedUsers = serverUsers.map((u, i) => ({
							...u,
							active: Boolean(u.active),
							pin: u.pin || existingUsers[i]?.pin || ''
						}));
						await db.users.bulkPut(mergedUsers);
					}
					if (result.serverUpdates.branches && result.serverUpdates.branches.length > 0) {
						await db.branches.bulkPut(result.serverUpdates.branches);
					}
					if (result.serverUpdates.tax_settings) {
						await db.app_settings.put({ key: 'tax_settings', value: result.serverUpdates.tax_settings });
					}
					if (result.serverUpdates.expenses && result.serverUpdates.expenses.length > 0) {
						const formattedExpenses = result.serverUpdates.expenses.map(e => ({
							...e,
							synced: true
						}));
						await db.expenses.bulkPut(formattedExpenses);
					}
					if (result.serverUpdates.stock_movements && result.serverUpdates.stock_movements.length > 0) {
						const formattedMovements = result.serverUpdates.stock_movements.map(m => ({
							...m,
							synced: true
						}));
						await db.stock_movements.bulkPut(formattedMovements);
					}
					if (result.serverUpdates.shifts && result.serverUpdates.shifts.length > 0) {
						const formattedShifts = result.serverUpdates.shifts.map(s => ({
							...s,
							synced: true
						}));
						await db.shifts.bulkPut(formattedShifts);
					}
					if (result.serverUpdates.purchases && result.serverUpdates.purchases.length > 0) {
						const formattedPurchases = result.serverUpdates.purchases.map(p => ({
							...p,
							synced: true
						}));
						await db.purchases.bulkPut(formattedPurchases);
					}
					if (result.serverUpdates.stock_counts && result.serverUpdates.stock_counts.length > 0) {
						const formattedCounts = result.serverUpdates.stock_counts.map(s => ({
							...s,
							synced: true
						}));
						await db.stock_counts.bulkPut(formattedCounts);
					}
				}

				// Gunakan waktu server agar delta pull tidak terpengaruh selisih jam perangkat
				this.lastSyncedAt = result.syncedAt || new Date().toISOString();
				localStorage.setItem('kasir_last_synced_at', this.lastSyncedAt);
				await this.updatePendingCount();
				this.isSyncing = false;
				return { success: true, message: 'Sinkronisasi berhasil!' };
			} else {
				throw new Error(result.message || 'Gagal menyinkronkan data');
			}
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : 'Kesalahan jaringan atau server';
			this.lastError = msg;
			this.isSyncing = false;
			await this.updatePendingCount();
			return { success: false, message: msg };
		}
	}
}

export const syncEngine = new SyncEngine();

