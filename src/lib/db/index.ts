import Dexie, { type Table } from 'dexie';
import type {
	Branch,
	User,
	Product,
	Category,
	Transaction,
	TransactionItem,
	SyncQueueItem,
	ActivityLog
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

	// 4. Produk Awal
	const initialProducts: Product[] = [
		{
			id: 'prod-01',
			branch_id: 'all',
			sku: 'KOP-001',
			barcode: '899123456001',
			name: 'Kopi Susu Gula Aren',
			category: 'Minuman',
			price: 22000,
			cost_price: 11000,
			stock: 120,
			unit: 'cup',
			is_active: true,
			created_at: now,
			updated_at: now,
			version: 1
		},
		{
			id: 'prod-02',
			branch_id: 'all',
			sku: 'KOP-002',
			barcode: '899123456002',
			name: 'Americano Double Shot',
			category: 'Minuman',
			price: 18000,
			cost_price: 8000,
			stock: 150,
			unit: 'cup',
			is_active: true,
			created_at: now,
			updated_at: now,
			version: 1
		},
		{
			id: 'prod-03',
			branch_id: 'all',
			sku: 'TEA-001',
			barcode: '899123456003',
			name: 'Matcha Latte Ice',
			category: 'Minuman',
			price: 25000,
			cost_price: 13000,
			stock: 80,
			unit: 'cup',
			is_active: true,
			created_at: now,
			updated_at: now,
			version: 1
		},
		{
			id: 'prod-04',
			branch_id: 'all',
			sku: 'MAK-001',
			barcode: '899123456004',
			name: 'Nasi Goreng Spesial',
			category: 'Makanan',
			price: 32000,
			cost_price: 18000,
			stock: 50,
			unit: 'porsi',
			is_active: true,
			created_at: now,
			updated_at: now,
			version: 1
		},
		{
			id: 'prod-05',
			branch_id: 'all',
			sku: 'MAK-002',
			barcode: '899123456005',
			name: 'Mie Goreng Jawa',
			category: 'Makanan',
			price: 28000,
			cost_price: 15000,
			stock: 45,
			unit: 'porsi',
			is_active: true,
			created_at: now,
			updated_at: now,
			version: 1
		},
		{
			id: 'prod-06',
			branch_id: 'all',
			sku: 'BAK-001',
			barcode: '899123456006',
			name: 'Croissant Butter Perancis',
			category: 'Camilan & Roti',
			price: 24000,
			cost_price: 12000,
			stock: 35,
			unit: 'pcs',
			is_active: true,
			created_at: now,
			updated_at: now,
			version: 1
		},
		{
			id: 'prod-07',
			branch_id: 'all',
			sku: 'BAK-002',
			barcode: '899123456007',
			name: 'Roti Bakar Coklat Keju',
			category: 'Camilan & Roti',
			price: 20000,
			cost_price: 9000,
			stock: 60,
			unit: 'porsi',
			is_active: true,
			created_at: now,
			updated_at: now,
			version: 1
		},
		{
			id: 'prod-08',
			branch_id: 'all',
			sku: 'MIN-001',
			barcode: '899123456008',
			name: 'Air Mineral Prima 600ml',
			category: 'Minuman',
			price: 6000,
			cost_price: 3000,
			stock: 200,
			unit: 'btl',
			is_active: true,
			created_at: now,
			updated_at: now,
			version: 1
		}
	];

	await db.branches.bulkAdd(initialBranches);
	await db.categories.bulkAdd(initialCategories);
	await db.users.bulkAdd(initialUsers);
	await db.products.bulkAdd(initialProducts);

	// Log aktivitas inisialisasi
	await db.activity_logs.add({
		id: 'act-init-1',
		branch_id: 'all',
		branch_name: 'Pusat',
		user_id: 'usr-admin-1',
		user_name: 'Admin Pusat',
		role: 'admin',
		action: 'system_initialized',
		details: 'Database lokal berhasil diinisialisasi dengan data awal cabang, pengguna, dan produk.',
		timestamp: now,
		synced: true
	});
}
