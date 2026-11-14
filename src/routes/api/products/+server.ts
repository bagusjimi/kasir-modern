import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { getSession, unauthorized } from '#lib/server/auth.js';
import { deterministicProductId } from '#lib/products/id.js';

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
		const category = url.searchParams.get('category');
		const search = url.searchParams.get('search');

		let sql = 'SELECT * FROM products WHERE 1=1';
		const params: any[] = [];

		if (branchId && branchId !== 'all') {
			sql += ' AND (branch_id = ? OR branch_id = "all")';
			params.push(branchId);
		}

		if (category) {
			sql += ' AND category = ?';
			params.push(category);
		}

		if (search) {
			sql += ' AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?)';
			const q = `%${search}%`;
			params.push(q, q, q);
		}

		sql += ' ORDER BY name ASC';

		const stmt = d1.prepare(sql).bind(...params);
		const result = await stmt.all();

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
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const body = (await request.json()) as any;
		const {
			name,
			branch_id = 'all',
			sku,
			barcode = '',
			category,
			price,
			cost_price = 0,
			stock = 0,
			unit = 'pcs',
			image_url = ''
		} = body || {};

		if (!name || price === undefined) {
			return json({ success: false, message: 'Nama dan harga produk wajib diisi' }, { status: 400 });
		}

		const now = new Date().toISOString();
		const finalSku = sku || `SKU-${Date.now().toString().slice(-6)}`;
		const id = body.id || deterministicProductId(branch_id, finalSku);

		await d1.prepare(`
			INSERT INTO products (id, branch_id, sku, barcode, name, category, price, cost_price, stock, unit, image_url, is_active, version, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
		`).bind(
			id, branch_id, finalSku, barcode, name, category, price, cost_price, stock, unit, image_url, now, now
		).run();

		// Log activity
		await d1.prepare(`
			INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
			`act-${Date.now()}`, branch_id, branch_id === 'all' ? 'Semua Cabang' : branch_id,
			body.user_id || 'system', body.user_name || 'Kasir', 'cashier', 'create_product',
			`Membuat produk baru: ${name} (${unit}) seharga Rp ${price}`, now
		).run();

		return json({
			success: true,
			data: {
				id,
				branch_id,
				sku: finalSku,
				barcode,
				name,
				category,
				price,
				cost_price,
				stock,
				unit,
				image_url,
				is_active: 1,
				version: 1,
				created_at: now,
				updated_at: now
			}
		}, { status: 201 });
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const body = (await request.json()) as any;
		const { id, name, category, sku, barcode, price, cost_price, stock, unit, is_active } = body || {};

		if (!id) {
			return json({ success: false, message: 'ID produk diperlukan' }, { status: 400 });
		}

		const now = new Date().toISOString();

		await d1.prepare(`
			UPDATE products SET
				name = COALESCE(?, name),
				category = COALESCE(?, category),
				sku = COALESCE(?, sku),
				barcode = COALESCE(?, barcode),
				price = COALESCE(?, price),
				cost_price = COALESCE(?, cost_price),
				stock = COALESCE(?, stock),
				unit = COALESCE(?, unit),
				is_active = COALESCE(?, is_active),
				version = version + 1,
				updated_at = ?
			WHERE id = ?
		`).bind(
			name ?? null,
			category ?? null,
			sku ?? null,
			barcode ?? null,
			price ?? null,
			cost_price ?? null,
			stock ?? null,
			unit ?? null,
			is_active !== undefined ? (is_active ? 1 : 0) : null,
			now,
			id
		).run();

		return json({ success: true, message: 'Produk berhasil diperbarui' });
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const id = url.searchParams.get('id');
		if (!id) {
			return json({ success: false, message: 'Parameter id diperlukan' }, { status: 400 });
		}

		// Ambil data produk sebelum dihapus untuk log
		const existing = await d1.prepare('SELECT name, branch_id FROM products WHERE id = ?').bind(id).first() as any;

		await d1.prepare('DELETE FROM products WHERE id = ?').bind(id).run();

		if (existing) {
			const now = new Date().toISOString();
			await d1.prepare(`
				INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).bind(
				`act-${Date.now()}`, existing.branch_id || 'all', existing.branch_id === 'all' ? 'Semua Cabang' : existing.branch_id,
				'system', 'Kasir', 'cashier', 'delete_product',
				`Menghapus produk: ${existing.name}`, now
			).run();
		}

		return json({ success: true, message: 'Produk berhasil dihapus' });
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
