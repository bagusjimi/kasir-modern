import type { User, Branch } from '../types/index.js';
import { db } from '../db/index.js';

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
		const user = await db.users.where('username').equalsIgnoreCase(username.trim()).first();

		if (!user) {
			return { success: false, message: 'Nama pengguna tidak ditemukan' };
		}

		if (!user.active) {
			return { success: false, message: 'Akun ini dinonaktifkan oleh Admin' };
		}

		if (user.pin !== pin.trim()) {
			return { success: false, message: 'PIN / Sandi salah' };
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
