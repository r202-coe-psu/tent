<script lang="ts">
	import { SOP_RATIO_KEYS, RATIO_LABELS, type SopMaster } from '../index.js';

	let {
		profile,
		search = ''
	}: {
		profile: SopMaster | null;
		search?: string;
	} = $props();

	const filteredKeys = $derived(
		search.trim()
			? SOP_RATIO_KEYS.filter((key) => {
					const label = RATIO_LABELS[key]?.label ?? key;
					return label.toLowerCase().includes(search.trim().toLowerCase());
				})
			: SOP_RATIO_KEYS
	);
</script>

<div class="overflow-hidden rounded-lg border">
	<table class="w-full text-sm">
		<thead class="bg-muted/50 text-muted-foreground">
			<tr>
				<th class="px-4 py-3 text-left font-semibold">รายการ (Item)</th>
				<th class="px-4 py-3 text-center font-semibold">ค่ากำหนด (Value)</th>
			</tr>
		</thead>
		<tbody>
			{#each filteredKeys as key (key)}
				{@const meta = RATIO_LABELS[key]}
				{@const value = profile?.ratios[key] ?? '-'}
				<tr class="border-t hover:bg-muted/30">
					<td class="px-4 py-3">
						<div class="font-medium text-foreground">{meta?.label ?? key}</div>
						{#if meta?.description}
							<div class="mt-0.5 text-xs text-muted-foreground">{meta.description}</div>
						{/if}
					</td>
					<td class="px-4 py-3 text-center">
						<span
							class="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
						>
							{value}
							{meta?.unit ?? ''}
						</span>
					</td>
				</tr>
			{:else}
				<tr>
					<td colspan="2" class="px-4 py-8 text-center text-muted-foreground">
						ไม่พบรายการที่ต้องการค้นหา
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
