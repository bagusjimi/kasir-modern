import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { getSession, unauthorized } from '#lib/server/auth.js';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		// Isolasi cabang: sesi non-admin terkunci pada cabangnya sendiri
		const branchId = session.branchId !== 'all' ? session.branchId : url.searchParams.get('branch_id');
		const startDate = url.searchParams.get('start_date');
		const endDate = url.searchParams.get('end_date');
		const category = url.searchParams.get('category');
		const limit = parseInt(url.searchParams.get('limit') || '200', 10);

		const whereClauses: string[] = [];
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

		const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
		const query = `
			SELECT * FROM expenses
			${whereSql}
			ORDER BY date DESC, created_at DESC
			LIMIT ?
		`;
		params.push(limit);

		const result = await d1.prepare(query).bind(...params).all<any>();

		return json({
			success: true,
			data: result.results || []
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const body = (await request.json()) as any;
		// Isolasi cabang: sesi non-admin hanya bisa mencatat pengeluaran di cabangnya sendiri
		if (session.branchId !== 'all') body.branch_id = session.branchId;
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

export const DELETE: RequestHandler = async ({ url, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const id = url.searchParams.get('id');
		if (!id) {
			return json({ success: false, message: 'ID pengeluaran diperlukan' }, { status: 400 });
		}

		// Isolasi cabang: sesi non-admin hanya bisa menghapus pengeluaran cabangnya sendiri
		const existingExp = await d1.prepare('SELECT branch_id FROM expenses WHERE id = ?').bind(id).first() as any;
		if (session.branchId !== 'all' && existingExp && existingExp.branch_id !== session.branchId) {
			return json({ success: false, message: 'Tidak diizinkan' }, { status: 403 });
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
