import { env } from 'cloudflare:workers';
import type { Branch, User, Category, Product, Transaction, TransactionItem, ActivityLog } from '../types/index.js';
import { hashPin } from '../auth/pin.js';

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
 * Melakukan auto-seeding data awal ke database D1 jika tabel branches/users masih kosong.
 * Hal ini memastikan D1 Cloudflare langsung memiliki data siap pakai saat pertama kali dijalankan.
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
			d1.prepare(`CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL)`),
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

	try {
		const check = await d1.prepare('SELECT count(*) as count FROM branches').first<{ count: number }>();
		if (check && check.count > 0) {
			return; // Database sudah memiliki data
		}
	} catch (e) {
		// Abaikan jika query check gagal
	}

	const now = new Date().toISOString();

	const adminPinHash = await hashPin('123456');
	const kasirPinHash = await hashPin('1234');

	const seedQueries = [
		// Branches
		d1.prepare(`INSERT OR IGNORE INTO branches (id, code, name, address, phone, created_at, updated_at) VALUES
			('cb-01', 'CB01', 'Cabang Jakarta Pusat (Menteng)', 'Jl. Teuku Umar No. 12, Menteng, Jakarta Pusat', '021-3901234', ?, ?),
			('cb-02', 'CB02', 'Cabang Bandung (Riau)', 'Jl. LLRE Martadinata No. 88, Riau, Bandung', '022-4205678', ?, ?),
			('cb-03', 'CB03', 'Cabang Surabaya (Gubeng)', 'Jl. Pemuda No. 45, Gubeng, Surabaya', '031-5319988', ?, ?)
		`).bind(now, now, now, now, now, now),

		// Categories
		d1.prepare(`INSERT OR IGNORE INTO categories (id, name) VALUES
			('cat-makanan', 'Makanan'),
			('cat-minuman', 'Minuman'),
			('cat-snack', 'Camilan & Roti'),
			('cat-lainnya', 'Lainnya')
		`),

		// Users (PIN disimpan sebagai hash PBKDF2)
		d1.prepare(`INSERT OR IGNORE INTO users (id, username, name, role, branch_id, pin, active, created_at, updated_at) VALUES
			('usr-admin-1', 'admin', 'Admin Pusat (Owner)', 'admin', 'all', ?, 1, ?, ?),
			('usr-kasir-jkt', 'kasir_jkt', 'Siti Rahma', 'cashier', 'cb-01', ?, 1, ?, ?),
			('usr-kasir-bdg', 'kasir_bdg', 'Budi Santoso', 'cashier', 'cb-02', ?, 1, ?, ?),
			('usr-kasir-sby', 'kasir_sby', 'Dewi Lestari', 'cashier', 'cb-03', ?, 1, ?, ?)
		`).bind(
			adminPinHash, now, now,
			kasirPinHash, now, now,
			kasirPinHash, now, now,
			kasirPinHash, now, now
		),

		// Log inisialisasi
		d1.prepare(`INSERT OR IGNORE INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp) VALUES
			('act-init-server', 'all', 'Pusat', 'usr-admin-1', 'Admin Pusat', 'admin', 'system_initialized', 'Database Cloudflare D1 berhasil diinisialisasi otomatis dengan data awal cabang dan pengguna.', ?)
		`).bind(now)
	];

	try {
		await d1.batch(seedQueries);
	} catch (err) {
		console.error('Gagal melakukan auto-seeding D1:', err);
	}
}
