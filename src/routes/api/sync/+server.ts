import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// In-memory mock store untuk sinkronisasi server saat D1 binding belum dikonfigurasi secara remote
interface ServerStore {
	transactions: any[];
	activityLogs: any[];
	products: any[];
	users: any[];
}

const globalStore: ServerStore = {
	transactions: [],
	activityLogs: [],
	products: [],
	users: []
};

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const payload = (await request.json()) as any;
		const { transactions = [], activity_logs = [], queue = [] } = payload || {};

		// Jika Cloudflare D1 terpasang di platform.env.DB
		// Kita dapat mengeksekusi batch query ke SQLite Cloudflare
		const d1 = (platform?.env as any)?.DB;

		if (d1) {
			const statements: any[] = [];

			// Simpan transaksi
			for (const tx of transactions) {
				statements.push(
					d1.prepare(`
						INSERT INTO transactions (id, invoice_no, branch_id, branch_name, cashier_id, cashier_name, customer_name, subtotal, discount, tax, total, payment_method, amount_paid, change, status, created_at, updated_at)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET
							status = excluded.status,
							updated_at = excluded.updated_at
					`).bind(
						tx.id, tx.invoice_no, tx.branch_id, tx.branch_name, tx.cashier_id,
						tx.cashier_name, tx.customer_name || '', tx.subtotal, tx.discount,
						tx.tax, tx.total, tx.payment_method, tx.amount_paid, tx.change,
						tx.status, tx.created_at, tx.updated_at
					)
				);

				if (tx.items && tx.items.length > 0) {
					for (const item of tx.items) {
						statements.push(
							d1.prepare(`
								INSERT INTO transaction_items (id, transaction_id, product_id, product_name, price, cost_price, quantity, subtotal, notes)
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
								ON CONFLICT(id) DO NOTHING
							`).bind(
								item.id, tx.id, item.product_id, item.product_name,
								item.price, item.cost_price, item.quantity, item.subtotal, item.notes || ''
							)
						);
					}
				}
			}

			// Simpan log aktivitas
			for (const log of activity_logs) {
				statements.push(
					d1.prepare(`
						INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO NOTHING
					`).bind(
						log.id, log.branch_id, log.branch_name || '', log.user_id,
						log.user_name, log.role, log.action, log.details, log.timestamp
					)
				);
			}

			if (statements.length > 0) {
				await d1.batch(statements);
			}
		} else {
			// Simpan di memori untuk simulasi lokal / testing
			if (transactions.length > 0) {
				for (const tx of transactions) {
					const idx = globalStore.transactions.findIndex(t => t.id === tx.id);
					if (idx >= 0) {
						globalStore.transactions[idx] = tx;
					} else {
						globalStore.transactions.push(tx);
					}
				}
			}

			if (activity_logs.length > 0) {
				for (const log of activity_logs) {
					if (!globalStore.activityLogs.some(l => l.id === log.id)) {
						globalStore.activityLogs.push(log);
					}
				}
			}
		}

		return json({
			success: true,
			message: `Sinkronisasi berhasil: ${transactions.length} transaksi, ${activity_logs.length} log aktivitas.`,
			syncedAt: new Date().toISOString(),
			serverUpdates: {
				products: [],
				users: []
			}
		});
	} catch (error: any) {
		console.error('Error saat sinkronisasi server:', error);
		return json(
			{
				success: false,
				message: error.message || 'Gagal memproses sinkronisasi di server'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ platform }) => {
	// Endpoint untuk admin memantau aktivitas server & statistik transaksi
	const d1 = (platform?.env as any)?.DB;

	if (d1) {
		try {
			const recentLogs = await d1.prepare(`
				SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 50
			`).all();

			const txSummary = await d1.prepare(`
				SELECT 
					COUNT(*) as total_transactions,
					COALESCE(SUM(total), 0) as total_revenue,
					branch_id, branch_name
				FROM transactions
				WHERE status = 'completed'
				GROUP BY branch_id
			`).all();

			return json({
				success: true,
				activityLogs: recentLogs.results || [],
				branchSummaries: txSummary.results || []
			});
		} catch (e: any) {
			return json({ success: false, message: e.message }, { status: 500 });
		}
	}

	return json({
		success: true,
		activityLogs: globalStore.activityLogs.slice(-50).reverse(),
		branchSummaries: []
	});
};
