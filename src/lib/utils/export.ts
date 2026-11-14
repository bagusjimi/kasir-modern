// Utilitas ekspor data: CSV (kompatibel Excel) dan JSON (backup lengkap).

const CSV_SEPARATOR = ';';

function escapeCsvValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	const s = String(value);
	if (s.includes(CSV_SEPARATOR) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
		return '"' + s.replace(/"/g, '""') + '"';
	}
	return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
	const lines = [headers.map(escapeCsvValue).join(CSV_SEPARATOR)];
	for (const row of rows) {
		lines.push(row.map(escapeCsvValue).join(CSV_SEPARATOR));
	}
	// BOM agar Excel mengenali UTF-8 (nama produk beraksen, simbol, dll.)
	return '\uFEFF' + lines.join('\r\n');
}

export function downloadFile(filename: string, content: string, mime: string): void {
	if (typeof window === 'undefined') return;
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
	downloadFile(filename, toCsv(headers, rows), 'text/csv;charset=utf-8');
}

export function downloadJson(filename: string, data: unknown): void {
	downloadFile(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}

export function fileTimestamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
