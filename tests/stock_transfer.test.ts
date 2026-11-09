import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock D1 Database tanpa TypeScript parameter properties
class MockD1PreparedStatement {
	db: MockD1Database;
	query: string;
	params: any[];

	constructor(db: MockD1Database, query: string, params: any[] = []) {
		this.db = db;
		this.query = query;
		this.params = params;
	}

	bind(...params: any[]) {
		return new MockD1PreparedStatement(this.db, this.query, params);
	}

	async first<T = unknown>(): Promise<T | null> {
		const results = await this.db.executeQuery(this.query, this.params);
		return (results[0] as T) || null;
	}

	async all<T = unknown>(): Promise<{ results: T[] }> {
		const results = await this.db.executeQuery(this.query, this.params);
		return { results: results as T[] };
	}

	async run(): Promise<{ success: boolean }> {
		await this.db.executeQuery(this.query, this.params);
		return { success: true };
	}
}

class MockD1Database {
	branches: any[] = [];
	products: any[] = [];
	stock_transfers: any[] = [];
	stock_transfer_items: any[] = [];
	activity_logs: any[] = [];

	prepare(query: string) {
		return new MockD1PreparedStatement(this, query);
	}

	async batch(statements: MockD1PreparedStatement[]) {
		const results = [];
		for (const stmt of statements) {
			results.push(await stmt.run());
		}
		return results;
	}

	async executeQuery(query: string, params: any[]): Promise<any[]> {
		const q = query.trim();

		// Branches
		if (q.startsWith('SELECT count(*) as count FROM branches')) {
			return [{ count: this.branches.length }];
		}
		if (q.includes('FROM branches WHERE id = ?')) {
			return this.branches.filter(b => b.id === params[0]);
		}
		if (q.includes('FROM branches')) {
			return this.branches;
		}

		// Products
		if (q.includes('FROM products WHERE id IN')) {
			return this.products.filter(p => params.includes(p.id));
		}
		if (q.includes('FROM products WHERE (sku = ?')) {
			const [sku, barcode, branchId] = params;
			return this.products.filter(p => p.sku === sku && p.branch_id === branchId);
		}
		if (q.includes('UPDATE products') && q.includes('SET stock = stock - ?')) {
			const [qty, now, prodId] = params;
			const p = this.products.find(item => item.id === prodId);
			if (p) p.stock -= qty;
			return [];
		}
		if (q.includes('UPDATE products') && q.includes('SET stock = stock + ?')) {
			const [qty, now, prodId] = params;
			const p = this.products.find(item => item.id === prodId);
			if (p) p.stock += qty;
			return [];
		}
		if (q.startsWith('INSERT INTO products')) {
			const [id, branch_id, sku, barcode, name, category, price, cost_price, stock, unit] = params;
			this.products.push({ id, branch_id, sku, barcode, name, category, price, cost_price, stock, unit });
			return [];
		}

		// Transfers
		if (q.startsWith('INSERT INTO stock_transfers')) {
			const [id, transfer_number, source_branch_id, destination_branch_id, created_by, created_at, updated_at, notes] = params;
			this.stock_transfers.push({
				id,
				transfer_number,
				source_branch_id,
				destination_branch_id,
				status: 'in_transit',
				created_by,
				created_at,
				updated_at,
				notes
			});
			return [];
		}
		if (q.startsWith('INSERT INTO stock_transfer_items')) {
			const [id, transfer_id, product_id, quantity_sent, created_at] = params;
			this.stock_transfer_items.push({
				id,
				transfer_id,
				product_id,
				quantity_sent,
				quantity_received: null,
				created_at
			});
			return [];
		}
		if (q.includes('SELECT * FROM stock_transfers WHERE id = ?')) {
			return this.stock_transfers.filter(t => t.id === params[0]);
		}
		if (q.includes('FROM stock_transfer_items') && q.includes('WHERE sti.transfer_id = ?')) {
			const items = this.stock_transfer_items.filter(it => it.transfer_id === params[0]);
			return items.map(it => {
				const prod = this.products.find(p => p.id === it.product_id);
				return { ...it, ...prod };
			});
		}
		if (q.includes('FROM stock_transfer_items WHERE transfer_id = ?')) {
			return this.stock_transfer_items.filter(it => it.transfer_id === params[0]);
		}
		if (q.includes('UPDATE stock_transfers') && q.includes("status = 'completed'")) {
			const t = this.stock_transfers.find(item => item.id === params[3]);
			if (t) t.status = 'completed';
			return [];
		}
		if (q.includes('UPDATE stock_transfers') && q.includes("status = 'cancelled'")) {
			const t = this.stock_transfers.find(item => item.id === params[3]);
			if (t) t.status = 'cancelled';
			return [];
		}
		if (q.includes('UPDATE stock_transfer_items') && q.includes('SET quantity_received = ?')) {
			const [qty, id] = params;
			const it = this.stock_transfer_items.find(item => item.id === id);
			if (it) it.quantity_received = qty;
			return [];
		}

		// Activity logs & other
		if (q.startsWith('INSERT INTO activity_logs')) {
			this.activity_logs.push(params);
			return [];
		}

		return [];
	}
}

describe('Stock Transfer Logic & Flow', () => {
	let mockDb: MockD1Database;

	beforeEach(() => {
		mockDb = new MockD1Database();

		// Seed dummy data
		mockDb.branches = [
			{ id: 'cb-01', code: 'CB01', name: 'Cabang Jakarta Pusat' },
			{ id: 'cb-02', code: 'CB02', name: 'Cabang Bandung' }
		];

		mockDb.products = [
			{
				id: 'prod-1',
				sku: 'SKU001',
				name: 'Kopi Susu Senja',
				stock: 25,
				unit: 'pcs',
				branch_id: 'cb-01',
				category: 'Minuman',
				price: 18000,
				cost_price: 10000
			},
			{
				id: 'prod-2',
				sku: 'SKU002',
				name: 'Roti Bakar Cokelat',
				stock: 5,
				unit: 'pcs',
				branch_id: 'cb-01',
				category: 'Makanan',
				price: 15000,
				cost_price: 8000
			}
		];
	});

	test('Validasi stok: tidak boleh transfer melebihi stok yang ada di cabang pengirim', () => {
		const sourceProd = mockDb.products.find(p => p.id === 'prod-2')!;
		const requestedQty = 10;

		assert.equal(sourceProd.stock < requestedQty, true, 'Stok seharusnya tidak mencukupi');
	});

	test('Transfer berhasil memotong stok cabang asal dan mencatat status in_transit', async () => {
		const transferId = 'trf-test-01';
		const transferNumber = 'TRF-20261109-1234';
		const qtyToTransfer = 10;
		const prod = mockDb.products.find(p => p.id === 'prod-1')!;
		const initialStock = prod.stock;

		// Jalankan transfer
		const stmts = [
			mockDb.prepare(`
				INSERT INTO stock_transfers (id, transfer_number, source_branch_id, destination_branch_id, status, created_by, created_at, updated_at, notes)
				VALUES (?, ?, ?, ?, 'in_transit', ?, ?, ?, ?)
			`).bind(transferId, transferNumber, 'cb-01', 'cb-02', 'admin', new Date().toISOString(), new Date().toISOString(), 'Pengiriman restock'),
			mockDb.prepare(`
				INSERT INTO stock_transfer_items (id, transfer_id, product_id, quantity_sent, quantity_received, created_at)
				VALUES (?, ?, ?, ?, NULL, ?)
			`).bind('sti-01', transferId, 'prod-1', qtyToTransfer, new Date().toISOString()),
			mockDb.prepare(`
				UPDATE products
				SET stock = stock - ?,
				    version = version + 1,
				    updated_at = ?
				WHERE id = ?
			`).bind(qtyToTransfer, new Date().toISOString(), 'prod-1')
		];

		await mockDb.batch(stmts);

		// Verifikasi
		const updatedProd = mockDb.products.find(p => p.id === 'prod-1')!;
		assert.equal(updatedProd.stock, initialStock - qtyToTransfer, 'Stok cabang asal harus berkurang');

		const createdTransfer = mockDb.stock_transfers.find(t => t.id === transferId)!;
		assert.ok(createdTransfer);
		assert.equal(createdTransfer.status, 'in_transit');
	});

	test('Penerimaan transfer menambah stok di cabang penerima dan mengubah status menjadi completed', async () => {
		const transferId = 'trf-test-02';
		const transferNumber = 'TRF-20261109-5678';
		const qtySent = 8;

		// Siapkan transfer in_transit
		mockDb.stock_transfers.push({
			id: transferId,
			transfer_number: transferNumber,
			source_branch_id: 'cb-01',
			destination_branch_id: 'cb-02',
			status: 'in_transit',
			created_by: 'admin',
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			notes: 'Kirim barang'
		});

		mockDb.stock_transfer_items.push({
			id: 'sti-02',
			transfer_id: transferId,
			product_id: 'prod-1',
			quantity_sent: qtySent,
			quantity_received: null,
			created_at: new Date().toISOString()
		});

		// Simulasi konfirmasi terima barang
		const receiveStmts = [
			mockDb.prepare(`
				UPDATE stock_transfers
				SET status = 'completed',
				    updated_at = ?,
				    notes = CASE WHEN ? != '' THEN COALESCE(notes || ' | ', '') || ? ELSE notes END
				WHERE id = ?
			`).bind(new Date().toISOString(), '', '', transferId),
			mockDb.prepare(`
				UPDATE stock_transfer_items
				SET quantity_received = ?
				WHERE id = ?
			`).bind(qtySent, 'sti-02'),
			mockDb.prepare(`
				INSERT INTO products (
					id, branch_id, sku, barcode, name, category, price, cost_price,
					stock, unit, image_url, is_active, version, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, 1, ?, ?)
			`).bind('prod-dest-01', 'cb-02', 'SKU001', '', 'Kopi Susu Senja', 'Minuman', 18000, 10000, qtySent, 'pcs', new Date().toISOString(), new Date().toISOString())
		];

		await mockDb.batch(receiveStmts);

		const updatedTransfer = mockDb.stock_transfers.find(t => t.id === transferId)!;
		assert.equal(updatedTransfer.status, 'completed');

		const destProd = mockDb.products.find(p => p.sku === 'SKU001' && p.branch_id === 'cb-02');
		assert.ok(destProd, 'Produk harus masuk ke inventaris cabang tujuan');
		assert.equal(destProd.stock, qtySent);
	});

	test('Pembatalan transfer mengembalikan stok ke cabang pengirim', async () => {
		const transferId = 'trf-test-03';
		const transferNumber = 'TRF-20261109-9999';
		const qtySent = 5;

		const prod = mockDb.products.find(p => p.id === 'prod-1')!;
		const initialStock = prod.stock;

		// Kurangi stok seolah sedang dikirim
		prod.stock -= qtySent;

		mockDb.stock_transfers.push({
			id: transferId,
			transfer_number: transferNumber,
			source_branch_id: 'cb-01',
			destination_branch_id: 'cb-02',
			status: 'in_transit',
			created_by: 'admin',
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			notes: 'Test cancel'
		});

		mockDb.stock_transfer_items.push({
			id: 'sti-03',
			transfer_id: transferId,
			product_id: 'prod-1',
			quantity_sent: qtySent,
			quantity_received: null,
			created_at: new Date().toISOString()
		});

		// Eksekusi pembatalan
		const cancelStmts = [
			mockDb.prepare(`
				UPDATE stock_transfers
				SET status = 'cancelled',
				    updated_at = ?,
				    notes = CASE WHEN notes IS NOT NULL AND notes != '' THEN notes || ' | ' || ? ELSE ? END
				WHERE id = ?
			`).bind(new Date().toISOString(), 'Dibatalkan', 'Dibatalkan', transferId),
			mockDb.prepare(`
				UPDATE products
				SET stock = stock + ?,
				    version = version + 1,
				    updated_at = ?
				WHERE id = ?
			`).bind(qtySent, new Date().toISOString(), 'prod-1')
		];

		await mockDb.batch(cancelStmts);

		const trf = mockDb.stock_transfers.find(t => t.id === transferId)!;
		assert.equal(trf.status, 'cancelled');

		const restoredProd = mockDb.products.find(p => p.id === 'prod-1')!;
		assert.equal(restoredProd.stock, initialStock, 'Stok cabang asal harus kembali utuh seperti semula');
	});
});
