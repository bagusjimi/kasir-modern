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
		const action = url.searchParams.get('action');
		const role = url.searchParams.get('role');
		const search = url.searchParams.get('search');
		const startDate = url.searchParams.get('start_date');
		const endDate = url.searchParams.get('end_date');

		const sortBy = validateSortColumn(
			url.searchParams.get('sort_by'),
			['timestamp', 'user_name', 'action', 'branch_name'],
			'timestamp'
		);
		const sortOrder = validateSortOrder(url.searchParams.get('sort_order'), 'DESC');

		// 1. Ambil summary per cabang
		const branchSummaries = await d1.prepare(`
			SELECT
				branch_id,
				branch_name,
				COUNT(*) as total_transactions,
				COALESCE(SUM(total), 0) as total_revenue,
				MAX(created_at) as last_activity
			FROM transactions
			WHERE status = 'completed'
			GROUP BY branch_id
		`).all();

		// 2. Ambil total statistik global
		const globalStats = await d1.prepare(`
			SELECT
				COUNT(*) as total_transactions,
				COALESCE(SUM(total), 0) as total_revenue
			FROM transactions
			WHERE status = 'completed'
		`).first<{ total_transactions: number; total_revenue: number }>();

		// 3. Ambil log aktivitas dengan smart pagination dan filter
		const logWhereClauses: string[] = ['1=1'];
		const logParams: any[] = [];

		if (branchId && branchId !== 'all') {
			logWhereClauses.push('(branch_id = ? OR branch_id = "all")');
			logParams.push(branchId);
		}

		if (action && action !== 'all') {
			logWhereClauses.push('action = ?');
			logParams.push(action);
		}

		if (role && role !== 'all') {
			logWhereClauses.push('role = ?');
			logParams.push(role);
		}

		if (startDate) {
			logWhereClauses.push('timestamp >= ?');
			logParams.push(startDate.includes('T') ? startDate : `${startDate}T00:00:00`);
		}

		if (endDate) {
			logWhereClauses.push('timestamp <= ?');
			logParams.push(endDate.includes('T') ? endDate : `${endDate}T23:59:59`);
		}

		if (search && search.trim() !== '') {
			logWhereClauses.push('(user_name LIKE ? OR details LIKE ? OR branch_name LIKE ?)');
			const q = `%${search.trim()}%`;
			logParams.push(q, q, q);
		}

		const logWhereSql = logWhereClauses.join(' AND ');

		const pagination = extractPaginationParams(url, 50, 200);

		// Count total matching logs
		const countQuery = `SELECT COUNT(*) as total FROM activity_logs WHERE ${logWhereSql}`;
		const countResult = await d1.prepare(countQuery).bind(...logParams).first<{ total: number }>();
		const totalLogs = countResult?.total || 0;

		let logsQuery = `SELECT * FROM activity_logs WHERE ${logWhereSql} ORDER BY ${sortBy} ${sortOrder}`;
		const queryParams = [...logParams];

		if (pagination.paginate) {
			logsQuery += ' LIMIT ? OFFSET ?';
			queryParams.push(pagination.limit, pagination.offset);
		} else {
			logsQuery += ' LIMIT ?';
			queryParams.push(pagination.limit);
		}

		const recentLogs = await d1.prepare(logsQuery).bind(...queryParams).all();
		const meta = buildPaginationMeta(totalLogs, pagination.page, pagination.limit);

		return json({
			success: true,
			stats: {
				totalRevenue: globalStats?.total_revenue || 0,
				totalTransactions: globalStats?.total_transactions || 0
			},
			branchSummaries: branchSummaries.results || [],
			activityLogs: recentLogs.results || [],
			pagination: meta,
			filters: {
				branch_id: branchId || 'all',
				action: action || 'all',
				role: role || 'all',
				search: search || '',
				start_date: startDate || null,
				end_date: endDate || null,
				sort_by: sortBy,
				sort_order: sortOrder
			}
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
