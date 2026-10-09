<script module lang="ts">
	/** Where registered people go next — Station 2 when medical screening is on, else Station 3. */
	export type IntakeNextStation = 'medical' | 'zoning';
</script>

<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import StationCompletionSummary from '../shared/station-completion-summary.svelte';
	import { formatPersonName, type Evacuee, type Household } from '../../domain/people';
	import EvacueeQrModal from '../evacuee-profile/evacuee-qr-modal.svelte';
	import EvacueeHandoverSlipModal from '../evacuee-profile/evacuee-handover-slip-modal.svelte';
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

	const showHandover = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);

	const total = $derived(members.length);
	const nextStation = $derived<IntakeNextStation>(showHandover ? 'medical' : 'zoning');
	const nextStationLabel = $derived(
		nextStation === 'medical' ? 'ไปคัดกรองแพทย์ (สถานี 2)' : 'ไปจัดโซน (สถานี 3)'
	);
	const facts = $derived([
		{ label: 'ครอบครัว', value: household.label || '—' },
		{ label: 'จำนวน', value: `${total} คน` },
		{ label: 'สถานะ', value: 'รายงานตัวแล้ว · รอเข้าพัก' },
		{
			label: 'ขั้นถัดไป',
			value: nextStation === 'medical' ? 'คัดกรองแพทย์ (สถานี 2)' : 'จัดโซน (สถานี 3)'
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
		subtitle={`พิมพ์บัตรด้านล่างทีละใบ${showHandover ? ' (Person QR และ Handover Slip ของทุกคน)' : ' (Person QR ของทุกคน)'} แล้วส่งต่อไปขั้นถัดไป`}
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
			{#if showHandover}
				<EvacueeHandoverSlipModal
					show={true}
					evacuee={member}
					symptoms={[]}
					embedded={true}
					dismissible={false}
					onClose={onDone}
				/>
			{/if}
		</section>
	{/each}

	<div
		class="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 p-3 backdrop-blur-sm"
	>
		<div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
			{@render nextActions()}
		</div>
	</div>
</div>
