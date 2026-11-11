<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import Ambulance from '@lucide/svelte/icons/ambulance';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Check from '@lucide/svelte/icons/check';
	import Search from '@lucide/svelte/icons/search';
	import Send from '@lucide/svelte/icons/send';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { useEvacuees, useScreenings } from '$lib/features/people';
	import { authStore } from '$lib/stores/auth.svelte';
	import type { Acuity, Referral, VehicleType } from '../domain/referral.schema';
	import { defaultAcuity, m5BatchInputSchema, type M5BatchInput } from '../domain/referral.m5';
	import type { ReferralBatchFailure } from '../data/referral.repository';
	import {
		useCreateM5Batch,
		useIntegrationStatus,
		useM5Facilities
	} from '../application/m5-queries';
	import { formatEvacueeFullName } from './referral.ui-helpers';
	import { ACUITY_OPTIONS, VEHICLE_OPTIONS, m5ErrorMessage } from './referral.m5.ui';
	import ReferralConfirmDialog from './referral-confirm-dialog.svelte';

	let {
		evacueeIds,
		onDone
	}: {
		/** Patients picked in the evacuee table above; one referral each, one M5 transfer. */
		evacueeIds: string[];
		onDone?: (result: { created: Referral[]; failed: ReferralBatchFailure[] }) => void;
	} = $props();

	const queryClient = useQueryClient();
	const createMutation = useCreateM5Batch(queryClient);
	const statusQuery = useIntegrationStatus();
	const facilitiesQuery = useM5Facilities(() => '');
	const evacueesQuery = useEvacuees();
	const screeningsQuery = useScreenings();

	const gateReady = $derived(statusQuery.data?.m5.state === 'ready');

	let facilitySearch = $state('');
	let facilityId = $state<number | null>(null);
	let urgency = $state<'normal' | 'urgent'>('urgent');
	let vehicleType = $state<VehicleType>('ambulance');
	let transportNote = $state('');
	let contactName = $state(authStore.user?.name ?? '');
	let contactRole = $state('');
	let contactPhone = $state('');
	let notes = $state('');
	let acuityById = $state<Record<string, Acuity | undefined>>({});
	let reasonById = $state<Record<string, string>>({});
	let attempted = $state(false);

	let confirmOpen = $state(false);
	let pendingInput = $state.raw<M5BatchInput | null>(null);

	const facilities = $derived(facilitiesQuery.data ?? []);
	const visibleFacilities = $derived.by(() => {
		const q = facilitySearch.trim().toLowerCase();
		if (!q) return facilities;
		return facilities.filter((f) =>
			`${f.name} ${f.district ?? ''} ${f.province}`.toLowerCase().includes(q)
		);
	});
	const selectedFacility = $derived(facilities.find((f) => f.facility_id === facilityId) ?? null);
	const vehicleLabel = $derived(
		VEHICLE_OPTIONS.find((v) => v.value === vehicleType)?.label ?? 'เลือกพาหนะ'
	);

	/** D13: acuity defaults from the latest legacy `triage_level`, if any. */
	const triageByEvacuee = $derived.by(() => {
		const latest: Record<
			string,
			{ created_at: string; triage_level?: 'green' | 'yellow' | 'red' | null }
		> = {};
		for (const s of screeningsQuery.data ?? []) {
			const prev = latest[s.evacuee_id];
			if (!prev || s.created_at > prev.created_at) latest[s.evacuee_id] = s;
		}
		return latest;
	});

	const patients = $derived(
		evacueeIds.map((id) => {
			const evacuee = evacueesQuery.data?.find((e) => e._id === id);
			return {
				id,
				name: evacuee ? formatEvacueeFullName(evacuee) : id,
				acuity: acuityById[id] ?? defaultAcuity(triageByEvacuee[id]),
				reason: reasonById[id] ?? ''
			};
		})
	);

	function buildInput(submit: boolean) {
		return m5BatchInputSchema.safeParse({
			to_org: { name: selectedFacility?.name ?? '', m5_facility_id: facilityId ?? 0 },
			urgency,
			transport: {
				vehicle_type: vehicleType,
				...(transportNote.trim() ? { note: transportNote } : {})
			},
			requester_contact: { name: contactName, role: contactRole, phone: contactPhone },
			...(notes.trim() ? { notes } : {}),
			patients: patients.map((p) => ({ evacuee_id: p.id, acuity: p.acuity, reason: p.reason })),
			submit
		});
	}

	function attempt(submit: boolean) {
		attempted = true;
		if (!facilityId) {
			toast.error('กรุณาเลือกโรงพยาบาลปลายทาง');
			return;
		}
		const parsed = buildInput(submit);
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'กรุณากรอกข้อมูลให้ครบ');
			return;
		}
		if (submit) {
			pendingInput = parsed.data;
			confirmOpen = true;
			return;
		}
		return run(parsed.data);
	}

	async function run(input: M5BatchInput) {
		try {
			const res = await createMutation.mutateAsync(input);
			if (res.submit && !res.submit.ok) {
				toast.error(`บันทึกเป็นร่างแล้ว แต่ส่งไป M5 ไม่สำเร็จ: ${res.submit.error}`);
			} else if (res.submit?.ok) {
				toast.success(`ส่งไป M5 แล้ว (${res.submit.code}) รอ สธ. พิจารณา`);
			} else {
				toast.success(`บันทึกร่างชุดส่งต่อ ${res.items.length} คนแล้ว`);
			}
			onDone?.({ created: res.items, failed: [] });
		} catch (e: unknown) {
			toast.error(m5ErrorMessage(e));
		}
	}
</script>

<div class="space-y-6">
	<!-- Destination -->
	<section class="space-y-3" aria-labelledby="m5-dest-heading">
		<h4 id="m5-dest-heading" class="text-base font-semibold text-slate-800">
			3. โรงพยาบาลปลายทาง (M5) <span class="text-red-600">*</span>
		</h4>
		<div class="relative md:max-w-md">
			<Search class="absolute top-3 left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
			<Label for="m5-facility-search" class="sr-only">ค้นหาโรงพยาบาล</Label>
			<Input
				id="m5-facility-search"
				bind:value={facilitySearch}
				placeholder="ค้นหาชื่อโรงพยาบาลหรืออำเภอ"
				class="h-11 pl-9"
			/>
		</div>
		{#if facilitiesQuery.isPending}
			<p class="text-sm text-slate-500">กำลังโหลดรายชื่อโรงพยาบาล...</p>
		{:else if facilitiesQuery.isError}
			<p class="text-sm text-red-700" role="alert">{m5ErrorMessage(facilitiesQuery.error)}</p>
		{:else if visibleFacilities.length === 0}
			<p class="text-sm text-slate-500">ไม่พบโรงพยาบาลที่ตรงกับคำค้น</p>
		{:else}
			<div
				class="grid grid-cols-1 gap-2 sm:grid-cols-2"
				role="radiogroup"
				aria-label="โรงพยาบาลปลายทาง"
			>
				{#each visibleFacilities as f (f.facility_id)}
					<button
						type="button"
						role="radio"
						aria-checked={facilityId === f.facility_id}
						onclick={() => (facilityId = f.facility_id)}
						class="flex min-h-11 items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
						{facilityId === f.facility_id
							? 'border-sky-300 bg-sky-50'
							: 'border-slate-200/80 bg-white hover:border-slate-300'}"
					>
						<Building2 class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
						<span class="min-w-0 flex-1">
							<span class="block text-sm font-semibold text-slate-900">{f.name}</span>
							<span class="block text-xs text-slate-500">
								{[f.district, f.province].filter(Boolean).join(' · ')}
								{#if f.readiness}
									· รับฉุกเฉินได้ <span class="tabular-nums">{f.readiness.er_capacity}</span> ราย
								{/if}
							</span>
						</span>
						{#if facilityId === f.facility_id}
							<Check class="h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Patients -->
	<section class="space-y-3" aria-labelledby="m5-patients-heading">
		<h4 id="m5-patients-heading" class="text-base font-semibold text-slate-800">
			4. ผู้ป่วยในชุด (<span class="tabular-nums">{patients.length}</span> คน) — ระดับความรุนแรงและอาการรายคน
		</h4>
		{#if patients.length === 0}
			<p class="text-sm text-slate-500">เลือกผู้ป่วยจากตารางด้านบนก่อน</p>
		{/if}
		{#each patients as p (p.id)}
			<div class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
				<div class="text-sm font-semibold text-slate-900">{p.name}</div>
				<div role="group" aria-label="ระดับความรุนแรงของ {p.name}" class="flex flex-wrap gap-2">
					{#each ACUITY_OPTIONS as opt (opt.value)}
						<button
							type="button"
							aria-pressed={p.acuity === opt.value}
							onclick={() => (acuityById = { ...acuityById, [p.id]: opt.value })}
							class="inline-flex min-h-11 min-w-20 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
							{p.acuity === opt.value
								? opt.selected
								: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}"
						>
							{#if p.acuity === opt.value}<Check class="h-3.5 w-3.5" aria-hidden="true" />{/if}
							{opt.label}
						</button>
					{/each}
				</div>
				{#if attempted && !p.acuity}
					<p class="text-sm text-red-700">กรุณาเลือกระดับความรุนแรง</p>
				{/if}
				<div class="space-y-1.5">
					<Label for="m5-reason-{p.id}" class="text-sm font-semibold text-slate-700">
						อาการโดยย่อ <span class="text-red-600">*</span>
					</Label>
					<Textarea
						id="m5-reason-{p.id}"
						rows={2}
						value={p.reason}
						oninput={(e) =>
							(reasonById = {
								...reasonById,
								[p.id]: (e.currentTarget as HTMLTextAreaElement).value
							})}
						placeholder="เช่น หายใจลำบาก ความดันต่ำ"
						aria-invalid={attempted && !p.reason.trim()}
					/>
				</div>
			</div>
		{/each}
	</section>

	<!-- Shared fields -->
	<section class="space-y-4" aria-labelledby="m5-shared-heading">
		<h4 id="m5-shared-heading" class="text-base font-semibold text-slate-800">
			5. การเดินทางและผู้ติดต่อกลับ (ใช้ร่วมกันทั้งชุด)
		</h4>
		<div role="group" aria-label="ระดับความเร่งด่วน" class="flex gap-2 md:max-w-md">
			{#each [{ v: 'normal', l: 'ปกติ' }, { v: 'urgent', l: 'เร่งด่วน' }] as const as u (u.v)}
				<button
					type="button"
					aria-pressed={urgency === u.v}
					onclick={() => (urgency = u.v)}
					class="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
					{urgency === u.v
						? 'border-[#0A2647] bg-[#0A2647] text-white'
						: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}"
				>
					{#if urgency === u.v}<Check class="h-3.5 w-3.5" aria-hidden="true" />{/if}
					{u.l}
				</button>
			{/each}
		</div>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div class="space-y-1.5">
				<Label for="m5-vehicle" class="text-sm font-semibold text-slate-700">พาหนะของศูนย์</Label>
				<Select.Root type="single" bind:value={vehicleType}>
					<Select.Trigger id="m5-vehicle" class="h-11 w-full">
						<Ambulance class="h-4 w-4 text-slate-500" aria-hidden="true" />
						{vehicleLabel}
					</Select.Trigger>
					<Select.Content>
						{#each VEHICLE_OPTIONS as v (v.value)}
							<Select.Item value={v.value} label={v.label} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="space-y-1.5">
				<Label for="m5-transport-note" class="text-sm font-semibold text-slate-700">
					รายละเอียดพาหนะ / ผู้ติดตาม
				</Label>
				<Input
					id="m5-transport-note"
					bind:value={transportNote}
					class="h-11"
					placeholder="เช่น ทะเบียน กข 1234"
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="m5-contact-name" class="text-sm font-semibold text-slate-700">
					ชื่อผู้ติดต่อ <span class="text-red-600">*</span>
				</Label>
				<Input id="m5-contact-name" bind:value={contactName} class="h-11" />
			</div>
			<div class="space-y-1.5">
				<Label for="m5-contact-role" class="text-sm font-semibold text-slate-700">
					ตำแหน่ง <span class="text-red-600">*</span>
				</Label>
				<Input
					id="m5-contact-role"
					bind:value={contactRole}
					class="h-11"
					placeholder="เช่น พยาบาลประจำศูนย์"
				/>
			</div>
			<div class="space-y-1.5 md:col-span-2 md:max-w-sm">
				<Label for="m5-contact-phone" class="text-sm font-semibold text-slate-700">
					เบอร์โทรกลับ <span class="text-red-600">*</span>
				</Label>
				<Input
					id="m5-contact-phone"
					type="tel"
					inputmode="tel"
					bind:value={contactPhone}
					class="h-11 tabular-nums"
				/>
				<p class="text-xs text-slate-500">ช่องทางเดียวที่ สธ. และโรงพยาบาลใช้ติดต่อกลับ</p>
			</div>
			<div class="space-y-1.5 md:col-span-2">
				<Label for="m5-notes" class="text-sm font-semibold text-slate-700">ข้อความถึง สธ.</Label>
				<Textarea id="m5-notes" rows={2} bind:value={notes} />
			</div>
		</div>
	</section>

	<div class="flex flex-col gap-2 border-t border-slate-200/80 pt-4 sm:flex-row sm:justify-end">
		<Button
			type="button"
			variant="outline"
			class="h-11 sm:min-w-32"
			disabled={createMutation.isPending || patients.length === 0}
			onclick={() => attempt(false)}
		>
			บันทึกร่าง
		</Button>
		<Button
			type="button"
			class="h-11 gap-2 sm:min-w-40"
			disabled={createMutation.isPending || patients.length === 0 || !gateReady}
			onclick={() => attempt(true)}
		>
			<Send class="h-4 w-4" aria-hidden="true" />
			ส่งไป M5
		</Button>
	</div>
</div>

{#if pendingInput}
	<ReferralConfirmDialog
		bind:open={confirmOpen}
		title="ยืนยันส่งชุดนี้ไป M5"
		description="ระบบจะส่งชื่อ เลขบัตรประชาชน อายุ และอาการของผู้ป่วยไปยัง สธ. ผ่าน M5 และบันทึกประวัติการส่ง"
		names={patients.map((p) => p.name)}
		count={patients.length}
		confirmLabel={`ส่ง ${patients.length} คนไป M5`}
		pending={createMutation.isPending}
		onConfirm={() => (pendingInput ? run(pendingInput) : undefined)}
	/>
{/if}
