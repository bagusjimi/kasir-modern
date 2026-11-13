-- Skema Database Cloudflare D1 untuk Kasir Modern (Multi-Cabang)

CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'cashier')),
    branch_id TEXT NOT NULL,
    pin TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'all',
    sku TEXT NOT NULL,
    barcode TEXT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    cost_price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'pcs',
    image_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    invoice_no TEXT NOT NULL UNIQUE,
    branch_id TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    cashier_name TEXT NOT NULL,
    customer_name TEXT,
    subtotal REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'qris', 'transfer')),
    amount_paid REAL NOT NULL,
    change REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transaction_items (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    cost_price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    subtotal REAL NOT NULL,
    notes TEXT,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    branch_name TEXT,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    branch_name TEXT,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    recipient TEXT,
    receipt_number TEXT,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

-- Ledger pergerakan stok (audit stok): penjualan, restock, void, retur, penyesuaian
CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    type TEXT NOT NULL,
    reference_id TEXT,
    reason TEXT,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Pembatalan (void) / retur transaksi, dengan alasan wajib
CREATE TABLE IF NOT EXISTS transaction_adjustments (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    reason TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Shift kasir: buka/tutup shift dengan setoran awal dan Z-report (selisih kas)
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    branch_name TEXT,
    cashier_id TEXT NOT NULL,
    cashier_name TEXT NOT NULL,
    opening_cash REAL NOT NULL DEFAULT 0,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    closing_cash REAL,
    expected_cash REAL,
    cash_difference REAL,
    total_sales REAL,
    cash_sales REAL,
    non_cash_sales REAL,
    total_transactions INTEGER,
    voided_count INTEGER,
    refunded_count INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    note TEXT,
    updated_at TEXT NOT NULL
);

-- Pembelian stok dari supplier (purchase order sederhana)
CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    branch_name TEXT,
    supplier_name TEXT NOT NULL,
    supplier_phone TEXT,
    total REAL NOT NULL DEFAULT 0,
    note TEXT,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    cost_price REAL NOT NULL,
    subtotal REAL NOT NULL
);

-- Stok opname (penghitungan fisik vs sistem)
CREATE TABLE IF NOT EXISTS stock_counts (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    branch_name TEXT,
    note TEXT,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    total_difference_qty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_count_items (
    id TEXT PRIMARY KEY,
    stock_count_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    system_qty INTEGER NOT NULL,
    counted_qty INTEGER NOT NULL,
    difference INTEGER NOT NULL
);

-- Indeks untuk performa query real-time monitoring dan sinkronisasi
CREATE INDEX IF NOT EXISTS idx_transactions_branch ON transactions(branch_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_branch ON activity_logs(branch_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_time ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_expenses_branch ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_branch ON stock_movements(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_tx_adjustments_tx ON transaction_adjustments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branch_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_updated ON shifts(updated_at);
CREATE INDEX IF NOT EXISTS idx_purchases_branch ON purchases(branch_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_branch ON stock_counts(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(stock_count_id);

