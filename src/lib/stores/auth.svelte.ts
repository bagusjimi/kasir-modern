import type { User, Branch, Device } from '../types/index.js';
import { db } from '../db/index.js';
import { cartStore } from './cart.svelte.js';
import { hashPin, verifyPin } from '../auth/pin.js';
import { syncEngine } from '../sync/index.js';

const DEVICE_KEY = 'kasir_device_id';
const DEVICE_NAME_KEY = 'kasir_device_name';
// Identitas fisik terminal; sengaja TIDAK dihapus saat lepas perangkat agar
// inisialisasi ulang memakai baris perangkat yang sama (tidak menumpuk duplikat).
const TERMINAL_KEY = 'kasir_terminal_id';
const ADMIN_KEY = 'kasir_admin_user_id';
const BRANCH_KEY = 'kasir_session_branch_id';
const DATA_BRANCH_KEY = 'kasir_data_branch';

/**
 * Sesi aplikasi dua lapis:
 *
 *  Lapis 1 - Toko/Perangkat : perangkat diikat ke satu cabang lewat
 *            inisialisasi (initDevice / initializeStore). Ini pengganti
 *            "login" lama: mengikat terminal ke cabang, bukan mengikat orang.
 *
 *  Lapis 2 - Operator/Kasir : identitas orang ditentukan saat membuka shift
 *            (openShift) dengan PIN pribadi. Ganti kasir cukup ganti operator,
 *            tanpa login ulang.
 *
 *  Admin masuk lewat pintu terpisah (loginAdmin) untuk mengelola user dan
 *  memantau; admin tidak memakai fitur transaksi.
 */
class AuthState {
	// Identitas aktif yang dipakai seluruh komponen (shim dari lapis aktif).
	user = $state<User | null>(null);
	// Cabang toko tempat perangkat diikat.
	branch = $state<Branch | null>(null);
	// Perangkat/terminal toko (lapis 1).
	device = $state<Device | null>(null);
	// Operator kasir yang sedang memegang laci (lapis 2, dari shift terbuka).
	operator = $state<User | null>(null);
	// Akun admin yang sedang masuk (pintu terpisah).
	admin = $state<User | null>(null);
	mode = $state<'none' | 'admin' | 'cashier'>('none');
	isLoading = $state<boolean>(true);

	constructor() {
		// isLoading tetap true di server (SSR) agar HTML awal berupa layar loading,
		// bukan form inisialisasi — mencegah kilatan form saat refresh.
		if (typeof window !== 'undefined') {
			this.loadStoredSession();
		}
	}

	get deviceReady(): boolean {
		return this.device !== null;
	}

	get isAdmin(): boolean {
		return this.admin !== null;
	}

	/** Menyusun ulang `user` dari lapis yang sedang aktif. */
	private refreshUser() {
		if (this.admin) {
			this.user = this.admin;
			this.mode = 'admin';
			return;
		}
		if (this.device) {
			const op = this.operator;
			const dev = this.device;
			this.user = {
				id: op?.id || dev.id,
				username: op?.username || dev.id,
				name: op?.name || dev.name,
				role: 'cashier',
				branch_id: dev.branch_id,
				pin: '',
				active: true,
				created_at: dev.created_at,
				updated_at: dev.updated_at
			};
			this.mode = 'cashier';
			return;
		}
		this.user = null;
		this.mode = 'none';
	}

	async loadStoredSession() {
		try {
			const adminId = localStorage.getItem(ADMIN_KEY);
			const deviceId = localStorage.getItem(DEVICE_KEY);
			const branchId = localStorage.getItem(BRANCH_KEY);

			if (adminId) {
				const admin = await db.users.get(adminId);
				if (admin && admin.active && admin.role === 'admin') {
					this.admin = admin;
					this.branch = null;
					this.refreshUser();
					this.isLoading = false;
					return;
				}
				localStorage.removeItem(ADMIN_KEY);
			}

			if (deviceId) {
				let device = await db.devices.get(deviceId);
				if (!device) {
					// Perangkat lama sebelum tabel devices ada: bangun ulang dari localStorage.
					device = {
						id: deviceId,
						branch_id: branchId || 'all',
						branch_name: '',
						name: localStorage.getItem(DEVICE_NAME_KEY) || 'Kasir',
						created_at: '',
						updated_at: ''
					};
				}
				const branch = branchId && branchId !== 'all' ? await db.branches.get(branchId) : null;
				this.device = device;
				this.branch = branch || null;
				await this.loadOpenOperator(device.id);
				this.refreshUser();
			}
		} catch (err) {
			console.error('Gagal memuat sesi:', err);
		} finally {
			this.isLoading = false;
		}
	}

	/** Memuat operator dari shift yang masih terbuka pada perangkat ini. */
	private async loadOpenOperator(deviceId: string) {
		try {
			const open = (await db.shifts.where('status').equals('open').toArray())
				.filter((s) => s.device_id === deviceId)
				.sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0];
			if (!open) {
				this.operator = null;
				return;
			}
			const u = await db.users.get(open.cashier_id);
			this.operator = u || {
				id: open.cashier_id,
				username: open.cashier_id,
				name: open.cashier_name,
				role: 'cashier',
				branch_id: open.branch_id,
				pin: '',
				active: true,
				created_at: open.opened_at,
				updated_at: open.opened_at
			};
		} catch {
			this.operator = null;
		}
	}

	private persistDevice(device: Device, branch: Branch | null) {
		this.device = device;
		this.branch = branch;
		localStorage.setItem(DEVICE_KEY, device.id);
		localStorage.setItem(DEVICE_NAME_KEY, device.name);
		localStorage.setItem(BRANCH_KEY, device.branch_id);
		localStorage.setItem(DATA_BRANCH_KEY, device.branch_id);
	}

	/** Identitas fisik terminal ini; dibuat sekali dan dipakai ulang tiap inisialisasi. */
	private getTerminalId(): string {
		if (typeof window === 'undefined') return `dev-${crypto.randomUUID()}`;
		let id = localStorage.getItem(TERMINAL_KEY);
		if (!id) {
			id = `dev-${crypto.randomUUID()}`;
			localStorage.setItem(TERMINAL_KEY, id);
		}
		return id;
	}

	/**
	 * Inisialisasi Perangkat/Toko (lapis 1).
	 * Mengikat terminal ke cabang, menarik data cabang, dan menyiapkan aplikasi.
	 */
	async initDevice(params: {
		device_name: string;
		branch_id?: string;
		branch_code?: string;
		branch_name?: string;
	}): Promise<{ success: boolean; message?: string }> {
		const deviceName = params.device_name.trim() || 'Kasir';
		const online = typeof navigator !== 'undefined' && navigator.onLine;
		const terminalId = this.getTerminalId();

		if (online) {
			try {
				const res = await fetch('/api/auth/device', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						device_id: terminalId,
						device_name: deviceName,
						branch_id: params.branch_id || '',
						branch_code: params.branch_code || '',
						branch_name: params.branch_name || ''
					})
				});
				const data: any = await res.json().catch(() => null);
				if (res.ok && data && data.success) {
					const branch: Branch | null = data.branch
						? {
								id: data.branch.id,
								code: data.branch.code || '',
								name: data.branch.name || '',
								address: data.branch.address || '',
								phone: data.branch.phone || '',
								created_at: data.branch.created_at || new Date().toISOString(),
								updated_at: data.branch.updated_at || new Date().toISOString()
							}
						: null;
					if (branch) await db.branches.put(branch);
					const device: Device = {
						id: data.device.id,
						branch_id: data.device.branch_id,
						branch_name: data.device.branch_name || branch?.name || '',
						name: data.device.name,
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString()
					};
					await db.devices.put(device);
					this.persistDevice(device, branch);
					this.operator = null;
					this.refreshUser();
					// Tarik data cabang agar perangkat tidak kosong sampai auto-sync berikutnya.
					await syncEngine.triggerSync();
					return { success: true };
				}
				return { success: false, message: data?.message || 'Gagal menginisialisasi perangkat' };
			} catch {
				// Server tidak terjangkau: lanjut coba jalur offline di bawah
			}
		}

		// Offline: hanya bisa mengikat ke cabang yang sudah ada di perangkat ini.
		const branchId = params.branch_id || '';
		const branch = branchId && branchId !== 'all' ? await db.branches.get(branchId) : null;
		if (!branch) {
			return {
				success: false,
				message: 'Perangkat belum punya data cabang. Sambungkan ke internet sekali untuk menginisialisasi toko.'
			};
		}
		const now = new Date().toISOString();
		const device: Device = {
			id: terminalId,
			branch_id: branch.id,
			branch_name: branch.name,
			name: deviceName,
			created_at: now,
			updated_at: now
		};
		await db.devices.put(device);
		await db.sync_queue.add({
			id: 'sq-' + Date.now(),
			entity: 'device',
			action: 'insert',
			data: device,
			timestamp: Date.now(),
			retry_count: 0,
			status: 'pending'
		});
		this.persistDevice(device, branch);
		this.operator = null;
		this.refreshUser();
		return { success: true };
	}

	/**
	 * Pengaturan Awal: membuat admin pertama, cabang pertama, dan perangkat
	 * pertama ketika sistem masih kosong.
	 */
	async initializeStore(params: {
		admin_name: string;
		admin_username: string;
		admin_pin: string;
		branch_code: string;
		branch_name: string;
		device_name: string;
	}): Promise<{ success: boolean; message?: string }> {
		const cleanName = params.admin_name.trim();
		const cleanUsername = params.admin_username.trim().toLowerCase();
		const cleanPin = params.admin_pin.trim();
		const cleanBranchCode = params.branch_code.trim().toUpperCase();
		const cleanBranchName = params.branch_name.trim();
		const cleanDeviceName = params.device_name.trim() || 'Kasir 1';

		if (!cleanName) return { success: false, message: 'Nama lengkap admin harus diisi' };
		if (cleanUsername.length < 3) return { success: false, message: 'Username minimal 3 karakter' };
		if (!/^[a-z0-9_.]+$/.test(cleanUsername)) {
			return { success: false, message: 'Username hanya boleh huruf kecil, angka, titik, dan garis bawah' };
		}
		if (cleanPin.length < 4) return { success: false, message: 'PIN minimal 4 karakter' };
		if (!cleanBranchCode) return { success: false, message: 'Kode cabang pertama wajib diisi' };
		if (!/^[A-Z0-9_-]+$/.test(cleanBranchCode)) {
			return { success: false, message: 'Kode cabang hanya boleh huruf besar, angka, garis, dan garis bawah' };
		}
		if (!cleanBranchName) return { success: false, message: 'Nama cabang pertama wajib diisi' };

		const now = new Date().toISOString();
		const pinHash = await hashPin(cleanPin);
		let adminId = `usr-${crypto.randomUUID()}`;
		let branchId = `cb-${crypto.randomUUID()}`;
		let deviceId = `dev-${crypto.randomUUID()}`;
		const online = typeof navigator !== 'undefined' && navigator.onLine;

		if (online) {
			try {
				const res = await fetch('/api/auth/bootstrap', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						username: cleanUsername,
						name: cleanName,
						pin: cleanPin,
						client_id: adminId,
						branch_id: branchId,
						branch_code: cleanBranchCode,
						branch_name: cleanBranchName,
						device_id: deviceId,
						device_name: cleanDeviceName
					})
				});
				const data: any = await res.json().catch(() => null);
				if (res.ok && data && data.success) {
					adminId = data.user?.id || adminId;
					branchId = data.branch?.id || branchId;
					deviceId = data.device?.id || deviceId;
				} else if (data?.code === 'USERS_EXIST') {
					return {
						success: false,
						message: 'Sistem sudah pernah diinisialisasi. Inisialisasi perangkat ini ke cabang yang ada.'
					};
				}
			} catch {
				// Offline: simpan lokal, sinkronisasi menyusul
			}
		}

		const admin: User = {
			id: adminId,
			username: cleanUsername,
			name: cleanName,
			role: 'admin',
			branch_id: 'all',
			pin: pinHash,
			active: true,
			created_at: now,
			updated_at: now
		};
		await db.users.put(admin);

		const branch: Branch = {
			id: branchId,
			code: cleanBranchCode,
			name: cleanBranchName,
			address: '',
			phone: '',
			created_at: now,
			updated_at: now
		};
		await db.branches.put(branch);

		const device: Device = {
			id: deviceId,
			branch_id: branch.id,
			branch_name: branch.name,
			name: cleanDeviceName,
			created_at: now,
			updated_at: now
		};
		await db.devices.put(device);

		// Offline: antrekan agar tersinkron saat online. (Saat online, server sudah
		// membuat ketiganya lewat bootstrap.)
		if (!online) {
			await db.sync_queue.bulkAdd([
				{ id: 'sq-' + Date.now(), entity: 'user', action: 'insert', data: admin, timestamp: Date.now(), retry_count: 0, status: 'pending' },
				{ id: 'sq-' + Date.now() + '-b', entity: 'branch', action: 'insert', data: branch, timestamp: Date.now(), retry_count: 0, status: 'pending' },
				{ id: 'sq-' + Date.now() + '-d', entity: 'device', action: 'insert', data: device, timestamp: Date.now(), retry_count: 0, status: 'pending' }
			]);
		}

		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: 'all',
			branch_name: 'Pusat',
			user_id: admin.id,
			user_name: admin.name,
			role: 'admin',
			action: 'setup_owner',
			details: `${admin.name} melakukan pengaturan awal. Cabang pertama: ${branch.name} (${branch.code}), perangkat: ${device.name}.`,
			timestamp: now,
			synced: false
		});

		this.persistDevice(device, branch);
		this.operator = null;
		// Pemilik langsung masuk sebagai admin agar bisa menambah akun kasir;
		// menutup mode admin akan kembali ke layar shift operator.
		this.admin = admin;
		if (typeof window !== 'undefined') localStorage.setItem(ADMIN_KEY, admin.id);
		this.branch = null;
		this.refreshUser();
		await syncEngine.updatePendingCount();
		if (online) await syncEngine.triggerSync();
		return { success: true };
	}

	/**
	 * Masuk sebagai Admin (pintu terpisah). Hanya akun ber-role 'admin'.
	 */
	async loginAdmin(username: string, pin: string): Promise<{ success: boolean; message?: string }> {
		const cleanUsername = username.trim();
		const cleanPin = pin.trim();
		const online = typeof navigator !== 'undefined' && navigator.onLine;
		const now = new Date().toISOString();

		let user = await db.users.where('username').equalsIgnoreCase(cleanUsername).first();
		let verified = false;
		let rejectMessage: string | null = null;

		// Saat online, server adalah sumber kebenaran PIN admin: verifikasi ke server sekaligus
		// membuat sesi server yang dipakai endpoint khusus admin (pengguna, pemantauan, cabang).
		// Bila server tak terjangkau, jatuh ke verifikasi lokal agar tetap bisa masuk offline.
		if (online) {
			try {
				const res = await fetch('/api/auth/login', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ username: cleanUsername, pin: cleanPin })
				});
				const data: any = await res.json().catch(() => null);
				if (res.ok && data && data.success && data.user) {
					// PIN sudah diverifikasi server: simpan akun beserta hash PIN lokal (dibuat dari PIN
					// yang baru saja diverifikasi) supaya login offline berikutnya tidak bergantung pada
					// hasil sinkronisasi.
					user = {
						id: data.user.id,
						username: data.user.username,
						name: data.user.name,
						role: 'admin',
						branch_id: 'all',
						pin: await hashPin(cleanPin),
						active: true,
						created_at: user?.created_at || now,
						updated_at: now
					} as User;
					await db.users.put(user);
					verified = true;
				} else if (data && data.code === 'NO_USERS') {
					// Server belum punya pengguna: andalkan data lokal (mis. pengaturan awal offline).
				} else if (res.status === 401 || res.status === 403) {
					rejectMessage = data?.message || 'PIN / Sandi salah';
				}
			} catch {
				// Server tidak terjangkau: lanjut verifikasi lokal
			}
		}

		// Verifikasi lokal (offline, atau server tak terjangkau).
		if (!verified && !rejectMessage && user && user.active && user.role === 'admin') {
			verified = await verifyPin(cleanPin, user.pin);
			if (!verified) rejectMessage = 'PIN / Sandi salah';
		}

		if (!user) return { success: false, message: rejectMessage || 'Nama pengguna tidak ditemukan' };
		if (!user.active) return { success: false, message: 'Akun ini dinonaktifkan oleh Admin' };
		if (user.role !== 'admin') {
			return {
				success: false,
				message: 'Akun kasir tidak masuk di sini. Buka shift untuk mulai sebagai operator.'
			};
		}
		if (!verified) return { success: false, message: rejectMessage || 'PIN / Sandi salah' };

		this.admin = user;
		// Admin memantau semua cabang, jadi cabang toko dinetralkan selama mode admin.
		this.branch = null;
		localStorage.setItem(ADMIN_KEY, user.id);
		this.refreshUser();

		// Tarik data terbaru setelah sesi admin aktif (best-effort, tidak mewajibkan koneksi).
		if (online) {
			syncEngine.triggerSync();
		}

		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: 'all',
			branch_name: 'Pusat / Semua Cabang',
			user_id: user.id,
			user_name: user.name,
			role: 'admin',
			action: 'login',
			details: `Admin ${user.name} berhasil masuk ke sistem.`,
			timestamp: new Date().toISOString(),
			synced: false
		});

		return { success: true };
	}

	/**
	 * Membuka shift: menentukan operator (orang) yang memegang laci.
	 * PIN pribadi operator diverifikasi di sini — inilah batas akuntabilitas
	 * per orang pada model dua lapis.
	 */
	async openShift(params: {
		operator: User;
		pin: string;
		openingCash: number;
	}): Promise<{ success: boolean; message?: string }> {
		if (!this.device) return { success: false, message: 'Perangkat belum diinisialisasi' };

		const existing = (await db.shifts.where('status').equals('open').toArray()).filter(
			(s) => s.device_id === this.device!.id
		);
		if (existing.length > 0) {
			return { success: false, message: 'Masih ada shift terbuka di perangkat ini. Tutup shift tersebut terlebih dahulu.' };
		}

		const pinOk = await verifyPin(params.pin.trim(), params.operator.pin);
		if (!pinOk) return { success: false, message: 'PIN operator salah' };

		const now = new Date().toISOString();
		await db.shifts.add({
			id: 'sh-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: this.device.branch_id,
			branch_name: this.device.branch_name || this.branch?.name,
			device_id: this.device.id,
			device_name: this.device.name,
			cashier_id: params.operator.id,
			cashier_name: params.operator.name,
			opening_cash: params.openingCash,
			opened_at: now,
			status: 'open',
			updated_at: now,
			synced: false
		});

		await db.activity_logs.add({
			id: 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
			branch_id: this.device.branch_id,
			branch_name: this.device.branch_name || this.branch?.name,
			user_id: params.operator.id,
			user_name: params.operator.name,
			role: 'cashier',
			action: 'open_shift',
			details: `${params.operator.name} membuka shift di ${this.device.name} dengan setoran awal ${params.openingCash}.`,
			timestamp: now,
			synced: false
		});

		this.operator = params.operator;
		this.refreshUser();
		await syncEngine.updatePendingCount();
		if (syncEngine.isOnline) syncEngine.triggerSync();
		return { success: true };
	}

	/** Menutup shift dan melepas operator dari perangkat. */
	async releaseOperator() {
		this.operator = null;
		this.refreshUser();
		await syncEngine.updatePendingCount();
		if (syncEngine.isOnline) syncEngine.triggerSync();
	}

	/** Keluar sebagai admin; kembali ke mode kasir bila perangkat sudah diinisialisasi. */
	async exitAdmin() {
		this.admin = null;
		if (typeof window !== 'undefined') localStorage.removeItem(ADMIN_KEY);

		// Pulihkan konteks cabang toko bila perangkat ini sudah terikat cabang.
		if (this.device) {
			const branchId = this.device.branch_id;
			this.branch = branchId && branchId !== 'all' ? (await db.branches.get(branchId)) || null : null;
		}
		this.refreshUser();

		const online = typeof navigator !== 'undefined' && navigator.onLine;
		if (this.device) {
			// Pulihkan sesi terminal agar sinkronisasi kasir tetap berjalan.
			if (online) {
				try {
					await fetch('/api/auth/device', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							device_id: this.device.id,
							device_name: this.device.name,
							branch_id: this.device.branch_id
						})
					});
				} catch {
					// abaikan
				}
			}
		} else if (online) {
			try {
				await fetch('/api/auth/logout', { method: 'POST' });
			} catch {
				// abaikan jika offline
			}
		}
	}

	/** Keluar sepenuhnya dari perangkat (kembali ke layar inisialisasi). */
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
					details: `${this.user.name} keluar dari sistem.`,
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
		cartStore.reset();
	}

	private clearSession() {
		this.admin = null;
		this.device = null;
		this.operator = null;
		this.branch = null;
		this.refreshUser();
		if (typeof window !== 'undefined') {
			localStorage.removeItem(ADMIN_KEY);
			localStorage.removeItem(DEVICE_KEY);
			localStorage.removeItem(DEVICE_NAME_KEY);
			localStorage.removeItem(BRANCH_KEY);
		}
	}
}

export const authState = new AuthState();
