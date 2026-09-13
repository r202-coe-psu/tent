<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		FamilyBatchPrint,
		RegistrationSaveErrorAlert,
		UnifiedRegistrationForm,
		useEvacuee,
		useEvacuees,
		useHousehold,
		useSubmitFamilyReportIn,
		buildSaveFailureReport,
		householdToUnifiedInput,
		evacueeToUnifiedMember,
		type Evacuee,
		type Household,
		type SaveFailureReport,
		type UnifiedRegistrationInput,
		type UnifiedMemberWithMeta
	} from '$lib/features/people';

	let { data } = $props();

	const evacueeQuery = useEvacuee(() => data.evacueeId);
	const evacuee = $derived(evacueeQuery.data ?? null);

	const householdQuery = useHousehold(
		() => evacuee?.household_id ?? '',
		() => Boolean(evacuee?.household_id)
	);
	const household = $derived(householdQuery.data ?? null);

	const evacueesQuery = useEvacuees();
	const allEvacuees = $derived(evacueesQuery.data ?? []);

	const familyMembers = $derived.by(() => {
		if (!evacuee) return [];
		if (!evacuee.household_id) return [evacuee];
		const members = allEvacuees.filter((e) => e.household_id === evacuee.household_id);
		if (members.length === 0) return [evacuee];
		// Place head first if available, else target evacuee first
		const headId = household?.head_evacuee_id ?? evacuee._id;
		return [...members].sort((a, b) => {
			if (a._id === headId) return -1;
			if (b._id === headId) return 1;
			return 0;
		});
	});

	const initialHousehold = $derived(householdToUnifiedInput(household));
	const initialMembers = $derived(
		familyMembers.map((m) => evacueeToUnifiedMember(m, data.evacueeId))
	);

	const submitReportIn = useSubmitFamilyReportIn();

	let completed = $state<{ household: Household; members: Evacuee[] } | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);
	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || completed) return;
		if (isDirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) {
			nav.cancel();
		}
	});

	function backToQueue() {
		isNavigatingAfterSave = true;
		completed = null;
		goto(resolve('/onsite/people'));
	}

	const wrongStatus = $derived(
		Boolean(evacuee && evacuee.current_stay.status !== 'pre_registered')
	);

	async function handleReportIn(
		input: UnifiedRegistrationInput,
		meta?: { reportingInMembers: UnifiedMemberWithMeta[]; allMembers: UnifiedMemberWithMeta[] }
	) {
		const shelterCode = getShelterCode();
		const ctx = {
			shelterCode,
			createdBy: authStore.user?.name ?? 'unknown'
		};

		saveError = null;

		try {
			const result = await submitReportIn.mutateAsync({
				householdId: evacuee?.household_id ?? household?._id ?? '',
				household: input.household,
				members: meta?.allMembers ?? (input.members as UnifiedMemberWithMeta[]),
				ctx
			});
			saveError = null;
			isDirty = false;
			isNavigatingAfterSave = true;
			completed = result;
			toast.success(`รายงานตัวสำเร็จ ${result.members.length} คน`);
		} catch (err) {
			saveError = buildSaveFailureReport(err, {
				summaryTh: 'บันทึกการรายงานตัวไม่สำเร็จ',
				shelterCode
			});
			toast.error('บันทึกการรายงานตัวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
			throw err;
		}
	}
</script>

<svelte:head>
	<title>
		{evacuee ? `รายงานตัว · ${evacuee.first_name}` : 'รายงานตัว'} | SmartShelter
	</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
	{#if completed}
		<FamilyBatchPrint
			household={completed.household}
			members={completed.members}
			onDone={backToQueue}
		/>
	{:else}
		<button
			type="button"
			onclick={backToQueue}
			class="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			<span>กลับคิวทะเบียน</span>
		</button>

		<div class="mb-2 flex flex-wrap items-center gap-2">
			<ClipboardList class="size-6 text-primary" />
			<h1 class="text-2xl font-bold md:text-3xl">รายงานตัวผู้ประสบภัย</h1>
			<Badge variant="outline">Station 1 · Report-in</Badge>
		</div>
		<p class="mb-4 text-sm text-muted-foreground md:mb-6">
			ตรวจสอบข้อมูลครอบครัว เลือกสมาชิกที่เดินทางมารายงานตัวในรอบนี้ และสามารถเพิ่มสมาชิกใหม่ได้
		</p>

		{#if saveError}
			<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
		{/if}

		{#if evacueeQuery.isPending || (evacuee?.household_id && householdQuery.isPending) || evacueesQuery.isPending}
			<div class="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
				<div
					class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
				></div>
				<p class="text-xs">กำลังโหลดข้อมูลผู้ประสบภัยและครอบครัว...</p>
			</div>
		{:else if !evacuee}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<AlertTriangle class="size-6" />
				</div>
				<h2 class="text-base font-bold">ไม่พบผู้ประสบภัย</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					รหัส <span class="font-mono">{data.evacueeId}</span> ไม่มีในศูนย์นี้
				</p>
				<Button class="mt-4" onclick={backToQueue}>กลับคิวทะเบียน</Button>
			</Card.Root>
		{:else if wrongStatus}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<h2 class="text-base font-bold">สถานะไม่ใช่ pre_registered</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					รายงานตัวได้เฉพาะผู้ที่ลงทะเบียนล่วงหน้า — สถานะปัจจุบัน:
					{evacuee.current_stay.status}
				</p>
				<Button class="mt-4" onclick={backToQueue}>กลับคิวทะเบียน</Button>
			</Card.Root>
		{:else}
			<UnifiedRegistrationForm
				mode="report-in"
				channel="onsite"
				includeVehiclesAssets={true}
				{initialHousehold}
				{initialMembers}
				pending={submitReportIn.isPending}
				onsubmit={handleReportIn}
				onDirtyChange={(dirty) => (isDirty = dirty)}
			/>
		{/if}
	{/if}
</div>
