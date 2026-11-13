export type Role = 'admin' | 'cashier';

export interface Branch {
	id: string;
	code: string;
	name: string;
	address: string;
	phone: string;
	created_at: string;
	updated_at: string;
}

export interface User {
	id: string;
	username: string;
	name: string;
	role: Role;
	branch_id: string; // 'all' atau ID cabang tertentu
	pin: string; // 4-6 digit PIN atau password sederhana untuk kasir
	active: boolean;
	created_at: string;
	updated_at: string;
}

export interface Category {
	id: string;
	name: string;
	icon?: string;
	updated_at?: string;
}

export interface StoreSettings {
	name: string;
	address: string;
	phone: string;
	updated_at?: string;
}

export interface Product {
	id: string;
	branch_id: string; // Cabang tempat stok berada, atau 'all' untuk produk global
	sku: string;
	barcode?: string;
	name: string;
	category: string;
	price: number;
	cost_price: number;
	stock: number;
	min_stock?: number;
	unit: string;
	image_url?: string;
	is_active: boolean;
	created_at: string;
	updated_at: string;
	version: number;
}

export type PaymentMethod = 'cash' | 'qris' | 'transfer';

export interface CartItem {
	product: Product;
	quantity: number;
	subtotal: number;
	notes?: string;
}

export interface TransactionItem {
	id: string;
	transaction_id: string;
	product_id: string;
	product_name: string;
	price: number;
	cost_price: number;
	quantity: number;
	subtotal: number;
	notes?: string;
}

export interface Transaction {
	id: string;
	invoice_no: string;
	branch_id: string;
	branch_name: string;
	cashier_id: string;
	cashier_name: string;
	customer_name?: string;
	subtotal: number;
	discount: number;
	tax: number;
	total: number;
	payment_method: PaymentMethod;
	amount_paid: number;
	change: number;
	status: 'completed' | 'cancelled' | 'voided' | 'refunded';
	void_reason?: string;
	voided_at?: string;
	voided_by?: string;
	voided_by_name?: string;
	items: TransactionItem[];
	created_at: string;
	updated_at: string;
	synced: boolean;
}

export type StockMovementType = 'sale' | 'restock' | 'void' | 'return' | 'purchase' | 'opname' | 'adjustment';

export interface StockMovement {
	id: string;
	branch_id: string;
	product_id: string;
	quantity: number; // negatif = stok keluar, positif = stok masuk
	type: StockMovementType;
	reference_id?: string;
	reason?: string;
	user_id: string;
	user_name: string;
	created_at: string;
	synced: boolean;
}

export type TransactionAdjustmentType = 'void' | 'return';

export interface TransactionAdjustment {
	id: string;
	transaction_id: string;
	type: TransactionAdjustmentType;
	reason: string;
	user_id: string;
	user_name: string;
	branch_id: string;
	created_at: string;
	synced: boolean;
}

export interface Shift {
	id: string;
	branch_id: string;
	branch_name?: string;
	cashier_id: string;
	cashier_name: string;
	opening_cash: number;
	opened_at: string;
	closed_at?: string;
	closing_cash?: number;
	expected_cash?: number;
	cash_difference?: number;
	total_sales?: number;
	cash_sales?: number;
	non_cash_sales?: number;
	total_transactions?: number;
	voided_count?: number;
	refunded_count?: number;
	status: 'open' | 'closed';
	note?: string;
	updated_at: string;
	synced: boolean;
}

export interface PurchaseItem {
	id: string;
	purchase_id: string;
	product_id: string;
	product_name: string;
	quantity: number;
	cost_price: number;
	subtotal: number;
}

export interface Purchase {
	id: string;
	branch_id: string;
	branch_name?: string;
	supplier_name: string;
	supplier_phone?: string;
	total: number;
	note?: string;
	user_id: string;
	user_name: string;
	items: PurchaseItem[];
	created_at: string;
	updated_at: string;
	synced: boolean;
}

export interface StockCountItem {
	id: string;
	stock_count_id: string;
	product_id: string;
	product_name: string;
	system_qty: number;
	counted_qty: number;
	difference: number;
}

export interface StockCount {
	id: string;
	branch_id: string;
	branch_name?: string;
	note?: string;
	user_id: string;
	user_name: string;
	items: StockCountItem[];
	total_difference_qty: number;
	created_at: string;
	synced: boolean;
}

export type ExpenseCategory =
	| 'listrik_air_internet'
	| 'gaji_karyawan'
	| 'sewa_tempat'
	| 'perlengkapan_kebersihan'
	| 'kantong_plastik_kemasan'
	| 'perawatan_perbaikan'
	| 'transportasi_logistik'
	| 'konsumsi_karyawan'
	| 'lain_lain';

export interface Expense {
	id: string;
	branch_id: string;
	branch_name?: string;
	user_id: string;
	user_name: string;
	category: ExpenseCategory;
	category_label?: string;
	amount: number;
	description: string;
	recipient?: string;
	receipt_number?: string;
	date: string; // YYYY-MM-DD
	created_at: string;
	updated_at: string;
	synced: boolean;
}

export interface SyncQueueItem {
	id: string;
	entity: 'transaction' | 'product' | 'user' | 'branch' | 'category' | 'activity' | 'expense' | 'transaction_adjustment';
	action: 'insert' | 'update' | 'delete';
	data: unknown;
	timestamp: number;
	retry_count: number;
	status: 'pending' | 'syncing' | 'failed';
	error?: string;
}

export interface ActivityLog {
	id: string;
	branch_id: string;
	branch_name?: string;
	user_id: string;
	user_name: string;
	role: Role;
	action: string;
	details: string;
	timestamp: string;
	synced: boolean;
}

export interface SyncStatus {
	isOnline: boolean;
	isSyncing: boolean;
	lastSyncedAt: string | null;
	pendingCount: number;
	lastError: string | null;
}

export interface TaxSettings {
	enabled: boolean;
	rate: number; // Persentase pajak, contoh: 11 untuk 11%, 10 untuk 10%
	name: string; // Contoh: 'PPN', 'PB1 (Pajak Resto)'
	updated_at?: string;
}
