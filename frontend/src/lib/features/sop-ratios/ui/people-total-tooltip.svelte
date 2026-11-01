<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	let {
		total,
		evacuees,
		staff,
		volunteers
	}: { total: number; evacuees: number; staff: number; volunteers: number } = $props();

	let open = $state(false);

	const rows = $derived([
		{ label: 'ผู้ประสบภัย', count: evacuees },
		{ label: 'เจ้าหน้าที่', count: staff },
		{ label: 'จิตอาสา', count: volunteers }
	]);
</script>

<Tooltip.Provider delayDuration={150}>
	<Tooltip.Root bind:open disableCloseOnTriggerClick>
		<Tooltip.Trigger
			class="-my-3.5 inline-flex cursor-help items-center gap-1 rounded-sm py-3.5 font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			onclick={() => (open = !open)}
		>
			<span class="underline decoration-dotted underline-offset-2">
				ทั้งหมด <span class="tabular-nums">{total}</span> คน
			</span>
			<Info class="size-3 text-muted-foreground" aria-hidden="true" />
		</Tooltip.Trigger>
		<Tooltip.Content>
			<dl class="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
				{#each rows as row (row.label)}
					<dt>{row.label}</dt>
					<dd class="text-right tabular-nums">{row.count} คน</dd>
				{/each}
			</dl>
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
