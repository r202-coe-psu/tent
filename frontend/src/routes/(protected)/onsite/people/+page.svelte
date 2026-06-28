<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		EvacueeForm,
		useEvacuees,
		useCreateEvacuee,
		useCreateScreening,
		SHELTER_CODE,
		type EvacueeInput
	} from '$lib/features/people';
	import Zap from '@lucide/svelte/icons/zap';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import { page } from '$app/stores';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import EvacueeWristbandSuccess from '$lib/features/people/ui/evacuee-wristband-success.svelte';

	const evacueesQuery = useEvacuees();
	const createMutation = useCreateEvacuee();
	const createScreeningMutation = useCreateScreening();

	let isFastTrack = $derived($page.url.searchParams.get('mode') === 'fast_track');

	// Completed evacuee after zone selection — drives the success screen
	let completedEvacuee = $state<any>(null);

	async function handleRegister(input: EvacueeInput, symptoms: string[]) {
		const ctx = {
			shelterCode: shelterStore.selectedShelterCode ?? SHELTER_CODE,
			createdBy: authStore.user?.name ?? 'unknown'
		};
		const track = isFastTrack ? 'fast_track' : symptoms.length > 0 ? 'fast_track' : 'normal';

		try {
			const evacuee = await createMutation.mutateAsync({
				input: { ...input, track },
				ctx
			});
			toast.success(`Registered ${evacuee.first_name} ${evacuee.last_name}`);

			await createScreeningMutation.mutateAsync({
				input: {
					evacuee_id: evacuee._id,
					symptoms,
					temperature_c: null,
					track,
					needs_referral: false
				},
				ctx
			});
			return evacuee;
		} catch (err: any) {
			toast.error(err.message || err);
			throw err;
		}
	}

	let step = $state<1 | 2 | 3 | 4 | 5 | 6>(1);
</script>

<div class="container mx-auto max-w-5xl p-6">
	{#if completedEvacuee}
		<EvacueeWristbandSuccess
			evacuee={completedEvacuee}
			onBack={() => {
				completedEvacuee = null;
			}}
		/>
	{:else}
		<!-- ── Registration Flow ─────────────────────────────────────────────── -->
		<h1 class="mb-6 text-3xl font-bold">ลงทะเบียนผู้ประสบภัย</h1>

		{#if isFastTrack}
			<div
				class="mb-6 flex items-center gap-4 rounded-2xl border border-purple-200 bg-purple-50/50 p-4"
			>
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-yellow-500"
				>
					<Zap class="size-5 fill-yellow-500" />
				</div>
				<div>
					<h3 class="text-sm font-bold text-purple-900">การลงทะเบียนช่องทางพิเศษ (Fast Track)</h3>
					<p class="text-xs font-semibold text-purple-700">
						สำหรับกลุ่มเปราะบาง มีความต้องการพิเศษ หรือกรณีฉุกเฉินทางการแพทย์
					</p>
				</div>
			</div>
		{/if}

		{#if step === 1}
			<Card.Root class="mb-4">
				<Card.Header class="flex flex-row items-start gap-3 space-y-0 p-4">
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
					>
						1
					</div>
					<div class="space-y-1">
						<Card.Title class="text-base leading-none font-semibold">
							ตรวจสอบประวัติการลงทะเบียน
						</Card.Title>
						<Card.Description class="text-sm">
							ค้นหาด้วยเลขบัตรประชาชน, เบอร์โทรศัพท์ หรือชื่อ-นามสกุล ก่อนลงทะเบียนใหม่
						</Card.Description>
					</div>
				</Card.Header>
			</Card.Root>
		{:else if step === 2}
			<Card.Root class="mb-4">
				<Card.Header class="flex flex-row items-start gap-3 space-y-0 p-4">
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
					>
						2
					</div>
					<div class="space-y-1">
						<Card.Title class="text-base leading-none font-semibold">
							ส่วนประเมินอาการเจ็บป่วยและกลุ่มอาการเฝ้าระวัง (EWAR Symptoms)
						</Card.Title>
						<Card.Description class="text-sm">
							โปรดสังเกตอาการหรือสอบถามผู้ประสบภัยก่อนเริ่มลงทะเบียน หากพบอาการให้แจ้งเตือน
						</Card.Description>
					</div>
				</Card.Header>
			</Card.Root>
		{:else if step === 3}
			<Card.Root class="mb-4">
				<Card.Header class="flex flex-row items-center justify-between gap-3 space-y-0 p-4">
					<div class="flex items-center gap-3">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
						>
							3
						</div>
						<div class="space-y-1">
							<Card.Title class="text-base leading-none font-semibold"
								>ข้อมูลผู้ประสบภัย (Registration)</Card.Title
							>
							<Card.Description class="text-sm">กรอกข้อมูลพื้นฐานและประเมินสถานะ</Card.Description>
						</div>
					</div>
					<button
						class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#003B71] px-3 py-2 text-sm font-medium text-white hover:bg-[#002a50]"
					>
						<CreditCard class="size-4" /> ดึงข้อมูลบัตรประชาชน
					</button>
				</Card.Header>
			</Card.Root>
		{:else if step === 4}
			<Card.Root class="mb-4">
				<Card.Header class="flex flex-row items-center gap-3 space-y-0 p-4">
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
					>
						4
					</div>
					<div class="space-y-1">
						<Card.Title class="text-base leading-none font-semibold"
							>หน้าค้นหาครัวเรือน (Head of Household)</Card.Title
						>
						<Card.Description class="text-sm">
							สืบค้นและตรวจสอบกลุ่มครอบครัว หรือลงทะเบียนเป็นครอบครัวใหม่
						</Card.Description>
					</div>
				</Card.Header>
			</Card.Root>
		{/if}

		<Card.Root class="mb-8">
			<Card.Content>
				<EvacueeForm
					onsubmit={handleRegister}
					pending={createMutation.isPending}
					bind:step
					onComplete={(ev) => {
						completedEvacuee = ev;
					}}
				/>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

