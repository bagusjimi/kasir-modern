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

		const storeRow = await d1
			.prepare('SELECT value FROM app_settings WHERE key = ?')
			.bind('store_settings')
			.first<{ value: string }>();
		const store = storeRow && storeRow.value ? JSON.parse(storeRow.value) : { name: '', address: '', phone: '' };

		if (row && row.value) {
			const parsed = JSON.parse(row.value) as TaxSettings;
			return json({ success: true, data: parsed, store });
		}

		const defaultSettings: TaxSettings = {
			enabled: true,
			rate: 11,
			name: 'PPN'
		};
		return json({ success: true, data: defaultSettings, store });
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
	const nowIso = new Date().toISOString();
	let savedStore = false;
	let savedTax = false;

	if (d1) {
		await ensureD1Seeded(d1);

		// Identitas toko (dikirim bersamaan atau terpisah dari pajak)
		if (body.store && typeof body.store === 'object') {
			const s = body.store;
			const storeSettings = {
				name: String(s.name || '').trim(),
				address: String(s.address || '').trim(),
				phone: String(s.phone || '').trim(),
				updated_at: nowIso
			};
			try {
				await d1
					.prepare(
						`INSERT INTO app_settings (key, value, updated_at)
						 VALUES ('store_settings', ?, ?)
						 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
					)
					.bind(JSON.stringify(storeSettings), nowIso)
					.run();
				savedStore = true;
			} catch (err: any) {
				console.error('Error saving store settings to D1:', err);
				return json({ success: false, message: err.message }, { status: 500 });
			}
		}
	}

	const { enabled, rate, name } = body;

	if (typeof enabled === 'boolean' && typeof rate === 'number' && name) {
		const updatedSettings: TaxSettings = {
			enabled,
			rate: Math.max(0, rate),
			name: name.trim(),
			updated_at: nowIso
		};

		if (d1) {
			try {
				await d1
					.prepare(
						`INSERT INTO app_settings (key, value, updated_at)
						 VALUES ('tax_settings', ?, ?)
						 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
					)
					.bind(JSON.stringify(updatedSettings), updatedSettings.updated_at)
					.run();
				savedTax = true;
			} catch (err: any) {
				console.error('Error saving tax settings to D1:', err);
				return json({ success: false, message: err.message }, { status: 500 });
			}
		}

		return json({
			success: true,
			message: 'Pengaturan berhasil disimpan',
			data: updatedSettings
		});
	}

	if (savedStore) {
		return json({ success: true, message: 'Identitas toko berhasil disimpan' });
	}

	return json({ success: false, message: 'Data pengaturan tidak valid' }, { status: 400 });
};
