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