import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';

/**
 * Status pengguna server (publik, untuk layar login):
 * menentukan apakah perangkat baru harus menampilkan Pengaturan Awal
 * atau mode login biasa.
 */
export const GET: RequestHandler = async ({ platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const row = await d1.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
		return json({ success: true, has_users: !!row && row.c > 0 });
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
