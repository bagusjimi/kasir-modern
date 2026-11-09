import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import type { StockTransfer, StockTransferItem } from '#lib/types/index.js';

export const GET: RequestHandler = async ({ url, platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const sourceBranchId = url.searchParams.get('source_branch_id');
		const destinationBranchId = url.searchParams.get('destination_branch_id');
		const branchId = url.searchParams.get('branch_id');
		const status = url.searchParams.get('status');
		const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 200);

		let sql = `
			SELECT
				st.*,
				sb.name as source_branch_name,
				db.name as destination_branch_name,
				u.name as created_by_name
			FROM stock_transfers st
			LEFT JOIN branches sb ON st.source_branch_id = sb.id
			LEFT JOIN branches db ON st.destination_branch_id = db.id
			LEFT JOIN users u ON st.created_by = u.id
			WHERE 1=1
		`;
		const params: any[] = [];

		if (branchId && branchId !== 'all') {
			sql += ' AND (st.source_branch_id = ? OR st.destination_branch_id = ?)';
			params.push(branchId, branchId);
		}

		if (sourceBranchId) {
			sql += ' AND st.source_branch_id = ?';
			params.push(sourceBranchId);
		}

		if (destinationBranchId) {
			sql += ' AND st.destination_branch_id = ?';
			params.push(destinationBranchId);
		}

		if (status) {
			sql += ' AND st.status = ?';
			params.push(status);
		}

		sql += ' ORDER BY st.created_at DESC LIMIT ?';
		params.push(limit);

		const transfersResult = await d1.prepare(sql).bind(...params).all<StockTransfer>();
		const transfers = (transfersResult.results || []) as StockTransfer[];

		if (transfers.length > 0) {
			const placeholders = transfers.map(() => '?').join(',');
			const transferIds = transfers.map(t => t.id);

			const itemsSql = `
				SELECT
					sti.*,
					p.name as product_name,
					p.sku,
					p.unit
				FROM stock_transfer_items sti
				LEFT JOIN products p ON sti.product_id = p.id
				WHERE sti.transfer_id IN (${placeholders})
			`;

			const itemsResult = await d1.prepare(itemsSql).bind(...transferIds).all<StockTransferItem>();
			const items = (itemsResult.results || []) as StockTransferItem[];

			for (const t of transfers) {
				t.items = items.filter(item => item.transfer_id === t.id);
			}
		}

		return json({
			success: true,
			data: transfers
		});
	} catch (err: any) {
		console.error('Error fetching stock transfers:', err);
		return json({ success: false, message: err.message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	try {
		const body = (await request.json()) as any;
		const {
			source_branch_id,
			destination_branch_id,
			items,
			created_by,
			created_by_name = 'Admin',
			notes = ''
		} = body || {};

		// Validasi input
		if (!source_branch_id || !destination_branch_id) {
			return json(
				{ success: false, message: 'Toko asal (sumber) dan toko tujuan wajib dipilih' },
				{ status: 400 }
			);
		}

		if (source_branch_id === destination_branch_id) {
			return json(
				{ success: false, message: 'Toko asal dan toko tujuan tidak boleh sama' },
				{ status: 400 }
			);
		}

		if (!Array.isArray(items) || items.length === 0) {
			return json(
				{ success: false, message: 'Daftar produk yang akan ditransfer minimal 1 item' },
				{ status: 400 }
			);
		}

		// Validasi setiap item
		for (const item of items) {
			const qty = Number(item.quantity_sent);
			if (!item.product_id || isNaN(qty) || qty <= 0) {
				return json(
					{ success: false, message: 'Jumlah barang yang ditransfer harus lebih besar dari 0' },
					{ status: 400 }
				);
			}
		}

		// Validasi ketersediaan stok di toko asal
		// Produk di source_branch_id atau 'all' (jika produk berlaku global namun stok dicatat per produk)
		const productIds = items.map((it: any) => it.product_id);
		const placeholders = productIds.map(() => '?').join(',');
		const existingProductsResult = await d1
			.prepare(`SELECT id, name, sku, stock, branch_id, unit FROM products WHERE id IN (${placeholders})`)
			.bind(...productIds)
			.all<{ id: string; name: string; sku: string; stock: number; branch_id: string; unit: string }>();

		const existingProductsMap = new Map<string, { id: string; name: string; sku: string; stock: number; branch_id: string; unit: string }>();
		for (const p of existingProductsResult.results || []) {
			existingProductsMap.set(p.id, p);
		}

		for (const item of items) {
			const product = existingProductsMap.get(item.product_id);
			if (!product) {
				return json(
					{ success: false, message: `Produk dengan ID ${item.product_id} tidak ditemukan di sistem` },
					{ status: 400 }
				);
			}

			const requestedQty = Number(item.quantity_sent);
			if (product.stock < requestedQty) {
				return json(
					{
						success: false,
						message: `Stok produk "${product.name}" di toko asal tidak mencukupi. Sisa stok: ${product.stock} ${product.unit}, diminta: ${requestedQty} ${product.unit}`
					},
					{ status: 400 }
				);
			}
		}

		// Ambil data nama cabang untuk log & surat jalan
		const [srcBranch, destBranch] = await Promise.all([
			d1.prepare('SELECT id, code, name FROM branches WHERE id = ?').bind(source_branch_id).first<any>(),
			d1.prepare('SELECT id, code, name FROM branches WHERE id = ?').bind(destination_branch_id).first<any>()
		]);

		const now = new Date();
		const nowIso = now.toISOString();

		// Nomor Surat Jalan otomatis: TRF-YYYYMMDD-XXXX
		const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
		const randomSuffix = Math.floor(1000 + Math.random() * 9000);
		const transferNumber = `TRF-${dateStr}-${randomSuffix}`;
		const transferId = body.id || `trf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

		const batchStatements: any[] = [];

		// 1. Simpan Header Transfer Stok
		batchStatements.push(
			d1.prepare(`
				INSERT INTO stock_transfers (id, transfer_number, source_branch_id, destination_branch_id, status, created_by, created_at, updated_at, notes)
				VALUES (?, ?, ?, ?, 'in_transit', ?, ?, ?, ?)
			`).bind(
				transferId,
				transferNumber,
				source_branch_id,
				destination_branch_id,
				created_by || 'admin',
				nowIso,
				nowIso,
				notes || null
			)
		);

		// 2. Simpan Detail Item Transfer & Potong Stok Produk di Toko Asal (Status: in_transit)
		for (const item of items) {
			const itemId = item.id || `sti-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
			const qtySent = Number(item.quantity_sent);

			batchStatements.push(
				d1.prepare(`
					INSERT INTO stock_transfer_items (id, transfer_id, product_id, quantity_sent, quantity_received, created_at)
					VALUES (?, ?, ?, ?, NULL, ?)
				`).bind(
					itemId,
					transferId,
					item.product_id,
					qtySent,
					nowIso
				)
			);

			// Potong stok di toko asal secara otomatis
			batchStatements.push(
				d1.prepare(`
					UPDATE products
					SET stock = stock - ?,
					    version = version + 1,
					    updated_at = ?
					WHERE id = ?
				`).bind(qtySent, nowIso, item.product_id)
			);
		}

		// 3. Catat Activity Log
		const srcName = srcBranch ? srcBranch.name : source_branch_id;
		const destName = destBranch ? destBranch.name : destination_branch_id;
		const itemCount = items.length;
		const totalQty = items.reduce((acc: number, cur: any) => acc + Number(cur.quantity_sent), 0);

		batchStatements.push(
			d1.prepare(`
				INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).bind(
				`act-${Date.now()}`,
				source_branch_id,
				srcName,
				created_by || 'admin',
				created_by_name || 'Admin',
				'admin',
				'create_stock_transfer',
				`Surat jalan #${transferNumber}: Transfer ${itemCount} jenis produk (${totalQty} item) dari ${srcName} menuju ${destName}`,
				nowIso
			)
		);

		await d1.batch(batchStatements);

		return json(
			{
				success: true,
				message: `Transfer stok #${transferNumber} berhasil dibuat dan stok telah dipotong dari toko asal`,
				data: {
					id: transferId,
					transfer_number: transferNumber,
					source_branch_id,
					source_branch_name: srcName,
					destination_branch_id,
					destination_branch_name: destName,
					status: 'in_transit',
					created_by: created_by || 'admin',
					created_at: nowIso,
					items_count: itemCount,
					total_quantity: totalQty
				}
			},
			{ status: 201 }
		);
	} catch (err: any) {
		console.error('Error creating stock transfer:', err);
		return json({ success: false, message: err.message }, { status: 500 });
	}
};
