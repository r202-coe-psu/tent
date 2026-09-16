<script lang="ts">
	import Printer from '@lucide/svelte/icons/printer';
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatPersonName, type Evacuee, type Household } from '../domain/people';
	import EvacueeQrModal from './evacuee-qr-modal.svelte';
	import EvacueeHandoverSlipModal from './evacuee-handover-slip-modal.svelte';
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

	let printIndex = $state(0);
	let printMode = $state<'qr' | 'handover'>('qr');

	const current = $derived(members[printIndex] ?? null);
	const total = $derived(members.length);

	function nextPrint() {
		if (printMode === 'qr' && showHandover) {
			printMode = 'handover';
			return;
		}
		if (printIndex < members.length - 1) {
			printIndex += 1;
			printMode = 'qr';
			return;
		}
		onDone();
	}

	function selectMember(index: number) {
		printIndex = index;
		printMode = 'qr';
	}
</script>

<div class="space-y-4">
	<div class="rounded-xl border border-border bg-card p-4 sm:p-5">
		<div class="mb-3 flex items-start gap-3">
			<div
				class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
			>
				<Users class="size-5" />
			</div>
			<div>
				<h2 class="text-lg font-bold text-foreground">พิมพ์บัตรประจำตัวครอบครัว</h2>
				<p class="text-sm text-muted-foreground">
					{household.label} · {total} คน — พิมพ์ Person QR
					{#if showHandover}
						และ Handover Slip
					{/if}
					ทีละคน หรือเลือกจากรายชื่อด้านล่าง
				</p>
			</div>
		</div>

		<div class="flex flex-wrap gap-2">
			{#each members as member, i (member._id)}
				<Button
					type="button"
					variant={printIndex === i ? 'default' : 'outline'}
					size="sm"
					onclick={() => selectMember(i)}
					class="h-9"
				>
					{i === 0 ? 'ผู้ติดต่อหลัก' : `สมาชิก ${i + 1}`}: {formatPersonName(member)}
				</Button>
			{/each}
		</div>
	</div>

	{#if current}
		<div
			class="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
		>
			<p class="text-sm text-foreground">
				กำลังแสดง: <span class="font-semibold">{formatPersonName(current)}</span>
				<span class="text-muted-foreground">
					({printMode === 'qr' ? 'Person QR' : 'Handover Slip'} · {printIndex + 1}/{total})
				</span>
			</p>
			<Button type="button" variant="outline" size="sm" onclick={nextPrint} class="h-9 gap-1.5">
				<Printer class="size-3.5" />
				{printIndex === total - 1 && (printMode === 'handover' || !showHandover)
					? 'เสร็จสิ้น'
					: 'ถัดไป'}
			</Button>
		</div>

		{#if printMode === 'qr'}
			<EvacueeQrModal
				show={true}
				evacuee={current}
				embedded={true}
				closeLabel="เสร็จสิ้น / กลับคิว"
				onClose={onDone}
			/>
		{:else}
			<EvacueeHandoverSlipModal
				show={true}
				evacuee={current}
				symptoms={[]}
				embedded={true}
				onClose={onDone}
			/>
		{/if}
	{/if}
</div>
