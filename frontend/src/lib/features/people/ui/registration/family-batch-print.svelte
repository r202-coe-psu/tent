<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatPersonName, type Evacuee, type Household } from '../../domain/people';
	import EvacueeQrModal from '../evacuee-profile/evacuee-qr-modal.svelte';
	import EvacueeHandoverSlipModal from '../evacuee-profile/evacuee-handover-slip-modal.svelte';
	import { useShelter } from '$lib/features/shelters/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';

	let {
		household,
		members,
		onDone
	}: {
		household: Household;
		members: Evacuee[];
		onDone: () => void;
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

	function isHead(member: Evacuee, index: number): boolean {
		if (household.head_evacuee_id) {
			return member._id === household.head_evacuee_id;
		}
		return index === 0;
	}
</script>

<div class="space-y-4 pb-20">
	<div class="rounded-xl border border-border bg-card p-4 sm:p-5">
		<div class="flex items-start gap-3">
			<div
				class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
			>
				<Users class="size-5" />
			</div>
			<div>
				<h2 class="text-lg font-bold text-foreground">พิมพ์บัตรประจำตัวครอบครัว</h2>
				<p class="text-sm text-muted-foreground">
					{household.label} · {total} คน — พิมพ์บัตรด้านล่างทีละใบ แล้วกดเสร็จสิ้น
					{#if showHandover}
						(Person QR และ Handover Slip ของทุกคน)
					{/if}
				</p>
			</div>
		</div>
	</div>

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
		<Button type="button" onclick={onDone} class="w-full">เสร็จสิ้น / กลับคิว</Button>
	</div>
</div>
