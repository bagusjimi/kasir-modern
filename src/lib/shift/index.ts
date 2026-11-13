import { db } from '../db/index.js';
import type { Shift } from '../types/index.js';

export interface ShiftSummary {
	totalTransactions: number;
	totalSales: number;
	cashSales: number;
	nonCashSales: number;
	refundedCash: number;
	voidedCount: number;
	refundedCount: number;
	expectedCash: number;
}

/**
 * Mengambil shift yang masih terbuka untuk kasir tertentu.
 * Satu kasir hanya boleh memiliki satu shift aktif.
 */
export async function getOpenShift(cashierId: string): Promise<Shift | undefined> {
	if (!cashierId) return undefined;
	const shifts = await db.shifts.where('cashier_id').equals(cashierId).toArray();
	return shifts
		.filter(s => s.status === 'open')
		.sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0];
}

/**
 * Menghitung ringkasan (Z-Report) transaksi selama shift berjalan:
 * omset per metode bayar, jumlah void/retur, dan kas yang seharusnya ada di laci.
 * Kas yang diharapkan = setoran awal + penjualan tunai - retur tunai.
 */
export async function computeShiftSummary(shift: Shift): Promise<ShiftSummary> {
	const txs = await db.transactions
		.where('cashier_id')
		.equals(shift.cashier_id)
		.and(t => t.created_at >= shift.opened_at)
		.toArray();

	let totalSales = 0;
	let cashSales = 0;
	let nonCashSales = 0;
	let refundedCash = 0;
	let voidedCount = 0;
	let refundedCount = 0;
	let completedCount = 0;

	for (const tx of txs) {
		if (tx.status === 'completed') {
			completedCount++;
			totalSales += tx.total;
			if (tx.payment_method === 'cash') {
				cashSales += tx.total;
			} else {
				nonCashSales += tx.total;
			}
		} else if (tx.status === 'voided') {
			voidedCount++;
		} else if (tx.status === 'refunded') {
			refundedCount++;
			if (tx.payment_method === 'cash') {
				refundedCash += tx.total;
			}
		}
	}

	const expectedCash = shift.opening_cash + cashSales - refundedCash;

	return {
		totalTransactions: completedCount,
		totalSales,
		cashSales,
		nonCashSales,
		refundedCash,
		voidedCount,
		refundedCount,
		expectedCash
	};
}

export function formatRupiah(num: number): string {
	return new Intl.NumberFormat('id-ID', {
		style: 'currency',
		currency: 'IDR',
		minimumFractionDigits: 0
	}).format(num);
}

export function formatDateTime(iso: string): string {
	return new Date(iso).toLocaleString('id-ID', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}
