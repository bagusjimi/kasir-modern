import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { getSession, unauthorized, forbidden } from '#lib/server/auth.js';

export const GET: RequestHandler = async ({ platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const res = await d1.prepare('SELECT * FROM categories ORDER BY name ASC').all();
		return json({
			success: true,
			data: res.results || []
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
	if (session.role !== 'admin') return forbidden();

	try {
		const body = (await request.json()) as any;
		const { id, name } = body || {};
		if (!name) {
			return json({ success: false, message: 'Nama kategori wajib diisi' }, { status: 400 });
		}

		const catId = id || `cat-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString().slice(-4)}`;
		await d1
			.prepare('INSERT OR IGNORE INTO categories (id, name, updated_at) VALUES (?, ?, ?)')
			.bind(catId, name, new Date().toISOString())
			.run();

		return json({
			success: true,
			data: { id: catId, name }
		}, { status: 201 });
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
