// Encoder Code 128 (subset B) murni TypeScript tanpa dependensi.
// Menghasilkan markup SVG siap cetak untuk label barcode.

const PATTERNS: string[] = [
	'212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
	'132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
	'123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
	'311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
	'232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
	'231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
	'313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
	'331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
	'111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
	'122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
	'111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
	'421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
	'114311', '411113', '411311', '113141', '114131', '311141', '411131',
	'211412', '211214', '211232', '2331112'
];

const START_B = 104;
const STOP = 106;

function sanitizeCode128B(text: string): string {
	return (
		text
			.split('')
			.filter(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126)
			.join('') || '0'
	);
}

export interface Code128SvgOptions {
	heightMm?: number;
	moduleMm?: number;
	showText?: boolean;
}

export function code128Svg(rawText: string, options: Code128SvgOptions = {}): string {
	const text = sanitizeCode128B(rawText);
	const heightMm = options.heightMm ?? 10;
	const moduleMm = options.moduleMm ?? 0.33;
	const showText = options.showText ?? true;

	const values = [START_B, ...text.split('').map(ch => ch.charCodeAt(0) - 32)];
	let checksum = START_B;
	for (let i = 1; i < values.length; i++) {
		checksum += i * values[i];
	}
	values.push(checksum % 103, STOP);

	const symbols = values.map(v => PATTERNS[v]);
	const totalModules = symbols.reduce((sum, pat) => sum + pat.split('').reduce((a, b) => a + Number(b), 0), 0);
	const barcodeWidth = totalModules * moduleMm;
	const textHeight = showText ? 3 : 0;
	const svgWidth = barcodeWidth + 1;
	const svgHeight = heightMm + textHeight + 1;

	let bars = '';
	let x = 0.5;
	for (const pat of symbols) {
		let isBar = true;
		for (const w of pat) {
			const width = Number(w) * moduleMm;
			if (isBar) {
				bars += `<rect x="${x.toFixed(3)}" y="0.5" width="${width.toFixed(3)}" height="${heightMm}" fill="#000"/>`;
			}
			x += width;
			isBar = !isBar;
		}
	}

	const textEl = showText
		? `<text x="${(svgWidth / 2).toFixed(3)}" y="${(heightMm + 3).toFixed(3)}" font-family="monospace" font-size="2.6" text-anchor="middle" fill="#000">${text
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')}</text>`
		: '';

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth.toFixed(3)} ${svgHeight.toFixed(3)}" shape-rendering="crispEdges">${bars}${textEl}</svg>`;
}
