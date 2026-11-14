import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { getSession, unauthorized, forbidden } from '#lib/server/auth.js';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();
	if (session.role !== 'admin') return forbidden();

	try {
		const branchId = url.searchParams.get('branch_id');

		// Filter periode bebas (YYYY-MM-DD); kosong = semua periode
		const startDate = url.searchParams.get('start_date') || '';
		const endDate = url.searchParams.get('end_date') || '';
		const txWhere: string[] = ["status = 'completed'"];
		const txParams: any[] = [];
		if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
			txWhere.push('date(created_at) >= ?');
			txParams.push(startDate);
		}
		if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
			txWhere.push('date(created_at) <= ?');
			txParams.push(endDate);
		}
		const txWhereSql = txWhere.join(' AND ');

		// 1. Ambil summary per cabang
		const branchSummaries = await d1.prepare(`
			SELECT
				branch_id,
				branch_name,
				COUNT(*) as total_transactions,
				COALESCE(SUM(total), 0) as total_revenue,
				MAX(created_at) as last_activity
			FROM transactions
			WHERE ${txWhereSql}
			GROUP BY branch_id
		`).bind(...txParams).all();

		// 2. Ambil total statistik global
		const globalStats = await d1.prepare(`
			SELECT
				COUNT(*) as total_transactions,
				COALESCE(SUM(total), 0) as total_revenue
			FROM transactions
			WHERE ${txWhereSql}
		`).bind(...txParams).first<{ total_transactions: number; total_revenue: number }>();

		// 3. Ambil log aktivitas terbaru (ikut periode)
		let logsQuery = 'SELECT * FROM activity_logs WHERE 1=1';
		const logParams: any[] = [];

		if (startDate) {
			logsQuery += ' AND date(timestamp) >= ?';
			logParams.push(startDate);
		}
		if (endDate) {
			logsQuery += ' AND date(timestamp) <= ?';
			logParams.push(endDate);
		}

		if (branchId && branchId !== 'all') {
			logsQuery += ' AND (branch_id = ? OR branch_id = "all")';
			logParams.push(branchId);
		}

		logsQuery += ' ORDER BY timestamp DESC LIMIT 100';
		const recentLogs = await d1.prepare(logsQuery).bind(...logParams).all();

		return json({
			success: true,
			stats: {
				totalRevenue: globalStats?.total_revenue || 0,
				totalTransactions: globalStats?.total_transactions || 0
			},
			branchSummaries: branchSummaries.results || [],
			activityLogs: recentLogs.results || []
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
