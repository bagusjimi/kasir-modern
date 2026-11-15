import { json, type Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'kasir_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface AuthSession {
	userId: string;
	role: 'admin' | 'cashier';
	branchId: string;
	// 'device' = sesi terminal/toko (lapis inisialisasi toko), 'user' = sesi admin (lapis orang)
	kind: 'user' | 'device';
	name?: string | null;
}

function generateToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export async function createSession(
	d1: D1Database,
	user: { id: string; role: string; branch_id: string; name?: string | null; kind?: 'user' | 'device' },
	cookies: Cookies,
	secure: boolean
): Promise<void> {
	const token = generateToken();
	const now = new Date();
	const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
	const kind = user.kind || 'user';

	await d1
		.prepare(
			'INSERT INTO sessions (token, user_id, role, branch_id, kind, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
		)
		.bind(token, user.id, user.role, user.branch_id, kind, user.name ?? null, now.toISOString(), expires.toISOString())
		.run();

	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: SESSION_TTL_SECONDS
	});
}

/**
 * Membuat sesi terminal/toko: perangkat diikat ke satu cabang. Identitas operator
 * (siapa yang memegang laci) TIDAK disimpan di sesi ini, melainkan pada shift.
 */
export async function createDeviceSession(
	d1: D1Database,
	device: { id: string; name: string; branch_id: string },
	cookies: Cookies,
	secure: boolean
): Promise<void> {
	await createSession(
		d1,
		{ id: device.id, role: 'cashier', branch_id: device.branch_id, name: device.name, kind: 'device' },
		cookies,
		secure
	);
}

export async function getSession(d1: D1Database, cookies: Cookies): Promise<AuthSession | null> {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return null;

	try {
		const row = await d1
			.prepare(
				`SELECT s.user_id, s.role, s.branch_id, s.kind, s.name, s.expires_at,
				        u.active
				 FROM sessions s
				 LEFT JOIN users u ON u.id = s.user_id
				 WHERE s.token = ?`
			)
			.bind(token)
			.first<{ user_id: string; role: string; branch_id: string; kind: string | null; name: string | null; active: number | null; expires_at: string }>();

		if (!row) return null;

		// Sesi admin (user) tetap divalidasi terhadap status aktif akun.
		// Sesi perangkat tidak terikat akun pengguna, jadi tidak ada pengecekan 'active'.
		if (row.kind !== 'device' && !row.active) return null;

		if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
			await d1.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
			return null;
		}

		return {
			userId: row.user_id,
			role: row.role === 'admin' ? 'admin' : 'cashier',
			branchId: row.branch_id,
			kind: row.kind === 'device' ? 'device' : 'user',
			name: row.name
		};
	} catch {
		return null;
	}
}

export async function destroySession(d1: D1Database | null, cookies: Cookies): Promise<void> {
	const token = cookies.get(SESSION_COOKIE);
	if (d1 && token) {
		try {
			await d1.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
		} catch {
			// abaikan kegagalan penghapusan session
		}
	}
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function unauthorized(): Response {
	return json(
		{ success: false, message: 'Tidak diizinkan: sesi tidak valid atau sudah berakhir' },
		{ status: 401 }
	);
}

export function forbidden(): Response {
	return json({ success: false, message: 'Akses ditolak: fitur ini khusus admin' }, { status: 403 });
}
