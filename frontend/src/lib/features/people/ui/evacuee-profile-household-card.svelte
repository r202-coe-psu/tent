<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Eye from '@lucide/svelte/icons/eye';
	import Users from '@lucide/svelte/icons/users';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useMasterData } from '$lib/features/master-data';
	import {
		evacueeAgeYears,
		formatPersonName,
		type Evacuee,
		type Household,
		type HouseholdStatus,
		type StayStatus
	} from '$lib/features/people';

	let {
		evacuee,
		household,
		members,
		readonly,
		onOpenAddressModal,
		onOpenHouseholdModal,
		onViewMember
	}: {
		evacuee: Evacuee;
		household: Household | null;
		members: Evacuee[];
		readonly: boolean;
		onOpenAddressModal: () => void;
		onOpenHouseholdModal: () => void;
		onViewMember: (id: string) => void;
	} = $props();

	const housingTypeQuery = useMasterData(() => 'housing_type');
	const municipalityZoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');

	const HOUSEHOLD_STATUS_LABEL: Record<HouseholdStatus, string> = {
		pre_registered: 'ลงทะเบียนล่วงหน้า',
		arriving: 'กำลังเดินทางมา',
		checked_in: 'เช็คอินแล้ว',
		checked_out: 'เช็คเอาท์แล้ว',
		cancelled: 'ยกเลิก'
	};

	const STAY_STATUS_LABEL: Partial<Record<StayStatus, string>> = {
		active: 'อยู่ในศูนย์',
		room_confirmed: 'ยืนยันถึงโซนแล้ว',
		pre_registered: 'ลงทะเบียนล่วงหน้า',
		arriving: 'รอจัดโซน',
		temporary_leave: 'ออกชั่วคราว',
		transferred: 'ย้ายศูนย์',
		checked_out: 'ย้ายออก',
		deceased: 'เสียชีวิต',
		cancelled: 'ยกเลิก'
	};

	const isHead = $derived(!!household && household.head_evacuee_id === evacuee._id);

	const housingTypeLabel = $derived.by(() => {
		const code = household?.housing_type;
		if (!code) return null;
		const item = (housingTypeQuery.data?.items ?? []).find((i) => i.code === code);
		return item?.label ?? code;
	});

	const municipalityZoneLabel = $derived.by(() => {
		const code = household?.municipality_zone;
		if (!code) return null;
		const item = (municipalityZoneQuery.data?.items ?? []).find((i) => i.code === code);
		return item?.label ?? code;
	});

	const communityLabel = $derived.by(() => {
		const code = household?.community;
		if (!code) return null;
		const item = (communityQuery.data?.items ?? []).find((i) => i.code === code);
		return item?.label ?? code;
	});

	const addressLine = $derived.by(() => {
		if (!household) return null;
		const parts = [
			household.address_no || '',
			household.village_no ? `หมู่ที่ ${household.village_no}` : '',
			household.subdistrict ? `ต.${household.subdistrict}` : '',
			household.district ? `อ.${household.district}` : '',
			household.province ? `จ.${household.province}` : '',
			household.postal_code || ''
		]
			.map((p) => p.trim())
			.filter(Boolean);
		return parts.length > 0 ? parts.join(' ') : null;
	});
</script>

<section class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
	<div class="flex items-center justify-between border-b border-slate-200/80 pb-2">
		<div class="flex items-center gap-2.5">
			<Home class="size-4.5 text-[#0A2647]" />
			<h3 class="text-base font-bold text-slate-900">ครัวเรือน / ครอบครัว</h3>
		</div>
		{#if !readonly}
			<button
				type="button"
				aria-label="แก้ไขสังกัดครัวเรือน"
				title="แก้ไขสังกัดครัวเรือน"
				onclick={onOpenHouseholdModal}
				class="inline-flex size-11 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
			>
				<Pencil class="size-4" />
			</button>
		{/if}
	</div>

	{#if !household}
		<div class="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
			<p class="text-sm font-medium text-slate-700">ยังไม่สังกัดครัวเรือน</p>
			<p class="mt-1 text-sm text-slate-500">
				ผู้พักพิงคนนี้ยังไม่ได้เชื่อมกับเอกสารครัวเรือนในระบบ
			</p>
			{#if !readonly}
				<Button class="mt-4" variant="outline" onclick={onOpenHouseholdModal}>
					เลือก / เชื่อมครัวเรือน
				</Button>
			{/if}
		</div>
	{:else}
		<div class="space-y-4">
			<div class="flex flex-wrap items-start justify-between gap-2">
				<div class="min-w-0 space-y-1">
					<span class="block text-sm font-semibold text-slate-700">ชื่อครัวเรือน</span>
					<p class="text-base font-bold text-slate-900">{household.label || '—'}</p>
				</div>
				<div class="flex flex-wrap items-center gap-1.5">
					<Badge
						variant="outline"
						class="border border-sky-200 bg-sky-50 text-xs font-semibold text-sky-900"
					>
						{HOUSEHOLD_STATUS_LABEL[household.status] ?? household.status}
					</Badge>
					{#if isHead}
						<Badge
							class="border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-900"
						>
							บทบาท: หัวหน้า
						</Badge>
					{:else}
						<Badge variant="secondary" class="text-xs font-semibold">บทบาท: สมาชิก</Badge>
					{/if}
				</div>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#if housingTypeLabel}
					<div>
						<span class="block text-sm font-semibold text-slate-700">ประเภทที่อยู่อาศัย</span>
						<p class="mt-0.5 text-sm font-medium text-slate-900">{housingTypeLabel}</p>
					</div>
				{/if}
				{#if household.residence_landmark}
					<div>
						<span class="block text-sm font-semibold text-slate-700">จุดสังเกตใกล้เคียง</span>
						<p class="mt-0.5 text-sm font-medium text-slate-900">{household.residence_landmark}</p>
					</div>
				{/if}
				{#if municipalityZoneLabel || communityLabel}
					<div class="sm:col-span-2">
						<span class="block text-sm font-semibold text-slate-700">เขต / ชุมชน</span>
						<p class="mt-0.5 text-sm font-medium text-slate-900">
							{#if municipalityZoneLabel}
								เขต {municipalityZoneLabel}
							{/if}
							{#if communityLabel}
								{municipalityZoneLabel ? ' · ' : ''}ชุมชน {communityLabel}
							{/if}
						</p>
					</div>
				{/if}
			</div>

			<div class="space-y-2 border-t border-slate-200/80 pt-3">
				<div class="flex items-center justify-between gap-2">
					<span class="text-sm font-semibold text-slate-700">ที่อยู่ครัวเรือน</span>
					{#if !readonly}
						<button
							type="button"
							onclick={onOpenAddressModal}
							class="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-[#0284C7] transition-colors hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
						>
							<Pencil class="size-3.5" /> แก้ไขที่อยู่
						</button>
					{/if}
				</div>
				<div
					class="rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-sm font-medium break-words text-slate-800"
				>
					{#if addressLine}
						{addressLine}
					{:else}
						<span class="text-slate-500 italic">ไม่มีที่อยู่จัดเก็บ</span>
					{/if}
				</div>
			</div>

			{#if household.notes}
				<div>
					<span class="block text-sm font-semibold text-slate-700">หมายเหตุครัวเรือน</span>
					<p class="mt-0.5 text-sm break-words text-slate-700">{household.notes}</p>
				</div>
			{/if}

			<div class="space-y-2 border-t border-slate-200/80 pt-3">
				<div class="flex items-center gap-2">
					<Users class="size-4 text-[#0A2647]" />
					<span class="text-sm font-bold text-slate-900">
						รายชื่อสมาชิก ({members.length} คน)
					</span>
				</div>

				{#if members.length === 0}
					<p class="py-4 text-center text-sm text-slate-500 italic">ไม่มีสมาชิกในครัวเรือนนี้</p>
				{:else}
					<div class="divide-y divide-slate-200/80 rounded-xl border border-slate-200/80 bg-white">
						{#each members as m (m._id)}
							{@const age = evacueeAgeYears(m)}
							{@const isCurrent = m._id === evacuee._id}
							{@const memberIsHead = m._id === household.head_evacuee_id}
							<div
								class="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between {isCurrent
									? 'bg-sky-50/60'
									: ''}"
							>
								<div class="min-w-0 space-y-1.5">
									<p class="truncate text-sm font-bold text-slate-900">
										{formatPersonName(m)}
									</p>
									<div class="flex flex-wrap items-center gap-1.5">
										{#if memberIsHead}
											<Badge
												class="border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-900"
											>
												หัวหน้า
											</Badge>
										{:else}
											<Badge variant="secondary" class="text-xs font-semibold">สมาชิก</Badge>
										{/if}
										{#if isCurrent}
											<Badge
												class="border border-sky-200 bg-sky-50 text-xs font-semibold text-sky-900"
											>
												กำลังดู
											</Badge>
										{/if}
									</div>
									<p class="text-sm text-slate-600">
										{#if age != null}
											<span class="tabular-nums">อายุ {age} ปี</span>
											<span aria-hidden="true"> · </span>
										{/if}
										{STAY_STATUS_LABEL[m.current_stay.status] ?? m.current_stay.status}
										{#if m.current_stay.zone}
											<span aria-hidden="true"> · </span>
											โซน {m.current_stay.zone.toUpperCase()}
										{/if}
									</p>
								</div>

								{#if !isCurrent}
									<Button
										variant="outline"
										size="sm"
										class="min-h-11 w-full shrink-0 sm:w-auto"
										onclick={() => onViewMember(m._id)}
									>
										<Eye class="mr-1.5 size-3.5" />
										ดูโปรไฟล์
									</Button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</section>
