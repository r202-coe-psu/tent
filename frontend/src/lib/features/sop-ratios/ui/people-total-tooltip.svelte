<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	let {
		total,
		evacuees,
		staff,
		volunteers,
		failed = false
	}: {
		total: number;
		evacuees: number;
		staff: number;
		volunteers: number;
		failed?: boolean;
	} = $props();

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

	type PeopleRow = { label: string; count: number | null };

	const rows: PeopleRow[] = $derived([
		{ label: 'ผู้ประสบภัย', count: evacuees },
		{ label: 'เจ้าหน้าที่', count: failed ? null : staff },
		{ label: 'จิตอาสา', count: failed ? null : volunteers }
	]);
</script>

<Tooltip.Provider delayDuration={150}>
	<Tooltip.Root bind:open disableCloseOnTriggerClick>
		<Tooltip.Trigger
			class="-my-3.5 inline-flex cursor-help items-center gap-1 rounded-sm py-3.5 font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			onpointerdown={rememberOpen}
			{onkeydown}
			onclick={toggle}
		>
			<span class="underline decoration-dotted underline-offset-2">
				ทั้งหมด <span class="tabular-nums">{total}</span> คน
			</span>
			{#if failed}
				<AlertTriangle class="size-3 text-destructive" aria-hidden="true" />
			{:else}
				<Info class="size-3 text-muted-foreground" aria-hidden="true" />
			{/if}
		</Tooltip.Trigger>
		<Tooltip.Content>
			<dl class="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
				{#each rows as row (row.label)}
					<dt>{row.label}</dt>
					<dd class="text-right tabular-nums">{row.count === null ? '—' : `${row.count} คน`}</dd>
				{/each}
			</dl>
			{#if failed}
				<p class="mt-1.5 max-w-[15rem] border-t border-primary-foreground/25 pt-1.5">
					โหลดจำนวนเจ้าหน้าที่และจิตอาสาไม่สำเร็จ ยอดนี้จึงนับเฉพาะผู้ประสบภัย
					และต่ำกว่าความเป็นจริง
				</p>
			{/if}
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
