import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { createSession } from '#lib/server/auth.js';
import { hashPin } from '#lib/auth/pin.js';

/**
 * Pengaturan Awal (bootstrap): membuat akun admin pertama.
 * Hanya berjalan ketika tabel users di D1 masih kosong.
 */
export const POST: RequestHandler = async ({ request, platform, cookies, url }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const body = (await request.json()) as any;
		const { username, name, pin, client_id } = body || {};

		if (!username || !name || !pin) {
			return json(
				{ success: false, message: 'Username, nama lengkap, dan PIN harus diisi' },
				{ status: 400 }
			);
		}

		const cleanUsername = String(username).trim().toLowerCase();
		const cleanName = String(name).trim();
		const cleanPin = String(pin).trim();

		if (cleanUsername.length < 3) {
			return json(
				{ success: false, message: 'Username minimal 3 karakter' },
				{ status: 400 }
			);
		}

		if (!/^[a-z0-9_.]+$/.test(cleanUsername)) {
			return json(
				{ success: false, message: 'Username hanya boleh huruf kecil, angka, titik, dan garis bawah' },
				{ status: 400 }
			);
		}

		if (cleanPin.length < 4) {
			return json({ success: false, message: 'PIN minimal 4 karakter' }, { status: 400 });
		}

		const existing = await d1
			.prepare('SELECT COUNT(*) AS c FROM users')
			.first<{ c: number }>();

		if (existing && existing.c > 0) {
			return json(
				{
					success: false,
					code: 'USERS_EXIST',
					message: 'Pengaturan awal sudah dilakukan sebelumnya'
				},
				{ status: 403 }
			);
		}

		const pinHash = await hashPin(cleanPin);
		const userId =
			typeof client_id === 'string' && client_id.startsWith('usr-')
				? client_id
				: `usr-${crypto.randomUUID()}`;
		const now = new Date().toISOString();

		await d1
			.prepare(
				`INSERT INTO users (id, username, name, role, branch_id, pin, active, created_at, updated_at)
				 VALUES (?, ?, ?, 'admin', 'all', ?, 1, ?, ?)`
			)
			.bind(userId, cleanUsername, cleanName, pinHash, now, now)
			.run();

		await d1
			.prepare(
				`INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				crypto.randomUUID(),
				'all',
				'Pusat',
				userId,
				cleanName,
				'admin',
				'setup_owner',
				`${cleanName} melakukan pengaturan awal dan menjadi admin pertama`,
				now
			)
			.run();

		await createSession(d1, { id: userId, role: 'admin', branch_id: 'all' }, cookies, url.protocol === 'https:');

		return json({
			success: true,
			user: {
				id: userId,
				username: cleanUsername,
				name: cleanName,
				role: 'admin',
				branch_id: 'all',
				active: true
			}
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
