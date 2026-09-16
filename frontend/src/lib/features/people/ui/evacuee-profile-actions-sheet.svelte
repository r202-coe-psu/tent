<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Printer from '@lucide/svelte/icons/printer';
	import * as Sheet from '$lib/components/ui/sheet';
	import {
		formatPersonName,
		zoneLabel,
		type Evacuee,
		type Medical,
		type Screening
	} from '$lib/features/people';
	import { useMasterData } from '$lib/features/master-data';
	import EvacueePhoto from './evacuee-photo.svelte';

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
		onOpenQrModal,
		onOpenPersonalEdit,
		onOpenEmergencyEdit,
		onOpenHealthEdit,
		onOpenHouseholdEdit,
		onOpenAssetsEdit
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
		onOpenPersonalEdit: () => void;
		onOpenEmergencyEdit: () => void;
		onOpenHealthEdit: () => void;
		onOpenHouseholdEdit: () => void;
		onOpenAssetsEdit: () => void;
	} = $props();

	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	const displayName = $derived(formatPersonName(evacuee));
	const hasIllnessAlert = $derived(
		(medical !== null && (medical.conditions.length > 0 || !!medical.notes)) ||
			(screening !== null && screening.symptoms.length > 0) ||
			medical?.track === 'fast_track'
	);
	const vulnerableGroups = $derived(evacuee.vulnerable_groups ?? []);
	const specialNeeds = $derived(evacuee.special_needs ?? []);

	function vulnerableLabel(code: string): string {
		return vulnerableGroupQuery.data?.items.find((i) => i.code === code)?.label ?? code;
	}

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
								โซน {zoneLabel(evacuee.current_stay.zone)}
							</span>
						</div>

						<!-- Row 2: vulnerable + special needs tags -->
						<div class="flex flex-wrap items-center gap-1.5">
							{#if hasIllnessAlert}
								<span
									class="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"
								>
									เฝ้าระวังสุขภาพ
								</span>
							{/if}
							{#each vulnerableGroups as code (code)}
								<span
									class="inline-flex max-w-full items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800"
								>
									{vulnerableLabel(code)}
								</span>
							{/each}
							{#each specialNeeds as need (need)}
								<span
									class="inline-flex max-w-full items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-900"
								>
									{need}
								</span>
							{/each}
							{#if !hasIllnessAlert && vulnerableGroups.length === 0 && specialNeeds.length === 0}
								<span class="text-xs text-slate-400 italic">ไม่ระบุกลุ่มเปราะบาง / ความต้องการ</span
								>
							{/if}
						</div>
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

					<p class="pt-1 text-xs font-bold tracking-wide text-slate-500 uppercase">แก้ไข</p>
					<div
						class="divide-y divide-slate-200/80 overflow-hidden rounded-xl border border-slate-200/80 bg-white"
					>
						<button
							type="button"
							onclick={() => runAction(onOpenPersonalEdit)}
							class="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none focus-visible:ring-inset"
						>
							<Pencil class="size-3.5 text-slate-500" />
							บุคคล
						</button>
						<button
							type="button"
							onclick={() => runAction(onOpenEmergencyEdit)}
							class="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none focus-visible:ring-inset"
						>
							<Pencil class="size-3.5 text-slate-500" />
							ฉุกเฉิน
						</button>
						<button
							type="button"
							onclick={() => runAction(onOpenHealthEdit)}
							class="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none focus-visible:ring-inset"
						>
							<Pencil class="size-3.5 text-slate-500" />
							สุขภาพ
						</button>
						<button
							type="button"
							onclick={() => runAction(onOpenHouseholdEdit)}
							class="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none focus-visible:ring-inset"
						>
							<Pencil class="size-3.5 text-slate-500" />
							ครัวเรือน
						</button>
						<button
							type="button"
							onclick={() => runAction(onOpenAssetsEdit)}
							class="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none focus-visible:ring-inset"
						>
							<Pencil class="size-3.5 text-slate-500" />
							สินทรัพย์
						</button>
					</div>
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
