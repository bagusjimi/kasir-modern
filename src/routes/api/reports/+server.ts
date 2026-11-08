import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '$lib/server/db.js';

export const GET: RequestHandler = async ({ url, platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const branchId = url.searchParams.get('branch_id');
		const startDate = url.searchParams.get('start_date');
		const endDate = url.searchParams.get('end_date');
		const paymentMethod = url.searchParams.get('payment_method');

		let whereClauses = ["status = 'completed'"];
		const params: any[] = [];

		if (branchId && branchId !== 'all') {
			whereClauses.push('branch_id = ?');
			params.push(branchId);
		}

		if (paymentMethod && paymentMethod !== 'all') {
			whereClauses.push('payment_method = ?');
			params.push(paymentMethod);
		}

		if (startDate) {
			whereClauses.push('created_at >= ?');
			params.push(startDate + 'T00:00:00');
		}

		if (endDate) {
			whereClauses.push('created_at <= ?');
			params.push(endDate + 'T23:59:59');
		}

		const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

		// 1. Summary Agregasi Utama
		const summaryQuery = `
			SELECT
				COUNT(*) as total_transactions,
				COALESCE(SUM(total), 0) as total_revenue,
				COALESCE(SUM(discount), 0) as total_discount,
				COALESCE(SUM(tax), 0) as total_tax
			FROM transactions
			${whereSql}
		`;
		const summaryResult = await d1.prepare(summaryQuery).bind(...params).first<any>();

		// 2. Breakdown Metode Pembayaran
		const paymentQuery = `
			SELECT
				payment_method,
				COUNT(*) as count,
				COALESCE(SUM(total), 0) as total_amount
			FROM transactions
			${whereSql}
			GROUP BY payment_method
		`;
		const paymentResult = await d1.prepare(paymentQuery).bind(...params).all<any>();

		// 3. Breakdown Penjualan Harian
		const dailyQuery = `
			SELECT
				substr(created_at, 1, 10) as date,
				COUNT(*) as count,
				COALESCE(SUM(total), 0) as total_revenue
			FROM transactions
			${whereSql}
			GROUP BY substr(created_at, 1, 10)
			ORDER BY date ASC
		`;
		const dailyResult = await d1.prepare(dailyQuery).bind(...params).all<any>();

		return json({
			success: true,
			data: {
				summary: summaryResult || {
					total_transactions: 0,
					total_revenue: 0,
					total_discount: 0,
					total_tax: 0
				},
				payment_breakdown: paymentResult.results || [],
				daily_breakdown: dailyResult.results || []
			}
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
