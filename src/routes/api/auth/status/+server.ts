import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';

/**
 * Status server (publik, untuk layar inisialisasi perangkat):
 * menentukan apakah perangkat harus menampilkan penyiapan awal (belum ada
 * pengguna/cabang) atau cukup memilih cabang yang sudah terdaftar.
 */
export const GET: RequestHandler = async ({ platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'Layanan basis data belum tersedia' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const [userRow, branchRes] = await d1.batch([
			d1.prepare('SELECT COUNT(*) AS c FROM users'),
			d1.prepare('SELECT id, code, name FROM branches ORDER BY name ASC')
		]);
		const users = (userRow.results?.[0] as any) || { c: 0 };
		return json({
			success: true,
			has_users: Number(users.c) > 0,
			branches: branchRes.results || []
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
