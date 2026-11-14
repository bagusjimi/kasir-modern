<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.svelte.js';
	import type { PaymentSettings } from '../types/index.js';
	import {
		QrCode,
		CreditCard,
		Save,
		CheckCircle2,
		AlertCircle,
		RotateCcw,
		Upload,
		Trash2,
		Wallet
	} from 'lucide-svelte';

	const MAX_IMAGE_BYTES = 400 * 1024; // Batas ukuran gambar QR (data URL)

	let qrisEnabled = $state<boolean>(false);
	let qrisImage = $state<string>('');
	let qrisMerchantName = $state<string>('');
	let transferEnabled = $state<boolean>(false);
	let transferBank = $state<string>('');
	let transferAccountNumber = $state<string>('');
	let transferAccountName = $state<string>('');

	let isLoading = $state<boolean>(true);
	let isSaving = $state<boolean>(false);
	let imageError = $state<string | null>(null);
	let notification = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	async function loadPaymentSettings() {
		isLoading = true;
		imageError = null;
		try {
			// 1. Ambil dari lokal Dexie terlebih dahulu
			const local = await db.app_settings.get('payment_settings');
			if (local && local.value) {
				applySettings(local.value as PaymentSettings);
			}

			// 2. Jika online, perbarui dari server
			if (syncEngine.isOnline) {
				try {
					const res = await fetch('/api/settings');
					if (res.ok) {
						const result = (await res.json()) as { success: boolean; payment?: PaymentSettings };
						if (result.success && result.payment) {
							applySettings(result.payment);
							await db.app_settings.put({
								key: 'payment_settings',
								value: result.payment
							});
						}
					}
				} catch (serverErr) {
					console.warn('Gagal memuat pengaturan pembayaran dari server:', serverErr);
				}
			}
		} finally {
			isLoading = false;
		}
	}

	function applySettings(p: PaymentSettings | null | undefined) {
		if (!p) return;
		qrisEnabled = p.qris?.enabled ?? false;
		qrisImage = p.qris?.image ?? '';
		qrisMerchantName = p.qris?.merchant_name ?? '';
		transferEnabled = p.transfer?.enabled ?? false;
		transferBank = p.transfer?.bank_name ?? '';
		transferAccountNumber = p.transfer?.account_number ?? '';
		transferAccountName = p.transfer?.account_name ?? '';
	}

	function handleImageUpload(event: Event) {
		imageError = null;
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			imageError = 'Berkas harus berupa gambar (PNG/JPG).';
			input.value = '';
			return;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			imageError = 'Ukuran gambar maksimal 400 KB.';
			input.value = '';
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			qrisImage = String(reader.result || '');
		};
		reader.readAsDataURL(file);
		input.value = '';
	}

	function removeImage() {
		qrisImage = '';
		imageError = null;
	}

	async function saveSettings() {
		if (qrisEnabled && !qrisImage) {
			notification = { type: 'error', message: 'Unggah gambar QR statis terlebih dahulu sebelum mengaktifkan QRIS' };
			return;
		}
		if (transferEnabled && !transferAccountNumber.trim()) {
			notification = { type: 'error', message: 'Nomor rekening wajib diisi jika transfer bank diaktifkan' };
			return;
		}

		isSaving = true;
		const payment: PaymentSettings = {
			qris: {
				enabled: qrisEnabled,
				mode: 'static',
				image: qrisImage,
				merchant_name: qrisMerchantName.trim(),
				updated_at: new Date().toISOString()
			},
			transfer: {
				enabled: transferEnabled,
				bank_name: transferBank.trim(),
				account_number: transferAccountNumber.trim(),
				account_name: transferAccountName.trim(),
				updated_at: new Date().toISOString()
			}
		};

		try {
			// 1. Simpan ke database lokal Dexie
			await db.app_settings.put({ key: 'payment_settings', value: payment });

			// Catatan log aktivitas
			if (authState.user) {
				await db.activity_logs.add({
					id: 'act-' + Date.now(),
					branch_id: authState.user.branch_id || 'all',
					branch_name: 'Pusat',
					user_id: authState.user.id,
					user_name: authState.user.name,
					role: authState.user.role,
					action: 'payment_settings_updated',
					details: `Mengubah metode pembayaran: QRIS ${qrisEnabled ? 'aktif' : 'nonaktif'}, Transfer ${transferEnabled ? 'aktif' : 'nonaktif'}`,
					timestamp: new Date().toISOString(),
					synced: false
				});
			}

			// 2. Jika online, kirim ke server D1
			if (syncEngine.isOnline) {
				try {
					const res = await fetch('/api/settings', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ payment })
					});
					if (!res.ok) {
						console.warn('Gagal menyimpan pengaturan pembayaran ke D1 Cloudflare');
					}
				} catch (networkErr) {
					console.warn('Offline saat mengirim ke server:', networkErr);
				}
			}

			notification = {
				type: 'success',
				message: 'Metode pembayaran berhasil diperbarui dan akan diterapkan di perangkat kasir.'
			};
			setTimeout(() => {
				if (notification?.type === 'success') {
					notification = null;
				}
			}, 4000);
		} catch (err: any) {
			console.error('Gagal menyimpan pengaturan pembayaran:', err);
			notification = {
				type: 'error',
				message: 'Terjadi kesalahan saat menyimpan pengaturan: ' + (err.message || 'Unknown error')
			};
		} finally {
			isSaving = false;
		}
	}

	onMount(() => {
		loadPaymentSettings();
	});
</script>

<div class="space-y-6">
	<!-- Header Halaman -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<div class="flex items-center gap-2">
				<div class="p-2 rounded-xl bg-emerald-100 text-emerald-800">
					<Wallet class="h-6 w-6" />
				</div>
				<div>
					<h1 class="text-2xl font-black text-gray-900 tracking-tight">Metode Pembayaran</h1>
					<p class="text-xs text-gray-500">Atur metode pembayaran non-tunai yang tersedia di kasir: QRIS statis dan transfer bank.</p>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<button
				onclick={loadPaymentSettings}
				disabled={isLoading}
				class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition cursor-pointer"
			>
				<RotateCcw class="h-3.5 w-3.5 {isLoading ? 'animate-spin' : ''}" />
				<span>Muat Ulang</span>
			</button>
		</div>
	</div>

	<!-- Notifikasi -->
	{#if notification}
		<div
			class="p-4 rounded-2xl flex items-start gap-3 transition-all {notification.type === 'success'
				? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
				: 'bg-rose-50 border border-rose-200 text-rose-800'}"
		>
			{#if notification.type === 'success'}
				<CheckCircle2 class="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
			{:else}
				<AlertCircle class="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
			{/if}
			<div class="flex-1 text-sm font-medium">
				{notification.message}
			</div>
			<button
				onclick={() => (notification = null)}
				class="text-xs opacity-60 hover:opacity-100 font-bold ml-2 cursor-pointer"
			>
				✕
			</button>
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
		<!-- Form Utama -->
		<div class="lg:col-span-2 space-y-6">
			<!-- QRIS Statis -->
			<div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<QrCode class="h-4 w-4 text-emerald-600" />
						<span class="font-bold text-gray-900 text-base">QRIS Statis</span>
						<span class="text-[11px] text-gray-400">QR dari bank/mitra pembayaran Anda</span>
					</div>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={qrisEnabled} class="accent-emerald-600 h-4 w-4" />
						<span class="text-xs font-semibold {qrisEnabled ? 'text-emerald-700' : 'text-gray-500'}">{qrisEnabled ? 'Aktif' : 'Nonaktif'}</span>
					</label>
				</div>

				{#if qrisEnabled}
					<div class="space-y-4 border-t border-gray-100 pt-4">
						<div>
							<label for="qris-merchant" class="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Nama Merchant (Opsional)</label>
							<input
								id="qris-merchant"
								type="text"
								bind:value={qrisMerchantName}
								placeholder="Contoh: Toko Sumber Rejeki"
								class="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500"
							/>
						</div>

						<div>
							<span class="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Gambar QR Statis</span>
							<div class="flex flex-wrap items-center gap-4">
								<div class="h-36 w-36 rounded-xl border border-gray-300 bg-white flex items-center justify-center overflow-hidden">
									{#if qrisImage}
										<img src={qrisImage} alt="QR Statis" class="h-full w-full object-contain p-1" />
									{:else}
										<QrCode class="h-16 w-16 text-gray-300" />
									{/if}
								</div>
								<div class="space-y-2">
									<label class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition cursor-pointer">
										<Upload class="h-3.5 w-3.5" />
										<span>{qrisImage ? 'Ganti Gambar' : 'Unggah Gambar'}</span>
										<input type="file" accept="image/*" class="hidden" onchange={handleImageUpload} />
									</label>
									{#if qrisImage}
										<button
											onclick={removeImage}
											class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 transition cursor-pointer ml-2"
										>
											<Trash2 class="h-3.5 w-3.5" />
											<span>Hapus</span>
										</button>
									{/if}
									<p class="text-[11px] text-gray-400">PNG/JPG, maksimal 400 KB. Ambil QR statis dari aplikasi bank/mitra pembayaran Anda.</p>
									{#if imageError}
										<p class="text-[11px] font-semibold text-rose-600">{imageError}</p>
									{/if}
								</div>
							</div>
						</div>

						<div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-800">
							<strong>Cara kerja:</strong> kasir menampilkan QR ini saat pelanggan membayar, lalu memastikan dana masuk lewat notifikasi bank/mitra sebelum mengonfirmasi. Verifikasi otomatis (QRIS dinamis) dapat ditambahkan nanti tanpa mengubah alur ini.
						</div>
					</div>
				{:else}
					<p class="text-xs text-gray-400 border-t border-gray-100 pt-4">Saat nonaktif, tombol QRIS tidak tampil di form pembayaran kasir.</p>
				{/if}
			</div>

			<!-- Transfer Bank -->
			<div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<CreditCard class="h-4 w-4 text-emerald-600" />
						<span class="font-bold text-gray-900 text-base">Transfer Bank</span>
						<span class="text-[11px] text-gray-400">Rekening tujuan yang tampil di kasir</span>
					</div>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={transferEnabled} class="accent-emerald-600 h-4 w-4" />
						<span class="text-xs font-semibold {transferEnabled ? 'text-emerald-700' : 'text-gray-500'}">{transferEnabled ? 'Aktif' : 'Nonaktif'}</span>
					</label>
				</div>

				{#if transferEnabled}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-gray-100 pt-4">
						<div>
							<label for="transfer-bank" class="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Nama Bank</label>
							<input
								id="transfer-bank"
								type="text"
								bind:value={transferBank}
								placeholder="Contoh: BCA"
								class="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500"
							/>
						</div>
						<div>
							<label for="transfer-number" class="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Nomor Rekening</label>
							<input
								id="transfer-number"
								type="text"
								bind:value={transferAccountNumber}
								placeholder="Contoh: 1234567890"
								class="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500"
							/>
						</div>
						<div class="sm:col-span-2">
							<label for="transfer-name" class="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Atas Nama</label>
							<input
								id="transfer-name"
								type="text"
								bind:value={transferAccountName}
								placeholder="Contoh: CV Sumber Rejeki"
								class="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:border-emerald-500"
							/>
						</div>
					</div>
				{:else}
					<p class="text-xs text-gray-400 border-t border-gray-100 pt-4">Saat nonaktif, tombol Transfer Bank tidak tampil di form pembayaran kasir.</p>
				{/if}
			</div>

			<!-- Tombol Simpan -->
			<button
				onclick={saveSettings}
				disabled={isSaving || isLoading}
				class="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-md shadow-emerald-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
			>
				<Save class="h-4 w-4" />
				<span>{isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
			</button>
		</div>

		<!-- Panel Penjelasan -->
		<div class="space-y-4">
			<div class="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
				<div class="flex items-center gap-2">
					<Wallet class="h-4 w-4 text-emerald-600" />
					<span class="font-bold text-gray-900 text-sm">Catatan Penting</span>
				</div>
				<ul class="text-xs text-gray-600 space-y-2 list-disc list-inside">
					<li>Metode tunai selalu tersedia di kasir.</li>
					<li>QRIS statis memerlukan konfirmasi manual kasir setelah dana masuk.</li>
					<li>Pengaturan berlaku untuk semua cabang dan tersinkron ke perangkat kasir otomatis.</li>
					<li>Transaksi QRIS/transfer tercatat sebagai non-tunai di laporan dan rekap shift.</li>
				</ul>
			</div>
		</div>
	</div>
</div>
