import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { createDeviceSession } from '#lib/server/auth.js';
import { hashPin } from '#lib/auth/pin.js';

/**
 * Pengaturan Awal (bootstrap): membuat akun admin pertama, cabang pertama,
 * dan perangkat pertama. Hanya berjalan ketika tabel users di D1 masih kosong.
 *
 * Perangkat yang menjalankan penyiapan awal langsung mendapat sesi terminal
 * (kind 'device'); admin tetap masuk lewat /api/auth/login untuk mengelola user
 * dan memantau.
 */
export const POST: RequestHandler = async ({ request, platform, cookies, url }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'Layanan basis data belum tersedia' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const body = (await request.json()) as any;
		const { username, name, pin, client_id, branch_id, branch_code, branch_name, device_id, device_name } = body || {};

		if (!username || !name || !pin) {
			return json(
				{ success: false, message: 'Username, nama lengkap, dan PIN harus diisi' },
				{ status: 400 }
			);
		}

		const cleanUsername = String(username).trim().toLowerCase();
		const cleanName = String(name).trim();
		const cleanPin = String(pin).trim();
		const cleanBranchCode = String(branch_code || '').trim().toUpperCase();
		const cleanBranchName = String(branch_name || '').trim();
		const cleanDeviceName = String(device_name || '').trim() || 'Kasir 1';
		const now = new Date().toISOString();

		if (cleanUsername.length < 3) {
			return json({ success: false, message: 'Username minimal 3 karakter' }, { status: 400 });
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

		await d1
			.prepare(
				`INSERT INTO users (id, username, name, role, branch_id, pin, active, created_at, updated_at)
				 VALUES (?, ?, ?, 'admin', 'all', ?, 1, ?, ?)`
			)
			.bind(userId, cleanUsername, cleanName, pinHash, now, now)
			.run();

		// Cabang pertama (opsional). ID lokal dipertahankan bila dikirim klien,
		// agar cabang lokal & server tidak menjadi dua record berbeda.
		let branch: any = null;
		if (cleanBranchCode && cleanBranchName) {
			branch = await d1.prepare('SELECT * FROM branches WHERE code = ?').bind(cleanBranchCode).first();
			if (!branch) {
				const newBranchId = (typeof branch_id === 'string' && branch_id) || `cb-${crypto.randomUUID()}`;
				await d1
					.prepare(
						`INSERT INTO branches (id, code, name, address, phone, created_at, updated_at)
						 VALUES (?, ?, ?, '', '', ?, ?)`
					)
					.bind(newBranchId, cleanBranchCode, cleanBranchName, now, now)
					.run();
				branch = { id: newBranchId, code: cleanBranchCode, name: cleanBranchName, address: '', phone: '', created_at: now, updated_at: now };
			}
		}

		// Perangkat pertama pada cabang tersebut.
		let device: any = null;
		if (branch) {
			const newDeviceId = (typeof device_id === 'string' && device_id) || `dev-${crypto.randomUUID()}`;
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
				.bind(newDeviceId, branch.id, branch.name || '', cleanDeviceName, now, now)
				.run();
			device = { id: newDeviceId, name: cleanDeviceName, branch_id: branch.id, branch_name: branch.name || '' };
			await createDeviceSession(d1, device, cookies, url.protocol === 'https:');
		}

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

		return json({
			success: true,
			user: {
				id: userId,
				username: cleanUsername,
				name: cleanName,
				role: 'admin',
				branch_id: 'all',
				active: true
			},
			branch,
			device
		});
	} catch (err: any) {
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
