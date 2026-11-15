import { jsPDF } from 'jspdf';
import autoTableImport from 'jspdf-autotable';

// jspdf-autotable mengekspor fungsi secara default; interop ESM/CJS berbeda
// antar bundler (Vite memberi fungsi, Node membungkusnya sebagai .default).
const autoTable = (
	typeof autoTableImport === 'function' ? autoTableImport : (autoTableImport as { default: typeof autoTableImport }).default
) as typeof autoTableImport;

/**
 * Pembangun PDF laporan penjualan komprehensif (A4, siap cetak).
 * Data dioper sebagai snapshot biasa agar modul ini tidak bergantung pada store/komponen.
 */

export interface ReportMetric {
	label: string;
	value: string;
	note?: string;
}

export interface ReportPaymentRow {
	label: string;
	count: number;
	amount: number;
	percentage: number;
}

export interface ReportProductRow {
	name: string;
	quantity: number;
	revenue: number;
	profit: number;
}

export interface ReportCategoryRow {
	name: string;
	count: number;
	revenue: number;
}

export interface ReportExpenseRow {
	name: string;
	count: number;
	amount: number;
}

export interface ReportTransactionRow {
	invoice_no: string;
	created_at: string;
	branch_name?: string;
	cashier_name?: string;
	payment_method: string;
	discount: number;
	tax: number;
	total: number;
}

export interface ReportPdfInput {
	storeName?: string;
	storeAddress?: string;
	storePhone?: string;
	periodLabel: string;
	branchLabel: string;
	paymentLabel?: string;
	generatedAt: string;
	metrics: ReportMetric[];
	payments: ReportPaymentRow[];
	categories: ReportCategoryRow[];
	products: ReportProductRow[];
	expenses: ReportExpenseRow[];
	transactions: ReportTransactionRow[];
}

const PRIMARY: [number, number, number] = [5, 150, 105];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [113, 113, 122];
const LINE: [number, number, number] = [228, 228, 231];
const MARGIN = 14;

const paymentLabels: Record<string, string> = {
	cash: 'Tunai',
	qris: 'QRIS',
	transfer: 'Transfer Bank'
};

export function formatRupiahPdf(value: number): string {
	const n = Number.isFinite(value) ? value : 0;
	const sign = n < 0 ? '-' : '';
	return `${sign}Rp ${Math.abs(Math.round(n)).toLocaleString('id-ID')}`;
}

function formatDate(iso: string): string {
	if (!iso) return '-';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function lastY(doc: jsPDF): number {
	return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
	doc.setFillColor(...PRIMARY);
	doc.rect(MARGIN, y - 3.4, 2.6, 4.4, 'F');
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(10.5);
	doc.setTextColor(...INK);
	doc.text(text, MARGIN + 4.5, y);
	return y + 3.5;
}

function table(
	doc: jsPDF,
	y: number,
	head: string[][],
	body: (string | number)[][],
	columnStyles: Record<number, object>
): number {
	autoTable(doc, {
		startY: y,
		head,
		body,
		theme: 'grid',
		margin: { left: MARGIN, right: MARGIN },
		styles: { fontSize: 8, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0.15 },
		headStyles: { fillColor: PRIMARY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
		alternateRowStyles: { fillColor: [250, 250, 250] },
		columnStyles
	});
	return lastY(doc) + 6;
}

function emptyRow(doc: jsPDF, y: number, message: string): number {
	autoTable(doc, {
		startY: y,
		head: [],
		body: [[message]],
		theme: 'plain',
		margin: { left: MARGIN, right: MARGIN },
		styles: { fontSize: 8.5, textColor: MUTED, halign: 'center', cellPadding: 4 }
	});
	return lastY(doc) + 6;
}

function drawHeader(doc: jsPDF, input: ReportPdfInput): number {
	const width = doc.internal.pageSize.getWidth();
	doc.setFillColor(...PRIMARY);
	doc.rect(0, 0, width, 3, 'F');

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(15);
	doc.setTextColor(...INK);
	doc.text(input.storeName?.trim() || 'Toko', MARGIN, 17);

	const meta: string[] = [];
	if (input.storeAddress?.trim()) meta.push(input.storeAddress.trim());
	if (input.storePhone?.trim()) meta.push(`Telp: ${input.storePhone.trim()}`);
	if (meta.length) {
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(8);
		doc.setTextColor(...MUTED);
		doc.text(meta.join('  •  '), MARGIN, 22);
	}

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	doc.setTextColor(...PRIMARY);
	doc.text('LAPORAN PENJUALAN KOMPREHENSIF', width - MARGIN, 17, { align: 'right' });

	doc.setDrawColor(...LINE);
	doc.setLineWidth(0.3);
	doc.line(MARGIN, 27, width - MARGIN, 27);

	const rows: [string, string][] = [
		['Periode', input.periodLabel],
		['Cabang', input.branchLabel]
	];
	if (input.paymentLabel && input.paymentLabel !== 'all') {
		rows.push(['Metode Pembayaran', paymentLabels[input.paymentLabel] || input.paymentLabel]);
	}
	rows.push(['Waktu Cetak', input.generatedAt]);

	doc.setFontSize(8.5);
	let y = 33;
	for (const [key, value] of rows) {
		doc.setFont('helvetica', 'normal');
		doc.setTextColor(...MUTED);
		doc.text(key, MARGIN, y);
		doc.setFont('helvetica', 'bold');
		doc.setTextColor(...INK);
		doc.text(`: ${value}`, MARGIN + 34, y);
		y += 5;
	}
	return y + 3;
}

function drawSignature(doc: jsPDF, input: ReportPdfInput): void {
	const width = doc.internal.pageSize.getWidth();
	const height = doc.internal.pageSize.getHeight();
	let y = lastY(doc) + 14;
	if (y > height - 50) {
		doc.addPage();
		y = 30;
	}

	const colWidth = (width - MARGIN * 2) / 2;
	const leftX = MARGIN;
	const rightX = MARGIN + colWidth;

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(9);
	doc.setTextColor(...INK);
	doc.text('Dibuat oleh,', leftX, y);
	doc.text('Disetujui oleh,', rightX, y);

	doc.setDrawColor(...MUTED);
	doc.setLineWidth(0.2);
	doc.line(leftX, y + 22, leftX + colWidth - 20, y + 22);
	doc.line(rightX, y + 22, rightX + colWidth - 20, y + 22);

	doc.setFontSize(8);
	doc.setTextColor(...MUTED);
	doc.text('Kasir / Operator', leftX, y + 26);
	doc.text('Manajer / Pemilik', rightX, y + 26);
}

export function buildReportPdf(input: ReportPdfInput): jsPDF {
	const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
	doc.setFont('helvetica', 'normal');

	let y = drawHeader(doc, input);

	y = sectionTitle(doc, '1. Ringkasan Eksekutif', y);
	const metricBody: (string | number)[][] = [];
	for (let i = 0; i < input.metrics.length; i += 2) {
		const a = input.metrics[i];
		const b = input.metrics[i + 1];
		metricBody.push([
			a?.label ?? '',
			a ? `${a.value}${a.note ? `  (${a.note})` : ''}` : '',
			b?.label ?? '',
			b ? `${b.value}${b.note ? `  (${b.note})` : ''}` : ''
		]);
	}
	y = table(doc, y, [['Metrik', 'Nilai', 'Metrik', 'Nilai']], metricBody.length ? metricBody : [['-', '-', '-', '-']], {
		0: { fontStyle: 'bold', cellWidth: 42 },
		1: { cellWidth: 46 },
		2: { fontStyle: 'bold', cellWidth: 42 },
		3: { cellWidth: 'auto' }
	});

	y = sectionTitle(doc, '2. Distribusi Metode Pembayaran', y);
	if (input.payments.length) {
		y = table(
			doc,
			y,
			[['Metode', 'Jumlah Transaksi', 'Nominal', 'Porsi']],
			input.payments.map((p) => [p.label, String(p.count), formatRupiahPdf(p.amount), `${p.percentage}%`]),
			{ 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
		);
	} else {
		y = emptyRow(doc, y, 'Tidak ada transaksi pada periode ini.');
	}

	y = sectionTitle(doc, '3. Penjualan per Kategori', y);
	if (input.categories.length) {
		y = table(
			doc,
			y,
			[['Kategori', 'Item Terjual', 'Omset']],
			input.categories.map((c) => [c.name, String(c.count), formatRupiahPdf(c.revenue)]),
			{ 1: { halign: 'center' }, 2: { halign: 'right' } }
		);
	} else {
		y = emptyRow(doc, y, 'Tidak ada data kategori.');
	}

	y = sectionTitle(doc, '4. Produk Terlaris', y);
	if (input.products.length) {
		y = table(
			doc,
			y,
			[['#', 'Produk', 'Terjual', 'Omset', 'Laba Kotor']],
			input.products.map((p, i) => [
				String(i + 1),
				p.name,
				String(p.quantity),
				formatRupiahPdf(p.revenue),
				formatRupiahPdf(p.profit)
			]),
			{ 0: { halign: 'center', cellWidth: 8 }, 2: { halign: 'center', cellWidth: 18 }, 3: { halign: 'right' }, 4: { halign: 'right' } }
		);
	} else {
		y = emptyRow(doc, y, 'Belum ada produk yang terjual pada periode ini.');
	}

	y = sectionTitle(doc, '5. Rincian Biaya Operasional', y);
	if (input.expenses.length) {
		const totalExpense = input.expenses.reduce((s, e) => s + e.amount, 0);
		const body: (string | number)[][] = input.expenses.map((e) => [e.name, String(e.count), formatRupiahPdf(e.amount)]);
		body.push(['Total Beban Operasional', '', formatRupiahPdf(totalExpense)]);
		y = table(doc, y, [['Kategori Biaya', 'Jumlah Catatan', 'Nominal']], body, {
			1: { halign: 'center' },
			2: { halign: 'right' }
		});
	} else {
		y = emptyRow(doc, y, 'Tidak ada catatan biaya operasional pada periode ini.');
	}

	if (y > doc.internal.pageSize.getHeight() - 45) {
		doc.addPage();
		y = 30;
	}
	y = sectionTitle(doc, '6. Rincian Transaksi', y);
	if (input.transactions.length) {
		table(
			doc,
			y,
			[['No. Invoice', 'Tanggal', 'Waktu', 'Cabang', 'Kasir', 'Metode', 'Diskon', 'Pajak', 'Total']],
			input.transactions.map((t) => [
				t.invoice_no,
				formatDate(t.created_at),
				formatTime(t.created_at),
				t.branch_name || '-',
				t.cashier_name || '-',
				paymentLabels[t.payment_method] || t.payment_method,
				t.discount > 0 ? formatRupiahPdf(t.discount) : '-',
				t.tax > 0 ? formatRupiahPdf(t.tax) : '-',
				formatRupiahPdf(t.total)
			]),
			{
				0: { cellWidth: 30, fontStyle: 'bold' },
				1: { cellWidth: 19 },
				2: { cellWidth: 12 },
				3: { cellWidth: 18 },
				4: { cellWidth: 18 },
				5: { cellWidth: 20 },
				6: { halign: 'right' },
				7: { halign: 'right' },
				8: { halign: 'right', fontStyle: 'bold' }
			}
		);
	} else {
		emptyRow(doc, y, 'Tidak ada transaksi yang cocok dengan filter.');
	}

	drawSignature(doc, input);

	const pageCount = doc.getNumberOfPages();
	const width = doc.internal.pageSize.getWidth();
	const height = doc.internal.pageSize.getHeight();
	for (let i = 1; i <= pageCount; i++) {
		doc.setPage(i);
		doc.setDrawColor(...LINE);
		doc.setLineWidth(0.2);
		doc.line(MARGIN, height - 12, width - MARGIN, height - 12);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(7.5);
		doc.setTextColor(...MUTED);
		doc.text('Kasir Modern — Laporan Penjualan Komprehensif', MARGIN, height - 8);
		doc.text(`Halaman ${i} dari ${pageCount}`, width - MARGIN, height - 8, { align: 'right' });
	}

	return doc;
}

export function downloadReportPdf(input: ReportPdfInput, filename: string): void {
	buildReportPdf(input).save(filename);
}

/** Cetak lewat iframe tersembunyi agar memakai viewer PDF bawaan browser. */
export function printReportPdf(input: ReportPdfInput): void {
	const doc = buildReportPdf(input);
	const url = doc.output('bloburl');
	const iframe = document.createElement('iframe');
	iframe.style.position = 'fixed';
	iframe.style.right = '0';
	iframe.style.bottom = '0';
	iframe.style.width = '0';
	iframe.style.height = '0';
	iframe.style.border = '0';
	iframe.src = url.toString();
	iframe.onload = () => {
		setTimeout(() => {
			iframe.contentWindow?.focus();
			iframe.contentWindow?.print();
		}, 300);
	};
	document.body.appendChild(iframe);
	setTimeout(() => iframe.remove(), 60_000);
}
