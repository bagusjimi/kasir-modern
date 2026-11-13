import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { getSession, unauthorized } from '#lib/server/auth.js';
import { hashPin, isHashedPin } from '#lib/auth/pin.js';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const payload = (await request.json()) as any;
		const { transactions = [], activity_logs = [], expenses = [], queue = [], lastSyncedAt = null } = payload || {};

		const statements: any[] = [];
		const now = new Date().toISOString();

		// 0. Sinkronisasi Pengeluaran (Expenses)
		for (const exp of expenses) {
			statements.push(
				d1.prepare(`
					INSERT INTO expenses (id, branch_id, branch_name, user_id, user_name, category, amount, description, recipient, receipt_number, date, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO UPDATE SET
						branch_id = excluded.branch_id,
						branch_name = excluded.branch_name,
						category = excluded.category,
						amount = excluded.amount,
						description = excluded.description,
						recipient = excluded.recipient,
						receipt_number = excluded.receipt_number,
						date = excluded.date,
						updated_at = excluded.updated_at
				`).bind(
					exp.id, exp.branch_id, exp.branch_name || '', exp.user_id,
					exp.user_name, exp.category, Number(exp.amount), exp.description,
					exp.recipient || '', exp.receipt_number || '', exp.date,
					exp.created_at || now, exp.updated_at || now
				)
			);
		}

		// 1. Sinkronisasi Transaksi (stok hanya dikurangi untuk transaksi yang benar-benar baru)
		const existingTxIds = new Set<string>();
		if (transactions.length > 0) {
			const txIdPlaceholders = transactions.map(() => '?').join(',');
			const existingRes = await d1
				.prepare(`SELECT id FROM transactions WHERE id IN (${txIdPlaceholders})`)
				.bind(...transactions.map((t: any) => t.id))
				.all();
			for (const row of existingRes.results || []) {
				existingTxIds.add((row as any).id);
			}
		}

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
					tx.cashier_name, tx.customer_name || '', tx.subtotal, tx.discount || 0,
					tx.tax || 0, tx.total, tx.payment_method, tx.amount_paid, tx.change || 0,
					tx.status || 'completed', tx.created_at || now, tx.updated_at || now
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
							item.price, item.cost_price || 0, item.quantity, item.subtotal, item.notes || ''
						)
					);

					// Kurangi stok di D1 hanya jika transaksi benar-benar baru (idempoten)
					if (item.product_id && !existingTxIds.has(tx.id)) {
						statements.push(
							d1.prepare(`
								UPDATE products
								SET stock = MAX(0, stock - ?),
								    version = version + 1,
								    updated_at = ?
								WHERE id = ?
							`).bind(item.quantity, now, item.product_id)
						);
					}
				}
			}
		}

		// 2. Sinkronisasi Antrean Umum (Produk & User perubahan offline)
		for (const q of queue) {
			if (q.entity === 'product') {
				const p = q.data;
				if (q.action === 'insert' || q.action === 'update') {
					statements.push(
						d1.prepare(`
							INSERT INTO products (id, branch_id, sku, barcode, name, category, price, cost_price, stock, unit, image_url, is_active, version, created_at, updated_at)
							VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
							ON CONFLICT(id) DO UPDATE SET
								name = excluded.name,
								category = excluded.category,
								sku = excluded.sku,
								price = excluded.price,
								cost_price = excluded.cost_price,
								stock = excluded.stock,
								unit = excluded.unit,
								is_active = excluded.is_active,
								version = excluded.version,
								updated_at = excluded.updated_at
							WHERE excluded.version >= products.version
						`).bind(
							p.id, p.branch_id || 'all', p.sku, p.barcode || '', p.name,
							p.category, p.price, p.cost_price || 0, p.stock || 0, p.unit || 'pcs',
							p.image_url || '', p.is_active !== undefined ? (p.is_active ? 1 : 0) : 1,
							p.version || 1, p.created_at || now, p.updated_at || now
						)
					);
				} else if (q.action === 'delete') {
					statements.push(
						d1.prepare('DELETE FROM products WHERE id = ?').bind(p.id)
					);
				}
			} else if (q.entity === 'user') {
				const u = q.data;
				if (q.action === 'insert' || q.action === 'update') {
					const pinHash = u.pin && !isHashedPin(u.pin) ? await hashPin(u.pin) : (u.pin || '');
					statements.push(
						d1.prepare(`
							INSERT INTO users (id, username, name, role, branch_id, pin, active, created_at, updated_at)
							VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
							ON CONFLICT(id) DO UPDATE SET
								name = excluded.name,
								role = excluded.role,
								branch_id = excluded.branch_id,
								pin = excluded.pin,
								active = excluded.active,
								updated_at = excluded.updated_at
						`).bind(
							u.id, u.username, u.name, u.role, u.branch_id, pinHash,
							u.active !== undefined ? (u.active ? 1 : 0) : 1,
							u.created_at || now, u.updated_at || now
						)
					);
				} else if (q.action === 'delete') {
					statements.push(
						d1.prepare('DELETE FROM users WHERE id = ?').bind(u.id)
					);
				}
			} else if (q.entity === 'expense') {
				const exp = q.data;
				if (q.action === 'insert' || q.action === 'update') {
					statements.push(
						d1.prepare(`
							INSERT INTO expenses (id, branch_id, branch_name, user_id, user_name, category, amount, description, recipient, receipt_number, date, created_at, updated_at)
							VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
							ON CONFLICT(id) DO UPDATE SET
								branch_id = excluded.branch_id,
								branch_name = excluded.branch_name,
								category = excluded.category,
								amount = excluded.amount,
								description = excluded.description,
								recipient = excluded.recipient,
								receipt_number = excluded.receipt_number,
								date = excluded.date,
								updated_at = excluded.updated_at
						`).bind(
							exp.id, exp.branch_id, exp.branch_name || '', exp.user_id,
							exp.user_name, exp.category, Number(exp.amount), exp.description,
							exp.recipient || '', exp.receipt_number || '', exp.date,
							exp.created_at || now, exp.updated_at || now
						)
					);
				} else if (q.action === 'delete') {
					statements.push(
						d1.prepare('DELETE FROM expenses WHERE id = ?').bind(exp.id)
					);
				}
			}
		}

		// 3. Sinkronisasi Activity Logs
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

		// 4. Tarik Pembaruan dari D1 Server (Pull delta changes)
		let updatedProducts: any[] = [];
		let updatedUsers: any[] = [];
		let updatedExpenses: any[] = [];
		let branches: any[] = [];
		let categories: any[] = [];

		if (lastSyncedAt) {
			const prodRes = await d1.prepare('SELECT * FROM products WHERE updated_at >= ?').bind(lastSyncedAt).all();
			updatedProducts = prodRes.results || [];

			const userRes = await d1.prepare('SELECT id, username, name, role, branch_id, active, created_at, updated_at FROM users WHERE updated_at >= ?').bind(lastSyncedAt).all();
			updatedUsers = (userRes.results || []).map((u: any) => ({
				...u,
				active: Boolean(u.active)
			}));

			const expRes = await d1.prepare('SELECT * FROM expenses WHERE updated_at >= ?').bind(lastSyncedAt).all();
			updatedExpenses = expRes.results || [];
		} else {
			// Jika first sync, kirimkan semua master data
			const [prodRes, userRes, branchRes, catRes, expRes] = await d1.batch([
				d1.prepare('SELECT * FROM products WHERE is_active = 1'),
				d1.prepare('SELECT id, username, name, role, branch_id, active, created_at, updated_at FROM users WHERE active = 1'),
				d1.prepare('SELECT * FROM branches'),
				d1.prepare('SELECT * FROM categories'),
				d1.prepare('SELECT * FROM expenses ORDER BY date DESC LIMIT 200')
			]);

			updatedProducts = prodRes.results || [];
			updatedUsers = (userRes.results || []).map((u: any) => ({
				...u,
				active: Boolean(u.active)
			}));
			branches = branchRes.results || [];
			categories = catRes.results || [];
			updatedExpenses = expRes.results || [];
		}

		return json({
			success: true,
			message: `Sinkronisasi D1 berhasil: ${transactions.length} transaksi, ${expenses.length} pengeluaran, ${activity_logs.length} log, ${queue.length} antrean.`,
			syncedAt: now,
			serverUpdates: {
				products: updatedProducts,
				users: updatedUsers,
				branches,
				categories,
				expenses: updatedExpenses
			}
		});
	} catch (error: any) {
		console.error('Error saat sinkronisasi D1:', error);
		return json(
			{
				success: false,
				message: error.message || 'Gagal memproses sinkronisasi di D1'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const [recentLogs, txSummary] = await d1.batch([
			d1.prepare('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 50'),
			d1.prepare(`
				SELECT 
					COUNT(*) as total_transactions,
					COALESCE(SUM(total), 0) as total_revenue,
					branch_id, branch_name
				FROM transactions
				WHERE status = 'completed'
				GROUP BY branch_id
			`)
		]);

		return json({
			success: true,
			activityLogs: recentLogs.results || [],
			branchSummaries: txSummary.results || []
		});
	} catch (e: any) {
		return json({ success: false, message: e.message }, { status: 500 });
	}
};
