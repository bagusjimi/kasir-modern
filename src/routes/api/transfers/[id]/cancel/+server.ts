import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';

export const PUT: RequestHandler = async ({ params, request, platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const transferId = params.id;
		if (!transferId) {
			return json({ success: false, message: 'ID transfer diperlukan' }, { status: 400 });
		}

		// Cari transfer
		const transfer = await d1
			.prepare('SELECT * FROM stock_transfers WHERE id = ?')
			.bind(transferId)
			.first<any>();

		if (!transfer) {
			return json({ success: false, message: 'Data transfer stok tidak ditemukan' }, { status: 404 });
		}

		if (transfer.status === 'completed') {
			return json({ success: false, message: 'Transfer sudah selesai, tidak dapat dibatalkan' }, { status: 400 });
		}

		if (transfer.status === 'cancelled') {
			return json({ success: false, message: 'Transfer sudah berstatus dibatalkan' }, { status: 400 });
		}

		const body = await request.json().catch(() => ({})) as any;
		const { cancelled_by = 'admin', cancelled_by_name = 'Admin', reason = '' } = body || {};

		// Ambil item yang sempat dipotong
		const itemsResult = await d1
			.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?')
			.bind(transferId)
			.all<any>();

		const items = (itemsResult.results || []) as any[];
		const now = new Date().toISOString();
		const batchStatements: any[] = [];

		// 1. Ubah status menjadi 'cancelled'
		const cancelNote = reason ? `Dibatalkan: ${reason}` : 'Dibatalkan oleh admin';
		batchStatements.push(
			d1.prepare(`
				UPDATE stock_transfers
				SET status = 'cancelled',
				    updated_at = ?,
				    notes = CASE WHEN notes IS NOT NULL AND notes != '' THEN notes || ' | ' || ? ELSE ? END
				WHERE id = ?
			`).bind(now, cancelNote, cancelNote, transferId)
		);

		// 2. Kembalikan kuantitas stok produk ke toko asal
		for (const item of items) {
			batchStatements.push(
				d1.prepare(`
					UPDATE products
					SET stock = stock + ?,
					    version = version + 1,
					    updated_at = ?
					WHERE id = ?
				`).bind(item.quantity_sent, now, item.product_id)
			);
		}

		// 3. Catat Activity Log pembatalan
		batchStatements.push(
			d1.prepare(`
				INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).bind(
				`act-${Date.now()}`,
				transfer.source_branch_id,
				transfer.source_branch_id,
				cancelled_by,
				cancelled_by_name,
				'admin',
				'cancel_stock_transfer',
				`Transfer #${transfer.transfer_number} dibatalkan: Stok barang dikembalikan ke toko asal. Alasan: ${cancelNote}`,
				now
			)
		);

		await d1.batch(batchStatements);

		return json({
			success: true,
			message: `Transfer #${transfer.transfer_number} berhasil dibatalkan dan stok produk dikembalikan ke toko asal.`,
			data: {
				id: transferId,
				transfer_number: transfer.transfer_number,
				status: 'cancelled',
				updated_at: now
			}
		});
	} catch (err: any) {
		console.error('Error cancelling stock transfer:', err);
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
