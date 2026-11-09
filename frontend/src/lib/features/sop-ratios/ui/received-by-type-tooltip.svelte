<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { formatQty } from '$lib/utils/qty';
	import type { ReceivedBreakdown } from '../domain/one-time-demand';

	let { received, breakdown }: { received: number; breakdown: ReceivedBreakdown } = $props();

	// Same open-on-hover / toggle-on-tap handling as `PeopleTotalTooltip`, so it also works on touch.
	let open = $state(false);
	let openBeforeGesture = false;

	function rememberOpen() {
		openBeforeGesture = open;
	}

	function toggle() {
		open = !openBeforeGesture;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') rememberOpen();
	}

	const rows = $derived([
		{ label: 'ผู้พักพิง', count: breakdown.evacuees },
		{ label: 'เจ้าหน้าที่', count: breakdown.staff },
		{ label: 'จิตอาสา', count: breakdown.volunteers }
	]);
</script>

{#if received === 0}
	<span class="tabular-nums">{formatQty(received)} <span class="text-slate-500">คน</span></span>
{:else}
	<Tooltip.Provider delayDuration={150}>
		<Tooltip.Root bind:open disableCloseOnTriggerClick>
			<Tooltip.Trigger
				class="inline-flex cursor-help items-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				aria-label="รับแล้ว {received} คน ดูแยกตามประเภท"
				onpointerdown={rememberOpen}
				{onkeydown}
				onclick={toggle}
			>
				<span class="underline decoration-dotted underline-offset-2">
					<span class="tabular-nums">{formatQty(received)}</span>
					<span class="text-slate-500">คน</span>
				</span>
			</Tooltip.Trigger>
			<Tooltip.Content>
				<dl class="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
					{#each rows as row (row.label)}
						<dt>{row.label}</dt>
						<dd class="text-right tabular-nums">{formatQty(row.count)} คน</dd>
					{/each}
				</dl>
			</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
{/if}
