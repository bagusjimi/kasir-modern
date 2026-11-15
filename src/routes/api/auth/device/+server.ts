import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { createDeviceSession } from '#lib/server/auth.js';

/**
 * Inisialisasi Perangkat/Toko (lapis 1).
 *
 * Mengikat terminal ke satu cabang dan membuat sesi server berjenis 'device'.
 * Identitas operator kasir TIDAK dibuat di sini: operator ditentukan saat
 * membuka shift (lapis 2), sehingga pergantian kasir tidak memerlukan login ulang.
 *
 * Body:
 *   - device_id?    : ID perangkat yang sudah ada (untuk memuat ulang terminal)
 *   - device_name   : nama terminal (mis. "Kasir 1")
 *   - branch_id?    : cabang yang sudah terdaftar
 *   - branch_code?  : kode cabang (membuat cabang baru bila belum ada)
 *   - branch_name?  : nama cabang untuk cabang baru
 */
export const POST: RequestHandler = async ({ request, platform, cookies, url }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'Layanan basis data belum tersedia' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const body = (await request.json()) as any;
		const deviceName = String(body?.device_name || '').trim() || 'Kasir';
		const requestedDeviceId = String(body?.device_id || '').trim();
		let branchId = String(body?.branch_id || '').trim();
		const branchCode = String(body?.branch_code || '').trim().toUpperCase();
		const branchName = String(body?.branch_name || '').trim();
		const now = new Date().toISOString();

		let branch: any = null;

		// 1. Tentukan cabang: pakai yang ada, atau buat baru (id lokal dipertahankan
		//    agar cabang lokal & server tidak menjadi dua record berbeda).
		if (branchId) {
			branch = await d1.prepare('SELECT * FROM branches WHERE id = ?').bind(branchId).first();
		}
		if (!branch && branchCode && branchName) {
			if (!/^[A-Z0-9_-]+$/.test(branchCode)) {
				return json({ success: false, message: 'Kode cabang hanya boleh huruf besar, angka, garis, dan garis bawah' }, { status: 400 });
			}
			branch = await d1.prepare('SELECT * FROM branches WHERE code = ?').bind(branchCode).first();
			if (!branch) {
				branchId = branchId || `cb-${crypto.randomUUID()}`;
				await d1
					.prepare(
						`INSERT INTO branches (id, code, name, address, phone, created_at, updated_at)
						 VALUES (?, ?, ?, '', '', ?, ?)`
					)
					.bind(branchId, branchCode, branchName, now, now)
					.run();
				branch = { id: branchId, code: branchCode, name: branchName, address: '', phone: '', created_at: now, updated_at: now };
			}
		}
		if (!branch) {
			return json({ success: false, message: 'Pilih cabang atau isi kode & nama cabang baru' }, { status: 400 });
		}
		branchId = branch.id;

		// 2. Buat/perbarui perangkat pada cabang tersebut.
		const deviceId = requestedDeviceId || `dev-${crypto.randomUUID()}`;
		await d1
			.prepare(
				`INSERT INTO devices (id, branch_id, branch_name, name, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				 	branch_id = excluded.branch_id,
				 	branch_name = excluded.branch_name,
				 	name = excluded.name,
				 	updated_at = excluded.updated_at`
			)
			.bind(deviceId, branch.id, branch.name || '', deviceName, now, now)
			.run();

		// 3. Sesi terminal (bukan sesi operator).
		await createDeviceSession(d1, { id: deviceId, name: deviceName, branch_id: branch.id }, cookies, url.protocol === 'https:');

		const userCount = await d1.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();

		return json({
			success: true,
			device: { id: deviceId, name: deviceName, branch_id: branch.id, branch_name: branch.name || '' },
			branch,
			has_users: !!userCount && userCount.c > 0
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
