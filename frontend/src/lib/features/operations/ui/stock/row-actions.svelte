<script lang="ts">
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		itemName,
		onreceive,
		ondistribute,
		disabled = false,
		distributeDisabled = false,
		layout = 'stack'
	}: {
		itemName: string;
		onreceive: () => void;
		ondistribute: () => void;
		disabled?: boolean;
		distributeDisabled?: boolean;
		/** `stack` = one above the other (tablet, phone); `inline` = side by side (desktop). */
		layout?: 'stack' | 'inline';
	} = $props();

	const DISTRIBUTE_FORBIDDEN_HINT =
		'ต้องมีสิทธิ์เจ้าหน้าที่คลัง (warehouse_staff) จึงจะเบิกจ่ายได้';
</script>

<!-- stopPropagation: the table row is itself clickable (opens the item). -->
<div class="flex gap-1.5 {layout === 'stack' ? 'flex-col' : 'flex-col xl:flex-row'}">
	<Button
		type="button"
		{disabled}
		aria-label="รับเข้า {itemName}"
		class="min-h-11 gap-1.5 rounded-lg bg-[#0A2647] px-3 text-sm font-semibold text-white hover:bg-[#051930]"
		onclick={(e: MouseEvent) => {
			e.stopPropagation();
			onreceive();
		}}
	>
		<ArrowDownToLine class="h-4 w-4" aria-hidden="true" />
		รับเข้า
	</Button>
	<Button
		type="button"
		variant="outline"
		disabled={disabled || distributeDisabled}
		title={distributeDisabled ? DISTRIBUTE_FORBIDDEN_HINT : undefined}
		aria-label="เบิก {itemName}"
		class="min-h-11 gap-1.5 rounded-lg border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-2xs"
		onclick={(e: MouseEvent) => {
			e.stopPropagation();
			ondistribute();
		}}
	>
		<ArrowUpFromLine class="h-4 w-4" aria-hidden="true" />
		เบิก
	</Button>
</div>
