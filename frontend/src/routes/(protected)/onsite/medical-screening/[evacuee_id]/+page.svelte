<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';

	import {
		useEvacuees,
		useScreenings,
		maskNationalId,
		genderLabelTh,
		evacueeAgeYears,
		nextScreeningQueueEvacuee,
		recommendZoneKind,
		formatPersonName,
		StationCompletionSummary,
		type Screening,
		type ZoningRecommendKind
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import ClinicalScreeningForm from '../clinical-screening-form.svelte';
	import { shouldConfirmLeave } from '../medical-screening.utils';

	let { data } = $props();

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);

	const evacueesQuery = useEvacuees();
	const screeningsQuery = useScreenings();

	const evacueeId = $derived(data.evacueeId);
	const isLoading = $derived(
		evacueesQuery.isPending || screeningsQuery.isPending || shelterQuery.isPending
	);

	const evacuee = $derived((evacueesQuery.data ?? []).find((e) => e._id === evacueeId) ?? null);

	const screeningsForEvacuee = $derived(
		((screeningsQuery.data ?? []) as Screening[])
			.filter((s) => s.evacuee_id === evacueeId)
			.slice()
			.sort((a, b) => (b.screened_at || '').localeCompare(a.screened_at || ''))
	);

	const latestScreening = $derived(screeningsForEvacuee[0] ?? null);

	const priorScreening = $derived(
		latestScreening
			? {
					screeningCount: screeningsForEvacuee.length,
					lastScreenedAt: latestScreening.screened_at,
					lastScreenedBy: latestScreening.created_by,
					latest: latestScreening
				}
			: null
	);

	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);
	let savedEvacueeId = $state<string | null>(null);
	// The route is reused for 「คนถัดไปในคิว」 — only show the summary for the person just saved
	const justSaved = $derived(savedEvacueeId !== null && savedEvacueeId === evacueeId);

	const ZONE_KIND_LABELS: Record<ZoningRecommendKind, string> = {
		quarantine: 'โซนกักตัว (มีอาการเฝ้าระวัง)',
		vulnerable: 'โซนกลุ่มเปราะบาง',
		general: 'โซนทั่วไป'
	};
	const savedFacts = $derived.by(() => {
		if (!evacuee) return [];
		const symptoms = latestScreening?.symptoms ?? [];
		return [
			{
				label: 'แนวทางดูแล',
				value: latestScreening?.track === 'fast_track' ? 'Fast track' : 'ดูแลตามปกติ'
			},
			{
				label: 'อาการเฝ้าระวัง (EWAR)',
				value: symptoms.length > 0 ? `${symptoms.length} อาการ` : 'ไม่มี'
			},
			{
				label: 'กลุ่มเปราะบาง',
				value:
					(evacuee.vulnerable_groups?.length ?? 0) > 0
						? `${evacuee.vulnerable_groups.length} กลุ่ม`
						: 'ไม่มี'
			},
			{
				label: 'โซนที่ระบบแนะนำ (สถานี 3)',
				value: ZONE_KIND_LABELS[recommendZoneKind(evacuee, symptoms)]
			}
		];
	});
	const screenedIds = $derived(
		new Set(((screeningsQuery.data ?? []) as Screening[]).map((s) => s.evacuee_id))
	);
	const nextInQueue = $derived(
		nextScreeningQueueEvacuee(evacueesQuery.data ?? [], screenedIds, savedEvacueeId)
	);

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || justSaved) return;
		if (
			shouldConfirmLeave({ isDirty }) &&
			!confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')
		) {
			nav.cancel();
		}
	});

	function goToQueue() {
		isNavigatingAfterSave = true;
		goto(resolve('/onsite/medical-screening'));
	}

	function goToZoning(id: string) {
		isNavigatingAfterSave = true;
		goto(resolve(`/onsite/zoning/${id}` as `/onsite/zoning/${string}`));
	}

	function goToNextInQueue() {
		if (!nextInQueue) return;
		savedEvacueeId = null;
		isDirty = false;
		goto(
			resolve(
				`/onsite/medical-screening/${nextInQueue._id}` as `/onsite/medical-screening/${string}`
			)
		);
	}

	function handleSuccess(id: string) {
		isDirty = false;
		savedEvacueeId = id;
	}
</script>

<svelte:head>
	<title>
		{evacuee ? `คัดกรอง · ${evacuee.first_name} ${evacuee.last_name}` : 'คัดกรองการแพทย์'} | SmartShelter
	</title>
</svelte:head>

<div class="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl flex-col">
	<div class="flex items-center gap-3 border-b border-border px-4 py-4 md:px-6">
		<button
			type="button"
			onclick={goToQueue}
			class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			title="กลับไปคิวคัดกรอง"
		>
			<ArrowLeft class="size-4" />
		</button>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2">
				<div
					class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
				>
					<Stethoscope class="size-5" />
				</div>
				<h1 class="truncate text-xl font-bold tracking-tight text-foreground md:text-2xl">
					{#if evacuee}
						{evacuee.first_name}
						{evacuee.last_name}
					{:else}
						ฟอร์มคัดกรองทางการแพทย์
					{/if}
				</h1>
				<Badge
					variant="outline"
					class="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
				>
					Station 2
				</Badge>
			</div>
			{#if evacuee}
				<p class="mt-0.5 text-xs text-muted-foreground">
					เพศ {genderLabelTh(evacuee.gender)} · อายุ
					{evacueeAgeYears(evacuee) ?? '—'} ปี · บัตร
					{maskNationalId(evacuee.person_id?.number)} · โทร {evacuee.phone || '—'}
				</p>
			{/if}
		</div>
	</div>

	{#if isLoading}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
			<div
				class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
			></div>
			<p class="text-xs">กำลังโหลดข้อมูลผู้ประสบภัย...</p>
		</div>
	{:else if !enableMedical}
		<div class="flex flex-1 items-center justify-center p-6">
			<Card.Root class="w-full max-w-md border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<Stethoscope class="size-6" />
				</div>
				<h2 class="text-base font-bold text-foreground">จุดคัดกรองการแพทย์ถูกปิดใช้งาน</h2>
				<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
					ศูนย์พักพิงนี้ไม่ได้เปิดใช้งานจุดคัดกรองทางการแพทย์ (Station 2) ตามการตั้งค่าศูนย์พักพิง
				</p>
				<div class="mt-5 flex flex-col gap-2">
					<Button variant="default" class="w-full" onclick={() => goto(resolve('/portal'))}>
						กลับหน้าเลือกเมนูหลัก
					</Button>
					<Button
						variant="outline"
						class="w-full"
						onclick={() =>
							goto(resolve(`/onsite/zoning/${evacueeId}` as `/onsite/zoning/${string}`))}
					>
						ไปจุดจัดสรรที่พัก (Station 3)
					</Button>
				</div>
			</Card.Root>
		</div>
	{:else if !evacuee}
		<div class="flex flex-1 items-center justify-center p-6">
			<Card.Root class="w-full max-w-md border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<AlertTriangle class="size-6" />
				</div>
				<h2 class="text-base font-bold text-foreground">ไม่พบผู้ประสบภัย</h2>
				<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
					รหัส <span class="font-semibold text-foreground">{evacueeId}</span> ไม่มีในศูนย์นี้ หรือคุณไม่มีสิทธิ์เข้าถึง
					— กลับไปที่คิวคัดกรองแล้วลองค้นหาอีกครั้ง
				</p>
				<Button variant="default" class="mt-4 w-full" onclick={goToQueue}>กลับไปคิวคัดกรอง</Button>
			</Card.Root>
		</div>
	{:else if justSaved}
		<div class="p-4 md:p-6">
			<StationCompletionSummary
				title="บันทึกผลคัดกรองแล้ว"
				subtitle={`${formatPersonName(evacuee)} — ส่งต่อโต๊ะจัดสรรที่พัก (สถานี 3) ได้เลย`}
				facts={savedFacts}
			>
				{#snippet actions()}
					<Button class="min-h-11" onclick={() => goToZoning(evacuee._id)}>ไปจัดโซนเลย</Button>
					<Button
						variant="outline"
						class="min-h-11"
						disabled={!nextInQueue}
						onclick={goToNextInQueue}
					>
						{nextInQueue ? `คนถัดไปในคิว: ${formatPersonName(nextInQueue)}` : 'ไม่มีคนรอตรวจในคิว'}
					</Button>
					<Button variant="ghost" class="min-h-11" onclick={goToQueue}>กลับคิวแพทย์</Button>
				{/snippet}
			</StationCompletionSummary>
		</div>
	{:else}
		{#key evacuee._id}
			<ClinicalScreeningForm
				{evacuee}
				{priorScreening}
				onDirtyChange={(dirty) => (isDirty = dirty)}
				onSuccess={handleSuccess}
			/>
		{/key}
	{/if}
</div>
