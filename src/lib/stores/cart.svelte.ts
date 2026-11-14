import type { CartItem, Product } from '../types/index.js';

class CartStore {
	items = $state<CartItem[]>([]);
	discount = $state<number>(0);
	private branchId = '';

	// Muat keranjang tersimpan untuk konteks cabang aktif, sehingga pesanan
	// tetap ada saat kasir berpindah menu atau memuat ulang halaman.
	init(branchId: string) {
		if (this.branchId === branchId) return;
		this.branchId = branchId;
		this.discount = 0;
		if (typeof window === 'undefined') {
			this.items = [];
			return;
		}
		try {
			const raw = localStorage.getItem('kasir_cart_' + branchId);
			this.items = raw ? (JSON.parse(raw) as CartItem[]) : [];
		} catch {
			this.items = [];
		}
	}

	private save() {
		if (typeof window === 'undefined' || !this.branchId) return;
		try {
			localStorage.setItem('kasir_cart_' + this.branchId, JSON.stringify(this.items));
		} catch {
			// penyimpanan penuh / tidak tersedia: keranjang tetap berjalan di memori
		}
	}

	add(product: Product) {
		if (product.stock <= 0) return;

		const existing = this.items.find(item => item.product.id === product.id);
		if (existing) {
			if (existing.quantity >= product.stock) {
				alert(`Stok produk "${product.name}" hanya tersisa ${product.stock}`);
				return;
			}
			existing.quantity += 1;
			existing.subtotal = existing.quantity * product.price;
			this.items = [...this.items];
		} else {
			this.items = [
				...this.items,
				{
					product,
					quantity: 1,
					subtotal: product.price
				}
			];
		}
		this.save();
	}

	updateQuantity(productId: string, delta: number) {
		const idx = this.items.findIndex(item => item.product.id === productId);
		if (idx === -1) return;

		const item = this.items[idx];
		const newQty = item.quantity + delta;

		if (newQty <= 0) {
			this.removeItem(productId);
		} else if (newQty > item.product.stock) {
			alert(`Stok tidak mencukupi (sisa ${item.product.stock})`);
		} else {
			item.quantity = newQty;
			item.subtotal = newQty * item.product.price;
			this.items = [...this.items];
			this.save();
		}
	}

	removeItem(productId: string) {
		this.items = this.items.filter(item => item.product.id !== productId);
		this.save();
	}

	clear() {
		this.items = [];
		this.discount = 0;
		this.save();
	}

	// Hapus keranjang beserta penyimpanannya (dipakai saat keluar dari sesi)
	reset() {
		if (typeof window !== 'undefined' && this.branchId) {
			try {
				localStorage.removeItem('kasir_cart_' + this.branchId);
			} catch {
				// abaikan
			}
		}
		this.items = [];
		this.discount = 0;
	}
}

export const cartStore = new CartStore();
