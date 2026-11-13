import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { createSession } from '#lib/server/auth.js';
import { hashPin, verifyPin, isHashedPin } from '#lib/auth/pin.js';

export const POST: RequestHandler = async ({ request, platform, cookies, url }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB not found' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const body = (await request.json()) as any;
		const { username, pin } = body || {};

		if (!username || !pin) {
			return json({ success: false, message: 'Username dan PIN harus diisi' }, { status: 400 });
		}

		const user = await d1.prepare(`
			SELECT id, username, name, role, branch_id, pin, active, created_at, updated_at
			FROM users
			WHERE lower(username) = lower(?)
		`).bind(username.trim()).first<any>();

		if (!user || !user.active) {
			return json({ success: false, message: 'Username atau PIN salah' }, { status: 401 });
		}

		const pinOk = await verifyPin(pin.trim(), user.pin);
		if (!pinOk) {
			return json({ success: false, message: 'Username atau PIN salah' }, { status: 401 });
		}

		if (!isHashedPin(user.pin)) {
			const hashed = await hashPin(pin.trim());
			await d1
				.prepare('UPDATE users SET pin = ?, updated_at = ? WHERE id = ?')
				.bind(hashed, new Date().toISOString(), user.id)
				.run();
		}

		await createSession(d1, user, cookies, url.protocol === 'https:');

		// Log aktivitas masuk
		const now = new Date().toISOString();
		await d1.prepare(`
			INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
			crypto.randomUUID(), user.branch_id, user.branch_id === 'all' ? 'Pusat' : user.branch_id,
			user.id, user.name, user.role, 'login',
			`${user.name} (${user.role}) berhasil masuk ke sistem`, now
		).run();

		// Ambil cabang jika bukan all
		let branch = null;
		if (user.branch_id !== 'all') {
			branch = await d1.prepare('SELECT * FROM branches WHERE id = ?').bind(user.branch_id).first();
		}

		return json({
			success: true,
			user: {
				id: user.id,
				username: user.username,
				name: user.name,
				role: user.role,
				branch_id: user.branch_id,
				active: Boolean(user.active)
			},
			branch
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
