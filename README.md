# Kasir Modern (Multi-Cabang PWA & Offline-First)

Aplikasi Point of Sale (POS) modern berbasis **SvelteKit**, **TypeScript**, dan **Tailwind CSS** dengan arsitektur fullstack di **Cloudflare Pages & Workers / Functions**. Dirancang khusus dengan pendekatan **Offline-First**, sehingga transaksi operasional kasir tetap berjalan lancar tanpa koneksi internet dan otomatis tersinkronisasi saat perangkat kembali online.

---

## 🚀 Fitur Utama

### 1. Pembagian Peran Pengguna (RBAC)
- **Peran Admin**:
  - Mengelola data master pengguna (tambah kasir, ubah status, penugasan cabang, reset PIN, hapus user).
  - Memantau log aktivitas kasir dan performa cabang secara real-time.
  - **Aturan Proteksi**: Admin **tidak dapat** mengakses entri transaksi kasir.
- **Peran Kasir**:
  - Antarmuka POS cepat & responsif untuk input transaksi kasir.
  - Pencarian produk instan berdasarkan nama, kategori, SKU, atau barcode scanner.
  - Pengurangan stok inventaris lokal seketika saat transaksi berhasil.
  - Cetak struk nota belanja siap cetak (*Thermal Receipt* ukuran 58mm / 80mm).
  - Manajemen produk & penyesuaian stok cabang.
  - Riwayat transaksi harian dan filter omset per cabang.
  - **Aturan Proteksi**: Kasir **tidak memiliki** akses ke panel administrasi sistem.

### 2. Arsitektur Offline-First & Mekanisme Sinkronisasi
- **Penyimpanan Lokal (IndexedDB via Dexie.js)**:
  - Seluruh data cabang, pengguna, produk, dan transaksi disimpan di browser perangkat lokal.
  - Aplikasi dapat dibuka dan digunakan sepenuhnya tanpa internet.
- **Service Worker PWA (Progressive Web App)**:
  - Caching aset statis (HTML, CSS, JS, aset grafis) sehingga aplikasi dapat di-install di Desktop, Tablet, atau Android/iOS.
- **Engine Sinkronisasi Otomatis**:
  - Event listener `online` dan `offline` browser.
  - Antrean perubahan (*sync queue*) dengan resolusi konflik berbasis *timestamp* dan *versioning*.
  - Indikator status jaringan visual: Badge Online (Hijau), Offline (Merah), dan jumlah transaksi tertunda (*pending count*).
  - Tombol manual *“Sinkronkan Sekarang”* serta auto-sync di latar belakang.

---

## 📂 Struktur Direktori Proyek

```
kasir-modern/
├── schema.sql                 # Skema D1 SQLite Cloudflare (Tabel & Indeks)
├── wrangler.jsonc             # Konfigurasi Cloudflare Pages / Workers & D1
├── vite.config.ts             # Konfigurasi Vite, Tailwind CSS v4 & Cloudflare Adapter
├── src/
│   ├── app.html               # Shell HTML & Web Manifest link
│   ├── app.css                # Styling Tailwind CSS & Struk Thermal Printer
│   ├── service-worker.ts      # Service Worker PWA untuk offline caching
│   ├── lib/
│   │   ├── types/             # Definisi tipe TypeScript domain POS
│   │   ├── db/                # Inisialisasi Dexie IndexedDB & Seeding Data Awal
│   │   ├── stores/            # Reactive State Manajemen (Svelte 5 Runes) & Sesi Auth
│   │   ├── sync/              # Engine Sinkronisasi Offline-First & Queue Manager
│   │   └── components/        # Komponen UI Modular:
│   │       ├── Navbar.svelte           # Header navigasi, indikator jaringan & sync
│   │       ├── LoginScreen.svelte      # Layar masuk & demo switch
│   │       ├── CashierPOS.svelte       # Antarmuka kasir utama & katalog
│   │       ├── CashierProducts.svelte  # Kelola produk & stok cabang
│   │       ├── CashierHistory.svelte   # Riwayat nota & rekap harian
│   │       ├── ReceiptModal.svelte     # Modal struk belanja thermal
│   │       ├── AdminUsers.svelte       # Manajemen user & kasir
│   │       └── AdminMonitoring.svelte  # Dashboard monitoring kasir real-time
│   └── routes/
│       ├── +layout.svelte     # Layout root, seeding DB & inisialisasi state
│       ├── +page.svelte       # Router dinamis berdasarkan peran akun
│       └── api/
│           └── sync/          # Endpoint Cloudflare Functions untuk batch sync
```

---

## 🛠️ Panduan Menjalankan Proyek Secara Lokal

1. **Clone & Masuk ke Direktori**:
   ```bash
   cd kasir-modern
   ```

2. **Jalankan Development Server**:
   ```bash
   npm run dev
   ```
   Buka peramban pada alamat `http://localhost:5173`.

3. **Cek Tipe & Kompilasi**:
   ```bash
   npm run check
   ```

4. **Build untuk Produksi**:
   ```bash
   npm run build
   ```

---

## 🔑 Kredensial Pengguna Demo Bawaan

Saat pertama kali dijalankan, sistem otomatis melakukan *seeding* data awal:

| Peran | Nama Pengguna (Username) | PIN | Cabang Penugasan | Hak Akses |
|---|---|---|---|---|
| **Admin** | `admin` | `123456` | Semua Cabang (Pusat) | Kelola User, Monitoring Real-Time |
| **Kasir** | `kasir_jkt` | `1234` | Cabang Jakarta (Menteng) | POS Kasir, Stok Cabang, Riwayat Nota |
| **Kasir** | `kasir_bdg` | `1234` | Cabang Bandung (Riau) | POS Kasir, Stok Cabang, Riwayat Nota |
| **Kasir** | `kasir_sby` | `1234` | Cabang Surabaya (Gubeng) | POS Kasir, Stok Cabang, Riwayat Nota |

---

## ☁️ Deployment ke Cloudflare Pages

1. **Inisialisasi Database D1 di Cloudflare**:
   ```bash
   npx wrangler d1 create kasir_modern_db
   ```
   Salin `database_id` yang dihasilkan ke dalam file `wrangler.jsonc`:
   ```jsonc
   "d1_databases": [
     {
       "binding": "DB",
       "database_name": "kasir_modern_db",
       "database_id": "<ID_DATABASE_ANDA>"
     }
   ]
   ```

2. **Terapkan Skema Database**:
   ```bash
   npx wrangler d1 execute kasir_modern_db --file=./schema.sql
   ```

3. **Deploy Langsung**:
   ```bash
   npm run deploy
   ```
   Aplikasi akan ter-deploy di jaringan edge Cloudflare secara global dengan latensi rendah.
