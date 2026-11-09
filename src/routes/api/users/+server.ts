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
		const role = url.searchParams.get('role');
		const active = url.searchParams.get('active');
		const search = url.searchParams.get('search');

		const sortBy = validateSortColumn(
			url.searchParams.get('sort_by'),
			['name', 'username', 'role', 'branch_id', 'created_at', 'active'],
			'name'
		);
		const sortOrder = validateSortOrder(url.searchParams.get('sort_order'), 'ASC');

		const whereClauses: string[] = ['1=1'];
		const params: any[] = [];

		if (branchId && branchId !== 'all') {
			whereClauses.push('(branch_id = ? OR branch_id = "all")');
			params.push(branchId);
		}

		if (role && role !== 'all') {
			whereClauses.push('role = ?');
			params.push(role);
		}

		if (active === 'true' || active === '1') {
			whereClauses.push('active = 1');
		} else if (active === 'false' || active === '0') {
			whereClauses.push('active = 0');
		}

		if (search && search.trim() !== '') {
			whereClauses.push('(name LIKE ? OR username LIKE ?)');
			const q = `%${search.trim()}%`;
			params.push(q, q);
		}

		const whereSql = whereClauses.join(' AND ');

		const pagination = extractPaginationParams(url, 50, 100);

		// Count total matching users
		const countQuery = `SELECT COUNT(*) as total FROM users WHERE ${whereSql}`;
		const countResult = await d1.prepare(countQuery).bind(...params).first<{ total: number }>();
		const total = countResult?.total || 0;

		let dataSql = `SELECT id, username, name, role, branch_id, pin, active, created_at, updated_at FROM users WHERE ${whereSql} ORDER BY ${sortBy} ${sortOrder}`;
		const dataParams = [...params];

		if (pagination.paginate) {
			dataSql += ' LIMIT ? OFFSET ?';
			dataParams.push(pagination.limit, pagination.offset);
		}

		const res = await d1.prepare(dataSql).bind(...dataParams).all();
		const mappedUsers = (res.results || []).map((u: any) => ({
			...u,
			active: Boolean(u.active)
		}));

		const meta = buildPaginationMeta(total, pagination.page, pagination.limit);

		return json({
			success: true,
			data: mappedUsers,
			pagination: meta,
			filters: {
				branch_id: branchId || 'all',
				role: role || 'all',
				active: active ?? null,
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
		const { username, name, role = 'cashier', branch_id = 'all', pin = '1234' } = body || {};

		if (!username || !name) {
			return json({ success: false, message: 'Username dan nama lengkap wajib diisi' }, { status: 400 });
		}

		// Cek username unik
		const exists = await d1.prepare('SELECT id FROM users WHERE username = ?').bind(username.toLowerCase().trim()).first();
		if (exists) {
			return json({ success: false, message: 'Username sudah digunakan' }, { status: 409 });
		}

		const id = body.id || `usr-${Date.now()}`;
		const now = new Date().toISOString();

		await d1.prepare(`
			INSERT INTO users (id, username, name, role, branch_id, pin, active, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
		`).bind(id, username.toLowerCase().trim(), name.trim(), role, branch_id, pin, now, now).run();

		// Log activity
		await d1.prepare(`
			INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
			`act-${Date.now()}`, 'all', 'Pusat (Admin)', body.admin_id || 'usr-admin-1',
			body.admin_name || 'Admin', 'admin', 'create_user',
			`Admin menambahkan user baru: ${name} (${role})`, now
		).run();

		return json({
			success: true,
			data: {
				id,
				username: username.toLowerCase().trim(),
				name: name.trim(),
				role,
				branch_id,
				pin,
				active: true,
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
		const { id, name, role, branch_id, pin, active } = body || {};

		if (!id) {
			return json({ success: false, message: 'ID pengguna wajib diisi' }, { status: 400 });
		}

		const now = new Date().toISOString();

		await d1.prepare(`
			UPDATE users SET
				name = COALESCE(?, name),
				role = COALESCE(?, role),
				branch_id = COALESCE(?, branch_id),
				pin = COALESCE(?, pin),
				active = COALESCE(?, active),
				updated_at = ?
			WHERE id = ?
		`).bind(
			name ?? null,
			role ?? null,
			branch_id ?? null,
			pin ?? null,
			active !== undefined ? (active ? 1 : 0) : null,
			now,
			id
		).run();

		// Log activity
		await d1.prepare(`
			INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
			`act-${Date.now()}`, 'all', 'Pusat (Admin)', body.admin_id || 'usr-admin-1',
			body.admin_name || 'Admin', 'admin', 'update_user',
			`Admin memperbarui data pengguna ID: ${id}`, now
		).run();

		return json({ success: true, message: 'Pengguna berhasil diperbarui' });
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

		await d1.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

		return json({ success: true, message: 'Pengguna berhasil dihapus' });
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
