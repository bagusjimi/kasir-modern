function fnv1a(input: string, seed: number): number {
	let hash = seed >>> 0;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
}

/**
 * ID produk deterministik dari pasangan (branch_id, SKU). Dua perangkat offline
 * di toko yang sama yang membuat produk dengan SKU sama akan menghasilkan ID
 * yang sama, sehingga saat sync tergabung menjadi satu record (bukan duplikat).
 * SKU dinormalisasi (trim + lowercase) agar konsisten dengan validasi SKU unik.
 * Hanya untuk produk dengan SKU; produk tanpa SKU tetap memakai ID acak.
 */
export function deterministicProductId(branchId: string, sku: string): string {
	const normalized = `${(branchId || '').trim().toLowerCase()}|${(sku || '').trim().toLowerCase()}`;
	const h1 = fnv1a(normalized, 0x811c9dc5);
	const h2 = fnv1a(normalized, 0x1b873593);
	return `prod-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
