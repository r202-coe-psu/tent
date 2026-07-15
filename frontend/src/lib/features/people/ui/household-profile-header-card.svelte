<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { Household, HouseholdStatus } from '../domain/people';

	let {
		household,
		statusConfig,
		onOpenStatusModal,
		onOpenZoneModal
	}: {
		household: Household;
		statusConfig: Record<HouseholdStatus, { label: string; colorClass: string; dotClass: string }>;
		onOpenStatusModal: () => void;
		onOpenZoneModal: () => void;
	} = $props();
</script>

<div
	class="flex flex-col gap-6 rounded-3xl border border-border bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between"
>
	<div class="space-y-2">
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-50">
				{household.label}
			</h2>
		</div>
		<p class="font-mono text-xs text-muted-foreground">ID: {household._id}</p>
		{#if household.notes}
			<p class="text-sm text-slate-600 dark:text-slate-400">
				<span class="font-bold">หมายเหตุ:</span>
				{household.notes}
			</p>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<button
			class="inline-flex cursor-pointer items-center justify-center rounded-xl border border-amber-400 bg-transparent px-4 py-2 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
			onclick={onOpenZoneModal}
		>
			ย้ายโซน (Change Zone)
		</button>

		{#if statusConfig[household.status]}
			{@const config = statusConfig[household.status]}
			<button
				class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm transition-all hover:brightness-95 {config.colorClass}"
				onclick={onOpenStatusModal}
			>
				<span class="size-1.5 rounded-full {config.dotClass}"></span>
				<span>{config.label}</span>
				<Pencil class="ml-0.5 size-3.5 opacity-60" />
			</button>
		{/if}
	</div>
</div>
