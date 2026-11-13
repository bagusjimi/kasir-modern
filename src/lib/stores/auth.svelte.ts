import type { User, Branch } from '../types/index.js';
import { db } from '../db/index.js';
import { hashPin, verifyPin, isHashedPin } from '../auth/pin.js';
import { syncEngine } from '../sync/index.js';

class AuthState {
	user = $state<User | null>(null);
	branch = $state<Branch | null>(null);
	isLoading = $state<boolean>(true);

	constructor() {
		if (typeof window !== 'undefined') {
			this.loadStoredSession();
		} else {
			this.isLoading = false;
		}
	}

	async loadStoredSession() {
		try {
			const savedUserId = localStorage.getItem('kasir_session_user_id');
			const savedBranchId = localStorage.getItem('kasir_session_branch_id');

			if (savedUserId) {
				const user = await db.users.get(savedUserId);
				if (user && user.active) {
					this.user = user;

					// Jika kasir, pastikan cabang SELALU terkunci pada cabang penugasannya
					let branchIdToUse: string;
					if (user.role === 'cashier' && user.branch_id && user.branch_id !== 'all') {
						branchIdToUse = user.branch_id;
					} else {
						branchIdToUse = savedBranchId || 'all';
					}

					if (branchIdToUse && branchIdToUse !== 'all') {
						const branch = await db.branches.get(branchIdToUse);
						this.branch = branch || null;
					} else {
						this.branch = null;
					}
				} else {
					this.clearSession();
				}
			}
		} catch (err) {
			console.error('Gagal memuat sesi:', err);
		} finally {
			this.isLoading = false;
		}
	}

	async login(username: string, pin: string, selectedBranchId?: string): Promise<{ success: boolean; message?: string }> {
		let user = await db.users.where('username').equalsIgnoreCase(username.trim()).first();

		// Perangkat baru: data pengguna belum ada di lokal. Jika online, verifikasi ke
		// server lalu tarik data pengguna (termasuk hash PIN) lewat sinkronisasi.
		if (!user && typeof navigator !== 'undefined' && navigator.onLine) {
			try {
				const res = await fetch('/api/auth/login', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ username: username.trim(), pin: pin.trim() })
				});
				if (res.ok) {
					await syncEngine.triggerSync();
					user = await db.users.where('username').equalsIgnoreCase(username.trim()).first();
				}
			} catch {
				// Server tidak terjangkau: lanjut dengan validasi lokal
			}
		}

		if (!user) {
			return { success: false, message: 'Nama pengguna tidak ditemukan' };
		}

		if (!user.active) {
			return { success: false, message: 'Akun ini dinonaktifkan oleh Admin' };
		}

		const pinOk = await verifyPin(pin.trim(), user.pin);
		if (!pinOk) {
			return { success: false, message: 'PIN / Sandi salah' };
		}

		// Upgrade PIN plaintext lama menjadi hash (migrasi bertahap)
		if (!isHashedPin(user.pin)) {
			await db.users.update(user.id, { pin: await hashPin(pin.trim()) });
		}

		// VALIDASI KETAT PENUGASAN CABANG UNTUK KASIR:
		// Kasir HANYA diizinkan login ke cabang tempat dia ditugaskan.
		if (user.role === 'cashier' && user.branch_id && user.branch_id !== 'all') {
			if (selectedBranchId && selectedBranchId !== user.branch_id) {
				const assignedBranch = await db.branches.get(user.branch_id);
				const selectedBranch = selectedBranchId !== 'all' ? await db.branches.get(selectedBranchId) : null;
				const assignedName = assignedBranch ? assignedBranch.name : user.branch_id;
				const selectedName = selectedBranch ? selectedBranch.name : 'cabang lain';

				return {
					success: false,
					message: `Akses ditolak: Kasir "${user.name}" hanya terdaftar di "${assignedName}". Anda tidak diizinkan masuk ke "${selectedName}".`
				};
			}
		}

		this.user = user;
		localStorage.setItem('kasir_session_user_id', user.id);

		// Tentukan Cabang:
		// Jika kasir, paksa selalu menggunakan user.branch_id
		// Jika admin, admin dapat memilih cabang spesifik atau 'all' (pusat)
		let branchIdToUse: string;
		if (user.role === 'cashier') {
			branchIdToUse = user.branch_id;
		} else {
			branchIdToUse = (selectedBranchId && selectedBranchId !== 'all') ? selectedBranchId : 'all';
		}

		if (branchIdToUse && branchIdToUse !== 'all') {
			const branch = await db.branches.get(branchIdToUse);
			this.branch = branch || null;
			localStorage.setItem('kasir_session_branch_id', branchIdToUse);
		} else {
			this.branch = null;
			localStorage.setItem('kasir_session_branch_id', 'all');
		}

		// Buat sesi server (best-effort, tidak mewajibkan koneksi)
		if (typeof navigator !== 'undefined' && navigator.onLine) {
			try {
				const res = await fetch('/api/auth/login', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ username: user.username, pin: pin.trim() })
				});
				if (!res.ok && user.role === 'admin') {
					const err: any = await res.json().catch(() => null);
					if (err && err.code === 'NO_USERS') {
						// Server belum punya pengguna: bootstrap admin pertama dari data lokal
						await fetch('/api/auth/bootstrap', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								username: user.username,
								name: user.name,
								pin: pin.trim(),
								client_id: user.id
							})
						}).catch(() => null);
					}
				}
			} catch {
				// Sesi server bisa dibuat saat login berikutnya saat online
			}
		}

		// Log aktivitas login
		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: this.branch ? this.branch.id : 'all',
			branch_name: this.branch ? this.branch.name : 'Pusat / Semua Cabang',
			user_id: user.id,
			user_name: user.name,
			role: user.role,
			action: 'login',
			details: `Pengguna ${user.name} (${user.role}) berhasil masuk ke cabang ${this.branch ? this.branch.name : 'Pusat'}.`,
			timestamp: new Date().toISOString(),
			synced: false
		});

		return { success: true };
	}

	/**
	 * Pengaturan Awal: membuat akun admin pertama saat belum ada pengguna sama sekali.
	 * Jika server sudah memiliki pengguna (USERS_EXIST), coba login dengan kredensial
	 * yang dimasukkan agar perangkat kedua mengadopsi akun yang sudah ada.
	 */
	async setupOwner(username: string, name: string, pin: string): Promise<{ success: boolean; message?: string }> {
		const cleanUsername = username.trim().toLowerCase();
		const cleanName = name.trim();
		const cleanPin = pin.trim();

		if (!cleanName) {
			return { success: false, message: 'Nama lengkap harus diisi' };
		}
		if (cleanUsername.length < 3) {
			return { success: false, message: 'Username minimal 3 karakter' };
		}
		if (!/^[a-z0-9_.]+$/.test(cleanUsername)) {
			return { success: false, message: 'Username hanya boleh huruf kecil, angka, titik, dan garis bawah' };
		}
		if (cleanPin.length < 4) {
			return { success: false, message: 'PIN minimal 4 karakter' };
		}

		const existing = await db.users.where('username').equalsIgnoreCase(cleanUsername).first();
		if (existing) {
			return { success: false, message: 'Username sudah digunakan di perangkat ini' };
		}

		const now = new Date().toISOString();
		const pinHash = await hashPin(cleanPin);
		let userId = `usr-${crypto.randomUUID()}`;

		// Online: bootstrap ke server dulu agar ID server = ID lokal (hindari konflik UNIQUE(username)
		// saat queue insert disinkronkan). Jika server sudah punya pengguna, coba login dengan
		// kredensial yang sama untuk mengadopsi akun yang sudah terdaftar.
		if (typeof navigator !== 'undefined' && navigator.onLine) {
			try {
				const res = await fetch('/api/auth/bootstrap', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ username: cleanUsername, name: cleanName, pin: cleanPin, client_id: userId })
				});
				if (res.ok) {
					const data: any = await res.json().catch(() => null);
					const serverUser = data && data.user ? data.user : null;
					if (serverUser && serverUser.id) {
						// Adopsi ID server agar sesi server konsisten
						userId = serverUser.id;
					}
				} else {
					const err: any = await res.json().catch(() => null);
					if (err && err.code === 'USERS_EXIST') {
						try {
							const loginRes = await fetch('/api/auth/login', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ username: cleanUsername, pin: cleanPin })
							});
							if (loginRes.ok) {
								const loginData: any = await loginRes.json().catch(() => null);
								const serverUser = loginData && loginData.user ? loginData.user : null;
								if (!serverUser) {
									return { success: false, message: 'Gagal mengambil data akun dari server' };
								}
								// Adopsi user server tanpa queue insert (sudah ada di server)
								const adopted: User = {
									id: serverUser.id,
									username: serverUser.username,
									name: serverUser.name,
									role: serverUser.role,
									branch_id: serverUser.branch_id,
									pin: pinHash,
									active: true,
									created_at: now,
									updated_at: now
								};
								await db.users.put(adopted);
								this.user = adopted;
								this.branch = null;
								localStorage.setItem('kasir_session_user_id', adopted.id);
								localStorage.setItem('kasir_session_branch_id', 'all');
								return { success: true };
							}
							return {
								success: false,
								message: 'Pengaturan awal sudah dilakukan sebelumnya. Gunakan username & PIN akun yang sudah terdaftar.'
							};
						} catch {
							return {
								success: false,
								message: 'Pengaturan awal sudah dilakukan sebelumnya. Gunakan username & PIN akun yang sudah terdaftar.'
							};
						}
					}
					// Error lain: lanjut simpan lokal, sinkronisasi menyusul saat online
				}
			} catch {
				// Offline atau server tidak terjangkau: lanjut simpan lokal
			}
		}

		const owner: User = {
			id: userId,
			username: cleanUsername,
			name: cleanName,
			role: 'admin',
			branch_id: 'all',
			pin: pinHash,
			active: true,
			created_at: now,
			updated_at: now
		};

		await db.users.put(owner);

		await db.sync_queue.add({
			id: 'sq-' + Date.now(),
			entity: 'user',
			action: 'insert',
			data: owner,
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});

		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: 'all',
			branch_name: 'Pusat',
			user_id: owner.id,
			user_name: owner.name,
			role: 'admin',
			action: 'setup_owner',
			details: `${owner.name} melakukan pengaturan awal dan menjadi admin pertama.`,
			timestamp: now,
			synced: false
		});

		this.user = owner;
		this.branch = null;
		localStorage.setItem('kasir_session_user_id', owner.id);
		localStorage.setItem('kasir_session_branch_id', 'all');

		return { success: true };
	}

	async logout() {
		if (this.user) {
			try {
				await db.activity_logs.add({
					id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
					branch_id: this.branch ? this.branch.id : 'all',
					branch_name: this.branch ? this.branch.name : 'Pusat',
					user_id: this.user.id,
					user_name: this.user.name,
					role: this.user.role,
					action: 'logout',
					details: `Pengguna ${this.user.name} keluar dari sistem.`,
					timestamp: new Date().toISOString(),
					synced: false
				});
			} catch (e) {
				console.error(e);
			}
		}

		if (typeof navigator !== 'undefined' && navigator.onLine) {
			try {
				await fetch('/api/auth/logout', { method: 'POST' });
			} catch {
				// abaikan jika offline
			}
		}

		this.clearSession();
	}

	setBranch(branch: Branch | null) {
		// Kasir tidak boleh mengganti cabang secara manual
		if (this.user?.role === 'cashier' && this.user.branch_id !== 'all') {
			console.warn('Kasir tidak diizinkan mengganti cabang');
			return;
		}

		this.branch = branch;
		if (branch) {
			localStorage.setItem('kasir_session_branch_id', branch.id);
		} else {
			localStorage.setItem('kasir_session_branch_id', 'all');
		}
	}

	private clearSession() {
		this.user = null;
		this.branch = null;
		if (typeof window !== 'undefined') {
			localStorage.removeItem('kasir_session_user_id');
			localStorage.removeItem('kasir_session_branch_id');
		}
	}
}

export const authState = new AuthState();
