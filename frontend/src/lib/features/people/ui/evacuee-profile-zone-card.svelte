<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { Evacuee } from '$lib/features/people';
	import { zoneLabel } from '$lib/features/people';

	let {
		evacuee,
		shelterName,
		readonly,
		onOpenEdit
	}: {
		evacuee: Evacuee;
		shelterName: string;
		readonly: boolean;
		onOpenEdit: () => void;
	} = $props();
</script>

<section class="space-y-4 rounded-lg border border-border bg-card p-5">
	<div class="flex items-center justify-between border-b border-border pb-2">
		<div class="flex items-center gap-2.5">
			<MapPin class="size-4.5 text-primary" />
			<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">พิกัดโซนและศูนย์พักพิง</h3>
		</div>
		{#if !readonly}
			<button
				type="button"
				aria-label="แก้ไขโซนพักอาศัย"
				title="แก้ไขโซนพักอาศัย"
				onclick={onOpenEdit}
				class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<Pencil class="size-4" />
			</button>
		{/if}
	</div>
	<div class="space-y-3.5">
		<div>
			<span class="block text-xs font-medium text-muted-foreground">ศูนย์อพยพ:</span>
			<span class="mt-0.5 block text-sm font-bold text-slate-800 dark:text-slate-200">
				{shelterName}
			</span>
		</div>
		<div class="grid grid-cols-2 gap-4">
			<div>
				<span class="block text-xs font-medium text-muted-foreground">โซนพักอาศัย:</span>
				<span
					class="mt-1 inline-block rounded-lg border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 dark:border-blue-900/30 dark:bg-blue-950/40 dark:text-blue-400"
				>
					Zone: {zoneLabel(evacuee.current_stay.zone)}
				</span>
			</div>
			<div>
				<span class="block text-xs font-medium text-muted-foreground">หมายเลขเตียง/จุดพัก:</span>
				<span class="mt-1 block text-sm font-semibold text-slate-800 dark:text-slate-200">-</span>
			</div>
		</div>
	</div>
</section>
