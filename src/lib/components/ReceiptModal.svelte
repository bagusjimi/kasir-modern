<script lang="ts">
	import type { Transaction } from '../types/index.js';
	import { Printer, X, CheckCircle2 } from 'lucide-svelte';

	interface Props {
		transaction: Transaction | null;
		onClose: () => void;
	}

	let { transaction, onClose }: Props = $props();

	function handlePrint() {
		window.print();
	}

	function formatRupiah(num: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(num);
	}
</script>

{#if transaction}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
			<!-- Header Modal -->
			<div class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-4">
				<div class="flex items-center gap-2 text-emerald-600 font-semibold">
					<CheckCircle2 class="h-5 w-5" />
					<span>Transaksi Berhasil</span>
				</div>
				<button
					onclick={onClose}
					class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition"
					aria-label="Tutup"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Thermal Struk Preview -->
			<div class="overflow-y-auto p-6 bg-gray-100 flex justify-center">
				<div
					id="thermal-receipt"
					class="w-full max-w-[320px] rounded-lg border border-dashed border-gray-300 bg-white p-5 text-gray-800 shadow-xs font-mono text-xs leading-relaxed"
				>
					<!-- Header Toko -->
					<div class="text-center pb-3 border-b border-dashed border-gray-300">
						<h3 class="text-base font-bold tracking-wider uppercase">KASIR MODERN</h3>
						<p class="font-semibold text-gray-700">{transaction.branch_name}</p>
						<p class="text-[10px] text-gray-500">Sistem Kasir Offline-First Multi Cabang</p>
					</div>

					<!-- Info Transaksi -->
					<div class="py-2.5 border-b border-dashed border-gray-300 text-[11px] space-y-0.5">
						<div class="flex justify-between">
							<span class="text-gray-500">No. Nota:</span>
							<span class="font-semibold">{transaction.invoice_no}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-500">Tanggal:</span>
							<span>{new Date(transaction.created_at).toLocaleString('id-ID')}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-500">Kasir:</span>
							<span>{transaction.cashier_name}</span>
						</div>
						{#if transaction.customer_name}
							<div class="flex justify-between">
								<span class="text-gray-500">Pelanggan:</span>
								<span>{transaction.customer_name}</span>
							</div>
						{/if}
						<div class="flex justify-between">
							<span class="text-gray-500">Pembayaran:</span>
							<span class="uppercase font-semibold">{transaction.payment_method}</span>
						</div>
					</div>

					<!-- Item Belanja -->
					<div class="py-2.5 border-b border-dashed border-gray-300 space-y-2">
						{#each transaction.items as item}
							<div>
								<div class="font-semibold text-gray-800">{item.product_name}</div>
								<div class="flex justify-between text-[11px] text-gray-600">
									<span>{item.quantity} x {formatRupiah(item.price)}</span>
									<span class="font-medium">{formatRupiah(item.subtotal)}</span>
								</div>
								{#if item.notes}
									<div class="text-[10px] text-gray-400 italic">catatan: {item.notes}</div>
								{/if}
							</div>
						{/each}
					</div>

					<!-- Rincian Total -->
					<div class="py-2.5 border-b border-dashed border-gray-300 space-y-1 text-[11px]">
						<div class="flex justify-between">
							<span class="text-gray-600">Subtotal</span>
							<span>{formatRupiah(transaction.subtotal)}</span>
						</div>
						{#if transaction.discount > 0}
							<div class="flex justify-between text-rose-600">
								<span>Diskon</span>
								<span>-{formatRupiah(transaction.discount)}</span>
							</div>
						{/if}
						{#if transaction.tax > 0}
							<div class="flex justify-between text-gray-600">
								<span>Pajak (PB1 10%)</span>
								<span>{formatRupiah(transaction.tax)}</span>
							</div>
						{/if}
						<div class="flex justify-between text-sm font-bold pt-1 border-t border-gray-200">
							<span>TOTAL</span>
							<span class="text-emerald-700">{formatRupiah(transaction.total)}</span>
						</div>
						<div class="flex justify-between pt-1">
							<span class="text-gray-600">Bayar ({transaction.payment_method.toUpperCase()})</span>
							<span>{formatRupiah(transaction.amount_paid)}</span>
						</div>
						<div class="flex justify-between font-semibold">
							<span class="text-gray-600">Kembalian</span>
							<span>{formatRupiah(transaction.change)}</span>
						</div>
					</div>

					<!-- Footer Struk -->
					<div class="text-center pt-3 text-[10px] text-gray-500 space-y-1">
						<p class="font-medium">Terima kasih atas kunjungan Anda!</p>
						<p>Barang yang sudah dibeli tidak dapat ditukar/dikembalikan.</p>
						<div class="mt-2 text-[9px] text-gray-400">
							Status: {transaction.synced ? 'Tersinkronisasi Online' : 'Disimpan Lokal (Offline)'}
						</div>
					</div>
				</div>
			</div>

			<!-- Tombol Aksi -->
			<div class="flex items-center justify-end gap-3 border-t border-gray-100 bg-white p-4">
				<button
					onclick={onClose}
					class="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium transition"
				>
					Tutup
				</button>
				<button
					onclick={handlePrint}
					class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-md shadow-emerald-600/20 transition cursor-pointer"
				>
					<Printer class="h-4 w-4" />
					<span>Cetak Struk Nota</span>
				</button>
			</div>
		</div>
	</div>
{/if}

