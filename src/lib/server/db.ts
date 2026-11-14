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
	// Pastikan semua tabel dibuat jika belum ada. Setiap statement dijalankan
	// sendiri-sendiri: kegagalan satu DDL (mis. indeks pada tabel lama yang
	// bentuknya tidak sesuai) tidak boleh menggagalkan pembuatan tabel lain
	// karena d1.batch bersifat atomik.
	const schemaStatements = [
		`CREATE TABLE IF NOT EXISTS branches (
			id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
			address TEXT, phone TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
			role TEXT NOT NULL CHECK(role IN ('admin', 'cashier')), branch_id TEXT NOT NULL,
			pin TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT)`,
		`CREATE TABLE IF NOT EXISTS products (
			id TEXT PRIMARY KEY, branch_id TEXT NOT NULL DEFAULT 'all', sku TEXT NOT NULL, barcode TEXT,
			name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL, cost_price REAL NOT NULL,
			stock INTEGER NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'pcs', image_url TEXT,
			is_active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS transactions (
			id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE, branch_id TEXT NOT NULL, branch_name TEXT NOT NULL,
			cashier_id TEXT NOT NULL, cashier_name TEXT NOT NULL, customer_name TEXT, subtotal REAL NOT NULL,
			discount REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
			payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'qris', 'transfer')),
			amount_paid REAL NOT NULL, change REAL NOT NULL, status TEXT NOT NULL DEFAULT 'completed',
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS transaction_items (
			id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL,
			price REAL NOT NULL, cost_price REAL NOT NULL, quantity INTEGER NOT NULL, subtotal REAL NOT NULL, notes TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS activity_logs (
			id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT, user_id TEXT NOT NULL,
			user_name TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL, timestamp TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS expenses (
			id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT, user_id TEXT NOT NULL,
			user_name TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, description TEXT NOT NULL,
			recipient TEXT, receipt_number TEXT, date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS app_settings (
			key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL,
			branch_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS stock_movements (
			id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, product_id TEXT NOT NULL,
			quantity INTEGER NOT NULL, type TEXT NOT NULL, reference_id TEXT,
			reason TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL, created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS transaction_adjustments (
			id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
			reason TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
			branch_id TEXT NOT NULL, created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS shifts (
			id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT,
			cashier_id TEXT NOT NULL, cashier_name TEXT NOT NULL,
			opening_cash REAL NOT NULL DEFAULT 0, opened_at TEXT NOT NULL,
			closed_at TEXT, closing_cash REAL, expected_cash REAL, cash_difference REAL,
			total_sales REAL, cash_sales REAL, non_cash_sales REAL,
			total_transactions INTEGER, voided_count INTEGER, refunded_count INTEGER,
			status TEXT NOT NULL DEFAULT 'open', note TEXT, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS purchases (
			id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT,
			supplier_name TEXT NOT NULL, supplier_phone TEXT, total REAL NOT NULL DEFAULT 0,
			note TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS purchase_items (
			id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL, product_id TEXT NOT NULL,
			product_name TEXT NOT NULL, quantity INTEGER NOT NULL, cost_price REAL NOT NULL,
			subtotal REAL NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS stock_counts (
			id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, branch_name TEXT,
			note TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
			total_difference_qty INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS stock_count_items (
			id TEXT PRIMARY KEY, stock_count_id TEXT NOT NULL, product_id TEXT NOT NULL,
			product_name TEXT NOT NULL, system_qty INTEGER NOT NULL,
			counted_qty INTEGER NOT NULL, difference INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS stock_transfers (
			id TEXT PRIMARY KEY, transfer_no TEXT NOT NULL,
			from_branch_id TEXT NOT NULL, from_branch_name TEXT,
			to_branch_id TEXT NOT NULL, to_branch_name TEXT,
			status TEXT NOT NULL DEFAULT 'dikirim', notes TEXT,
			user_id TEXT NOT NULL, user_name TEXT NOT NULL,
			received_by TEXT, received_by_name TEXT, received_at TEXT,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS stock_transfer_items (
			id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, product_id TEXT NOT NULL,
			product_name TEXT NOT NULL, sku TEXT, quantity INTEGER NOT NULL,
			quantity_received INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
			price REAL NOT NULL DEFAULT 0, cost_price REAL NOT NULL DEFAULT 0,
			category TEXT, unit TEXT, min_stock INTEGER NOT NULL DEFAULT 0
		)`,
		'CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branch_id)',
		'CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status)',
		'CREATE INDEX IF NOT EXISTS idx_shifts_updated ON shifts(updated_at)',
		'CREATE INDEX IF NOT EXISTS idx_purchases_branch ON purchases(branch_id)',
		'CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at)',
		'CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id)',
		'CREATE INDEX IF NOT EXISTS idx_stock_counts_branch ON stock_counts(branch_id)',
		'CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(stock_count_id)',
		'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
		'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)',
		'CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id)',
		'CREATE INDEX IF NOT EXISTS idx_stock_movements_branch ON stock_movements(branch_id)',
		'CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at)',
		'CREATE INDEX IF NOT EXISTS idx_tx_adjustments_tx ON transaction_adjustments(transaction_id)'
	];
	for (const ddl of schemaStatements) {
		try {
			await d1.prepare(ddl).run();
		} catch (ddlErr) {
			console.warn('Gagal menyiapkan skema D1:', ddlErr);
		}
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

	// Pulihkan tabel berbentuk warisan yang punya kolom NOT NULL tanpa default
	// di luar skema kanonik (mis. transfer_number dari percobaan versi awal).
	// Constraint tersebut menolak semua INSERT baru, sedangkan ALTER hanya
	// menambah kolom tanpa bisa menghapus constraint lama, sehingga satu-satunya
	// jalan adalah membangun ulang tabel. Data lama yang masih bisa dipetakan
	// ikut dipindahkan.
	const rebuildLegacyTable = async (
		table: string,
		canonicalDdl: string,
		canonicalCols: string[],
		insertSql: string,
		mapRow: (r: any) => any[]
	) => {
		try {
			const info = await d1.prepare(`PRAGMA table_info(${table})`).all();
			const cols = (info.results || []) as any[];
			if (cols.length === 0) return;
			const canonical = new Set(canonicalCols);
			const hasLegacy = cols.some(c => c.notnull && !c.dflt_value && !canonical.has(String(c.name)));
			if (!hasLegacy) return;
			const rowsRes = await d1.prepare(`SELECT * FROM ${table}`).all();
			await d1.prepare(`DROP TABLE ${table}`).run();
			await d1.prepare(canonicalDdl).run();
			for (const row of rowsRes.results || []) {
				try {
					await d1.prepare(insertSql).bind(...mapRow(row)).run();
				} catch (rowErr) {
					console.warn(`Gagal memindahkan baris lama ${table}:`, rowErr);
				}
			}
			console.warn(`Tabel ${table} dibangun ulang karena ada kolom warisan NOT NULL di luar skema kanonik`);
		} catch (rebuildErr) {
			console.warn(`Gagal memulihkan tabel ${table}:`, rebuildErr);
		}
	};

	await rebuildLegacyTable(
		'stock_transfers',
		`CREATE TABLE stock_transfers (
			id TEXT PRIMARY KEY, transfer_no TEXT NOT NULL,
			from_branch_id TEXT NOT NULL, from_branch_name TEXT,
			to_branch_id TEXT NOT NULL, to_branch_name TEXT,
			status TEXT NOT NULL DEFAULT 'dikirim', notes TEXT,
			user_id TEXT NOT NULL, user_name TEXT NOT NULL,
			received_by TEXT, received_by_name TEXT, received_at TEXT,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		['id', 'transfer_no', 'from_branch_id', 'from_branch_name', 'to_branch_id', 'to_branch_name', 'status', 'notes', 'user_id', 'user_name', 'received_by', 'received_by_name', 'received_at', 'created_at', 'updated_at'],
		`INSERT OR IGNORE INTO stock_transfers (id, transfer_no, from_branch_id, from_branch_name, to_branch_id, to_branch_name, status, notes, user_id, user_name, received_by, received_by_name, received_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		(r: any) => [
			r.id, r.transfer_no || r.transfer_number || '', r.from_branch_id || '',
			r.from_branch_name ?? null, r.to_branch_id || '', r.to_branch_name ?? null,
			r.status || 'dikirim', r.notes ?? null, r.user_id || '', r.user_name || '',
			r.received_by ?? null, r.received_by_name ?? null, r.received_at ?? null,
			r.created_at || '', r.updated_at || ''
		]
	);

	await rebuildLegacyTable(
		'stock_transfer_items',
		`CREATE TABLE stock_transfer_items (
			id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, product_id TEXT NOT NULL,
			product_name TEXT NOT NULL, sku TEXT, quantity INTEGER NOT NULL,
			quantity_received INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
			price REAL NOT NULL DEFAULT 0, cost_price REAL NOT NULL DEFAULT 0,
			category TEXT, unit TEXT, min_stock INTEGER NOT NULL DEFAULT 0
		)`,
		['id', 'transfer_id', 'product_id', 'product_name', 'sku', 'quantity', 'quantity_received', 'created_at', 'price', 'cost_price', 'category', 'unit', 'min_stock'],
		`INSERT OR IGNORE INTO stock_transfer_items (id, transfer_id, product_id, product_name, sku, quantity, quantity_received, created_at, price, cost_price, category, unit, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		(r: any) => [
			r.id, r.transfer_id || '', r.product_id || '', r.product_name || '',
			r.sku ?? null, r.quantity || 0, r.quantity_received || 0,
			r.created_at || '', r.price || 0, r.cost_price || 0,
			r.category ?? null, r.unit ?? null, r.min_stock || 0
		]
	);

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
