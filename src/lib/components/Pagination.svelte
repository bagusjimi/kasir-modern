<script lang="ts">
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';

	let {
		page = $bindable(1),
		perPage = $bindable(25),
		totalItems,
		label = 'data'
	}: {
		page?: number;
		perPage?: number;
		totalItems: number;
		label?: string;
	} = $props();

	let totalPages = $derived(Math.max(1, Math.ceil(totalItems / perPage)));

	// Kembali ke halaman 1 jika halaman aktif melebihi total (misal setelah data tersaring)
	$effect(() => {
		if (page > totalPages) page = 1;
	});

	let rangeStart = $derived(totalItems === 0 ? 0 : (page - 1) * perPage + 1);
	let rangeEnd = $derived(Math.min(page * perPage, totalItems));
</script>

{#if totalItems > 0}
	<div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 bg-gray-50/60">
		<p class="text-[11px] text-gray-500">
			Menampilkan
			<span class="font-bold text-gray-700">{rangeStart}&ndash;{rangeEnd}</span>
			dari
			<span class="font-bold text-gray-700">{totalItems}</span>
			{label}
		</p>
		<div class="flex items-center gap-2">
			<select
				bind:value={perPage}
				class="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
			>
				{#each [10, 25, 50, 100] as opt (opt)}
					<option value={opt}>{opt} / halaman</option>
				{/each}
			</select>
			<button
				onclick={() => page = Math.max(1, page - 1)}
				disabled={page <= 1}
				class="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
				aria-label="Halaman sebelumnya"
			>
				<ChevronLeft class="h-3.5 w-3.5" />
			</button>
			<span class="text-[11px] font-semibold text-gray-600 whitespace-nowrap">Halaman {page} dari {totalPages}</span>
			<button
				onclick={() => page = Math.min(totalPages, page + 1)}
				disabled={page >= totalPages}
				class="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
				aria-label="Halaman berikutnya"
			>
				<ChevronRight class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>
{/if}
