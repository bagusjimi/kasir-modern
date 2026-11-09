import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import {
	extractPaginationParams,
	validateSortColumn,
	validateSortOrder
} from '#lib/server/pagination.js';
import { buildPaginationMeta } from '#lib/types/pagination.js';

export const GET: RequestHandler = async ({ url, platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const branchId = url.searchParams.get('branch_id');
		const cashierId = url.searchParams.get('cashier_id');
		const search = url.searchParams.get('search');
		const paymentMethod = url.searchParams.get('payment_method');
		const status = url.searchParams.get('status');
		const startDate = url.searchParams.get('start_date');
		const endDate = url.searchParams.get('end_date');
		const minTotal = url.searchParams.get('min_total');
		const maxTotal = url.searchParams.get('max_total');

		const sortBy = validateSortColumn(
			url.searchParams.get('sort_by'),
			['created_at', 'total', 'invoice_no', 'branch_name', 'cashier_name', 'payment_method'],
			'created_at'
		);
		const sortOrder = validateSortOrder(url.searchParams.get('sort_order'), 'DESC');

		const whereClauses: string[] = ['1=1'];
		const params: any[] = [];

		if (branchId && branchId !== 'all') {
			whereClauses.push('branch_id = ?');
			params.push(branchId);
		}

		if (cashierId) {
			whereClauses.push('cashier_id = ?');
			params.push(cashierId);
		}

		if (paymentMethod && paymentMethod !== 'all') {
			whereClauses.push('payment_method = ?');
			params.push(paymentMethod);
		}

		if (status && status !== 'all') {
			whereClauses.push('status = ?');
			params.push(status);
		}

		if (startDate) {
			whereClauses.push('created_at >= ?');
			params.push(startDate.includes('T') ? startDate : `${startDate}T00:00:00`);
		}

		if (endDate) {
			whereClauses.push('created_at <= ?');
			params.push(endDate.includes('T') ? endDate : `${endDate}T23:59:59`);
		}

		if (minTotal !== null && minTotal !== '' && !isNaN(Number(minTotal))) {
			whereClauses.push('total >= ?');
			params.push(Number(minTotal));
		}

		if (maxTotal !== null && maxTotal !== '' && !isNaN(Number(maxTotal))) {
			whereClauses.push('total <= ?');
			params.push(Number(maxTotal));
		}

		if (search && search.trim() !== '') {
			whereClauses.push('(invoice_no LIKE ? OR customer_name LIKE ? OR cashier_name LIKE ?)');
			const q = `%${search.trim()}%`;
			params.push(q, q, q);
		}

		const whereSql = whereClauses.join(' AND ');

		// Smart pagination calculation (default 50 for backward compatibility with existing tests/views, max 200)
		const pagination = extractPaginationParams(url, 50, 200);

		// Get total count
		const countQuery = `SELECT COUNT(*) as total FROM transactions WHERE ${whereSql}`;
		const countResult = await d1.prepare(countQuery).bind(...params).first<{ total: number }>();
		const total = countResult?.total || 0;

		let dataSql = `SELECT * FROM transactions WHERE ${whereSql} ORDER BY ${sortBy} ${sortOrder}`;
		const dataParams = [...params];

		if (pagination.paginate) {
			dataSql += ' LIMIT ? OFFSET ?';
			dataParams.push(pagination.limit, pagination.offset);
		} else {
			// If not strictly paginating with page param, respect default limit
			dataSql += ' LIMIT ?';
			dataParams.push(pagination.limit);
		}

		const txResult = await d1.prepare(dataSql).bind(...dataParams).all();
		const transactions = txResult.results || [];

		// Fetch items for transactions in this page
		if (transactions.length > 0) {
			const placeholders = transactions.map(() => '?').join(',');
			const txIds = transactions.map((t: any) => t.id);
			const itemsResult = await d1
				.prepare(`SELECT * FROM transaction_items WHERE transaction_id IN (${placeholders})`)
				.bind(...txIds)
				.all();
			const items = itemsResult.results || [];

			for (const tx of transactions as any[]) {
				tx.items = items.filter((item: any) => item.transaction_id === tx.id);
				tx.synced = true;
			}
		}

		const meta = buildPaginationMeta(total, pagination.page, pagination.limit);

		return json({
			success: true,
			data: transactions,
			pagination: meta,
			filters: {
				branch_id: branchId || 'all',
				cashier_id: cashierId || null,
				payment_method: paymentMethod || 'all',
				status: status || 'all',
				start_date: startDate || null,
				end_date: endDate || null,
				min_total: minTotal ? Number(minTotal) : null,
				max_total: maxTotal ? Number(maxTotal) : null,
				search: search || '',
				sort_by: sortBy,
				sort_order: sortOrder
			}
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

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
