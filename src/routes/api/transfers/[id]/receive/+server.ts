import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import type { StockTransferItem } from '#lib/types/index.js';

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

		// Cari transfer di database
		const transfer = await d1
			.prepare('SELECT * FROM stock_transfers WHERE id = ?')
			.bind(transferId)
			.first<any>();

		if (!transfer) {
			return json({ success: false, message: 'Data transfer stok tidak ditemukan' }, { status: 404 });
		}

		if (transfer.status === 'completed') {
			return json({ success: false, message: 'Barang sudah pernah diterima sebelumnya (status: completed)' }, { status: 400 });
		}

		if (transfer.status === 'cancelled') {
			return json({ success: false, message: 'Transfer stok sudah dibatalkan, barang tidak dapat diterima' }, { status: 400 });
		}

		const body = await request.json().catch(() => ({})) as any;
		const { received_by = 'admin', received_by_name = 'Admin Cabang', items_received, notes = '' } = body || {};

		// Ambil items dari transfer ini
		const itemsResult = await d1
			.prepare(`
				SELECT sti.*, p.sku, p.name, p.category, p.price, p.cost_price, p.unit, p.barcode
				FROM stock_transfer_items sti
				LEFT JOIN products p ON sti.product_id = p.id
				WHERE sti.transfer_id = ?
			`)
			.bind(transferId)
			.all<any>();

		const transferItems = (itemsResult.results || []) as any[];
		if (transferItems.length === 0) {
			return json({ success: false, message: 'Item transfer tidak ditemukan' }, { status: 400 });
		}

		// Ambil data cabang penerima & pengirim
		const [srcBranch, destBranch] = await Promise.all([
			d1.prepare('SELECT name FROM branches WHERE id = ?').bind(transfer.source_branch_id).first<any>(),
			d1.prepare('SELECT name FROM branches WHERE id = ?').bind(transfer.destination_branch_id).first<any>()
		]);

		const now = new Date().toISOString();
		const batchStatements: any[] = [];

		// 1. Update status transfer menjadi 'completed'
		batchStatements.push(
			d1.prepare(`
				UPDATE stock_transfers
				SET status = 'completed',
				    updated_at = ?,
				    notes = CASE WHEN ? != '' THEN COALESCE(notes || ' | ', '') || ? ELSE notes END
				WHERE id = ?
			`).bind(now, notes, notes, transferId)
		);

		// 2. Untuk setiap item: update quantity_received dan tambahkan stok ke cabang tujuan
		for (const item of transferItems) {
			// Jika client mengirim detail per item received, gunakan nilai itu; fallback ke item.quantity_sent
			let qtyReceived = item.quantity_sent;
			if (Array.isArray(items_received)) {
				const match = items_received.find((r: any) => r.item_id === item.id || r.product_id === item.product_id);
				if (match && typeof match.quantity_received === 'number') {
					qtyReceived = match.quantity_received;
				}
			}

			// Update stock_transfer_items dengan kuantitas yang diterima
			batchStatements.push(
				d1.prepare(`
					UPDATE stock_transfer_items
					SET quantity_received = ?
					WHERE id = ?
				`).bind(qtyReceived, item.id)
			);

			// Tambah stok ke cabang penerima:
			// Cek apakah ada record produk yang spesifik untuk destination_branch_id dengan SKU/Barcode yang sama,
			// atau jika produk tersebut bertipe global / per-cabang.
			const destProduct = await d1
				.prepare('SELECT id, stock FROM products WHERE (sku = ? OR (barcode IS NOT NULL AND barcode != "" AND barcode = ?)) AND branch_id = ?')
				.bind(item.sku, item.barcode || '', transfer.destination_branch_id)
				.first<any>();

			if (destProduct) {
				// Cabang tujuan sudah memiliki produk dengan SKU yang sama -> Update stoknya
				batchStatements.push(
					d1.prepare(`
						UPDATE products
						SET stock = stock + ?,
						    version = version + 1,
						    updated_at = ?
						WHERE id = ?
					`).bind(qtyReceived, now, destProduct.id)
				);
			} else {
				// Jika cabang tujuan belum memiliki produk dengan SKU itu:
				// Buat produk baru khusus cabang tujuan dengan data produk asal
				const newProdId = `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
				batchStatements.push(
					d1.prepare(`
						INSERT INTO products (
							id, branch_id, sku, barcode, name, category, price, cost_price,
							stock, unit, image_url, is_active, version, created_at, updated_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, 1, ?, ?)
					`).bind(
						newProdId,
						transfer.destination_branch_id,
						item.sku,
						item.barcode || '',
						item.name,
						item.category || 'Lainnya',
						item.price || 0,
						item.cost_price || 0,
						qtyReceived,
						item.unit || 'pcs',
						now,
						now
					)
				);
			}
		}

		// 3. Catat Activity Log penerimaan barang
		const srcName = srcBranch?.name || transfer.source_branch_id;
		const destName = destBranch?.name || transfer.destination_branch_id;
		const totalReceivedQty = transferItems.reduce((acc, cur) => acc + cur.quantity_sent, 0);

		batchStatements.push(
			d1.prepare(`
				INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).bind(
				`act-${Date.now()}`,
				transfer.destination_branch_id,
				destName,
				received_by,
				received_by_name,
				'admin',
				'receive_stock_transfer',
				`Konfirmasi Penerimaan #${transfer.transfer_number}: ${transferItems.length} produk (${totalReceivedQty} item) dari ${srcName} telah masuk inventaris ${destName}`,
				now
			)
		);

		await d1.batch(batchStatements);

		return json({
			success: true,
			message: `Penerimaan barang surat jalan #${transfer.transfer_number} berhasil dikonfirmasi. Stok telah ditambahkan ke cabang ${destName}.`,
			data: {
				id: transferId,
				transfer_number: transfer.transfer_number,
				status: 'completed',
				updated_at: now
			}
		});
	} catch (err: any) {
		console.error('Error receiving stock transfer:', err);
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
