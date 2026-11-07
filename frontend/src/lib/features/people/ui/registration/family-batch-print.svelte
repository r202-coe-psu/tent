<script module lang="ts">
	/** Where registered people go next — Station 2 when medical screening is on, else Station 3. */
	export type IntakeNextStation = 'medical' | 'zoning';
</script>

<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { PRINTERS_I18N, PrintLabelsButton } from '$lib/features/printers';
	import { renderKioskQrLabelPng } from '$lib/features/kiosk';
	import StationCompletionSummary from '../shared/station-completion-summary.svelte';
	import { peopleKeys } from '../../application/queries';
	import { peopleRepository } from '../../data/people.remote';
	import { buildEvacueeQrLabel } from '../../domain/evacuee-qr-label';
	import { headFirst } from '../../domain/household-label-order';
	import { formatPersonName, type Evacuee, type Household } from '../../domain/people';
	import { getTranslation } from '$lib/utils/i18n';
	import { EVACUEE_QR_MODAL_I18N } from '../_constants/evacuee-qr-modal.i18n';
	import EvacueeQrModal from '../evacuee-profile/evacuee-qr-modal.svelte';
	import { useShelter } from '$lib/features/shelters/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { langState } from '$lib/states/i18n.svelte';
	import {
		PRIMARY_CONTACT_LABEL,
		PRIMARY_CONTACT_LABEL_EN
	} from '../../domain/unified-registration';
	import { STATION1_REGISTRATION_I18N } from '../_constants/station1-registration.i18n';

	let {
		household,
		members,
		onDone,
		onNextStation,
		onRegisterAnother
	}: {
		household: Household;
		members: Evacuee[];
		/** Back to the Station 1 queue. */
		onDone: () => void;
		onNextStation?: (station: IntakeNextStation) => void;
		/** Start a fresh family form in place. */
		onRegisterAnother?: () => void;
	} = $props();

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const shelterQuery = safeQuery(
		() => useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode()),
		{ data: undefined } as unknown as ReturnType<typeof useShelter>
	);

	const queryClient = safeQuery(() => useQueryClient(), null);
	const qrT = $derived(getTranslation(EVACUEE_QR_MODAL_I18N, langState.current));
	const printersT = $derived(getTranslation(PRINTERS_I18N, langState.current));
	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	/**
	 * Station-printer labels for the whole family, head first. Built when the button is clicked, so
	 * the tick on คัดกรอง reflects the screenings that exist right now: each member's screenings are
	 * fetched through the query client under the same key `useScreeningsByEvacuee` uses (the
	 * member cards below already populate it; staleTime 0 here forces a fresh read at click time).
	 */
	async function renderFamilyLabels(): Promise<string[]> {
		const client = queryClient;
		if (!client) throw new Error('Query client is not available');
		const zones = shelterQuery.data?.zones;
		const checklist = [qrT.checklistCheckIn, qrT.checklistScreening, qrT.checklistLodging];
		return Promise.all(
			headFirst(members, household.head_evacuee_id).map(async (member) => {
				const screenings = await client.fetchQuery({
					queryKey: peopleKeys.screeningsByEvacuee(member._id),
					queryFn: () => peopleRepository().listScreeningsByEvacuee(member._id),
					staleTime: 0
				});
				const { qrPayload, label } = buildEvacueeQrLabel(member, {
					zones,
					hasScreening: screenings.length > 0,
					checklist
				});
				return renderKioskQrLabelPng(qrPayload, label);
			})
		);
	}

	const medicalScreeningEnabled = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);

	const t = $derived(getTranslation(STATION1_REGISTRATION_I18N, langState.current).batch);
	const primaryContactLabel = $derived(
		langState.current === 'en' ? PRIMARY_CONTACT_LABEL_EN : PRIMARY_CONTACT_LABEL
	);

	const total = $derived(members.length);
	const nextStation = $derived<IntakeNextStation>(medicalScreeningEnabled ? 'medical' : 'zoning');
	const nextStationLabel = $derived(nextStation === 'medical' ? t.toMedical : t.toZoning);
	const facts = $derived([
		{ label: t.factFamily, value: household.label || '—' },
		{ label: t.factCount, value: t.count(total) },
		{ label: t.factStatus, value: t.statusValue },
		{
			label: t.factNext,
			value: nextStation === 'medical' ? t.nextMedical : t.nextZoning
		}
	]);

	// Leaving the page while printing, or while a job already sent may still print, drops the
	// button's follow-up state: printing the family again would duplicate labels.
	let printing = $state(false);
	let retryHeld = $state(false);
	const leaveLocked = $derived(printing || retryHeld);

	function isHead(member: Evacuee, index: number): boolean {
		if (household.head_evacuee_id) {
			return member._id === household.head_evacuee_id;
		}
		return index === 0;
	}
</script>

{#snippet nextActions()}
	{#if onNextStation}
		<Button
			type="button"
			class="min-h-11"
			disabled={leaveLocked}
			onclick={() => onNextStation?.(nextStation)}
		>
			{nextStationLabel}
			<ArrowRight class="ml-1.5 size-4" />
		</Button>
	{/if}
	{#if onRegisterAnother}
		<Button
			type="button"
			variant="outline"
			class="min-h-11"
			disabled={leaveLocked}
			onclick={onRegisterAnother}
		>
			<UserPlus class="mr-1.5 size-4" />
			{t.registerAnother}
		</Button>
	{/if}
	<Button type="button" variant="ghost" class="min-h-11" disabled={leaveLocked} onclick={onDone}>
		{t.backToQueue}
	</Button>
{/snippet}

<div class="space-y-4 pb-20">
	<StationCompletionSummary
		title={t.title}
		titleId="family-batch-print-heading"
		subtitle={t.subtitle}
		{facts}
		actions={nextActions}
	>
		<ul class="flex flex-wrap gap-1.5 text-sm">
			{#each members as member, i (member._id)}
				<li class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-slate-700">
					{formatPersonName(member)}{isHead(member, i) ? ` (${primaryContactLabel})` : ''}
				</li>
			{/each}
		</ul>
	</StationCompletionSummary>

	{#each members as member, i (member._id)}
		<section class="space-y-3">
			<h3 class="text-base font-semibold text-foreground">
				{isHead(member, i) ? primaryContactLabel : t.member}: {formatPersonName(member)}
			</h3>
			<EvacueeQrModal
				show={true}
				evacuee={member}
				embedded={true}
				dismissible={false}
				printable={false}
				onClose={onDone}
			/>
		</section>
	{/each}

	<div
		class="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 p-3 backdrop-blur-sm"
	>
		<div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
			<!-- The only printer button on this page (member cards hide theirs, nextActions has none):
			     one instance = one print state, no double print. -->
			{#if total > 0}
				<!-- Keyed by the family: the button keeps unsent chunks for Retry, which must not outlive a
				     change of members (it would print the old labels). Invariant: `members` is a snapshot
				     taken when the family registered, so the key never changes while `printing` or
				     `retryHeld` is true. If it did, the new instance would report both as false and the
				     follow-up of a job already sent would be lost. -->
				{#key `${household._id}:${members.map((m) => m._id).join(',')}`}
					<PrintLabelsButton
						bind:printing
						bind:retryHeld
						{shelterCode}
						labelCount={total}
						source="walk_in"
						renderLabels={renderFamilyLabels}
						label={printersT.printFamily(total)}
						buttonClass="min-h-11"
					/>
				{/key}
			{/if}
			{@render nextActions()}
		</div>
	</div>
</div>
