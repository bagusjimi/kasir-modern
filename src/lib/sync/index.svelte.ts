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
			const queueCount = await db.sync_queue.where('status').equals('pending').count();
			this.pendingCount = unsyncedTx + unsyncedExp + unsyncedLogs + queueCount;
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

			// 4. Ambil antrean perubahan umum (produk, user, expense delete, dll.)
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
				queue: queueItems,
				lastSyncedAt: this.lastSyncedAt
			};

			const response = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

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
						await db.users.bulkPut(result.serverUpdates.users);
					}
					if (result.serverUpdates.branches && result.serverUpdates.branches.length > 0) {
						await db.branches.bulkPut(result.serverUpdates.branches);
					}
					if (result.serverUpdates.expenses && result.serverUpdates.expenses.length > 0) {
						const formattedExpenses = result.serverUpdates.expenses.map(e => ({
							...e,
							synced: true
						}));
						await db.expenses.bulkPut(formattedExpenses);
					}
				}

				this.lastSyncedAt = new Date().toISOString();
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

