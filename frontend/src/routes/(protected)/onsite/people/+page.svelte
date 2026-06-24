<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		EvacueeForm,
		// EvacueeList,
		useEvacuees,
		useCreateEvacuee,
		useCreateScreening,
		SHELTER_CODE,
		type EvacueeInput
	} from '$lib/features/people';
	import Button from '$lib/components/ui/button/button.svelte';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Zap from '@lucide/svelte/icons/zap';
	import { page } from '$app/stores';

	const evacueesQuery = useEvacuees();
	const createMutation = useCreateEvacuee();
	const createScreeningMutation = useCreateScreening();

	let isFastTrack = $derived($page.url.searchParams.get('mode') === 'fast_track');

	function handleRegister(input: EvacueeInput, symptoms: string[]) {
		const ctx = { shelterCode: SHELTER_CODE, createdBy: authStore.user?.name ?? 'unknown' };
		createMutation.mutate(
			{ input, ctx },
			{
				onSuccess: (evacuee) => {
					toast.success(`Registered ${evacuee.first_name} ${evacuee.last_name}`);
					
					// Create screening record
					createScreeningMutation.mutate({
						input: {
							evacuee_id: evacuee._id,
							symptoms,
							temperature_c: null,
							track: isFastTrack ? 'fast_track' : (symptoms.length > 0 ? 'fast_track' : 'normal'),
							needs_referral: false,
						},
						ctx
					}, {
						onSuccess: () => console.log('Screening record created successfully.'),
						onError: (err) => {
							console.error('Failed to create screening:', err);
							toast.error(`Screening failed: ${err.message}`);
						}
					});
				},
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}
	let step = $state<1 | 2>(1);
</script>

<div class="container mx-auto max-w-5xl p-6">
	<h1 class="mb-6 text-3xl font-bold">People</h1>

	{#if isFastTrack}
		<div class="mb-6 rounded-2xl border border-purple-200 bg-purple-50/50 p-4 flex items-center gap-4">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-yellow-500">
				<Zap class="size-5 fill-yellow-500" />
			</div>
			<div>
				<h3 class="text-sm font-bold text-purple-900">การลงทะเบียนช่องทางพิเศษ (Fast Track)</h3>
				<p class="text-xs font-semibold text-purple-700">สำหรับกลุ่มเปราะบาง มีความต้องการพิเศษ หรือกรณีฉุกเฉินทางการแพทย์</p>
			</div>
		</div>
	{/if}

	{#if step === 1}
		<Card.Root class="mb-8">
			<Card.Header class="p-4 flex flex-row items-start gap-3 space-y-0">
				<div
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
				>
					1
				</div>
				<div class="space-y-1">
					<Card.Title class="text-base font-semibold leading-none">
						ส่วนประเมินอาการเจ็บป่วยและกลุ่มอาการเฝ้าระวัง (EWAR Symptoms)
					</Card.Title>
					<Card.Description class="text-sm">
						โปรดสังเกตอาการหรือสอบถามผู้ประสบภัยก่อนเริ่มลงทะเบียน หากพบอาการให้แจ้งเตือน
					</Card.Description>
				</div>
			</Card.Header>
		</Card.Root>
	{:else if step === 2}
		<Card.Root class="mb-4">
			<Card.Header class="p-4 flex flex-row items-center justify-between gap-3 space-y-0">
				<div class="flex items-center gap-3">
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
					>
						2
					</div>
					<div class="space-y-1">
						<Card.Title class="text-base font-semibold leading-none">ข้อมูลผู้ประสบภัย (Registration)</Card.Title>
						<Card.Description class="text-sm">
							กรอกข้อมูลพื้นฐานและประเมินสถานะ
						</Card.Description>
					</div>
				</div>
				<Button class="bg-[#003B71] text-white hover:bg-[#002a50]">
					<CreditCard class="mr-2 h-4 w-4" /> ดึงข้อมูลบัตรประชาชน
				</Button>
			</Card.Header>
		</Card.Root>
	{/if}

	<Card.Root class="mb-8">
		<Card.Header>
			<Card.Title>Register evacuee</Card.Title>
		</Card.Header>
		<Card.Content>
			<EvacueeForm onsubmit={handleRegister} pending={createMutation.isPending} bind:step />
		</Card.Content>
	</Card.Root>

	<!-- <Card.Root>
		<Card.Header>
			<Card.Title>Evacuees</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if evacueesQuery.isLoading}
				<p class="text-sm text-muted-foreground">Loading...</p>
			{:else if evacueesQuery.isError}
				<p class="text-sm text-destructive">Error: {evacueesQuery.error?.message}</p>
			{:else}
				<EvacueeList evacuees={evacueesQuery.data ?? []} />
			{/if}
		</Card.Content>
	</Card.Root> -->
</div>
