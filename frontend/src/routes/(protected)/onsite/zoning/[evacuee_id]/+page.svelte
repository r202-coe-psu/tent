<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import MapPin from '@lucide/svelte/icons/map-pin';

	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Card from '$lib/components/ui/card';

	import {
		useEvacuee,
		useEvacuees,
		useHouseholds,
		useScreenings,
		useCheckInEvacuee,
		useChangeEvacueeZone,
		useConfirmRoom,
		useConfirmRoomForHousehold,
		ZoneSelectionFields,
		maskNationalId,
		formatPersonName,
		classifyZoningQueueTab,
		countPresentOccupantsByZone,
		recommendZoneKind,
		canChangeEvacueeZone,
		canConfirmRoom,
		isPendingZoneArrivalConfirmation,
		type Evacuee,
		type TriageLevel
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { useMasterData } from '$lib/features/master-data';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';

	let { data }: { data: { evacueeId: string } } = $props();

	const evacueeId = $derived(data.evacueeId);
	const evacueeQuery = useEvacuee(() => evacueeId);
	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	const checkInMutation = useCheckInEvacuee();
	const changeZoneMutation = useChangeEvacueeZone();
	const confirmRoomMutation = useConfirmRoom();
	const confirmRoomHouseholdMutation = useConfirmRoomForHousehold();

	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const evacuee = $derived(evacueeQuery.data ?? null);
	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const screenedIds = $derived(new Set((screeningsQuery.data ?? []).map((s) => s.evacuee_id)));
	const latestTriage = $derived.by((): TriageLevel | null => {
		if (!evacuee) return null;
		const list = (screeningsQuery.data ?? [])
			.filter((s) => s.evacuee_id === evacuee._id)
			.sort((a, b) => (b.screened_at ?? b.created_at).localeCompare(a.screened_at ?? a.created_at));
		return list[0]?.triage_level ?? null;
	});

	const TRIAGE_LABELS: Record<TriageLevel, string> = {
		green: 'เขียว',
		yellow: 'เหลือง',
		red: 'แดง'
	};
	const TRIAGE_BADGE_CLASS: Record<TriageLevel, string> = {
		green: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
		yellow: 'border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200',
		red: 'border-red-500/40 bg-red-500/15 text-red-800 dark:text-red-200'
	};
	const SPECIAL_NEED_LABELS: Record<string, string> = {
		wheelchair: 'ใช้วีลแชร์',
		bedridden: 'ผู้ป่วยติดเตียง',
		oxygen: 'ใช้ออกซิเจน',
		pregnant: 'หญิงตั้งครรภ์',
		infant: 'ทารก/เด็กเล็ก',
		visual_impaired: 'ผู้พิการทางการมองเห็น',
		hearing_impaired: 'ผู้พิการทางการได้ยิน',
		high_dependency: 'มีภาวะพึ่งพิงสูง',
		elderly: 'ผู้สูงอายุ',
		chronic_illness: 'โรคเรื้อรัง',
		disabled: 'ผู้พิการ'
	};

	function getSpecialNeedLabel(need: string): string {
		const fromMaster = vulnerableGroupQuery.data?.items.find((i) => i.code === need)?.label;
		if (fromMaster) return fromMaster;
		return SPECIAL_NEED_LABELS[need] ?? need;
	}

	const isAwaitingConfirm = $derived(!!evacuee && isPendingZoneArrivalConfirmation(evacuee));
	const isRezone = $derived(!!evacuee && canChangeEvacueeZone(evacuee) && !isAwaitingConfirm);
	const canConfirmArrival = $derived(!!evacuee && isAwaitingConfirm && canConfirmRoom(evacuee));

	const pendingHouseholdMembers = $derived.by((): Evacuee[] => {
		if (!evacuee?.household_id) return [];
		return allEvacuees.filter((e) => {
			if (e._id === evacuee._id) return false;
			if (e.household_id !== evacuee.household_id) return false;
			return (
				classifyZoningQueueTab(e, {
					enableMedicalScreening: enableMedical,
					hasScreening: screenedIds.has(e._id)
				}) === 'pending'
			);
		});
	});

	const rezoneHouseholdMembers = $derived.by((): Evacuee[] => {
		if (!evacuee?.household_id) return [];
		return allEvacuees.filter(
			(e) =>
				e._id !== evacuee._id && e.household_id === evacuee.household_id && canChangeEvacueeZone(e)
		);
	});

	const companionCandidates = $derived(isRezone ? rezoneHouseholdMembers : pendingHouseholdMembers);

	// User edits tracked per-evacuee so query refetches don't wipe selection
	let zoneDraft = $state<string | null>(null);
	let zoneDraftEvacueeId = $state<string | null>(null);
	let companionDraft = $state<string[]>([]);
	let companionDraftEvacueeId = $state<string | null>(null);
	let submitting = $state(false);

	const selectedZone = $derived(
		zoneDraftEvacueeId === evacueeId && zoneDraft !== null
			? zoneDraft
			: (evacuee?.current_stay.zone ?? '')
	);
	// Isolation default: companions start empty (never auto-select household)
	const selectedCompanionIds = $derived(
		companionDraftEvacueeId === evacueeId ? companionDraft : []
	);

	const recommendKind = $derived(
		recommendZoneKind(evacuee ?? { vulnerable_groups: [], special_needs: [] }, latestTriage)
	);
	const isolationDefault = $derived(recommendKind === 'quarantine');

	const occupantCounts = $derived(countPresentOccupantsByZone(allEvacuees));
	const householdLabel = $derived(
		evacuee?.household_id
			? (householdsQuery.data?.find((h) => h._id === evacuee.household_id)?.label ?? '—')
			: '—'
	);

	function setSelectedZone(zone: string) {
		zoneDraftEvacueeId = evacueeId;
		zoneDraft = zone;
	}

	function toggleCompanion(id: string, checked: boolean) {
		const base = companionDraftEvacueeId === evacueeId ? companionDraft : [];
		companionDraftEvacueeId = evacueeId;
		companionDraft = checked ? [...new Set([...base, id])] : base.filter((x) => x !== id);
	}

	function authorCtx() {
		return {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};
	}

	async function applyZone(target: Evacuee, zone: string) {
		if (canChangeEvacueeZone(target)) {
			return changeZoneMutation.mutateAsync({ evacuee: target, ctx: authorCtx(), zone });
		}
		return checkInMutation.mutateAsync({ evacuee: target, ctx: authorCtx(), zone });
	}

	async function handleConfirmArrival() {
		if (!evacuee || !canConfirmArrival) return;
		submitting = true;
		try {
			await confirmRoomMutation.mutateAsync({ evacuee, ctx: authorCtx() });
			toast.success('ยืนยันถึงโซนเรียบร้อย');
			await goto(resolve('/onsite/zoning'));
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : 'ยืนยันถึงโซนไม่สำเร็จ');
		} finally {
			submitting = false;
		}
	}

	async function handleConfirmHouseholdArrival() {
		if (!evacuee?.household_id) return;
		submitting = true;
		try {
			const confirmed = await confirmRoomHouseholdMutation.mutateAsync({
				householdId: evacuee.household_id,
				evacuees: allEvacuees,
				ctx: authorCtx()
			});
			toast.success(`ยืนยันถึงโซนทั้งครัวเรือน ${confirmed.length} คน`);
			await goto(resolve('/onsite/zoning'));
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : 'ยืนยันถึงโซนไม่สำเร็จ');
		} finally {
			submitting = false;
		}
	}

	async function handleSubmit() {
		if (!evacuee || !selectedZone.trim()) {
			toast.error('กรุณาเลือกโซนที่พัก');
			return;
		}
		submitting = true;
		try {
			await applyZone(evacuee, selectedZone.trim());
			for (const id of selectedCompanionIds) {
				const member = companionCandidates.find((m) => m._id === id);
				if (member) await applyZone(member, selectedZone.trim());
			}
			toast.success(
				isRezone
					? `ย้ายโซนเป็น ${selectedZone} เรียบร้อย`
					: `จัดที่พักโซน ${selectedZone} และเช็คอินเรียบร้อย`
			);
			await goto(resolve('/onsite/zoning'));
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>จัดสรรที่พัก | SmartShelter</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6">
	<div class="flex items-center gap-3">
		<a
			href={resolve('/onsite/zoning')}
			class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
		</a>
		<div>
			<div class="flex items-center gap-2">
				<MapPin class="size-5 text-amber-600" />
				<h1 class="text-xl font-bold">{isRezone ? 'ย้ายโซนที่พัก' : 'จัดสรรที่พัก'}</h1>
				<Badge variant="outline">Station 3</Badge>
			</div>
		</div>
	</div>

	{#if evacueeQuery.isPending}
		<p class="flex items-center gap-2 text-sm text-muted-foreground">
			<Loader2 class="size-4 animate-spin" /> กำลังโหลด...
		</p>
	{:else if !evacuee}
		<Card.Root class="p-6">
			<p class="text-sm text-muted-foreground">ไม่พบผู้ประสบภัยรหัสนี้</p>
			<Button class="mt-4" variant="outline" href={resolve('/onsite/zoning')}>กลับคิว</Button>
		</Card.Root>
	{:else}
		<Card.Root class="border-border p-5 shadow-sm">
			<div class="mb-4 space-y-2">
				<p class="text-lg font-bold">{formatPersonName(evacuee)}</p>
				<p class="text-xs text-muted-foreground">
					บัตร {maskNationalId(evacuee.person_id?.number)} · สถานะ {evacuee.current_stay.status} · ครอบครัว
					{householdLabel}
				</p>
				<div class="flex flex-wrap items-center gap-2">
					{#if latestTriage}
						<span class="text-xs text-muted-foreground">Triage</span>
						<Badge variant="outline" class={TRIAGE_BADGE_CLASS[latestTriage]}>
							{TRIAGE_LABELS[latestTriage]}
						</Badge>
						{#if isolationDefault}
							<span class="text-xs text-amber-700 dark:text-amber-300"
								>— แนะนำกักตัว (ไม่รวมครัวเรือนโดยปริยาย)</span
							>
						{/if}
					{/if}
				</div>
				{#if evacuee.special_needs && evacuee.special_needs.length > 0}
					<div class="flex flex-wrap gap-1.5 pt-1">
						{#each evacuee.special_needs as need (need)}
							<Badge
								variant="outline"
								class="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
							>
								{getSpecialNeedLabel(need)}
							</Badge>
						{/each}
					</div>
				{/if}
			</div>

			<ZoneSelectionFields
				bind:selected_zone={() => selectedZone, setSelectedZone}
				{evacuee}
				triage_level={latestTriage}
				occupant_counts={occupantCounts}
				shelter_zones={shelterQuery.data?.zones}
			/>

			{#if companionCandidates.length > 0}
				<div class="mt-6 space-y-3 border-t border-border pt-4">
					<p class="text-sm font-semibold">
						{isRezone ? 'ย้ายสมาชิกครัวเรือนที่พักอยู่ด้วย' : 'จัดโซนสมาชิกครัวเรือนที่รอจัดด้วย'}
					</p>
					<p class="text-2xs text-muted-foreground">
						เลือกเฉพาะคน — ไม่ตัด household_id · คนละโซนได้เมื่อจำเป็น (เช่น กักตัว)
					</p>
					{#each companionCandidates as member (member._id)}
						{@const checked = selectedCompanionIds.includes(member._id)}
						<label class="flex items-center gap-3 rounded-lg border border-border p-3">
							<Checkbox
								{checked}
								onCheckedChange={(v) => toggleCompanion(member._id, v === true)}
							/>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">{formatPersonName(member)}</p>
								<p class="text-2xs text-muted-foreground">
									{member.current_stay.status}
									{#if member.current_stay.zone}
										· {member.current_stay.zone}{/if}
								</p>
							</div>
						</label>
					{/each}
				</div>
			{/if}

			<div class="mt-6 flex flex-wrap gap-2">
				{#if canConfirmArrival}
					<Button onclick={handleConfirmArrival} disabled={submitting}>
						{#if submitting}
							<Loader2 class="mr-2 size-4 animate-spin" />
						{/if}
						ยืนยันถึงโซน
					</Button>
					{#if evacuee.household_id}
						<Button
							variant="secondary"
							onclick={handleConfirmHouseholdArrival}
							disabled={submitting}
						>
							ยืนยันทั้งครัวเรือน
						</Button>
					{/if}
				{/if}
				<Button onclick={handleSubmit} disabled={submitting || !selectedZone}>
					{#if submitting}
						<Loader2 class="mr-2 size-4 animate-spin" />
					{/if}
					{isRezone ? 'บันทึกการย้ายโซน' : 'ยืนยันจัดที่พักและเช็คอิน'}
				</Button>
				<Button variant="outline" href={resolve('/onsite/zoning')} disabled={submitting}>
					กลับคิว
				</Button>
			</div>
		</Card.Root>
	{/if}
</div>
