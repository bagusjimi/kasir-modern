import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getD1, ensureD1Seeded } from '#lib/server/db.js';
import { getSession, unauthorized } from '#lib/server/auth.js';
import { hashPin, isHashedPin } from '#lib/auth/pin.js';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		const payload = (await request.json()) as any;
		const { transactions = [], activity_logs = [], expenses = [], stock_movements = [], shifts = [], purchases = [], stock_counts = [], stock_transfers = [], queue = [], lastSyncedAt = null } = payload || {};

		// Eksekusi dikelompokkan per item sumber: kegagalan satu item
		// tidak menggagalkan item lain (d1.batch bersifat atomik per grup).
		const groups: { key: string; statements: any[] }[] = [];
		const failedItems: string[] = [];
		let statements: any[] = [];
		const flush = (key: string) => {
			if (statements.length > 0) {
				groups.push({ key, statements });
			}
			statements = [];
		};
		const now = new Date().toISOString();

		// 0. Sinkronisasi Pengeluaran (Expenses)
		for (const exp of expenses) {
			statements.push(
				d1.prepare(`
					INSERT INTO expenses (id, branch_id, branch_name, user_id, user_name, category, amount, description, recipient, receipt_number, date, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO UPDATE SET
						branch_id = excluded.branch_id,
						branch_name = excluded.branch_name,
						category = excluded.category,
						amount = excluded.amount,
						description = excluded.description,
						recipient = excluded.recipient,
						receipt_number = excluded.receipt_number,
						date = excluded.date,
						updated_at = excluded.updated_at
				`).bind(
					exp.id, exp.branch_id, exp.branch_name || '', exp.user_id,
					exp.user_name, exp.category, Number(exp.amount), exp.description,
					exp.recipient || '', exp.receipt_number || '', exp.date,
					exp.created_at || now, now
				)
			);
			flush('expense:' + exp.id);
		}

		// 1. Sinkronisasi Transaksi (stok hanya dikurangi untuk transaksi yang benar-benar baru)
		const existingTxIds = new Set<string>();
		if (transactions.length > 0) {
			const txIdPlaceholders = transactions.map(() => '?').join(',');
			const existingRes = await d1
				.prepare(`SELECT id FROM transactions WHERE id IN (${txIdPlaceholders})`)
				.bind(...transactions.map((t: any) => t.id))
				.all();
			for (const row of existingRes.results || []) {
				existingTxIds.add((row as any).id);
			}
		}

		for (const tx of transactions) {
			statements.push(
				d1.prepare(`
					INSERT INTO transactions (id, invoice_no, branch_id, branch_name, cashier_id, cashier_name, customer_name, subtotal, discount, tax, total, payment_method, amount_paid, change, status, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO UPDATE SET
						status = excluded.status,
						updated_at = excluded.updated_at
				`).bind(
					tx.id, tx.invoice_no, tx.branch_id, tx.branch_name, tx.cashier_id,
					tx.cashier_name, tx.customer_name || '', tx.subtotal, tx.discount || 0,
					tx.tax || 0, tx.total, tx.payment_method, tx.amount_paid, tx.change || 0,
					tx.status || 'completed', tx.created_at || now, tx.updated_at || now
				)
			);

			if (tx.items && tx.items.length > 0) {
				for (const item of tx.items) {
					statements.push(
						d1.prepare(`
							INSERT INTO transaction_items (id, transaction_id, product_id, product_name, price, cost_price, quantity, subtotal, notes)
							VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
							ON CONFLICT(id) DO NOTHING
						`).bind(
							item.id, tx.id, item.product_id, item.product_name,
							item.price, item.cost_price || 0, item.quantity, item.subtotal, item.notes || ''
						)
					);

					// Kurangi stok di D1 hanya jika transaksi benar-benar baru (idempoten)
					if (item.product_id && !existingTxIds.has(tx.id)) {
						statements.push(
							d1.prepare(`
								UPDATE products
								SET stock = MAX(0, stock - ?),
								    version = version + 1,
								    updated_at = ?
								WHERE id = ?
							`).bind(item.quantity, now, item.product_id)
						);

						// Catat ledger stok keluar (audit)
						statements.push(
							d1.prepare(`
								INSERT INTO stock_movements (id, branch_id, product_id, quantity, type, reference_id, user_id, user_name, created_at)
								VALUES (?, ?, ?, ?, 'sale', ?, ?, ?, ?)
								ON CONFLICT(id) DO NOTHING
							`).bind(
								`mv-sale-${item.id}`, tx.branch_id, item.product_id, -item.quantity,
								tx.id, tx.cashier_id, tx.cashier_name, tx.created_at || now
							)
						);
					}
				}
			}
			flush('tx:' + tx.id);
		}

		// 2. Sinkronisasi Antrean Umum (Produk & User perubahan offline)
		// Deteksi dulu versi produk yang tersimpan agar push yang kalah (versi
		// lebih kecil, mis. dibuat perangkat lain saat offline) bisa diberi tahu
		// ke perangkat pengirim, bukan ditolak diam-diam.
		const supersededItems: { id: string; name: string; local_version: number; server_version: number }[] = [];
		const productQueue = queue.filter((q: any) => q.entity === 'product' && (q.action === 'insert' || q.action === 'update'));
		const effectiveProductVersion = new Map<string, number>();
		if (productQueue.length > 0) {
			const prodIds = [...new Set(productQueue.map((q: any) => q.data.id))];
			const existingProdRes = await d1.prepare(`SELECT id, version FROM products WHERE id IN (${prodIds.map(() => '?').join(',')})`).bind(...prodIds).all();
			for (const row of existingProdRes.results || []) {
				effectiveProductVersion.set((row as any).id, Number((row as any).version) || 1);
			}
		}

		for (const q of queue) {
			try {
				if (q.entity === 'product') {
					const p = q.data;
					// Isolasi cabang: sesi non-admin hanya bisa mencatat produk di cabangnya sendiri
					if (session.branchId !== 'all') p.branch_id = session.branchId;
					if (q.action === 'insert' || q.action === 'update') {
						const incomingVersion = p.version || 1;
						const currentVersion = effectiveProductVersion.get(p.id) || 0;
						if (incomingVersion < currentVersion) {
							supersededItems.push({ id: p.id, name: p.name || p.sku || p.id, local_version: incomingVersion, server_version: currentVersion });
							flush('queue:' + q.id);
							continue;
						}
						effectiveProductVersion.set(p.id, incomingVersion);
						statements.push(
							d1.prepare(`
								INSERT INTO products (id, branch_id, sku, barcode, name, category, price, cost_price, stock, min_stock, unit, image_url, is_active, version, created_at, updated_at)
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
								ON CONFLICT(id) DO UPDATE SET
									name = excluded.name,
									category = excluded.category,
									sku = excluded.sku,
									price = excluded.price,
									cost_price = excluded.cost_price,
									stock = excluded.stock,
									min_stock = excluded.min_stock,
									unit = excluded.unit,
									is_active = excluded.is_active,
									version = excluded.version,
									updated_at = excluded.updated_at
								WHERE excluded.version >= products.version
							`).bind(
								p.id, p.branch_id || 'all', p.sku, p.barcode || '', p.name,
								p.category, p.price, p.cost_price || 0, p.stock || 0, p.min_stock || 0, p.unit || 'pcs',
								p.image_url || '', p.is_active !== undefined ? (p.is_active ? 1 : 0) : 1,
								p.version || 1, p.created_at || now, p.updated_at || now
							)
						);
					} else if (q.action === 'delete') {
						statements.push(
							d1.prepare('DELETE FROM products WHERE id = ?').bind(p.id)
						);
					}
				} else if (q.entity === 'branch') {
					const br = q.data;
					if (q.action === 'insert' || q.action === 'update') {
						// Cegah konflik UNIQUE(code) antar ID sebelum upsert
						statements.push(
							d1.prepare('DELETE FROM branches WHERE code = ? AND id != ?').bind(br.code, br.id)
						);
						statements.push(
							d1.prepare(`
								INSERT INTO branches (id, code, name, address, phone, created_at, updated_at)
								VALUES (?, ?, ?, ?, ?, ?, ?)
								ON CONFLICT(id) DO UPDATE SET
									code = excluded.code,
									name = excluded.name,
									address = excluded.address,
									phone = excluded.phone,
									updated_at = excluded.updated_at
							`).bind(
								br.id, br.code, br.name, br.address || '', br.phone || '',
								br.created_at || now, now
							)
						);
					} else if (q.action === 'delete') {
						statements.push(
							d1.prepare('DELETE FROM branches WHERE id = ?').bind(br.id)
						);
					}
				} else if (q.entity === 'category') {
					const cat = q.data;
					if (q.action === 'insert' || q.action === 'update') {
						// Cegah duplikasi nama kategori antar ID sebelum upsert
						statements.push(
							d1.prepare('DELETE FROM categories WHERE name = ? AND id != ?').bind(cat.name, cat.id)
						);
						statements.push(
							d1.prepare(`
								INSERT INTO categories (id, name, updated_at)
								VALUES (?, ?, ?)
								ON CONFLICT(id) DO UPDATE SET
									name = excluded.name,
									updated_at = excluded.updated_at
							`).bind(cat.id, cat.name, now)
						);
					} else if (q.action === 'delete') {
						statements.push(
							d1.prepare('DELETE FROM categories WHERE id = ?').bind(cat.id)
						);
					}
				} else if (q.entity === 'user') {
					const u = q.data;
					if (q.action === 'insert' || q.action === 'update') {
						// Cegah konflik UNIQUE(username) antar ID: hapus record lama dengan username sama
						// tetapi id berbeda sebelum upsert
						statements.push(
							d1.prepare('DELETE FROM users WHERE username = ? AND id != ?').bind(u.username, u.id)
						);
						const pinHash = u.pin && !isHashedPin(u.pin) ? await hashPin(u.pin) : (u.pin || '');
						statements.push(
							d1.prepare(`
								INSERT INTO users (id, username, name, role, branch_id, pin, active, created_at, updated_at)
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
								ON CONFLICT(id) DO UPDATE SET
									name = excluded.name,
									role = excluded.role,
									branch_id = excluded.branch_id,
									pin = excluded.pin,
									active = excluded.active,
									updated_at = excluded.updated_at
							`).bind(
								u.id, u.username, u.name, u.role, u.branch_id, pinHash,
								u.active !== undefined ? (u.active ? 1 : 0) : 1,
								u.created_at || now, now
							)
						);
					} else if (q.action === 'delete') {
						statements.push(
							d1.prepare('DELETE FROM users WHERE id = ?').bind(u.id)
						);
					}
				} else if (q.entity === 'transaction_adjustment') {
					const adj = q.data;
					if ((adj.type === 'void' || adj.type === 'return') && adj.transaction_id) {
						const existingTx = await d1
							.prepare('SELECT id, branch_id, cashier_id, status FROM transactions WHERE id = ?')
							.bind(adj.transaction_id)
							.first<any>();

						if (existingTx && existingTx.status !== 'completed') {
							continue; // sudah dibatalkan/diretur sebelumnya
						}
						if (existingTx && session.role === 'cashier' && existingTx.cashier_id !== session.userId) {
							continue; // kasir hanya boleh membatalkan transaksinya sendiri
						}

						const newStatus = adj.type === 'void' ? 'voided' : 'refunded';
						const adjBranchId = existingTx?.branch_id || adj.branch_id || 'all';

						// Ubah status transaksi (idempoten: lewati jika penyesuaian sudah tercatat)
						statements.push(
							d1.prepare(`
								UPDATE transactions
								SET status = ?, updated_at = ?
								WHERE id = ? AND NOT EXISTS (SELECT 1 FROM transaction_adjustments WHERE transaction_id = ?)
							`).bind(newStatus, now, adj.transaction_id, adj.transaction_id)
						);
						statements.push(
							d1.prepare(`
								INSERT INTO transaction_adjustments (id, transaction_id, type, reason, user_id, user_name, branch_id, created_at)
								VALUES (?, ?, ?, ?, ?, ?, ?, ?)
								ON CONFLICT(transaction_id) DO NOTHING
							`).bind(
								adj.id || `adj-${adj.transaction_id}`, adj.transaction_id, adj.type,
								adj.reason || '', adj.user_id || session.userId, adj.user_name || '',
								adjBranchId, adj.created_at || now
							)
						);

						// Kembalikan stok per item (idempoten via ledger stock_movements)
						let adjItems: any[] = [];
						if (existingTx) {
							const itemsRes = await d1
								.prepare('SELECT id, product_id, quantity FROM transaction_items WHERE transaction_id = ?')
								.bind(adj.transaction_id)
								.all();
							adjItems = itemsRes.results || [];
						} else {
							const payloadTx = transactions.find((t: any) => t.id === adj.transaction_id);
							adjItems = (payloadTx?.items || []).map((it: any) => ({ id: it.id, product_id: it.product_id, quantity: it.quantity }));
						}

						for (const item of adjItems) {
							if (!item.product_id) continue;
							const mvId = `mv-${adj.type}-${adj.transaction_id}-${item.id || item.product_id}`;
							statements.push(
								d1.prepare(`
									UPDATE products
									SET stock = stock + ?, version = version + 1, updated_at = ?
									WHERE id = ? AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE id = ?)
								`).bind(item.quantity, now, item.product_id, mvId)
							);
							statements.push(
								d1.prepare(`
									INSERT INTO stock_movements (id, branch_id, product_id, quantity, type, reference_id, reason, user_id, user_name, created_at)
									VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
									ON CONFLICT(id) DO NOTHING
								`).bind(
									mvId, adjBranchId, item.product_id, item.quantity, adj.type,
									adj.transaction_id, adj.reason || '', adj.user_id || session.userId,
									adj.user_name || '', adj.created_at || now
								)
							);
						}

						statements.push(
							d1.prepare(`
								INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
								ON CONFLICT(id) DO NOTHING
							`).bind(
								`act-adj-${adj.transaction_id}`, adjBranchId, adjBranchId === 'all' ? 'Pusat' : adjBranchId,
								adj.user_id || session.userId, adj.user_name || session.role, session.role,
								adj.type === 'void' ? 'void_transaction' : 'return_transaction',
								`Transaksi ${adj.transaction_id} ${adj.type === 'void' ? 'dibatalkan' : 'diretur'}: ${adj.reason || '-'}`,
								adj.created_at || now
							)
						);
					}
				} else if (q.entity === 'expense') {
					const exp = q.data;
					if (q.action === 'insert' || q.action === 'update') {
						statements.push(
							d1.prepare(`
								INSERT INTO expenses (id, branch_id, branch_name, user_id, user_name, category, amount, description, recipient, receipt_number, date, created_at, updated_at)
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
								ON CONFLICT(id) DO UPDATE SET
									branch_id = excluded.branch_id,
									branch_name = excluded.branch_name,
									category = excluded.category,
									amount = excluded.amount,
									description = excluded.description,
									recipient = excluded.recipient,
									receipt_number = excluded.receipt_number,
									date = excluded.date,
									updated_at = excluded.updated_at
							`).bind(
								exp.id, exp.branch_id, exp.branch_name || '', exp.user_id,
								exp.user_name, exp.category, Number(exp.amount), exp.description,
								exp.recipient || '', exp.receipt_number || '', exp.date,
								exp.created_at || now, now
							)
						);
					} else if (q.action === 'delete') {
						statements.push(
							d1.prepare('DELETE FROM expenses WHERE id = ?').bind(exp.id)
						);
					}
				}
			} catch (qErr: any) {
				console.warn(`Gagal menyiapkan item antrean ${q.id}:`, qErr);
				statements = [];
				failedItems.push('queue:' + q.id);
			}
			flush('queue:' + q.id);
		}

		// 3. Sinkronisasi Ledger Stok (Stock Movements)
		for (const mv of stock_movements) {
			statements.push(
				d1.prepare(`
					INSERT INTO stock_movements (id, branch_id, product_id, quantity, type, reference_id, reason, user_id, user_name, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO NOTHING
				`).bind(
					mv.id, mv.branch_id, mv.product_id, mv.quantity, mv.type,
					mv.reference_id || '', mv.reason || '', mv.user_id, mv.user_name,
					mv.created_at || now
				)
			);
			flush('mv:' + mv.id);
		}

		// 4. Sinkronisasi Shift Kasir (buka/tutup shift)
		for (const sh of shifts) {
			statements.push(
				d1.prepare(`
					INSERT INTO shifts (id, branch_id, branch_name, cashier_id, cashier_name, opening_cash, opened_at, closed_at, closing_cash, expected_cash, cash_difference, total_sales, cash_sales, non_cash_sales, total_transactions, voided_count, refunded_count, status, note, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO UPDATE SET
						closed_at = excluded.closed_at,
						closing_cash = excluded.closing_cash,
						expected_cash = excluded.expected_cash,
						cash_difference = excluded.cash_difference,
						total_sales = excluded.total_sales,
						cash_sales = excluded.cash_sales,
						non_cash_sales = excluded.non_cash_sales,
						total_transactions = excluded.total_transactions,
						voided_count = excluded.voided_count,
						refunded_count = excluded.refunded_count,
						status = excluded.status,
						note = excluded.note,
						updated_at = excluded.updated_at
				`).bind(
					sh.id, sh.branch_id, sh.branch_name || '', sh.cashier_id, sh.cashier_name,
					Number(sh.opening_cash) || 0, sh.opened_at, sh.closed_at || null,
					sh.closing_cash ?? null, sh.expected_cash ?? null, sh.cash_difference ?? null,
					sh.total_sales ?? null, sh.cash_sales ?? null, sh.non_cash_sales ?? null,
					sh.total_transactions ?? null, sh.voided_count ?? null, sh.refunded_count ?? null,
					sh.status || 'open', sh.note || '', now
				)
			);
			flush('shift:' + sh.id);
		}

		// 5. Sinkronisasi Pembelian Stok dari Supplier
		for (const po of purchases) {
			statements.push(
				d1.prepare(`
					INSERT INTO purchases (id, branch_id, branch_name, supplier_name, supplier_phone, total, note, user_id, user_name, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO NOTHING
				`).bind(
					po.id, po.branch_id, po.branch_name || '', po.supplier_name,
					po.supplier_phone || '', Number(po.total) || 0, po.note || '',
					po.user_id, po.user_name, po.created_at || now, now
				)
			);
			for (const it of po.items || []) {
				statements.push(
					d1.prepare(`
						INSERT INTO purchase_items (id, purchase_id, product_id, product_name, quantity, cost_price, subtotal)
						VALUES (?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO NOTHING
					`).bind(
						it.id, po.id, it.product_id, it.product_name,
						it.quantity, it.cost_price, it.subtotal
					)
				);
			}
			flush('po:' + po.id);
		}

		// 6. Sinkronisasi Stok Opname
		for (const sc of stock_counts) {
			statements.push(
				d1.prepare(`
					INSERT INTO stock_counts (id, branch_id, branch_name, note, user_id, user_name, total_difference_qty, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO NOTHING
				`).bind(
					sc.id, sc.branch_id, sc.branch_name || '', sc.note || '',
					sc.user_id, sc.user_name, Number(sc.total_difference_qty) || 0,
					sc.created_at || now
				)
			);
			for (const it of sc.items || []) {
				statements.push(
					d1.prepare(`
						INSERT INTO stock_count_items (id, stock_count_id, product_id, product_name, system_qty, counted_qty, difference)
						VALUES (?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO NOTHING
					`).bind(
						it.id, sc.id, it.product_id, it.product_name,
						it.system_qty, it.counted_qty, it.difference
					)
				);
			}
			flush('sc:' + sc.id);
		}

		// 6b. Sinkronisasi Transfer Stok Antar Cabang
		for (const trf of stock_transfers) {
			statements.push(
				d1.prepare(`
					INSERT INTO stock_transfers (id, transfer_no, from_branch_id, from_branch_name, to_branch_id, to_branch_name, status, notes, user_id, user_name, received_by, received_by_name, received_at, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO UPDATE SET
						status = excluded.status,
						notes = excluded.notes,
						received_by = excluded.received_by,
						received_by_name = excluded.received_by_name,
						received_at = excluded.received_at,
						updated_at = excluded.updated_at
				`).bind(
					trf.id, trf.transfer_no, trf.from_branch_id, trf.from_branch_name || '',
					trf.to_branch_id, trf.to_branch_name || '', trf.status || 'dikirim',
					trf.notes || '', trf.user_id, trf.user_name,
					trf.received_by || null, trf.received_by_name || null, trf.received_at || null,
					trf.created_at || now, trf.updated_at || now
				)
			);
			for (const it of trf.items || []) {
				statements.push(
					d1.prepare(`
						INSERT INTO stock_transfer_items (id, transfer_id, product_id, product_name, sku, quantity, quantity_received, created_at, price, cost_price, category, unit, min_stock)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET
							quantity = excluded.quantity,
							quantity_received = excluded.quantity_received,
							price = excluded.price,
							cost_price = excluded.cost_price,
							category = excluded.category,
							unit = excluded.unit,
							min_stock = excluded.min_stock
						`).bind(
						it.id, trf.id, it.product_id, it.product_name,
						it.sku || '', Number(it.quantity) || 0,
						Number(it.quantity_received) || 0, it.created_at || trf.created_at || now,
						Number(it.price) || 0, Number(it.cost_price) || 0,
						it.category || '', it.unit || '', Number(it.min_stock) || 0
					)
				);
			}
			flush('trf:' + trf.id);
		}

		// 7. Sinkronisasi Activity Logs
		for (const log of activity_logs) {
			statements.push(
				d1.prepare(`
					INSERT INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO NOTHING
				`).bind(
					log.id, log.branch_id, log.branch_name || '', log.user_id,
					log.user_name, log.role, log.action, log.details, log.timestamp
				)
			);
			flush('log:' + log.id);
		}

		flush('sisa');

		for (const group of groups) {
			try {
				await d1.batch(group.statements);
			} catch (groupErr: any) {
				console.error(`Gagal sinkron item ${group.key}:`, groupErr);
				failedItems.push(group.key);
			}
		}

		// 8. Tarik Pembaruan dari D1 Server (Pull delta changes)
		let updatedProducts: any[] = [];
		let updatedUsers: any[] = [];
		let updatedTransactions: any[] = [];
		let updatedExpenses: any[] = [];
		let updatedMovements: any[] = [];
		let updatedShifts: any[] = [];
		let updatedPurchases: any[] = [];
		let updatedStockCounts: any[] = [];
		let updatedTransfers: any[] = [];
		let branches: any[] = [];
		let categories: any[] = [];

		if (lastSyncedAt) {
			// Isolasi data per cabang: perangkat non-admin hanya menarik data cabangnya
			// sendiri agar IndexedDB kasir tidak menampung data cabang lain.
			// Admin pusat (semua cabang) tetap menerima seluruh data untuk pemantauan.
			const isAdmin = session.branchId === 'all';
			const branchId = session.branchId;

			const prodRes = isAdmin
				? await d1.prepare('SELECT * FROM products WHERE updated_at >= ?').bind(lastSyncedAt).all()
				: await d1.prepare('SELECT * FROM products WHERE updated_at >= ? AND branch_id = ?').bind(lastSyncedAt, branchId).all();
			updatedProducts = prodRes.results || [];

			const userRes = isAdmin
				? await d1.prepare('SELECT id, username, name, role, branch_id, pin, active, created_at, updated_at FROM users WHERE updated_at >= ?').bind(lastSyncedAt).all()
				: await d1.prepare('SELECT id, username, name, role, branch_id, pin, active, created_at, updated_at FROM users WHERE updated_at >= ? AND branch_id = ?').bind(lastSyncedAt, branchId).all();
			updatedUsers = (userRes.results || []).map((u: any) => ({
				...u,
				active: Boolean(u.active)
			}));

			const expRes = isAdmin
				? await d1.prepare('SELECT * FROM expenses WHERE updated_at >= ?').bind(lastSyncedAt).all()
				: await d1.prepare('SELECT * FROM expenses WHERE updated_at >= ? AND branch_id = ?').bind(lastSyncedAt, branchId).all();
			updatedExpenses = expRes.results || [];

			const mvRes = isAdmin
				? await d1.prepare('SELECT * FROM stock_movements WHERE created_at >= ? ORDER BY created_at ASC LIMIT 200').bind(lastSyncedAt).all()
				: await d1.prepare('SELECT * FROM stock_movements WHERE created_at >= ? AND branch_id = ? ORDER BY created_at ASC LIMIT 200').bind(lastSyncedAt, branchId).all();
			updatedMovements = mvRes.results || [];

			const shiftRes = isAdmin
				? await d1.prepare('SELECT * FROM shifts WHERE updated_at >= ? ORDER BY opened_at DESC LIMIT 100').bind(lastSyncedAt).all()
				: await d1.prepare('SELECT * FROM shifts WHERE updated_at >= ? AND branch_id = ? ORDER BY opened_at DESC LIMIT 100').bind(lastSyncedAt, branchId).all();
			updatedShifts = shiftRes.results || [];

			const poRes = isAdmin
				? await d1.prepare('SELECT * FROM purchases WHERE updated_at >= ? ORDER BY created_at DESC LIMIT 100').bind(lastSyncedAt).all()
				: await d1.prepare('SELECT * FROM purchases WHERE updated_at >= ? AND branch_id = ? ORDER BY created_at DESC LIMIT 100').bind(lastSyncedAt, branchId).all();
			updatedPurchases = poRes.results || [];

			const scRes = isAdmin
				? await d1.prepare('SELECT * FROM stock_counts WHERE created_at >= ? ORDER BY created_at DESC LIMIT 100').bind(lastSyncedAt).all()
				: await d1.prepare('SELECT * FROM stock_counts WHERE created_at >= ? AND branch_id = ? ORDER BY created_at DESC LIMIT 100').bind(lastSyncedAt, branchId).all();
			updatedStockCounts = scRes.results || [];

			// Transaksi ikut ditarik agar riwayat per cabang tersedia di semua
			// perangkat cabang tersebut tanpa harus membuka tab laporan lebih dulu.
			const txRes = isAdmin
				? await d1.prepare('SELECT * FROM transactions WHERE updated_at >= ? ORDER BY created_at DESC LIMIT 200').bind(lastSyncedAt).all()
				: await d1.prepare('SELECT * FROM transactions WHERE updated_at >= ? AND branch_id = ? ORDER BY created_at DESC LIMIT 200').bind(lastSyncedAt, branchId).all();
			updatedTransactions = txRes.results || [];

			// Catatan transfer bersifat privat per toko: pengirim melihat catatan keluarnya
			// (belum 'diterima'), penerima hanya melihat catatan penerimaannya sendiri.
			// Admin pusat (semua cabang) menerima semua catatan untuk dipantau (baca-saja).
			// Kegagalan pull transfer tidak boleh menggagalkan seluruh sinkronisasi.
			try {
				const trfRes = session.branchId === 'all'
					? await d1.prepare('SELECT * FROM stock_transfers WHERE updated_at >= ? ORDER BY created_at DESC LIMIT 100').bind(lastSyncedAt).all()
					: await d1.prepare("SELECT * FROM stock_transfers WHERE updated_at >= ? AND ((status != 'diterima' AND from_branch_id = ?) OR (status = 'diterima' AND to_branch_id = ?)) ORDER BY created_at DESC LIMIT 100").bind(lastSyncedAt, session.branchId, session.branchId).all();
				updatedTransfers = trfRes.results || [];
			} catch (trfErr) {
				console.warn('Gagal pull stock_transfers:', trfErr);
			}

			const branchDeltaRes = await d1.prepare('SELECT * FROM branches WHERE updated_at >= ?').bind(lastSyncedAt).all();
			branches = branchDeltaRes.results || [];

			const catDeltaRes = await d1.prepare('SELECT * FROM categories WHERE updated_at >= ?').bind(lastSyncedAt).all();
			categories = catDeltaRes.results || [];
		} else {
			// Jika first sync, kirimkan master data (difilter per cabang untuk non-admin)
			const isAdmin = session.branchId === 'all';
			const branchId = session.branchId;
			const [prodRes, userRes, branchRes, catRes, expRes, mvRes, shiftRes, poRes, scRes, txRes] = await d1.batch([
				isAdmin
					? d1.prepare('SELECT * FROM products WHERE is_active = 1')
					: d1.prepare('SELECT * FROM products WHERE is_active = 1 AND branch_id = ?').bind(branchId),
				isAdmin
					? d1.prepare('SELECT id, username, name, role, branch_id, pin, active, created_at, updated_at FROM users WHERE active = 1')
					: d1.prepare('SELECT id, username, name, role, branch_id, pin, active, created_at, updated_at FROM users WHERE active = 1 AND branch_id = ?').bind(branchId),
				d1.prepare('SELECT * FROM branches'),
				d1.prepare('SELECT * FROM categories'),
				isAdmin
					? d1.prepare('SELECT * FROM expenses ORDER BY date DESC LIMIT 200')
					: d1.prepare('SELECT * FROM expenses WHERE branch_id = ? ORDER BY date DESC LIMIT 200').bind(branchId),
				isAdmin
					? d1.prepare('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 200')
					: d1.prepare('SELECT * FROM stock_movements WHERE branch_id = ? ORDER BY created_at DESC LIMIT 200').bind(branchId),
				isAdmin
					? d1.prepare('SELECT * FROM shifts ORDER BY opened_at DESC LIMIT 100')
					: d1.prepare('SELECT * FROM shifts WHERE branch_id = ? ORDER BY opened_at DESC LIMIT 100').bind(branchId),
				isAdmin
					? d1.prepare('SELECT * FROM purchases ORDER BY created_at DESC LIMIT 100')
					: d1.prepare('SELECT * FROM purchases WHERE branch_id = ? ORDER BY created_at DESC LIMIT 100').bind(branchId),
				isAdmin
					? d1.prepare('SELECT * FROM stock_counts ORDER BY created_at DESC LIMIT 100')
					: d1.prepare('SELECT * FROM stock_counts WHERE branch_id = ? ORDER BY created_at DESC LIMIT 100').bind(branchId),
				isAdmin
					? d1.prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200')
					: d1.prepare('SELECT * FROM transactions WHERE branch_id = ? ORDER BY created_at DESC LIMIT 200').bind(branchId)
			]);

			updatedProducts = prodRes.results || [];
			updatedUsers = (userRes.results || []).map((u: any) => ({
				...u,
				active: Boolean(u.active)
			}));
			branches = branchRes.results || [];
			categories = catRes.results || [];
			updatedExpenses = expRes.results || [];
			updatedMovements = mvRes.results || [];
			updatedShifts = shiftRes.results || [];
			updatedPurchases = poRes.results || [];
			updatedStockCounts = scRes.results || [];
			updatedTransactions = txRes.results || [];

			// Catatan transfer privat per toko (lihat komentar di blok delta pull);
			// admin pusat menerima semua catatan untuk dipantau (baca-saja).
			// Di luar batch agar kegagalan tidak menggagalkan master data lain.
			try {
				const trfRes = session.branchId === 'all'
					? await d1.prepare('SELECT * FROM stock_transfers ORDER BY created_at DESC LIMIT 100').all()
					: await d1.prepare("SELECT * FROM stock_transfers WHERE (status != 'diterima' AND from_branch_id = ?) OR (status = 'diterima' AND to_branch_id = ?) ORDER BY created_at DESC LIMIT 100").bind(session.branchId, session.branchId).all();
				updatedTransfers = trfRes.results || [];
			} catch (trfErr) {
				console.warn('Gagal pull stock_transfers:', trfErr);
			}
		}

		// Pengaturan pajak & identitas toko (global): first-sync selalu dikirim, delta hanya jika berubah
		let taxSettings: any = null;
		let storeSettings: any = null;
		const settingsRes = await d1
			.prepare("SELECT key, value, updated_at FROM app_settings WHERE key IN ('tax_settings', 'store_settings')")
			.all();
		for (const row of settingsRes.results || []) {
			const r = row as { key: string; value: string; updated_at: string };
			if (!r.value) continue;
			if (lastSyncedAt && !(r.updated_at && r.updated_at >= lastSyncedAt)) continue;
			try {
				if (r.key === 'tax_settings') taxSettings = JSON.parse(r.value);
				if (r.key === 'store_settings') storeSettings = JSON.parse(r.value);
			} catch {
				// Nilai JSON rusak: lewati
			}
		}

		// Pengaturan pembayaran per cabang: hanya sesi non-admin (kasir menerima pengaturan tokonya sendiri)
		let paymentSettings: any = null;
		if (session.branchId && session.branchId !== 'all') {
			try {
				const payRow = await d1
					.prepare('SELECT value, updated_at FROM app_settings WHERE key = ?')
					.bind('payment_settings:' + session.branchId)
					.first<{ value: string; updated_at: string }>();
				if (payRow && payRow.value && (!lastSyncedAt || (payRow.updated_at && payRow.updated_at >= lastSyncedAt))) {
					paymentSettings = JSON.parse(payRow.value);
				}
			} catch {
				// Nilai JSON rusak: lewati
			}
		}

		// Lampirkan item untuk transaksi yang ditarik dari server
		if (updatedTransactions.length > 0) {
			const txIds = updatedTransactions.map((t: any) => t.id);
			const txItemsRes = await d1
				.prepare(`SELECT * FROM transaction_items WHERE transaction_id IN (${txIds.map(() => '?').join(',')})`)
				.bind(...txIds)
				.all();
			const itemsByTx: Record<string, any[]> = {};
			for (const it of txItemsRes.results || []) {
				(itemsByTx[(it as any).transaction_id] ||= []).push(it);
			}
			updatedTransactions = updatedTransactions.map((t: any) => ({ ...t, items: itemsByTx[t.id] || [] }));
		}

		// Lampirkan item untuk pembelian dan opname yang ditarik dari server
		if (updatedPurchases.length > 0) {
			const poIds = updatedPurchases.map((p: any) => p.id);
			const poItemsRes = await d1
				.prepare(`SELECT * FROM purchase_items WHERE purchase_id IN (${poIds.map(() => '?').join(',')})`)
				.bind(...poIds)
				.all();
			const itemsByPo: Record<string, any[]> = {};
			for (const it of poItemsRes.results || []) {
				(itemsByPo[(it as any).purchase_id] ||= []).push(it);
			}
			updatedPurchases = updatedPurchases.map((p: any) => ({ ...p, items: itemsByPo[p.id] || [] }));
		}

		if (updatedStockCounts.length > 0) {
			const scIds = updatedStockCounts.map((s: any) => s.id);
			const scItemsRes = await d1
				.prepare(`SELECT * FROM stock_count_items WHERE stock_count_id IN (${scIds.map(() => '?').join(',')})`)
				.bind(...scIds)
				.all();
			const itemsBySc: Record<string, any[]> = {};
			for (const it of scItemsRes.results || []) {
				(itemsBySc[(it as any).stock_count_id] ||= []).push(it);
			}
			updatedStockCounts = updatedStockCounts.map((s: any) => ({ ...s, items: itemsBySc[s.id] || [] }));
		}

		if (updatedTransfers.length > 0) {
			const trfIds = updatedTransfers.map((t: any) => t.id);
			const trfItemsRes = await d1
				.prepare(`SELECT * FROM stock_transfer_items WHERE transfer_id IN (${trfIds.map(() => '?').join(',')})`)
				.bind(...trfIds)
				.all();
			const itemsByTrf: Record<string, any[]> = {};
			for (const it of trfItemsRes.results || []) {
				(itemsByTrf[(it as any).transfer_id] ||= []).push(it);
			}
			updatedTransfers = updatedTransfers.map((t: any) => ({ ...t, items: itemsByTrf[t.id] || [] }));
		}

		return json({
			success: true,
			message: `Sinkronisasi D1 berhasil: ${transactions.length} transaksi, ${expenses.length} pengeluaran, ${activity_logs.length} log, ${queue.length} antrean.`,
			syncedAt: now,
			failed_items: failedItems,
			superseded_items: supersededItems,
			serverUpdates: {
				products: updatedProducts,
				users: updatedUsers,
				transactions: updatedTransactions,
				branches,
				categories,
				expenses: updatedExpenses,
				stock_movements: updatedMovements,
				shifts: updatedShifts,
				purchases: updatedPurchases,
				stock_counts: updatedStockCounts,
				stock_transfers: updatedTransfers,
				...(taxSettings ? { tax_settings: taxSettings } : {}),
				...(storeSettings ? { store_settings: storeSettings } : {}),
				...(paymentSettings ? { payment_settings: paymentSettings } : {})
			}
		});
	} catch (error: any) {
		console.error('Error saat sinkronisasi D1:', error);
		return json(
			{
				success: false,
				message: error.message || 'Gagal memproses sinkronisasi di D1'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ platform, cookies }) => {
	const d1 = getD1(platform);
	if (!d1) {
		return json({ success: false, message: 'D1 database binding DB tidak ditemukan' }, { status: 503 });
	}

	await ensureD1Seeded(d1);

	const session = await getSession(d1, cookies);
	if (!session) return unauthorized();

	try {
		// Isolasi cabang: sesi non-admin hanya melihat log & ringkasan cabangnya sendiri
		const isAdmin = session.branchId === 'all';
		const logSql = isAdmin
			? 'SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 50'
			: 'SELECT * FROM activity_logs WHERE branch_id = ? ORDER BY timestamp DESC LIMIT 50';
		const summarySql = `
			SELECT 
				COUNT(*) as total_transactions,
				COALESCE(SUM(total), 0) as total_revenue,
				branch_id, branch_name
			FROM transactions
			WHERE status = 'completed'
			${isAdmin ? '' : 'AND branch_id = ?'}
			GROUP BY branch_id
		`;
		const [recentLogs, txSummary] = await d1.batch([
			isAdmin ? d1.prepare(logSql) : d1.prepare(logSql).bind(session.branchId),
			isAdmin ? d1.prepare(summarySql) : d1.prepare(summarySql).bind(session.branchId)
		]);

		return json({
			success: true,
			activityLogs: recentLogs.results || [],
			branchSummaries: txSummary.results || []
		});
	} catch (e: any) {
		return json({ success: false, message: e.message }, { status: 500 });
	}
};
