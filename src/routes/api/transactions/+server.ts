import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { getSession, unauthorized } from '#lib/server/auth.js';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const branchId = url.searchParams.get('branch_id');
		const cashierId = url.searchParams.get('cashier_id');
		const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

		let sql = 'SELECT * FROM transactions WHERE 1=1';
		const params: any[] = [];

		if (branchId && branchId !== 'all') {
			sql += ' AND branch_id = ?';
			params.push(branchId);
		}

		if (cashierId) {
			sql += ' AND cashier_id = ?';
			params.push(cashierId);
		}

		sql += ' ORDER BY created_at DESC LIMIT ?';
		params.push(limit);

		const txResult = await d1.prepare(sql).bind(...params).all();
		const transactions = txResult.results || [];

		// Ambil items untuk transaksi
		if (transactions.length > 0) {
			const placeholders = transactions.map(() => '?').join(',');
			const txIds = transactions.map((t: any) => t.id);
			const itemsResult = await d1.prepare(`SELECT * FROM transaction_items WHERE transaction_id IN (${placeholders})`).bind(...txIds).all();
			const items = itemsResult.results || [];

			for (const tx of transactions as any[]) {
				tx.items = items.filter((item: any) => item.transaction_id === tx.id);
				tx.synced = true;
			}
		}

		return json({
			success: true,
			data: transactions
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const body = (await request.json()) as any;
		const {
			invoice_no,
			branch_id,
			branch_name,
			cashier_id,
			cashier_name,
			customer_name = '',
			subtotal,
			discount = 0,
			tax = 0,
			total,
			payment_method = 'cash',
			amount_paid,
			change = 0,
			status = 'completed',
			items = []
		} = body || {};

		if (!branch_id || !cashier_id || !items.length || total === undefined) {
			return json({ success: false, message: 'Informasi transaksi dan items tidak lengkap' }, { status: 400 });
		}

		const id = body.id || `tx-${Date.now()}`;
		const now = new Date().toISOString();
		const finalInvoice = invoice_no || `INV-${Date.now().toString().slice(-8)}`;

		const batchStatements: any[] = [];

		// 1. Simpan Transaksi
		batchStatements.push(
			d1.prepare(`
				INSERT INTO transactions (id, invoice_no, branch_id, branch_name, cashier_id, cashier_name, customer_name, subtotal, discount, tax, total, payment_method, amount_paid, change, status, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					status = excluded.status,
					updated_at = excluded.updated_at
			`).bind(
				id, finalInvoice, branch_id, branch_name, cashier_id, cashier_name,
				customer_name, subtotal, discount, tax, total, payment_method,
				amount_paid, change, status, body.created_at || now, now
			)
		);

		// 2. Simpan Item & Kurangi Stok Produk D1
		for (const item of items) {
			const itemId = item.id || `txi-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
			batchStatements.push(
				d1.prepare(`
					INSERT INTO transaction_items (id, transaction_id, product_id, product_name, price, cost_price, quantity, subtotal, notes)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO NOTHING
				`).bind(
					itemId, id, item.product_id, item.product_name,
					item.price, item.cost_price || 0, item.quantity, item.subtotal, item.notes || ''
				)
			);

			// Pengurangan stok otomatis jika status completed
			if (status === 'completed' && item.product_id) {
				batchStatements.push(
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

		// 3. Simpan Activity Log
		batchStatements.push(
			d1.prepare(`
				INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).bind(
				`act-${Date.now()}`, branch_id, branch_name, cashier_id, cashier_name,
				'cashier', 'create_transaction',
				`Kasir ${cashier_name} menyelesaikan transaksi #${finalInvoice} senilai Rp ${total.toLocaleString('id-ID')} (${payment_method.toUpperCase()})`,
				now
			)
		);

		await d1.batch(batchStatements);

		return json({
			success: true,
			data: {
				id,
				invoice_no: finalInvoice,
				branch_id,
				branch_name,
				total,
				status,
				created_at: now
			}
		}, { status: 201 });
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
