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
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const branchId = url.searchParams.get('branch_id');
		const startDate = url.searchParams.get('start_date');
		const endDate = url.searchParams.get('end_date');
		const category = url.searchParams.get('category');
		const search = url.searchParams.get('search');
		const minAmount = url.searchParams.get('min_amount');
		const maxAmount = url.searchParams.get('max_amount');

		const sortBy = validateSortColumn(
			url.searchParams.get('sort_by'),
			['date', 'amount', 'created_at', 'category', 'branch_name', 'recipient'],
			'date'
		);
		const sortOrder = validateSortOrder(url.searchParams.get('sort_order'), 'DESC');

		const whereClauses: string[] = ['1=1'];
		const params: any[] = [];

		if (branchId && branchId !== 'all') {
			whereClauses.push('branch_id = ?');
			params.push(branchId);
		}

		if (category && category !== 'all') {
			whereClauses.push('category = ?');
			params.push(category);
		}

		if (startDate) {
			whereClauses.push('date >= ?');
			params.push(startDate);
		}

		if (endDate) {
			whereClauses.push('date <= ?');
			params.push(endDate);
		}

		if (minAmount !== null && minAmount !== '' && !isNaN(Number(minAmount))) {
			whereClauses.push('amount >= ?');
			params.push(Number(minAmount));
		}

		if (maxAmount !== null && maxAmount !== '' && !isNaN(Number(maxAmount))) {
			whereClauses.push('amount <= ?');
			params.push(Number(maxAmount));
		}

		if (search && search.trim() !== '') {
			whereClauses.push('(description LIKE ? OR recipient LIKE ? OR receipt_number LIKE ? OR user_name LIKE ?)');
			const q = `%${search.trim()}%`;
			params.push(q, q, q, q);
		}

		const whereSql = whereClauses.join(' AND ');

		// Smart pagination calculation (default 200 for backward compatibility, max 300)
		const pagination = extractPaginationParams(url, 200, 300);

		// Get total count
		const countQuery = `SELECT COUNT(*) as total, COALESCE(SUM(amount), 0) as total_amount FROM expenses WHERE ${whereSql}`;
		const countResult = await d1.prepare(countQuery).bind(...params).first<{ total: number; total_amount: number }>();
		const total = countResult?.total || 0;
		const totalAmount = countResult?.total_amount || 0;

		let dataSql = `SELECT * FROM expenses WHERE ${whereSql} ORDER BY ${sortBy} ${sortOrder}, created_at DESC`;
		const dataParams = [...params];

		if (pagination.paginate) {
			dataSql += ' LIMIT ? OFFSET ?';
			dataParams.push(pagination.limit, pagination.offset);
		} else {
			dataSql += ' LIMIT ?';
			dataParams.push(pagination.limit);
		}

		const result = await d1.prepare(dataSql).bind(...dataParams).all<any>();
		const meta = buildPaginationMeta(total, pagination.page, pagination.limit);

		return json({
			success: true,
			data: result.results || [],
			pagination: meta,
			summary: {
				total_records: total,
				total_amount: totalAmount
			},
			filters: {
				branch_id: branchId || 'all',
				category: category || 'all',
				start_date: startDate || null,
				end_date: endDate || null,
				search: search || '',
				min_amount: minAmount ? Number(minAmount) : null,
				max_amount: maxAmount ? Number(maxAmount) : null,
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
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const body = (await request.json()) as any;
		const {
			id,
			branch_id,
			branch_name = '',
			user_id,
			user_name,
			category,
			amount,
			description,
			recipient = '',
			receipt_number = '',
			date
		} = body;

		if (!id || !branch_id || !user_id || !user_name || !category || !amount || !description || !date) {
			return json({ success: false, message: 'Data pengeluaran tidak lengkap' }, { status: 400 });
		}

		const now = new Date().toISOString();

		await d1.prepare(`
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
			id, branch_id, branch_name, user_id, user_name, category,
			Number(amount), description, recipient, receipt_number,
			date, body.created_at || now, now
		).run();

		return json({
			success: true,
			message: 'Pengeluaran berhasil disimpan'
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url, platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const id = url.searchParams.get('id');
		if (!id) {
			return json({ success: false, message: 'ID pengeluaran diperlukan' }, { status: 400 });
		}

		await d1.prepare('DELETE FROM expenses WHERE id = ?').bind(id).run();

		return json({
			success: true,
			message: 'Pengeluaran berhasil dihapus'
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
