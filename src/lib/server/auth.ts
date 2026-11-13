import { json, type Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'kasir_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface AuthSession {
	userId: string;
	role: 'admin' | 'cashier';
	branchId: string;
}

function generateToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export async function createSession(
	d1: D1Database,
	user: { id: string; role: string; branch_id: string },
	cookies: Cookies,
	secure: boolean
): Promise<void> {
	const token = generateToken();
	const now = new Date();
	const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

	await d1
		.prepare(
			'INSERT INTO sessions (token, user_id, role, branch_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.bind(token, user.id, user.role, user.branch_id, now.toISOString(), expires.toISOString())
		.run();

	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: SESSION_TTL_SECONDS
	});
}

export async function getSession(d1: D1Database, cookies: Cookies): Promise<AuthSession | null> {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return null;

	try {
		const row = await d1
			.prepare(
				`SELECT u.id, u.role, u.branch_id, u.active, s.expires_at
				 FROM sessions s
				 JOIN users u ON u.id = s.user_id
				 WHERE s.token = ?`
			)
			.bind(token)
			.first<{ id: string; role: string; branch_id: string; active: number; expires_at: string }>();

		if (!row || !row.active) return null;

		if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
			await d1.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
			return null;
		}

		return {
			userId: row.id,
			role: row.role === 'admin' ? 'admin' : 'cashier',
			branchId: row.branch_id
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
