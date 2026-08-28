<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Printer from '@lucide/svelte/icons/printer';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { maskNationalId } from '$lib/features/people';
	import type { Evacuee, Medical, Screening } from '$lib/features/people';
	import { imageRepository } from '$lib/features/images';

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
		onOpenQrModal,
		onOpenProfileEdit
	}: {
		evacuee: Evacuee;
		medical: Medical | null;
		screening: Screening | null;
		statusInfo: StatusInfo | null;
		readonly: boolean;
		onOpenZoneModal: () => void;
		onOpenStatusModal: () => void;
		onOpenQrModal: () => void;
		onOpenProfileEdit: () => void;
	} = $props();

	let photoUrl = $state<string | null>(null);

	// Load the thumbnail as an object URL whenever the evacuee's photo ref changes;
	// revoke it on change/unmount so blob URLs don't leak.
	$effect(() => {
		const photoId = evacuee.photo;
		let cancelled = false;
		let objectUrl: string | null = null;

		if (photoId) {
			imageRepository()
				.getThumbnailUrl(photoId)
				.then((url) => {
					if (cancelled) {
						if (url) URL.revokeObjectURL(url);
						return;
					}
					objectUrl = url;
					photoUrl = url;
				});
		} else {
			photoUrl = null;
		}

		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});
</script>

<header
	class="flex flex-col items-start justify-between gap-5 rounded-lg border border-border bg-card p-5 md:flex-row md:items-center"
>
	<div class="flex flex-wrap items-center gap-4">
		{#if photoUrl}
			<img
				src={photoUrl}
				alt={`${evacuee.first_name} ${evacuee.last_name}`}
				class="h-20 w-20 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
			/>
		{:else}
			<div
				class="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-2xs font-semibold text-slate-400 select-none dark:border-slate-700 dark:bg-slate-800"
			>
				<span>No Photo</span>
			</div>
		{/if}

		<div class="space-y-1">
			<h2 class="text-2xl font-bold text-slate-900 dark:text-slate-50">
				{evacuee.first_name}
				{evacuee.last_name}
				{#if evacuee.nickname}
					<span class="text-base font-semibold text-muted-foreground">({evacuee.nickname})</span>
				{/if}
			</h2>
			<p
				class="inline-block rounded-md bg-muted px-2 py-0.5 font-mono text-xs tracking-wider text-muted-foreground"
			>
				{#if evacuee.person_id?.cardType === 'passport'}
					PASSPORT:
				{:else if evacuee.person_id?.cardType === 'pink_card'}
					PINK CARD:
				{:else if evacuee.person_id?.cardType === 'other'}
					ID CARD:
				{:else}
					NATIONAL ID:
				{/if}
				{maskNationalId(evacuee.person_id?.number)}
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
				class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
				onclick={onOpenProfileEdit}
			>
				<Pencil class="size-4" />
				<span>ข้อมูลส่วนบุคคล</span>
			</button>
			<button
				class="inline-flex cursor-pointer items-center justify-center rounded-md border border-amber-400 bg-transparent px-4 py-2 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
				onclick={onOpenZoneModal}
			>
				ย้ายโซน (Change Zone)
			</button>

			<button
				class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold transition-colors hover:brightness-95 {statusInfo?.colorClass}"
				onclick={onOpenStatusModal}
			>
				<span class="size-1.5 rounded-full {statusInfo?.dotClass}"></span>
				<span>{statusInfo?.label}</span>
				<Pencil class="ml-0.5 size-3.5 opacity-60" />
			</button>

			<button
				class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-muted dark:text-slate-200"
				onclick={onOpenQrModal}
			>
				<Printer class="size-4 opacity-75" />
				<span>พิมพ์ QR</span>
			</button>
		{:else}
			<span
				class="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold {statusInfo?.colorClass}"
			>
				<span class="size-1.5 rounded-full {statusInfo?.dotClass}"></span>
				<span>{statusInfo?.label}</span>
			</span>

			<button
				class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-muted dark:text-slate-200"
				onclick={() =>
					goto(resolve(`/back-office/evacuee-management/edit/-evacuee/${evacuee._id}`))}
			>
				<ExternalLink class="size-4 opacity-75" />
				<span>ดูข้อมูลเต็ม / แก้ไข</span>
			</button>
		{/if}
	</div>
</header>
