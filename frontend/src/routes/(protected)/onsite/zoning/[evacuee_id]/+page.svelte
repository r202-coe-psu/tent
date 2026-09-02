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
		ZoneSelectionFields,
		maskNationalId,
		classifyZoningQueueTab,
		countOccupantsByZone,
		recommendZoneKind,
		type Evacuee
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
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
	const checkInMutation = useCheckInEvacuee();
	const changeZoneMutation = useChangeEvacueeZone();

	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const evacuee = $derived(evacueeQuery.data ?? null);
	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const screenedIds = $derived(new Set((screeningsQuery.data ?? []).map((s) => s.evacuee_id)));
	const latestTriage = $derived.by(() => {
		if (!evacuee) return null;
		const list = (screeningsQuery.data ?? [])
			.filter((s) => s.evacuee_id === evacuee._id)
			.sort((a, b) => (b.screened_at ?? b.created_at).localeCompare(a.screened_at ?? a.created_at));
		return list[0]?.triage_level ?? null;
	});

	const isRezone = $derived(
		evacuee?.current_stay.status === 'active' && !!evacuee.current_stay.zone
	);

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

	const activeHouseholdMembers = $derived.by((): Evacuee[] => {
		if (!evacuee?.household_id) return [];
		return allEvacuees.filter(
			(e) =>
				e._id !== evacuee._id &&
				e.household_id === evacuee.household_id &&
				e.current_stay.status === 'active'
		);
	});

	const companionCandidates = $derived(isRezone ? activeHouseholdMembers : pendingHouseholdMembers);

	let selectedZone = $state('');
	let selectedCompanionIds = $state<string[]>([]);
	let submitting = $state(false);

	const recommendKind = $derived(recommendZoneKind(evacuee ?? { special_needs: [] }, latestTriage));
	const isolationDefault = $derived(recommendKind === 'quarantine');

	$effect(() => {
		if (!evacuee) return;
		if (evacuee.current_stay.zone && !selectedZone) {
			selectedZone = evacuee.current_stay.zone;
		}
		// Isolation default: when quarantine recommended, do not auto-select household
		if (isolationDefault) {
			selectedCompanionIds = [];
		}
	});

	const occupantCounts = $derived(countOccupantsByZone(allEvacuees));
	const householdLabel = $derived(
		evacuee?.household_id
			? (householdsQuery.data?.find((h) => h._id === evacuee.household_id)?.label ?? '—')
			: '—'
	);

	function toggleCompanion(id: string, checked: boolean) {
		if (checked) {
			selectedCompanionIds = [...new Set([...selectedCompanionIds, id])];
		} else {
			selectedCompanionIds = selectedCompanionIds.filter((x) => x !== id);
		}
	}

	function authorCtx() {
		return {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};
	}

	async function applyZone(target: Evacuee, zone: string) {
		if (target.current_stay.status === 'active') {
			return changeZoneMutation.mutateAsync({ evacuee: target, ctx: authorCtx(), zone });
		}
		return checkInMutation.mutateAsync({ evacuee: target, ctx: authorCtx(), zone });
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
			<div class="mb-4 space-y-1">
				<p class="text-lg font-bold">{evacuee.first_name} {evacuee.last_name}</p>
				<p class="text-xs text-muted-foreground">
					บัตร {maskNationalId(evacuee.person_id?.number)} · สถานะ {evacuee.current_stay.status} · ครัวเรือน
					{householdLabel}
				</p>
				{#if latestTriage}
					<p class="text-xs">
						Triage:
						<Badge variant="secondary">{latestTriage}</Badge>
						{#if isolationDefault}
							<span class="text-amber-700"> — แนะนำกักตัว (ไม่รวมครัวเรือนโดยปริยาย)</span>
						{/if}
					</p>
				{/if}
			</div>

			<ZoneSelectionFields
				bind:selected_zone={selectedZone}
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
								<p class="text-sm font-medium">{member.first_name} {member.last_name}</p>
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
