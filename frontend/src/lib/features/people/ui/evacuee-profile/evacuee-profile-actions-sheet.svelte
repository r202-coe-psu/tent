<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Printer from '@lucide/svelte/icons/printer';
	import * as Sheet from '$lib/components/ui/sheet';
	import {
		formatPersonName,
		zoneLabel,
		type Evacuee,
		type Medical,
		type Screening
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import EvacueePhoto from '../shared/evacuee-photo.svelte';

	interface StatusInfo {
		label: string;
		shortLabel: string;
		colorClass: string;
		dotClass: string;
	}

	let {
		open = $bindable(false),
		evacuee,
		medical,
		screening,
		statusInfo,
		readonly,
		onOpenZoneModal,
		onOpenStatusModal,
		onOpenQrModal
	}: {
		open: boolean;
		evacuee: Evacuee;
		medical: Medical | null;
		screening: Screening | null;
		statusInfo: StatusInfo | null;
		readonly: boolean;
		onOpenZoneModal: () => void;
		onOpenStatusModal: () => void;
		onOpenQrModal: () => void;
	} = $props();

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);

	const displayName = $derived(formatPersonName(evacuee));
	const hasIllnessAlert = $derived(
		(medical !== null && (medical.conditions.length > 0 || !!medical.notes)) ||
			(screening !== null && screening.symptoms.length > 0) ||
			medical?.track === 'fast_track'
	);
	const specialNeeds = $derived(evacuee.special_needs ?? []);

	function runAction(action: () => void) {
		open = false;
		action();
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="bottom"
		class="flex max-h-[85dvh] flex-col gap-0 overflow-y-auto rounded-t-2xl p-0"
	>
		<Sheet.Header class="border-b border-slate-200/80 px-4 py-3 text-left">
			<Sheet.Title class="text-base font-bold text-slate-900">การดำเนินการ</Sheet.Title>
			<Sheet.Description class="sr-only">
				เมนูด่วนสำหรับโปรไฟล์ผู้พักพิง {displayName}
			</Sheet.Description>
		</Sheet.Header>

		<div class="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
			<!-- Column 1: identity summary -->
			<section class="min-w-0 space-y-2.5">
				<div class="flex min-w-0 items-start gap-3">
					<EvacueePhoto photoId={evacuee.photo} alt={displayName} size="md" />
					<div class="min-w-0 flex-1 space-y-1.5">
						<!-- Row 1: name · status · zone -->
						<div class="flex min-w-0 flex-wrap items-center gap-1.5">
							<p class="text-base font-bold break-words text-slate-900">{displayName}</p>
							{#if statusInfo}
								<span
									class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold {statusInfo.colorClass}"
								>
									<span class="size-1.5 rounded-full {statusInfo.dotClass}"></span>
									{statusInfo.shortLabel}
								</span>
							{/if}
							<span
								class="inline-flex items-center gap-1 rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700"
							>
								<MapPin class="size-3 shrink-0 text-[#0A2647]" />
								โซน {zoneLabel(evacuee.current_stay.zone, shelterZones)}
							</span>
						</div>

						<!-- Row 2: health alert + special needs (vulnerable groups live on health card) -->
						{#if hasIllnessAlert || specialNeeds.length > 0}
							<div class="flex flex-wrap items-center gap-1.5">
								{#if hasIllnessAlert}
									<span
										class="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"
									>
										เฝ้าระวังสุขภาพ
									</span>
								{/if}
								{#each specialNeeds as need (need)}
									<span
										class="inline-flex max-w-full items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-900"
									>
										{need}
									</span>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</section>

			<!-- Column 2: actions -->
			<section class="min-w-0 space-y-2 sm:border-l sm:border-slate-200/80 sm:pl-4">
				{#if !readonly}
					<p class="text-xs font-bold tracking-wide text-slate-500 uppercase">ปฏิบัติการ</p>
					<button
						type="button"
						onclick={() => runAction(onOpenZoneModal)}
						class="inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-xl border border-amber-400 bg-transparent px-3 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						ย้ายโซน
					</button>
					<button
						type="button"
						onclick={() => runAction(onOpenStatusModal)}
						class="inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {statusInfo?.colorClass}"
					>
						<span class="size-1.5 rounded-full {statusInfo?.dotClass}"></span>
						เปลี่ยนสถานะ
					</button>
					<button
						type="button"
						onclick={() => runAction(onOpenQrModal)}
						class="inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						<Printer class="size-4 opacity-75" />
						พิมพ์ QR
					</button>
				{:else}
					<button
						type="button"
						onclick={() =>
							runAction(() =>
								goto(resolve(`/back-office/evacuee-management/edit/evacuee/${evacuee._id}`))
							)}
						class="inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						<ExternalLink class="size-4 opacity-75" />
						ดูข้อมูลเต็ม
					</button>
				{/if}
			</section>
		</div>
	</Sheet.Content>
</Sheet.Root>
