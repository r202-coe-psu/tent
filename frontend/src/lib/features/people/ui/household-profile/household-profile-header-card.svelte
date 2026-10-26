<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import type { Household, HouseholdStatus } from '../../domain/people';
	import { MANUAL_HOUSEHOLD_STATUS_TRANSITIONS } from '../../domain/people';

	let {
		household,
		statusConfig,
		onOpenStatusModal,
		onOpenZoneModal,
		onOpenMergeModal,
		onCancelPreRegistration,
		isCancelling = false,
		canCancel = false
	}: {
		household: Household;
		statusConfig: Record<HouseholdStatus, { label: string; colorClass: string; dotClass: string }>;
		onOpenStatusModal: () => void;
		onOpenZoneModal: () => void;
		onOpenMergeModal?: () => void;
		onCancelPreRegistration: () => void;
		isCancelling?: boolean;
		canCancel?: boolean;
	} = $props();

	const allowedTransitions = $derived(
		household ? MANUAL_HOUSEHOLD_STATUS_TRANSITIONS[household.status] : []
	);
	const isStatusEditable = $derived(allowedTransitions.length > 0);
</script>

<!--
	Laid out by the card's own width (container query), not the viewport: in the back
	office the sidebar leaves the card far narrower than the screen, so viewport
	breakpoints put title and actions side by side long before there is room — buttons
	squeezed to three lines and the title pushed down the middle.
-->
<div class="@container rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
	<div class="flex flex-col gap-4 @4xl:flex-row @4xl:items-start @4xl:justify-between @4xl:gap-6">
		<div class="min-w-0 flex-1 space-y-2">
			<h2 class="text-2xl font-black tracking-tight break-words text-slate-900 dark:text-slate-50">
				{household.label}
			</h2>
			{#if household.linked_shelter_code || household.status === 'merged'}
				<div class="flex flex-wrap gap-2">
					{#if household.linked_shelter_code}
						<span
							class="inline-flex items-center rounded-lg border border-amber-400/60 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300"
						>
							ครอบครัวเชื่อมโยง: ศูนย์ {household.linked_shelter_code}
						</span>
					{/if}
					{#if household.status === 'merged'}
						<span
							class="inline-flex items-center rounded-lg border border-purple-300 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700 dark:border-purple-500/40 dark:bg-purple-950/40 dark:text-purple-300"
						>
							รวมเข้ากับครอบครัวอื่นแล้ว
						</span>
					{/if}
				</div>
			{/if}
			<p class="font-mono text-xs break-all text-muted-foreground">ID: {household._id}</p>
			{#if household.notes}
				<p class="text-sm text-slate-600 dark:text-slate-400">
					<span class="font-bold">หมายเหตุ:</span>
					{household.notes}
				</p>
			{/if}
		</div>

		<!-- Status first: it is what staff look for; the actions follow it. -->
		<div class="flex flex-wrap items-center gap-2 @4xl:max-w-[55%] @4xl:justify-end">
			{#if statusConfig[household.status]}
				{@const config = statusConfig[household.status]}
				{#if isStatusEditable}
					<button
						type="button"
						class="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold whitespace-nowrap shadow-sm transition-all hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {config.colorClass}"
						onclick={onOpenStatusModal}
					>
						<span class="size-1.5 shrink-0 rounded-full {config.dotClass}"></span>
						<span>{config.label}</span>
						<Pencil class="ml-0.5 size-3.5 shrink-0 opacity-60" />
					</button>
				{:else}
					<div
						class="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold whitespace-nowrap {config.colorClass}"
					>
						<span class="size-1.5 shrink-0 rounded-full {config.dotClass}"></span>
						<span>{config.label}</span>
					</div>
				{/if}
			{/if}

			{#if onOpenMergeModal && household.status !== 'merged' && household.status !== 'cancelled'}
				<button
					type="button"
					class="inline-flex min-h-11 grow cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-transparent px-4 py-2 text-sm font-semibold whitespace-nowrap text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @md:grow-0"
					onclick={onOpenMergeModal}
				>
					<GitMerge class="size-4 shrink-0" />
					<span>รวมครอบครัว</span>
				</button>
			{/if}

			<button
				type="button"
				class="inline-flex min-h-11 grow cursor-pointer items-center justify-center rounded-xl border border-amber-400 bg-transparent px-4 py-2 text-sm font-semibold whitespace-nowrap text-amber-700 transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @md:grow-0 dark:text-amber-400 dark:hover:bg-amber-950/30"
				onclick={onOpenZoneModal}
			>
				ย้ายโซน (Change Zone)
			</button>

			{#if canCancel && household.status === 'pre_registered'}
				<button
					type="button"
					class="inline-flex min-h-11 grow cursor-pointer items-center justify-center rounded-xl border border-destructive bg-transparent px-4 py-2 text-sm font-semibold whitespace-nowrap text-destructive transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 @md:grow-0"
					disabled={isCancelling}
					onclick={onCancelPreRegistration}
				>
					{isCancelling ? 'กำลังยกเลิก...' : 'ยกเลิกการลงทะเบียนล่วงหน้า'}
				</button>
			{/if}
		</div>
	</div>
</div>
