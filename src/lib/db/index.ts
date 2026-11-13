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

// Inisialisasi pengaturan default aplikasi saat pertama kali dibuka.
// TIDAK ada data fiktif: akun admin & cabang pertama dibuat lewat layar Pengaturan Awal (LoginScreen).
export async function seedInitialData(): Promise<void> {
	const taxExists = await db.app_settings.get('tax_settings');
	if (taxExists) return; // Sudah terinisialisasi

	const now = new Date().toISOString();

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
