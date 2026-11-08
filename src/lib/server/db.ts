import { env } from 'cloudflare:workers';
import type { Branch, User, Category, Product, Transaction, TransactionItem, ActivityLog } from '../types/index.js';

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
			)`)
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

		// Users
		d1.prepare(`INSERT OR IGNORE INTO users (id, username, name, role, branch_id, pin, active, created_at, updated_at) VALUES
			('usr-admin-1', 'admin', 'Admin Pusat (Owner)', 'admin', 'all', '123456', 1, ?, ?),
			('usr-kasir-jkt', 'kasir_jkt', 'Siti Rahma', 'cashier', 'cb-01', '1234', 1, ?, ?),
			('usr-kasir-bdg', 'kasir_bdg', 'Budi Santoso', 'cashier', 'cb-02', '1234', 1, ?, ?),
			('usr-kasir-sby', 'kasir_sby', 'Dewi Lestari', 'cashier', 'cb-03', '1234', 1, ?, ?)
		`).bind(now, now, now, now, now, now, now, now),

		// Products
		d1.prepare(`INSERT OR IGNORE INTO products (id, branch_id, sku, barcode, name, category, price, cost_price, stock, unit, is_active, version, created_at, updated_at) VALUES
			('prod-01', 'all', 'KOP-001', '899123456001', 'Kopi Susu Gula Aren', 'Minuman', 22000, 11000, 120, 'cup', 1, 1, ?, ?),
			('prod-02', 'all', 'KOP-002', '899123456002', 'Americano Double Shot', 'Minuman', 18000, 8000, 150, 'cup', 1, 1, ?, ?),
			('prod-03', 'all', 'TEA-001', '899123456003', 'Matcha Latte Ice', 'Minuman', 25000, 13000, 80, 'cup', 1, 1, ?, ?),
			('prod-04', 'all', 'MAK-001', '899123456004', 'Nasi Goreng Spesial', 'Makanan', 32000, 18000, 50, 'porsi', 1, 1, ?, ?),
			('prod-05', 'all', 'MAK-002', '899123456005', 'Mie Goreng Jawa', 'Makanan', 28000, 15000, 45, 'porsi', 1, 1, ?, ?),
			('prod-06', 'all', 'BAK-001', '899123456006', 'Croissant Butter Perancis', 'Camilan & Roti', 24000, 12000, 35, 'pcs', 1, 1, ?, ?),
			('prod-07', 'all', 'BAK-002', '899123456007', 'Roti Bakar Coklat Keju', 'Camilan & Roti', 20000, 9000, 60, 'porsi', 1, 1, ?, ?),
			('prod-08', 'all', 'MIN-001', '899123456008', 'Air Mineral Prima 600ml', 'Minuman', 6000, 3000, 200, 'btl', 1, 1, ?, ?)
		`).bind(now, now, now, now, now, now, now, now, now, now, now, now, now, now, now, now),

		// Log inisialisasi
		d1.prepare(`INSERT OR IGNORE INTO activity_logs (id, branch_id, branch_name, user_id, user_name, role, action, details, timestamp) VALUES
			('act-init-server', 'all', 'Pusat', 'usr-admin-1', 'Admin Pusat', 'admin', 'system_initialized', 'Database Cloudflare D1 berhasil diinisialisasi otomatis dengan data awal.', ?)
		`).bind(now)
	];

	try {
		await d1.batch(seedQueries);
	} catch (err) {
		console.error('Gagal melakukan auto-seeding D1:', err);
	}
}
