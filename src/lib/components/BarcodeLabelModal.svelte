<script lang="ts">
	import { Printer, X, Tags } from 'lucide-svelte';
	import { code128Svg } from '../utils/barcode.js';
	import type { Product } from '../types/index.js';

	interface Props {
		open: boolean;
		products: Product[];
		onClose: () => void;
	}

	let { open, products, onClose }: Props = $props();

	type LabelSize = 'small' | 'medium' | 'large';

	const SIZE_PRESETS: Record<LabelSize, { label: string; w: number; h: number; barcodeH: number; nameFont: number; priceFont: number }> = {
		small: { label: 'Kecil (40\u00d725 mm)', w: 40, h: 25, barcodeH: 7, nameFont: 7, priceFont: 8 },
		medium: { label: 'Sedang (50\u00d730 mm)', w: 50, h: 30, barcodeH: 9, nameFont: 8, priceFont: 9 },
		large: { label: 'Besar (60\u00d740 mm)', w: 60, h: 40, barcodeH: 12, nameFont: 9, priceFont: 11 }
	};

	let labelSize = $state<LabelSize>('medium');
	let qtyMap = $state<Record<string, number>>({});

	const size = $derived(SIZE_PRESETS[labelSize]);

	interface LabelItem {
		key: string;
		product: Product;
	}

	const labelItems = $derived.by<LabelItem[]>(() => {
		const items: LabelItem[] = [];
		for (const prod of products) {
			const qty = Math.max(0, Math.min(999, Math.floor(qtyMap[prod.id] ?? 1)));
			for (let i = 0; i < qty; i++) {
				items.push({ key: `${prod.id}#${i}`, product: prod });
			}
		}
		return items;
	});

	$effect(() => {
		if (open) {
			qtyMap = {};
			labelSize = 'medium';
		}
	});

	function barcodeFor(prod: Product): string {
		return prod.barcode?.trim() || prod.sku.trim();
	}

	function barcodeSvgFor(prod: Product): string {
		const code = barcodeFor(prod);
		const innerWidth = size.w - 6;
		const totalModules = 11 * (code.length + 2) + 13;
		const moduleMm = Math.max(0.19, Math.min(0.4, innerWidth / totalModules));
		return code128Svg(code, { heightMm: size.barcodeH, moduleMm, showText: false });
	}

	function setQty(prod: Product, value: number) {
		qtyMap = { ...qtyMap, [prod.id]: Math.max(0, Math.min(999, Math.floor(value) || 0)) };
	}

	function setAllQty(value: number) {
		const next: Record<string, number> = {};
		for (const prod of products) next[prod.id] = Math.max(0, Math.min(999, Math.floor(value) || 0));
		qtyMap = next;
	}

	function formatRupiah(num: number): string {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0
		}).format(num);
	}

	function handlePrint() {
		window.print();
	}
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
			<div class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-4">
				<div class="flex items-center gap-2 text-emerald-600 font-semibold">
					<Tags class="h-5 w-5" />
					<span>Cetak Label Barcode</span>
				</div>
				<button
					onclick={onClose}
					class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition"
					aria-label="Tutup"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="overflow-y-auto p-6 space-y-5">
				{#if products.length === 0}
					<p class="text-sm text-gray-500 text-center py-8">Tidak ada produk yang dipilih. Pilih produk di tabel terlebih dahulu.</p>
				{:else}
					<div class="flex flex-col sm:flex-row sm:items-end gap-4">
						<div>
							<label for="labelSize" class="block text-xs font-semibold text-gray-700 mb-1">Ukuran Label</label>
							<select
								id="labelSize"
								bind:value={labelSize}
								class="px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-hidden focus:border-emerald-500"
							>
								{#each Object.entries(SIZE_PRESETS) as [key, preset]}
									<option value={key}>{preset.label}</option>
								{/each}
							</select>
						</div>
						<div class="flex items-end gap-2">
							<div>
								<label for="allQty" class="block text-xs font-semibold text-gray-700 mb-1">Jumlah Semua</label>
								<input
									id="allQty"
									type="number"
									min="0"
									max="999"
									value="1"
									onchange={(e) => setAllQty(Number((e.target as HTMLInputElement).value))}
									class="w-20 px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-hidden focus:border-emerald-500"
								/>
							</div>
							<span class="text-[11px] text-gray-400 pb-2.5">set rata untuk semua produk</span>
						</div>
						<div class="sm:ml-auto text-right">
							<p class="text-xs text-gray-500">Total label</p>
							<p class="text-xl font-black text-emerald-600">{labelItems.length}</p>
						</div>
					</div>

					<div class="rounded-xl border border-gray-200 divide-y divide-gray-100">
						{#each products as prod (prod.id)}
							<div class="flex items-center gap-3 px-4 py-2.5">
								<div class="min-w-0 flex-1">
									<p class="text-sm font-semibold text-gray-900 truncate">{prod.name}</p>
									<p class="text-[11px] text-gray-400 font-mono truncate">{barcodeFor(prod)}</p>
								</div>
								<div class="flex items-center gap-1.5">
									<label for="qty-{prod.id}" class="text-[11px] text-gray-500">Jumlah</label>
									<input
										id="qty-{prod.id}"
										type="number"
										min="0"
										max="999"
										value={qtyMap[prod.id] ?? 1}
										onchange={(e) => setQty(prod, Number((e.target as HTMLInputElement).value))}
										class="w-16 px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-hidden focus:border-emerald-500"
									/>
								</div>
							</div>
						{/each}
					</div>

					<div>
						<p class="text-xs font-semibold text-gray-700 mb-2">Pratinjau Lembar Cetak (A4)</p>
						<div class="rounded-xl border border-gray-200 bg-gray-50 p-4 overflow-x-auto">
							<div id="barcode-labels">
								{#each labelItems as item (item.key)}
									<div
										class="barcode-label"
										style="width: {size.w}mm; height: {size.h}mm; padding: 2mm; border: 0.3mm dashed #bbb; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1mm; overflow: hidden; background: #fff;"
									>
										<p
											class="label-name"
											style="font-size: {size.nameFont}px; font-weight: 700; line-height: 1.15; text-align: center; max-width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;"
										>
											{item.product.name}
										</p>
										<p class="label-price" style="font-size: {size.priceFont}px; font-weight: 800;">{formatRupiah(item.product.price)}</p>
										<div class="label-barcode" style="width: 100%; display: flex; justify-content: center;">
											<!-- eslint-disable-next-line svelte/no-at-html-tags -->
											{@html barcodeSvgFor(item.product)}
										</div>
										<p class="label-code" style="font-size: 7px; font-family: monospace; color: #000;">{barcodeFor(item.product)}</p>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}
			</div>

			<div class="flex items-center justify-end gap-3 border-t border-gray-100 bg-white p-4">
				<button
					onclick={onClose}
					class="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium transition"
				>
					Tutup
				</button>
				<button
					onclick={handlePrint}
					disabled={labelItems.length === 0}
					class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-md shadow-emerald-600/20 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
				>
					<Printer class="h-4 w-4" />
					<span>Cetak {labelItems.length} Label</span>
				</button>
			</div>
		</div>
	</div>
{/if}
