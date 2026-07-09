<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { SOP_RATIO_KEYS, RATIO_LABELS, type SopRatioKey, type SopMaster } from '../index.js';

	let {
		profile,
		isSA,
		disabled,
		onEditItem,
		search = ''
	}: {
		profile: SopMaster | null;
		isSA: boolean;
		disabled: boolean;
		onEditItem: (key: SopRatioKey) => void;
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
				<th class="px-4 py-3 text-right font-semibold">จัดการ (Action)</th>
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
					<td class="px-4 py-3">
						<div class="flex items-center justify-end gap-2">
							{#if isSA}
								<Button
									type="button"
									variant="outline"
									size="sm"
									class="border-blue-200 text-blue-700 hover:bg-blue-50"
									disabled={disabled || !profile}
									onclick={() => onEditItem(key)}
									aria-label="จัดการ {meta?.label ?? key}"
								>
									<svg
										class="mr-1 h-3.5 w-3.5"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
									</svg>
									จัดการ
								</Button>
							{:else}
								<span class="px-2 text-xs text-muted-foreground italic">อ่านอย่างเดียว</span>
							{/if}
						</div>
					</td>
				</tr>
			{:else}
				<tr>
					<td colspan="3" class="px-4 py-8 text-center text-muted-foreground">
						ไม่พบรายการที่ต้องการค้นหา
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
