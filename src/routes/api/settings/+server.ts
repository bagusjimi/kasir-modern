import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { getSession, unauthorized, forbidden } from '#lib/server/auth.js';
import type { TaxSettings } from '#lib/types/index.js';

export const GET: RequestHandler = async ({ platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({
			success: true,
			data: {
				enabled: true,
				rate: 11,
				name: 'PPN'
			}
		});
	}

	try {
		await ensureD1Seeded(d1);

		const session = await getSession(d1, cookies);
		if (!session) return unauthorized();

		const row = await d1
			.prepare('SELECT value FROM app_settings WHERE key = ?')
			.bind('tax_settings')
			.first<{ value: string }>();

		if (row && row.value) {
			const parsed = JSON.parse(row.value) as TaxSettings;
			return json({ success: true, data: parsed });
		}

		const defaultSettings: TaxSettings = {
			enabled: true,
			rate: 11,
			name: 'PPN'
		};
		return json({ success: true, data: defaultSettings });
	} catch (err: any) {
		console.error('Error fetching tax settings:', err);
		return json({ success: false, message: err.message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	const d1 = getD1(platform);
	if (d1) {
		await ensureD1Seeded(d1);

		const session = await getSession(d1, cookies);
		if (!session) return unauthorized();
		if (session.role !== 'admin') return forbidden();
	}

	const body = (await request.json()) as any;
	const { enabled, rate, name } = body;

	if (typeof enabled !== 'boolean' || typeof rate !== 'number' || !name) {
		return json({ success: false, message: 'Data pengaturan pajak tidak valid' }, { status: 400 });
	}

	const updatedSettings: TaxSettings = {
		enabled,
		rate: Math.max(0, rate),
		name: name.trim(),
		updated_at: new Date().toISOString()
	};

	if (d1) {
		try {
			await ensureD1Seeded(d1);
			await d1
				.prepare(
					`INSERT INTO app_settings (key, value, updated_at)
					 VALUES ('tax_settings', ?, ?)
					 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
				)
				.bind(JSON.stringify(updatedSettings), updatedSettings.updated_at)
				.run();
		} catch (err: any) {
			console.error('Error saving tax settings to D1:', err);
			return json({ success: false, message: err.message }, { status: 500 });
		}
	}

	return json({
		success: true,
		message: 'Pengaturan pajak berhasil disimpan',
		data: updatedSettings
	});
};
