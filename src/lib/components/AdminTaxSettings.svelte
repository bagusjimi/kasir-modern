<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '../db/index.js';
	import { authState } from '../stores/auth.svelte.js';
	import { syncEngine } from '../sync/index.svelte.js';
	import type { TaxSettings } from '../types/index.js';
	import {
		Receipt,
		Percent,
		CheckCircle2,
		AlertCircle,
		Save,
		RotateCcw,
		HelpCircle,
		ShieldCheck,
		Calculator
	} from 'lucide-svelte';

	let enabled = $state<boolean>(true);
	let rate = $state<number>(11);
	let name = $state<string>('PPN');
	let isLoading = $state<boolean>(true);
	let isSaving = $state<boolean>(false);
	let notification = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	// Simulasi perhitungan belanja
	let sampleSubtotal = $state<number>(100000);
	let computedTax = $derived(enabled ? Math.round((sampleSubtotal * rate) / 100) : 0);
	let computedTotal = $derived(sampleSubtotal + computedTax);

	function formatRupiah(amount: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(amount);
	}

	async function loadTaxSettings() {
		isLoading = true;
		notification = null;
		try {
			// 1. Ambil dari lokal Dexie terlebih dahulu
			const local = await db.app_settings.get('tax_settings');
			if (local && local.value) {
				const val = local.value as TaxSettings;
				enabled = val.enabled ?? true;
				rate = val.rate ?? 11;
				name = val.name ?? 'PPN';
			}

			// 2. Jika online, coba perbarui dari server
			if (syncEngine.isOnline) {
				try {
					const res = await fetch('/api/settings');
					if (res.ok) {
						const result = (await res.json()) as { success: boolean; data?: TaxSettings };
						if (result.success && result.data) {
							enabled = result.data.enabled ?? true;
							rate = result.data.rate ?? 11;
							name = result.data.name ?? 'PPN';

							// Simpan ke Dexie
							await db.app_settings.put({
								key: 'tax_settings',
								value: result.data
							});
						}
					}
				} catch (serverErr) {
					console.warn('Gagal sinkronisasi setting pajak dari server:', serverErr);
				}
			}
		} catch (err) {
			console.error('Gagal memuat pengaturan pajak:', err);
		} finally {
			isLoading = false;
		}
	}

	async function saveTaxSettings() {
		notification = null;

		if (rate < 0 || rate > 100) {
			notification = {
				type: 'error',
				message: 'Besaran persentase tarif pajak harus antara 0% dan 100%'
			};
			return;
		}

		if (!name.trim()) {
			notification = {
				type: 'error',
				message: 'Nama atau label pajak tidak boleh kosong'
			};
			return;
		}

		isSaving = true;
		const updated: TaxSettings = {
			enabled,
			rate,
			name: name.trim(),
			updated_at: new Date().toISOString()
		};

		try {
			// 1. Simpan ke database lokal Dexie
			await db.app_settings.put({
				key: 'tax_settings',
				value: updated
			});

			// Tambahkan catatan log aktivitas
			if (authState.user) {
				await db.activity_logs.add({
					id: 'act-' + Date.now(),
					branch_id: authState.user.branch_id || 'all',
					branch_name: 'Pusat',
					user_id: authState.user.id,
					user_name: authState.user.name,
					role: authState.user.role,
					action: 'tax_settings_updated',
					details: `Mengubah pengaturan pajak: ${enabled ? 'Aktif' : 'Nonaktif'}, Nama: ${name}, Tarif: ${rate}%`,
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
						body: JSON.stringify(updated)
					});
					if (!res.ok) {
						console.warn('Gagal menyimpan ke D1 Cloudflare');
					}
				} catch (networkErr) {
					console.warn('Offline saat mengirim ke server:', networkErr);
				}
			}

			notification = {
				type: 'success',
				message: 'Konfigurasi pajak berhasil diperbarui dan diterapkan ke seluruh sistem!'
			};

			// Hilangkan notifikasi sukses setelah 4 detik
			setTimeout(() => {
				if (notification?.type === 'success') {
					notification = null;
				}
			}, 4000);
		} catch (err: any) {
			console.error('Gagal menyimpan konfigurasi pajak:', err);
			notification = {
				type: 'error',
				message: 'Terjadi kesalahan saat menyimpan pengaturan: ' + (err.message || 'Unknown error')
			};
		} finally {
			isSaving = false;
		}
	}

	function applyPreset(presetName: string, presetRate: number, isEnabled: boolean) {
		name = presetName;
		rate = presetRate;
		enabled = isEnabled;
	}

	onMount(() => {
		loadTaxSettings();
	});
</script>

<div class="space-y-6">
	<!-- Page Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<div class="flex items-center gap-2">
				<div class="p-2 rounded-xl bg-emerald-100 text-emerald-800">
					<Receipt class="h-6 w-6" />
				</div>
				<div>
					<h1 class="text-2xl font-black text-gray-900 tracking-tight">Konfigurasi Pajak (PPN / PB1)</h1>
					<p class="text-xs text-gray-500">Atur apakah pajak diberlakukan pada kasir, sesuaikan persentase tarif, dan beri nama label pajak.</p>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<button
				onclick={loadTaxSettings}
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
		<!-- Main Form Settings -->
		<div class="lg:col-span-2 space-y-6">
			<div class="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
				<!-- Toggle Pajak Aktif / Nonaktif -->
				<div class="flex items-center justify-between p-4 rounded-2xl border {enabled ? 'bg-emerald-50/60 border-emerald-200' : 'bg-gray-50 border-gray-200'} transition">
					<div class="space-y-1">
						<div class="flex items-center gap-2">
							<span class="font-bold text-gray-900 text-base">Status Pemungutan Pajak</span>
							<span class="text-xs font-semibold px-2 py-0.5 rounded-full {enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'}">
								{enabled ? 'Aktif' : 'Nonaktif'}
							</span>
						</div>
						<p class="text-xs text-gray-500 max-w-md">
							Jika diaktifkan, kasir akan otomatis menghitung pajak pada setiap transaksi POS dan mencantumkannya di struk nota.
						</p>
					</div>

					<label class="relative inline-flex items-center cursor-pointer">
						<input
							type="checkbox"
							bind:checked={enabled}
							class="sr-only peer"
						/>
						<div
							class="w-12 h-6.5 bg-gray-300 peer-focus:outline-hidden peer-focus:ring-2 peer-focus:ring-emerald-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"
						></div>
					</label>
				</div>

				<!-- Nama Pajak -->
				<div>
					<label for="tax-name-input" class="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
						Nama / Label Pajak (Muncul di Struk POS)
					</label>
					<input
						id="tax-name-input"
						type="text"
						bind:value={name}
						placeholder="Contoh: PPN, PB1, Pajak Resto"
						class="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm text-gray-900"
					/>
					<p class="text-[11px] text-gray-400 mt-1.5">
						Label ini akan ditampilkan pada ringkasan keranjang kasir dan nota belanja pelanggan.
					</p>
				</div>

				<!-- Besaran Tarif Pajak (%) -->
				<div>
					<label for="tax-rate-input" class="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
						Besaran Tarif Pajak (%)
					</label>
					<div class="relative">
						<input
							id="tax-rate-input"
							type="number"
							bind:value={rate}
							min="0"
							max="100"
							step="0.5"
							class="w-full pl-4 pr-10 py-2.5 rounded-xl border border-gray-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm text-gray-900 font-semibold"
						/>
						<div class="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-gray-400">
							<Percent class="h-4 w-4" />
						</div>
					</div>
				</div>

				<!-- Pilihan Cepat (Preset) -->
				<div class="pt-2 border-t border-gray-100">
					<span class="block text-xs font-bold text-gray-700 mb-2">Pilihan Cepat Standar Pajak Indonesia:</span>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							onclick={() => applyPreset('PB1 (Pajak Resto)', 10, true)}
							class="px-3 py-1.5 rounded-xl border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50/50 text-xs font-semibold text-gray-700 transition cursor-pointer"
						>
							PB1 Resto (10%)
						</button>
						<button
							type="button"
							onclick={() => applyPreset('PPN Nasional', 11, true)}
							class="px-3 py-1.5 rounded-xl border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50/50 text-xs font-semibold text-gray-700 transition cursor-pointer"
						>
							PPN Nasional (11%)
						</button>
						<button
							type="button"
							onclick={() => applyPreset('Pajak Khusus', 5, true)}
							class="px-3 py-1.5 rounded-xl border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50/50 text-xs font-semibold text-gray-700 transition cursor-pointer"
						>
							Pajak Khusus (5%)
						</button>
						<button
							type="button"
							onclick={() => applyPreset('Bebas Pajak', 0, false)}
							class="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50/40 hover:bg-rose-100/60 text-xs font-semibold text-rose-700 transition cursor-pointer"
						>
							Bebas Pajak (Nonaktifkan)
						</button>
					</div>
				</div>

				<!-- Action Buttons -->
				<div class="pt-4 flex justify-end">
					<button
						onclick={saveTaxSettings}
						disabled={isSaving}
						class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition cursor-pointer"
					>
						<Save class="h-4 w-4" />
						<span>{isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
					</button>
				</div>
			</div>
		</div>

		<!-- Preview & Panduan -->
		<div class="space-y-6">
			<!-- Simulasi Real-Time Kasir -->
			<div class="bg-slate-900 text-white rounded-2xl p-5 shadow-lg border border-slate-800 space-y-4">
				<div class="flex items-center gap-2 border-b border-slate-800 pb-3">
					<Calculator class="h-4 w-4 text-emerald-400" />
					<h3 class="text-xs font-bold uppercase tracking-wider text-slate-200">Simulasi Tagihan Kasir</h3>
				</div>

				<div class="space-y-2.5 text-xs">
					<div class="flex justify-between items-center text-slate-400">
						<span>Subtotal Belanja:</span>
						<span class="font-medium text-slate-200">{formatRupiah(sampleSubtotal)}</span>
					</div>

					<div class="flex justify-between items-center">
						<span class="text-slate-400">
							{name || 'Pajak'} ({enabled ? `${rate}%` : 'Nonaktif'}):
						</span>
						<span class="font-medium {enabled && rate > 0 ? 'text-emerald-400' : 'text-slate-500'}">
							{enabled && rate > 0 ? `+ ${formatRupiah(computedTax)}` : 'Rp 0'}
						</span>
					</div>

					<div class="pt-3 border-t border-slate-800 flex justify-between items-center">
						<span class="font-bold text-white text-sm">Total Tagihan:</span>
						<span class="font-black text-emerald-400 text-base">{formatRupiah(computedTotal)}</span>
					</div>
				</div>

				<div class="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
					Status saat ini:
					<span class="font-bold {enabled ? 'text-emerald-400' : 'text-amber-400'}">
						{enabled ? `Aktif (${name} ${rate}%)` : 'Nonaktif (Bebas Pajak)'}
					</span>
				</div>
			</div>

			<!-- Informasi Hak Akses & Kebijakan -->
			<div class="bg-indigo-50/50 rounded-2xl border border-indigo-100 p-5 space-y-3">
				<div class="flex items-center gap-2 text-indigo-900 font-bold text-xs">
					<ShieldCheck class="h-4 w-4 text-indigo-600" />
					<span>Kewenangan Administrator</span>
				</div>
				<p class="text-xs text-indigo-800/80 leading-relaxed">
					Pengaturan ini dikelola secara terpusat oleh Admin. Kasir di seluruh cabang toko (Jakarta, Bandung, Surabaya, dsb.) akan secara otomatis mengikuti konfigurasi pajak ini tanpa perlu mengubah pengaturan di masing-masing mesin kasir.
				</p>
			</div>
		</div>
	</div>
</div>
