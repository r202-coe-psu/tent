<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { untrack } from 'svelte';

	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	import {
		useEvacuees,
		useScreenings,
		maskNationalId,
		genderLabel,
		evacueeAgeYears,
		nextScreeningQueueEvacuee,
		classifyScreeningQueueTab,
		startStaffStationVisit,
		recommendZoneKind,
		zoneKindLabelsByLanguage,
		formatPersonName,
		StationCompletionSummary,
		type Screening
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { STAFF_MEDICAL_SCREENING_I18N } from '$lib/constants/i18n/staff-medical-screening';
	import ClinicalScreeningForm from '../clinical-screening-form.svelte';
	import { shouldConfirmLeave } from '../medical-screening.utils';

	let { data } = $props();

	const t = $derived(getTranslation(STAFF_MEDICAL_SCREENING_I18N, langState.current));

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

	const savedFacts = $derived.by(() => {
		if (!evacuee) return [];
		const symptoms = latestScreening?.symptoms ?? [];
		return [
			{
				label: t.factCareTrack,
				value: latestScreening?.track === 'fast_track' ? t.factFastTrack : t.factNormalCare
			},
			{
				label: t.factEwar,
				value: symptoms.length > 0 ? t.factSymptomCount(symptoms.length) : t.factNone
			},
			{
				label: t.factVulnerable,
				value:
					(evacuee.vulnerable_groups?.length ?? 0) > 0
						? t.factGroupCount(evacuee.vulnerable_groups.length)
						: t.factNone
			},
			{
				label: t.factZone,
				value: zoneKindLabelsByLanguage[langState.current][recommendZoneKind(evacuee, symptoms)]
			}
		];
	});
	const screenedIds = $derived(
		new Set(((screeningsQuery.data ?? []) as Screening[]).map((s) => s.evacuee_id))
	);
	// CR-192: Station 2 `start` when staff open someone who is still waiting for screening. The
	// boolean flips only when that state changes, so saving (which adds the screening) never
	// re-opens a visit; the repository skips a reopen / refresh while a start is still live.
	const awaitingScreening = $derived(
		!isLoading && evacuee !== null && classifyScreeningQueueTab(evacuee, screenedIds) === 'pending'
	);
	$effect(() => {
		const id = evacueeId;
		if (!awaitingScreening) return;
		untrack(() => {
			void startStaffStationVisit(id, 2, {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			});
		});
	});
	const nextInQueue = $derived(
		nextScreeningQueueEvacuee(evacueesQuery.data ?? [], screenedIds, savedEvacueeId)
	);

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || justSaved) return;
		if (shouldConfirmLeave({ isDirty }) && !confirm(t.confirmLeave)) {
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
		{evacuee ? t.detailTitle(`${evacuee.first_name} ${evacuee.last_name}`) : t.detailTitleDefault} | SmartShelter
	</title>
</svelte:head>

<div class="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl flex-col">
	<div class="flex items-center gap-3 border-b border-border px-4 py-4 md:px-6">
		<button
			type="button"
			onclick={goToQueue}
			class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			title={t.backToQueueTitle}
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
				<h1
					class="text-xl font-bold tracking-tight break-words text-foreground sm:truncate md:text-2xl"
				>
					{#if evacuee}
						{evacuee.first_name}
						{evacuee.last_name}
					{:else}
						{t.formHeading}
					{/if}
				</h1>
			</div>
			{#if evacuee}
				<p class="mt-0.5 text-xs text-muted-foreground">
					{t.headerMeta(
						genderLabel(evacuee.gender, langState.current),
						String(evacueeAgeYears(evacuee) ?? '—'),
						maskNationalId(evacuee.person_id?.number),
						evacuee.phone || '—'
					)}
				</p>
			{/if}
		</div>
	</div>

	{#if isLoading}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
			<div
				class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
			></div>
			<p class="text-xs">{t.loadingEvacuee}</p>
		</div>
	{:else if !enableMedical}
		<div class="flex flex-1 items-center justify-center p-6">
			<Card.Root class="w-full max-w-md border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<Stethoscope class="size-6" />
				</div>
				<h2 class="text-base font-bold text-foreground">{t.disabledTitle}</h2>
				<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
					{t.disabledDesc}
				</p>
				<div class="mt-5 flex flex-col gap-2">
					<Button
						variant="default"
						class="h-auto min-h-9 w-full py-2 leading-tight whitespace-normal"
						onclick={() => goto(resolve('/portal'))}
					>
						{t.backToPortal}
					</Button>
					<Button
						variant="outline"
						class="h-auto min-h-9 w-full py-2 leading-tight whitespace-normal"
						onclick={() =>
							goto(resolve(`/onsite/zoning/${evacueeId}` as `/onsite/zoning/${string}`))}
					>
						{t.goToStation3}
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
				<h2 class="text-base font-bold text-foreground">{t.notFoundTitle}</h2>
				<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
					{t.notFoundPrefix}
					<span class="font-semibold text-foreground">{evacueeId}</span>
					{t.notFoundSuffix}
				</p>
				<Button variant="default" class="mt-4 w-full" onclick={goToQueue}>{t.backToQueueBtn}</Button
				>
			</Card.Root>
		</div>
	{:else if justSaved}
		<div class="p-4 md:p-6">
			<StationCompletionSummary
				title={t.savedTitle}
				subtitle={t.savedSubtitle(formatPersonName(evacuee))}
				facts={savedFacts}
			>
				{#snippet actions()}
					<Button
						class="h-auto min-h-11 py-2 leading-tight whitespace-normal"
						onclick={() => goToZoning(evacuee._id)}>{t.goToZoning}</Button
					>
					<Button
						variant="outline"
						class="h-auto min-h-11 py-2 leading-tight whitespace-normal"
						disabled={!nextInQueue}
						onclick={goToNextInQueue}
					>
						{nextInQueue ? t.nextInQueue(formatPersonName(nextInQueue)) : t.noNextInQueue}
					</Button>
					<Button
						variant="ghost"
						class="h-auto min-h-11 py-2 leading-tight whitespace-normal"
						onclick={goToQueue}>{t.backToDoctorQueue}</Button
					>
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
