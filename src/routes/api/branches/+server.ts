import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';

export const GET: RequestHandler = async ({ platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const res = await d1.prepare('SELECT * FROM branches ORDER BY code ASC').all();
		return json({
			success: true,
			data: res.results || []
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
		const { id, code, name, address = '', phone = '' } = body || {};

		if (!code || !name) {
			return json({ success: false, message: 'Kode dan nama cabang wajib diisi' }, { status: 400 });
		}

		const branchId = id || `cb-${Date.now().toString().slice(-4)}`;
		const now = new Date().toISOString();

		await d1.prepare(`
			INSERT INTO branches (id, code, name, address, phone, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`).bind(branchId, code, name, address, phone, now, now).run();

		return json({
			success: true,
			data: { id: branchId, code, name, address, phone, created_at: now, updated_at: now }
		}, { status: 201 });
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
