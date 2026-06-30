<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Printer from '@lucide/svelte/icons/printer';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import type { Evacuee, Medical, Screening } from '$lib/features/people';

	interface StatusInfo {
		label: string;
		colorClass: string;
		dotClass: string;
	}

	let {
		evacuee,
		medical,
		screening,
		statusInfo,
		readonly,
		onOpenZoneModal,
		onOpenStatusModal,
		onOpenQrModal
	}: {
		evacuee: Evacuee;
		medical: Medical | null;
		screening: Screening | null;
		statusInfo: StatusInfo | null;
		readonly: boolean;
		onOpenZoneModal: () => void;
		onOpenStatusModal: () => void;
		onOpenQrModal: () => void;
	} = $props();
</script>

<div
	class="flex flex-col items-start justify-between gap-6 rounded-3xl border border-border bg-card p-6 shadow-sm md:flex-row md:items-center"
>
	<div class="flex flex-wrap items-center gap-4">
		<div
			class="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-[10px] font-semibold text-slate-400 shadow-inner select-none dark:border-slate-700 dark:bg-slate-800"
		>
			<span>No Photo</span>
		</div>

		<div class="space-y-1">
			<h2 class="text-2xl font-bold text-slate-900 dark:text-slate-50">
				{evacuee.first_name}
				{evacuee.last_name}
			</h2>
			<p
				class="inline-block rounded-md bg-muted px-2 py-0.5 font-mono text-xs tracking-wider text-muted-foreground"
			>
				NATIONAL ID: {evacuee.person_id?.number || '—'}
			</p>

			<div class="mt-2 flex flex-wrap items-center gap-2">
				{#if (medical && (medical.conditions.length > 0 || medical.notes)) || (screening && screening.symptoms.length > 0) || medical?.track === 'fast_track'}
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-red-100 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:border-red-900/30 dark:bg-red-950/40 dark:text-red-400"
					>
						<span class="size-1.5 rounded-full bg-red-500"></span>
						มีอาการป่วย/เฝ้าระวัง
					</span>
				{/if}
				{#if evacuee.special_needs && evacuee.special_needs.length > 0}
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:border-amber-900/30 dark:bg-amber-950/40 dark:text-amber-400"
					>
						<span class="size-1.5 rounded-full bg-amber-500"></span>
						กลุ่มเปราะบาง
					</span>
				{/if}
			</div>
		</div>
	</div>

	<div
		class="flex w-full flex-wrap items-center gap-3 border-t border-border pt-4 md:w-auto md:shrink-0 md:border-none md:pt-0"
	>
		{#if !readonly}
			<button
				class="inline-flex cursor-pointer items-center justify-center rounded-xl border border-amber-400 bg-transparent px-4 py-2 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
				onclick={onOpenZoneModal}
			>
				ย้ายโซน (Change Zone)
			</button>

			<button
				class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm transition-all hover:brightness-95 {statusInfo?.colorClass}"
				onclick={onOpenStatusModal}
			>
				<span class="size-1.5 rounded-full {statusInfo?.dotClass}"></span>
				<span>{statusInfo?.label}</span>
				<Pencil class="ml-0.5 size-3.5 opacity-60" />
			</button>

			<button
				class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-muted dark:text-slate-200"
				onclick={onOpenQrModal}
			>
				<Printer class="size-4 opacity-75" />
				<span>พิมพ์ QR</span>
			</button>
		{:else}
			<span
				class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold {statusInfo?.colorClass}"
			>
				<span class="size-1.5 rounded-full {statusInfo?.dotClass}"></span>
				<span>{statusInfo?.label}</span>
			</span>

			<button
				class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-muted dark:text-slate-200"
				onclick={() =>
					goto(resolve(`/back-office/evacuee-management/edit/-evacuee/${evacuee._id}`))}
			>
				<ExternalLink class="size-4 opacity-75" />
				<span>ดูข้อมูลเต็ม / แก้ไข</span>
			</button>
		{/if}
	</div>
</div>
