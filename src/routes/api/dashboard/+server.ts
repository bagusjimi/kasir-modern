import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { getSession, unauthorized, forbidden } from '#lib/server/auth.js';

/**
 * Ringkasan dashboard admin: KPI hari ini, tren 7 hari, rekap per cabang,
 * dan daftar produk dengan stok menipis. Hanya untuk admin.
 */
export const GET: RequestHandler = async ({ platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	try {
		await ensureD1Seeded(d1);

		const session = await getSession(d1, cookies);
		if (!session) return unauthorized();
		if (session.role !== 'admin') return forbidden();

		const [todayRes, profitRes, trendRes, branchRes, cashierRes, lowStockRes, productRes, categoryRes] = await d1.batch([
			d1.prepare(
				`SELECT COUNT(*) AS tx_count, COALESCE(SUM(total), 0) AS total_sales
				 FROM transactions
				 WHERE status = 'completed' AND date(created_at) = date('now')`
			),
			d1.prepare(
				`SELECT COALESCE(SUM((ti.price - ti.cost_price) * ti.quantity), 0) AS gross_profit,
				        COALESCE(SUM(ti.quantity), 0) AS items_sold
				 FROM transaction_items ti
				 JOIN transactions t ON t.id = ti.transaction_id
				 WHERE t.status = 'completed' AND date(t.created_at) = date('now')`
			),
			d1.prepare(
				`SELECT date(created_at) AS day, COUNT(*) AS tx_count, COALESCE(SUM(total), 0) AS total_sales
				 FROM transactions
				 WHERE status = 'completed' AND created_at >= date('now', '-6 days')
				 GROUP BY date(created_at) ORDER BY day ASC`
			),
			d1.prepare(
				`SELECT branch_id, branch_name, COUNT(*) AS tx_count, COALESCE(SUM(total), 0) AS total_sales
				 FROM transactions
				 WHERE status = 'completed' AND date(created_at) = date('now')
				 GROUP BY branch_id, branch_name ORDER BY total_sales DESC`
			),
			d1.prepare(
				`SELECT cashier_id, cashier_name, branch_name, COUNT(*) AS tx_count,
				        COALESCE(SUM(total), 0) AS total_sales, COALESCE(SUM(discount), 0) AS total_discount
				 FROM transactions
				 WHERE status = 'completed' AND date(created_at) = date('now')
				 GROUP BY cashier_id, cashier_name, branch_name ORDER BY total_sales DESC LIMIT 50`
			),
			d1.prepare(
				`SELECT id, name, sku, stock, min_stock, branch_id
				 FROM products
				 WHERE is_active = 1 AND min_stock > 0 AND stock <= min_stock
				 ORDER BY (stock - min_stock) ASC LIMIT 20`
			),
			d1.prepare(`SELECT COUNT(*) AS count FROM products WHERE is_active = 1`),
			d1.prepare(`SELECT COUNT(*) AS count FROM categories`)
		]);

		const today = (todayRes.results?.[0] || {}) as { tx_count?: number; total_sales?: number };
		const profit = (profitRes.results?.[0] || {}) as { gross_profit?: number; items_sold?: number };

		return json({
			success: true,
			data: {
				today: {
					tx_count: Number(today.tx_count || 0),
					total_sales: Number(today.total_sales || 0),
					gross_profit: Number(profit.gross_profit || 0),
					items_sold: Number(profit.items_sold || 0)
				},
				trend: (trendRes.results || []).map((r: any) => ({
					day: r.day,
					tx_count: Number(r.tx_count || 0),
					total_sales: Number(r.total_sales || 0)
				})),
				branches: (branchRes.results || []).map((r: any) => ({
					branch_id: r.branch_id,
					branch_name: r.branch_name,
					tx_count: Number(r.tx_count || 0),
					total_sales: Number(r.total_sales || 0)
				})),
				cashiers: (cashierRes.results || []).map((r: any) => ({
					cashier_id: r.cashier_id,
					cashier_name: r.cashier_name,
					branch_name: r.branch_name,
					tx_count: Number(r.tx_count || 0),
					total_sales: Number(r.total_sales || 0),
					total_discount: Number(r.total_discount || 0)
				})),
				low_stock: (lowStockRes.results || []).map((r: any) => ({
					id: r.id,
					name: r.name,
					sku: r.sku,
					stock: Number(r.stock || 0),
					min_stock: Number(r.min_stock || 0),
					branch_id: r.branch_id
				})),
				counts: {
					active_products: Number((productRes.results?.[0] as any)?.count || 0),
					categories: Number((categoryRes.results?.[0] as any)?.count || 0)
				}
			}
		});
	} catch (err: any) {
		console.error('Error dashboard:', err);
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
