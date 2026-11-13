import Dexie, { type Table } from 'dexie';
import type {
	User,
	Branch,
	Product,
	Category,
	Transaction,
	TransactionItem,
	SyncQueueItem,
	ActivityLog,
	Expense,
	StockMovement,
	TransactionAdjustment,
	Shift,
	Purchase,
	StockCount
} from '../types/index.js';

export interface SettingItem {
	key: string;
	value: unknown;
}

export class KasirDatabase extends Dexie {
	branches!: Table<Branch, string>;
	users!: Table<User, string>;
	products!: Table<Product, string>;
	categories!: Table<Category, string>;
	transactions!: Table<Transaction, string>;
	transaction_items!: Table<TransactionItem, string>;
	sync_queue!: Table<SyncQueueItem, string>;
	activity_logs!: Table<ActivityLog, string>;
	expenses!: Table<Expense, string>;
	stock_movements!: Table<StockMovement, string>;
	transaction_adjustments!: Table<TransactionAdjustment, string>;
	shifts!: Table<Shift, string>;
	purchases!: Table<Purchase, string>;
	stock_counts!: Table<StockCount, string>;
	app_settings!: Table<SettingItem, string>;

	constructor() {
		super('KasirModernDB');

		this.version(1).stores({
			branches: 'id, code, name, updated_at',
			users: 'id, username, role, branch_id, updated_at',
			products: 'id, branch_id, category, name, sku, barcode, updated_at, is_active',
			categories: 'id, name',
			transactions: 'id, invoice_no, branch_id, cashier_id, created_at, status',
			transaction_items: 'id, transaction_id, product_id',
			sync_queue: 'id, entity, action, timestamp, status',
			activity_logs: 'id, branch_id, user_id, timestamp',
			app_settings: 'key'
		});

		this.version(2).stores({
			expenses: 'id, branch_id, category, date, created_at'
		});

		this.version(3).stores({
			stock_movements: 'id, branch_id, product_id, type, reference_id, created_at',
			transaction_adjustments: 'id, transaction_id, type, created_at'
		});

		this.version(4).stores({
			shifts: 'id, branch_id, cashier_id, status, opened_at',
			purchases: 'id, branch_id, supplier_name, created_at',
			stock_counts: 'id, branch_id, created_at'
		});
	}
}

export const db = new KasirDatabase();

// Inisialisasi Data Struktur Dasar (cabang & kategori) saat pertama kali dibuka.
// TIDAK ada akun demo: akun admin pertama dibuat lewat layar Pengaturan Awal (LoginScreen).
export async function seedInitialData(): Promise<void> {
	const branchCount = await db.branches.count();
	if (branchCount > 0) return; // Sudah terinisialisasi

	const now = new Date().toISOString();

	// 1. Cabang
	const initialBranches: Branch[] = [
		{
			id: 'cb-01',
			code: 'CB01',
			name: 'Cabang Jakarta Pusat (Menteng)',
			address: 'Jl. Teuku Umar No. 12, Menteng, Jakarta Pusat',
			phone: '021-3901234',
			created_at: now,
			updated_at: now
		},
		{
			id: 'cb-02',
			code: 'CB02',
			name: 'Cabang Bandung (Riau)',
			address: 'Jl. LLRE Martadinata No. 88, Riau, Bandung',
			phone: '022-4205678',
			created_at: now,
			updated_at: now
		},
		{
			id: 'cb-03',
			code: 'CB03',
			name: 'Cabang Surabaya (Gubeng)',
			address: 'Jl. Pemuda No. 45, Gubeng, Surabaya',
			phone: '031-5319988',
			created_at: now,
			updated_at: now
		}
	];

	// 2. Kategori
	const initialCategories: Category[] = [
		{ id: 'cat-makanan', name: 'Makanan' },
		{ id: 'cat-minuman', name: 'Minuman' },
		{ id: 'cat-snack', name: 'Camilan & Roti' },
		{ id: 'cat-lainnya', name: 'Lainnya' }
	];

	await db.branches.bulkAdd(initialBranches);
	await db.categories.bulkAdd(initialCategories);

	// Log aktivitas inisialisasi
	await db.activity_logs.add({
		id: 'act-init-1',
		branch_id: 'all',
		branch_name: 'Pusat',
		user_id: 'system',
		user_name: 'Sistem',
		role: 'admin',
		action: 'system_initialized',
		details: 'Database lokal berhasil diinisialisasi dengan data awal cabang dan kategori.',
		timestamp: now,
		synced: true
	});

	// Default tax settings: PPN 11% aktif
	await db.app_settings.put({
		key: 'tax_settings',
		value: {
			enabled: true,
			rate: 11,
			name: 'PPN',
			updated_at: now
		}
	});
}
