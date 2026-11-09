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
		const category = url.searchParams.get('category');
		const search = url.searchParams.get('search');
		const minPrice = url.searchParams.get('min_price');
		const maxPrice = url.searchParams.get('max_price');
		const inStock = url.searchParams.get('in_stock');
		const isActive = url.searchParams.get('is_active');

		const sortBy = validateSortColumn(
			url.searchParams.get('sort_by'),
			['name', 'price', 'cost_price', 'stock', 'created_at', 'updated_at', 'sku'],
			'name'
		);
		const sortOrder = validateSortOrder(
			url.searchParams.get('sort_order'),
			sortBy === 'created_at' || sortBy === 'updated_at' ? 'DESC' : 'ASC'
		);

		const whereClauses: string[] = ['1=1'];
		const params: any[] = [];

		if (branchId && branchId !== 'all') {
			whereClauses.push('(branch_id = ? OR branch_id = "all")');
			params.push(branchId);
		}

		if (category && category !== 'all') {
			whereClauses.push('category = ?');
			params.push(category);
		}

		if (search && search.trim() !== '') {
			whereClauses.push('(name LIKE ? OR sku LIKE ? OR barcode LIKE ?)');
			const q = `%${search.trim()}%`;
			params.push(q, q, q);
		}

		if (minPrice !== null && minPrice !== '' && !isNaN(Number(minPrice))) {
			whereClauses.push('price >= ?');
			params.push(Number(minPrice));
		}

		if (maxPrice !== null && maxPrice !== '' && !isNaN(Number(maxPrice))) {
			whereClauses.push('price <= ?');
			params.push(Number(maxPrice));
		}

		if (inStock === 'true' || inStock === '1') {
			whereClauses.push('stock > 0');
		} else if (inStock === 'false' || inStock === '0') {
			whereClauses.push('stock <= 0');
		}

		if (isActive === 'true' || isActive === '1') {
			whereClauses.push('is_active = 1');
		} else if (isActive === 'false' || isActive === '0') {
			whereClauses.push('is_active = 0');
		}

		const whereSql = whereClauses.join(' AND ');

		// Smart pagination calculation
		const pagination = extractPaginationParams(url, 20, 200);

		// Get total count for pagination meta
		const countQuery = `SELECT COUNT(*) as total FROM products WHERE ${whereSql}`;
		const countResult = await d1.prepare(countQuery).bind(...params).first<{ total: number }>();
		const total = countResult?.total || 0;

		// Data query with ordering and pagination
		let dataSql = `SELECT * FROM products WHERE ${whereSql} ORDER BY ${sortBy} ${sortOrder}`;
		const dataParams = [...params];

		if (pagination.paginate) {
			dataSql += ' LIMIT ? OFFSET ?';
			dataParams.push(pagination.limit, pagination.offset);
		}

		const stmt = d1.prepare(dataSql).bind(...dataParams);
		const result = await stmt.all();

		const meta = buildPaginationMeta(total, pagination.page, pagination.limit);

		return json({
			success: true,
			data: result.results || [],
			pagination: meta,
			filters: {
				branch_id: branchId || 'all',
				category: category || 'all',
				search: search || '',
				min_price: minPrice ? Number(minPrice) : null,
				max_price: maxPrice ? Number(maxPrice) : null,
				in_stock: inStock ?? null,
				is_active: isActive ?? null,
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

		const id = body.id || `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const now = new Date().toISOString();
		const finalSku = sku || `SKU-${Date.now().toString().slice(-6)}`;

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

export const PUT: RequestHandler = async ({ request, platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

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

export const DELETE: RequestHandler = async ({ url, platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

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
