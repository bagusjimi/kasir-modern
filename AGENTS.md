Buat aplikasi kasir multi-cabang berbasis SvelteKit dengan arsitektur fullstack di Cloudflare Pages dan Functions, yang mendukung mode offline-first dan sinkronisasi otomatis saat kembali online. Aplikasi harus berupa PWA (Progressive Web App) dengan antarmuka berbahasa Indonesia.  

Fitur utama:  
- **Peran Admin**: Hanya dapat mengelola user (tambah, ubah, hapus) dan memantau aktivitas kasir secara real-time (tanpa mengakses fitur transaksi).  
- **Peran Kasir**: Memiliki akses penuh ke semua fitur kasir (input transaksi, cetak nota, manajemen produk, laporan harian, dll.), tetapi tidak memiliki hak akses admin.  
- **Offline Support**: Aplikasi harus berjalan sepenuhnya tanpa koneksi internet (dengan penyimpanan lokal menggunakan IndexedDB atau lokalForage), dan otomatis menyinkronkan data ketika kembali online.  
- **Sinkronisasi**: Gunakan strategi sinkronisasi berbasis timestamp atau versi data untuk menghindari konflik, dengan penanganan error dan notifikasi pengguna.  
- **UI**: Berbahasa Indonesia, responsif, menggunakan komponen SvelteKit yang modular dan mudah diintegrasikan.  
- **Deploy**: Harus dapat di-deploy secara langsung ke Cloudflare Pages dengan konfigurasi build dan functions yang optimal.  

Output:  
- Kode lengkap dalam format SvelteKit (App SvelteKit + Pages + Functions).  
- File konfigurasi build dan deployment untuk Cloudflare Pages.  
- Dokumentasi singkat (README.md) yang menjelaskan struktur proyek, cara deploy, dan mekanisme sinkronisasi offline.  
- Gunakan teknologi pendukung: SvelteKit, TypeScript, Tailwind CSS, IndexedDB/localForage, dan Cloudflare Workers untuk fungsi backend.
---

## Catatan Repositori (untuk sesi berikutnya)

### Model Autentikasi Dua Lapis (sudah diterapkan)
- **Lapis 1 — Perangkat/Toko** (`LoginScreen.svelte`): `authState.initDevice()` / `authState.initializeStore()` mengikat terminal ke satu cabang. Endpoint: `POST /api/auth/device` (sesi `kind: 'device'`) dan `POST /api/auth/bootstrap` (penyiapan awal: admin + cabang + perangkat pertama).
- **Lapis 2 — Operator/Kasir** (`OperatorLock.svelte`): `authState.openShift({ operator, pin, openingCash })` memverifikasi PIN pribadi dan mengikat shift ke perangkat. Menutup shift (Z-Report) memanggil `authState.releaseOperator()` → kembali ke layar kunci operator.
- **Pintu Admin**: `authState.loginAdmin()` → `POST /api/auth/login` (hanya role `admin`; kasir ditolak dengan kode `NOT_ADMIN`). `authState.exitAdmin()` keluar dari mode admin tanpa melepas perangkat.
- State di `src/lib/stores/auth.svelte.ts`: `mode` ('none'|'admin'|'cashier'), `operator`, `admin`, `device`, `branch`, dan `user` (shim: admin di mode admin, operator di mode kasir).
- Routing di `src/routes/+page.svelte`: loading → `!user` → LoginScreen → `mode==='cashier' && !operator` → OperatorLock → aplikasi utama.

### Entitas & Sinkronisasi
- Entitas `device` ikut disinkronkan dua arah: server (`src/routes/api/sync/+server.ts` mengembalikan `serverUpdates.devices`) dan klien (`src/lib/sync/index.svelte.ts` `bulkPut` ke tabel `devices`).
- Shift terikat perangkat (`getOpenShiftForDevice`), identitas orang ada di `cashier_id`/`cashier_name`.

### Perintah
- `npm run check` — svelte-check (harus 0 error, 0 warning).
- `npm run build` — build produksi (adapter Cloudflare).
- `npm run dev` — dev server Vite.

### Sinkronisasi Akun Pusat & Rotasi Sesi (perbaikan login admin)
- Akun pusat (`branch_id = 'all'`, termasuk admin) WAJIB ikut ditarik pada sinkronisasi perangkat cabang, karena pintu "Masuk sebagai Admin" ada di terminal toko dan butuh hash PIN admin untuk verifikasi offline. Filter sinkronisasi user di `src/routes/api/sync/+server.ts` memakai `(branch_id = ? OR branch_id = 'all')` pada tarikan pertama maupun delta.
- `authState.loginAdmin()` memverifikasi PIN ke server saat online (server = sumber kebenaran, sekaligus membuat sesi server untuk endpoint khusus admin) lalu menyimpan hash PIN lokal agar login offline berikutnya tetap berhasil. Bila server tak terjangkau, dipakai verifikasi lokal.
- `createSession()` di `src/lib/server/auth.ts` menghapus sesi lama dengan `user_id` sama sebelum INSERT (rotasi sesi). Ini mencegah kegagalan login pada basis data lama yang punya batasan UNIQUE pada `sessions.user_id` — sebelumnya harus menghapus baris sesi manual di database.

### Daftar Operator Harus Reaktif (perbaikan "harus refresh setelah aktifkan perangkat")
- `OperatorLock.svelte` membaca daftar operator lewat `liveQuery` Dexie (bukan `onMount` sekali baca). Setelah "Aktifkan Perangkat", `initDevice()` memicu `triggerSync()` yang menulis akun kasir ke IndexedDB secara asinkron; pembacaan sekali pakai selesai sebelum data itu tiba sehingga layar menampilkan "Belum ada akun kasir" sampai halaman di-refresh.
- Pola ini berlaku umum: komponen yang menampilkan data hasil sinkronisasi (user, produk, shift) sebaiknya memakai `liveQuery` agar UI ikut terbarui saat sinkronisasi menulis ke IndexedDB.
