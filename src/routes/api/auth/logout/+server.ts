import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1 } from '#lib/server/db.js';
import { destroySession } from '#lib/server/auth.js';

export const POST: RequestHandler = async ({ platform, cookies }) => {
	const d1 = getD1(platform);
	await destroySession(d1, cookies);
	return json({ success: true, message: 'Berhasil keluar' });
};
