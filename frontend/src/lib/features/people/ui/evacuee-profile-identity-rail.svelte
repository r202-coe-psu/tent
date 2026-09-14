<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Printer from '@lucide/svelte/icons/printer';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import {
		evacueeAgeYears,
		formatPersonName,
		maskNationalId,
		zoneLabel,
		type Evacuee,
		type Medical,
		type Screening
	} from '$lib/features/people';
	import { useMasterData } from '$lib/features/master-data';
	import { COUNTRIES } from '$lib/utils/country';
	import EvacueePhoto from './evacuee-photo.svelte';

	interface StatusInfo {
		label: string;
		shortLabel: string;
		colorClass: string;
		dotClass: string;
	}

	let {
		evacuee,
		medical,
		screening,
		shelterName,
		statusInfo,
		readonly,
		variant = 'rail',
		onOpenZoneModal,
		onOpenStatusModal,
		onOpenQrModal,
		onOpenPersonalEdit,
		onOpenEmergencyEdit,
		onOpenHealthEdit,
		onOpenHouseholdEdit,
		onOpenAssetsEdit,
		onOpenActions
	}: {
		evacuee: Evacuee;
		medical: Medical | null;
		screening: Screening | null;
		shelterName: string;
		statusInfo: StatusInfo | null;
		readonly: boolean;
		/** `rail` = sticky desktop sidebar; `compact` = non-sticky mobile page header */
		variant?: 'rail' | 'compact';
		onOpenZoneModal: () => void;
		onOpenStatusModal: () => void;
		onOpenQrModal: () => void;
		onOpenPersonalEdit: () => void;
		onOpenEmergencyEdit: () => void;
		onOpenHealthEdit?: () => void;
		onOpenHouseholdEdit?: () => void;
		onOpenAssetsEdit?: () => void;
		/** Compact mobile header: open actions sheet */
		onOpenActions?: () => void;
	} = $props();

	const isCompact = $derived(variant === 'compact');

	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	const ageYears = $derived(evacueeAgeYears(evacuee));
	const displayName = $derived(formatPersonName(evacuee));
	const countryName = $derived(
		COUNTRIES.find((c) => c.value === evacuee.country)?.label ?? evacuee.country
	);
	const genderLabel = $derived(
		evacuee.gender === 'male' ? 'ชาย' : evacuee.gender === 'female' ? 'หญิง' : 'อื่นๆ'
	);
	const hasIllnessAlert = $derived(
		(medical !== null && (medical.conditions.length > 0 || !!medical.notes)) ||
			(screening !== null && screening.symptoms.length > 0) ||
			medical?.track === 'fast_track'
	);
	const vulnerableGroups = $derived(evacuee.vulnerable_groups ?? []);
	const specialNeeds = $derived(evacuee.special_needs ?? []);
	const emergencyLine = $derived.by(() => {
		const contact = evacuee.emergency_contact;
		if (!contact) return 'ไม่ระบุ';
		const parts = [contact.name, contact.phone, contact.relation]
			.map((p) => (p ?? '').trim())
			.filter(Boolean);
		return parts.length > 0 ? parts.join(' · ') : 'ไม่ระบุ';
	});

	function vulnerableLabel(code: string): string {
		return vulnerableGroupQuery.data?.items.find((i) => i.code === code)?.label ?? code;
	}
</script>

<aside
	class="min-w-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs {isCompact
		? 'space-y-3'
		: 'space-y-3 lg:sticky lg:top-[var(--registration-sticky-top,6.75rem)] lg:z-10 lg:self-start'}"
>
	<!-- Identity row: photo + name / status / zone -->
	<div class="flex min-w-0 items-start gap-3">
		<EvacueePhoto photoId={evacuee.photo} alt={displayName} size={isCompact ? 'md' : 'lg'} />

		<div class="min-w-0 flex-1 space-y-1.5">
			<h2 class="text-base font-bold break-words text-slate-900 lg:text-lg">
				{displayName}
				{#if evacuee.nickname}
					<span class="text-sm font-medium text-slate-500">({evacuee.nickname})</span>
				{/if}
			</h2>
			<p class="font-mono text-xs tracking-wider break-all text-slate-500">
				{maskNationalId(evacuee.person_id?.number)}
			</p>

			<!-- Row: status · zone -->
			<div class="flex flex-wrap items-center gap-1.5">
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

			<!-- Tags: vulnerable + special needs -->
			<div class="flex flex-wrap items-center gap-1.5">
				{#if hasIllnessAlert}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"
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
					<span class="text-xs text-slate-400 italic">ไม่ระบุกลุ่มเปราะบาง</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Compact personal snapshot -->
	<div class="space-y-1 border-t border-slate-200/80 pt-3 text-sm text-slate-700">
		<p class="break-words">
			<span class="font-semibold text-slate-900">{genderLabel}</span>
			{#if ageYears !== null}
				<span aria-hidden="true"> · </span>
				<span class="tabular-nums">อายุ {ageYears} ปี</span>
			{/if}
			<span aria-hidden="true"> · </span>
			<span class="break-words">{countryName || 'ไม่ระบุสัญชาติ'}</span>
		</p>
		<p class="break-words">โทร: {evacuee.phone || 'ไม่มีเบอร์'}</p>
		<p class="truncate text-slate-600" title={shelterName}>{shelterName}</p>
		<div class="flex items-start gap-1.5 pt-0.5">
			<ShieldAlert class="mt-0.5 size-3.5 shrink-0 text-amber-700" />
			<p class="min-w-0 break-words text-slate-700">
				<span class="font-semibold text-amber-900">ฉุกเฉิน:</span>
				{emergencyLine}
			</p>
			{#if !readonly && !isCompact}
				<button
					type="button"
					aria-label="แก้ไขข้อมูลติดต่อฉุกเฉิน"
					title="แก้ไขข้อมูลติดต่อฉุกเฉิน"
					onclick={onOpenEmergencyEdit}
					class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-amber-50 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					<Pencil class="size-3.5" />
				</button>
			{/if}
		</div>
	</div>

	{#if !isCompact}
		<!-- Desktop: actions as dropdown — keeps sticky card short -->
		<div class="border-t border-slate-200/80 pt-3">
			{#if !readonly}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#0A2647] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						การดำเนินการ
						<ChevronDown class="size-4 opacity-80" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-56" align="end">
						<DropdownMenu.Group>
							<DropdownMenu.GroupHeading>ปฏิบัติการ</DropdownMenu.GroupHeading>
							<DropdownMenu.Item onSelect={() => onOpenZoneModal()}>ย้ายโซน</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={() => onOpenStatusModal()}>
								เปลี่ยนสถานะ
								{#if statusInfo}
									<span class="ml-auto text-xs text-muted-foreground">{statusInfo.shortLabel}</span>
								{/if}
							</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={() => onOpenQrModal()}>
								<Printer class="size-4" />
								พิมพ์ QR
							</DropdownMenu.Item>
						</DropdownMenu.Group>
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.GroupHeading>แก้ไขข้อมูล</DropdownMenu.GroupHeading>
							<DropdownMenu.Item onSelect={() => onOpenPersonalEdit()}>
								<Pencil class="size-4" />
								บุคคล
							</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={() => onOpenEmergencyEdit()}>
								<Pencil class="size-4" />
								ฉุกเฉิน
							</DropdownMenu.Item>
							{#if onOpenHealthEdit}
								<DropdownMenu.Item onSelect={() => onOpenHealthEdit?.()}>
									<Pencil class="size-4" />
									สุขภาพ
								</DropdownMenu.Item>
							{/if}
							{#if onOpenHouseholdEdit}
								<DropdownMenu.Item onSelect={() => onOpenHouseholdEdit?.()}>
									<Pencil class="size-4" />
									ครัวเรือน
								</DropdownMenu.Item>
							{/if}
							{#if onOpenAssetsEdit}
								<DropdownMenu.Item onSelect={() => onOpenAssetsEdit?.()}>
									<Pencil class="size-4" />
									สินทรัพย์
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Group>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else}
				<button
					type="button"
					onclick={() =>
						goto(resolve(`/back-office/evacuee-management/edit/evacuee/${evacuee._id}`))}
					class="inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					<ExternalLink class="size-4 opacity-75" />
					ดูข้อมูลเต็ม
				</button>
			{/if}
		</div>
	{:else}
		<div class="border-t border-slate-200/80 pt-3">
			{#if !readonly}
				<div class="grid grid-cols-2 gap-2">
					<button
						type="button"
						onclick={onOpenZoneModal}
						class="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-amber-400 bg-transparent px-3 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						ย้ายโซน
					</button>
					<button
						type="button"
						onclick={() => onOpenActions?.()}
						class="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-[#0A2647] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						การดำเนินการ
					</button>
				</div>
			{:else}
				<button
					type="button"
					onclick={() => onOpenActions?.()}
					class="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl bg-[#0A2647] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					การดำเนินการ
				</button>
			{/if}
		</div>
	{/if}
</aside>
