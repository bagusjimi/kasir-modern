import { env } from 'cloudflare:workers';
import type { Branch, Category, Product, Transaction, TransactionItem, ActivityLog } from '../types/index.js';

/**
 * Helper untuk mengambil binding Cloudflare D1 dari cloudflare:workers env
 * atau dari SvelteKit platform event (fallback).
 */
export function getD1(platform?: App.Platform | undefined): D1Database | null {
	try {
		if ((env as any)?.DB) {
			return (env as any).DB as D1Database;
		}
	} catch (e) {
		// Abaikan jika tidak di runtime worker
	}

	const dbFromPlatform = (platform?.env as any)?.DB as D1Database | undefined;
	if (dbFromPlatform) {
		return dbFromPlatform;
	}

	return null;
}

/**
 * Memastikan skema tabel D1 sudah ada (DDL saja, tanpa data).
 */
export async function ensureD1Seeded(d1: D1Database): Promise<void> {
	// Pastikan semua tabel dibuat jika belum ada
	try {
		await d1.batch([
			d1.prepare(`CREATE TABLE IF NOT EXISTS branches (
				id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
				address TEXT, phone TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
				role TEXT NOT NULL CHECK(role IN ('admin', 'cashier')), branch_id TEXT NOT NULL,
				pin TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS products (
				id TEXT PRIMARY KEY, branch_id TEXT NOT NULL DEFAULT 'all', sku TEXT NOT NULL, barcode TEXT,
				name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL, cost_price REAL NOT NULL,
				stock INTEGER NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'pcs', image_url TEXT,
				is_active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS transactions (
				id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE, branch_id TEXT NOT NULL, branch_name TEXT NOT NULL,
				cashier_id TEXT NOT NULL, cashier_name TEXT NOT NULL, customer_name TEXT, subtotal REAL NOT NULL,
				discount REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
				payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'qris', 'transfer')),
				amount_paid REAL NOT NULL, change REAL NOT NULL, status TEXT NOT NULL DEFAULT 'completed',
				created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS transaction_items (
				id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL,
				price REAL NOT NULL, cost_price REAL NOT NULL, quantity INTEGER NOT NULL, subtotal REAL NOT NULL, notes TEXT
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS activity_logs (
				id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT, user_id TEXT NOT NULL,
				user_name TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL, timestamp TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS expenses (
				id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT, user_id TEXT NOT NULL,
				user_name TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, description TEXT NOT NULL,
				recipient TEXT, receipt_number TEXT, date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS app_settings (
				key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS sessions (
				token TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL,
				branch_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS stock_movements (
				id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, product_id TEXT NOT NULL,
				quantity INTEGER NOT NULL, type TEXT NOT NULL, reference_id TEXT,
				reason TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL, created_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS transaction_adjustments (
				id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
				reason TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
				branch_id TEXT NOT NULL, created_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS shifts (
				id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT,
				cashier_id TEXT NOT NULL, cashier_name TEXT NOT NULL,
				opening_cash REAL NOT NULL DEFAULT 0, opened_at TEXT NOT NULL,
				closed_at TEXT, closing_cash REAL, expected_cash REAL, cash_difference REAL,
				total_sales REAL, cash_sales REAL, non_cash_sales REAL,
				total_transactions INTEGER, voided_count INTEGER, refunded_count INTEGER,
				status TEXT NOT NULL DEFAULT 'open', note TEXT, updated_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS purchases (
				id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT,
				supplier_name TEXT NOT NULL, supplier_phone TEXT, total REAL NOT NULL DEFAULT 0,
				note TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
				created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS purchase_items (
				id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL, product_id TEXT NOT NULL,
				product_name TEXT NOT NULL, quantity INTEGER NOT NULL, cost_price REAL NOT NULL,
				subtotal REAL NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS stock_counts (
				id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT,
				note TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
				total_difference_qty INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS stock_count_items (
				id TEXT PRIMARY KEY, stock_count_id TEXT NOT NULL, product_id TEXT NOT NULL,
				product_name TEXT NOT NULL, system_qty INTEGER NOT NULL,
				counted_qty INTEGER NOT NULL, difference INTEGER NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS stock_transfers (
				id TEXT PRIMARY KEY, transfer_no TEXT NOT NULL,
				from_branch_id TEXT NOT NULL, from_branch_name TEXT,
				to_branch_id TEXT NOT NULL, to_branch_name TEXT,
				status TEXT NOT NULL DEFAULT 'dikirim', notes TEXT,
				user_id TEXT NOT NULL, user_name TEXT NOT NULL,
				received_by TEXT, received_by_name TEXT, received_at TEXT,
				created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			)`),
			d1.prepare(`CREATE TABLE IF NOT EXISTS stock_transfer_items (
				id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, product_id TEXT NOT NULL,
				product_name TEXT NOT NULL, sku TEXT, quantity INTEGER NOT NULL,
				quantity_received INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
				price REAL NOT NULL DEFAULT 0, cost_price REAL NOT NULL DEFAULT 0,
				category TEXT, unit TEXT, min_stock INTEGER NOT NULL DEFAULT 0
			)`),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branch_id)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_shifts_updated ON shifts(updated_at)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_purchases_branch ON purchases(branch_id)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_stock_counts_branch ON stock_counts(branch_id)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(stock_count_id)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_stock_movements_branch ON stock_movements(branch_id)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at)'),
			d1.prepare('CREATE INDEX IF NOT EXISTS idx_tx_adjustments_tx ON transaction_adjustments(transaction_id)')
		]);
	} catch (tableErr) {
		console.warn('Gagal memastikan tabel D1:', tableErr);
	}

	// Migrasi: kolom updated_at untuk delta pull kategori pada database lama
	try {
		await d1.prepare('ALTER TABLE categories ADD COLUMN updated_at TEXT').run();
	} catch {
		// Kolom sudah ada
	}

	// Backfill kategori lama yang dibuat sebelum kolom updated_at ada,
	// agar ikut terkirim ke perangkat lewat delta pull.
	try {
		await d1
			.prepare("UPDATE categories SET updated_at = ? WHERE updated_at IS NULL")
			.bind(new Date().toISOString())
			.run();
	} catch (backfillErr) {
		console.warn('Gagal backfill updated_at kategori:', backfillErr);
	}

	// Migrasi: stok minimum produk untuk peringatan stok menipis
	try {
		await d1.prepare('ALTER TABLE products ADD COLUMN min_stock INTEGER NOT NULL DEFAULT 0').run();
	} catch {
		// Kolom sudah ada
	}

	// Migrasi: snapshot harga & kategori pada item transfer stok
	for (const ddl of [
		'ALTER TABLE stock_transfer_items ADD COLUMN price REAL NOT NULL DEFAULT 0',
		'ALTER TABLE stock_transfer_items ADD COLUMN cost_price REAL NOT NULL DEFAULT 0',
		'ALTER TABLE stock_transfer_items ADD COLUMN category TEXT',
		'ALTER TABLE stock_transfer_items ADD COLUMN unit TEXT',
		'ALTER TABLE stock_transfer_items ADD COLUMN min_stock INTEGER NOT NULL DEFAULT 0',
		'ALTER TABLE stock_transfer_items ADD COLUMN sku TEXT',
		'ALTER TABLE stock_transfer_items ADD COLUMN quantity_received INTEGER NOT NULL DEFAULT 0'
	]) {
		try {
			await d1.prepare(ddl).run();
		} catch {
			// Kolom sudah ada
		}
	}

	// Migrasi: kolom tabel stock_transfers untuk database yang dibuat dengan
	// bentuk lama/tidak lengkap (CREATE TABLE IF NOT EXISTS tidak memperbaiki
	// tabel yang sudah ada, sehingga tiap kolom ditambahkan secara idempoten).
	const transferColumnMigrations: [string, string][] = [
		['transfer_no', "TEXT NOT NULL DEFAULT ''"],
		['from_branch_id', "TEXT NOT NULL DEFAULT ''"],
		['from_branch_name', 'TEXT'],
		['to_branch_id', "TEXT NOT NULL DEFAULT ''"],
		['to_branch_name', 'TEXT'],
		['status', "TEXT NOT NULL DEFAULT 'dikirim'"],
		['notes', 'TEXT'],
		['user_id', "TEXT NOT NULL DEFAULT ''"],
		['user_name', "TEXT NOT NULL DEFAULT ''"],
		['received_by', 'TEXT'],
		['received_by_name', 'TEXT'],
		['received_at', 'TEXT'],
		['created_at', "TEXT NOT NULL DEFAULT ''"],
		['updated_at', "TEXT NOT NULL DEFAULT ''"]
	];
	for (const [col, def] of transferColumnMigrations) {
		try {
			await d1.prepare(`ALTER TABLE stock_transfers ADD COLUMN ${col} ${def}`).run();
		} catch {
			// Kolom sudah ada
		}
	}

	// Indeks transfer dibuat setelah migrasi kolom agar tidak menggagalkan
	// batch CREATE TABLE di atas (d1.batch bersifat atomik).
	for (const idx of [
		'CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON stock_transfers(from_branch_id)',
		'CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON stock_transfers(to_branch_id)',
		'CREATE INDEX IF NOT EXISTS idx_stock_transfers_updated ON stock_transfers(updated_at)',
		'CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_items(transfer_id)'
	]) {
		try {
			await d1.prepare(idx).run();
		} catch (idxErr) {
			console.warn('Gagal membuat indeks transfer:', idxErr);
		}
	}

	// TIDAK ada auto-seeding data: cabang, kategori, dan pengguna dibuat
	// oleh pengguna lewat alur Pengaturan Awal dan menu admin (data asli, bukan fiktif).
}
