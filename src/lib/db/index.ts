import Dexie, { type Table } from 'dexie';
import type {
	Branch,
	User,
	Product,
	Category,
	Transaction,
	TransactionItem,
	SyncQueueItem,
	ActivityLog,
	Expense,
	StockTransfer,
	StockTransferItem
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
	app_settings!: Table<SettingItem, string>;
	stock_transfers!: Table<StockTransfer, string>;
	stock_transfer_items!: Table<StockTransferItem, string>;

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
			stock_transfers: 'id, transfer_number, source_branch_id, destination_branch_id, status, created_at',
			stock_transfer_items: 'id, transfer_id, product_id'
		});
	}
}

export const db = new KasirDatabase();

// Inisialisasi Data Master Default (Seeding saat pertama kali dibuka)
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

	// 3. Pengguna / User
	// Catatan: Admin TIDAK bisa input transaksi kasir, hanya memantau dan kelola user.
	// Kasir memiliki akses kasir penuh di cabangnya.
	const initialUsers: User[] = [
		{
			id: 'usr-admin-1',
			username: 'admin',
			name: 'Admin Pusat (Owner)',
			role: 'admin',
			branch_id: 'all',
			pin: '123456',
			active: true,
			created_at: now,
			updated_at: now
		},
		{
			id: 'usr-kasir-jkt',
			username: 'kasir_jkt',
			name: 'Siti Rahma',
			role: 'cashier',
			branch_id: 'cb-01',
			pin: '1234',
			active: true,
			created_at: now,
			updated_at: now
		},
		{
			id: 'usr-kasir-bdg',
			username: 'kasir_bdg',
			name: 'Budi Santoso',
			role: 'cashier',
			branch_id: 'cb-02',
			pin: '1234',
			active: true,
			created_at: now,
			updated_at: now
		},
		{
			id: 'usr-kasir-sby',
			username: 'kasir_sby',
			name: 'Dewi Lestari',
			role: 'cashier',
			branch_id: 'cb-03',
			pin: '1234',
			active: true,
			created_at: now,
			updated_at: now
		}
	];

	await db.branches.bulkAdd(initialBranches);
	await db.categories.bulkAdd(initialCategories);
	await db.users.bulkAdd(initialUsers);

	// Log aktivitas inisialisasi
	await db.activity_logs.add({
		id: 'act-init-1',
		branch_id: 'all',
		branch_name: 'Pusat',
		user_id: 'usr-admin-1',
		user_name: 'Admin Pusat',
		role: 'admin',
		action: 'system_initialized',
		details: 'Database lokal berhasil diinisialisasi dengan data awal cabang dan pengguna.',
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
