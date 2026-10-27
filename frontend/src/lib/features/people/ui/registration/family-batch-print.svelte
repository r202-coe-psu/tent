<script module lang="ts">
	/** Where registered people go next — Station 2 when medical screening is on, else Station 3. */
	export type IntakeNextStation = 'medical' | 'zoning';
</script>

<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { PrintLabelsButton } from '$lib/features/printers';
	import { renderKioskQrLabelPng } from '$lib/features/kiosk';
	import StationCompletionSummary from '../shared/station-completion-summary.svelte';
	import { peopleKeys } from '../../application/queries';
	import { peopleRepository } from '../../data/people.remote';
	import { buildEvacueeQrLabel } from '../../domain/evacuee-qr-label';
	import { headFirst } from '../../domain/household-label-order';
	import { formatPersonName, type Evacuee, type Household } from '../../domain/people';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { EVACUEE_QR_MODAL_I18N } from '../_constants/evacuee-qr-modal.i18n';
	import EvacueeQrModal from '../evacuee-profile/evacuee-qr-modal.svelte';
	import { useShelter } from '$lib/features/shelters/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';

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
	const qrT = $derived(getTranslation(EVACUEE_QR_MODAL_I18N, languageStore.current));
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

	const total = $derived(members.length);
	const nextStation = $derived<IntakeNextStation>(medicalScreeningEnabled ? 'medical' : 'zoning');
	const nextStationLabel = $derived(
		nextStation === 'medical' ? 'ไปคัดกรองผู้เข้าพัก (สถานี 2)' : 'ไปจัดโซน (สถานี 3)'
	);
	const facts = $derived([
		{ label: 'ครอบครัว', value: household.label || '—' },
		{ label: 'จำนวน', value: `${total} คน` },
		{ label: 'สถานะ', value: 'รายงานตัวแล้ว · รอเข้าพัก' },
		{
			label: 'ขั้นถัดไป',
			value: nextStation === 'medical' ? 'คัดกรองผู้เข้าพัก (สถานี 2)' : 'จัดโซน (สถานี 3)'
		}
	]);

	function isHead(member: Evacuee, index: number): boolean {
		if (household.head_evacuee_id) {
			return member._id === household.head_evacuee_id;
		}
		return index === 0;
	}
</script>

{#snippet nextActions()}
	{#if onNextStation}
		<Button type="button" class="min-h-11" onclick={() => onNextStation?.(nextStation)}>
			{nextStationLabel}
			<ArrowRight class="ml-1.5 size-4" />
		</Button>
	{/if}
	{#if onRegisterAnother}
		<Button type="button" variant="outline" class="min-h-11" onclick={onRegisterAnother}>
			<UserPlus class="mr-1.5 size-4" />
			ลงทะเบียนครอบครัวถัดไป
		</Button>
	{/if}
	<Button type="button" variant="ghost" class="min-h-11" onclick={onDone}>กลับคิวทะเบียน</Button>
{/snippet}

<div class="space-y-4 pb-20">
	<StationCompletionSummary
		title="ลงทะเบียนสำเร็จ"
		titleId="family-batch-print-heading"
		subtitle="พิมพ์บัตรด้านล่างทีละใบ (Person QR ของทุกคน) แล้วส่งต่อไปขั้นถัดไป"
		{facts}
		actions={nextActions}
	>
		<ul class="flex flex-wrap gap-1.5 text-sm">
			{#each members as member, i (member._id)}
				<li class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-slate-700">
					{formatPersonName(member)}{isHead(member, i) ? ' (ผู้ติดต่อหลัก)' : ''}
				</li>
			{/each}
		</ul>
	</StationCompletionSummary>

	{#each members as member, i (member._id)}
		<section class="space-y-3">
			<h3 class="text-base font-semibold text-foreground">
				{isHead(member, i) ? 'ผู้ติดต่อหลัก' : 'สมาชิก'}: {formatPersonName(member)}
			</h3>
			<EvacueeQrModal
				show={true}
				evacuee={member}
				embedded={true}
				dismissible={false}
				onClose={onDone}
			/>
		</section>
	{/each}

	<div
		class="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 p-3 backdrop-blur-sm"
	>
		<div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
			<!-- Only here (not in the shared nextActions): one instance = one print state, no double print. -->
			{#if total > 0}
				<PrintLabelsButton
					{shelterCode}
					labelCount={total}
					source="walk_in"
					renderLabels={renderFamilyLabels}
					label={`พิมพ์ทั้งครอบครัว (${total} ใบ)`}
					buttonClass="min-h-11"
				/>
			{/if}
			{@render nextActions()}
		</div>
	</div>
</div>
