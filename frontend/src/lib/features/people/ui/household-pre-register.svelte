<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useCreateEvacuee, useUpdateEvacuee, useCreateHousehold } from '../application/queries';
	import { getShelterCode } from '$lib/db/shelter';
	import type {
		Evacuee,
		Household,
		PetGroup,
		HouseholdVehicle,
		EvacueeInput,
		HouseholdAddressForm
	} from '../domain/people';
	import EvacueePetAssetVehicle from './evacuee-pet-asset-vehicle.svelte';
	import HouseholdPreRegisterHead from './household-pre-register-head.svelte';
	import HouseholdPreRegisterAddress from './household-pre-register-address.svelte';
	import HouseholdPreRegisterSummary from './household-pre-register-summary.svelte';
	import { useMasterData } from '$lib/features/master-data';
	import { toast } from 'svelte-sonner';
	import EvacueeSelectZone from './evacuee-select-zone.svelte';

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	// --- Step Tracking ---
	let step = $state<1 | 2 | 3 | 4 | 5>(1);
	let isSubmitting = $state(false);

	// --- Queries and Mutations ---
	const createEvacueeMutation = useCreateEvacuee();
	const createHouseholdMutation = useCreateHousehold();
	const updateEvacueeMutation = useUpdateEvacuee();

	const municipalityZoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');

	const municipalityZoneItems = $derived(
		(municipalityZoneQuery.data?.items ?? []).map((z) => ({ value: z.code, label: z.label }))
	);
	const communityItems = $derived(
		(communityQuery.data?.items ?? []).map((c) => ({ value: c.code, label: c.label }))
	);

	// --- Created State ---
	let createdHousehold = $state<Household | null>(null);
	let createdHead = $state<Evacuee | null>(null);

	// --- Validated step data (filled once each step's form passes Zod validation) ---
	let headData = $state<EvacueeInput | null>(null);
	let addressData = $state<HouseholdAddressForm | null>(null);

	const householdLabel = $derived(
		headData ? `ครอบครัว${headData.first_name} ${headData.last_name}`.trim() : ''
	);

	// --- Form State (Pets, Vehicles, Assets) ---
	let petsList = $state<PetGroup[]>([]);
	let vehicleRows = $state<HouseholdVehicle[]>([]);
	let assetDescription = $state('');

	async function handleRegisterHousehold(zone: string) {
		if (isSubmitting || !headData || !addressData) return;

		isSubmitting = true;

		try {
			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'staff'
			};

			// 1. Create Head Evacuee (registered state)
			const headDoc = await createEvacueeMutation.mutateAsync({
				input: headData,
				ctx
			});

			const updatedHeadDoc = await updateEvacueeMutation.mutateAsync({
				...headDoc,
				current_stay: {
					...headDoc.current_stay,
					zone: zone || null
				}
			});
			createdHead = updatedHeadDoc;

			// 2. Create Household (pre_registered state)
			const householdInput = {
				label: householdLabel,
				head_evacuee_id: headDoc._id,
				status: 'pre_registered' as const,
				checkout_destination: null,
				municipality_zone: addressData.municipalityZone || null,
				community: addressData.community || null,
				pets: petsList,
				vehicles: vehicleRows,
				assets: assetDescription.trim()
					? { description: assetDescription.trim(), image_url: null }
					: null,
				notes: '',
				address_no: addressData.addressNo || null,
				village_no: addressData.villageNo || null,
				subdistrict: addressData.subdistrict || null,
				district: addressData.district || null,
				province: addressData.province || null,
				postal_code: addressData.postalCode || null
			};

			const hhDoc = await createHouseholdMutation.mutateAsync({
				input: householdInput,
				ctx
			});

			createdHousehold = hhDoc;

			// 3. Update Head Evacuee with household_id
			const finalHeadDoc = await updateEvacueeMutation.mutateAsync({
				...updatedHeadDoc,
				household_id: hhDoc._id
			});
			createdHead = finalHeadDoc;

			toast.success(`ลงทะเบียนหัวหน้าครัวเรือนและสร้างครัวเรือน "${hhDoc.label}" สำเร็จ`);
			step = 5;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(`เกิดข้อผิดพลาด: ${msg}`);
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>ลงทะเบียนครัวเรือนล่วงหน้า · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-8 md:px-6">
	<!-- Top Navigation -->
	<div class="mb-6">
		<button
			type="button"
			class="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
			onclick={() => goto(resolve('/back-office/evacuee-management?tab=household'))}
		>
			<ArrowLeft class="size-4" />
			<span>กลับหน้ารายการครัวเรือนหลัก</span>
		</button>
		<h2 class="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
			ลงทะเบียนครัวเรือนล่วงหน้า (Household Pre-registration)
		</h2>
	</div>

	<!-- Step Progress Indicator -->
	<div class="mx-auto mb-8 flex max-w-5xl items-start">
		{#each [1, 2, 3, 4, 5] as s (s)}
			<div class="flex flex-1 flex-col items-center gap-2">
				<div class="flex w-full items-center">
					<!-- left connector -->
					<div
						class="h-0.5 flex-1 transition-colors {s === 1
							? 'invisible'
							: step >= s
								? 'bg-green-500'
								: 'bg-border'}"
					></div>
					<!-- circle -->
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors {step ===
						s
							? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
							: step > s
								? 'bg-green-600 text-white'
								: 'bg-muted text-muted-foreground'}"
					>
						{step > s ? '✓' : s}
					</div>
					<!-- right connector -->
					<div
						class="h-0.5 flex-1 transition-colors {s === 5
							? 'invisible'
							: step > s
								? 'bg-green-500'
								: 'bg-border'}"
					></div>
				</div>
				<!-- label below -->
				<span
					class="hidden text-center text-xs leading-tight font-medium sm:block {step === s
						? 'font-semibold text-foreground'
						: step > s
							? 'text-green-700'
							: 'text-muted-foreground'}"
				>
					{s === 1
						? 'ข้อมูลหัวหน้าครัวเรือน'
						: s === 2
							? 'ข้อมูลที่อยู่ครัวเรือน'
							: s === 3
								? 'ทรัพย์สินและสัตว์เลี้ยง'
								: s === 4
									? 'เลือกโซนพักพิง'
									: 'จัดการสมาชิกและ QR Code'}
				</span>
			</div>
		{/each}
	</div>

	<!-- ────────────────── STEP 1: Head info Form ────────────────── -->
	{#if step === 1}
		<HouseholdPreRegisterHead
			initialData={headData}
			onNext={(data) => {
				headData = data;
				step = 2;
			}}
		/>
	{/if}

	<!-- ────────────────── STEP 2: Address info Form ────────────────── -->
	{#if step === 2}
		<HouseholdPreRegisterAddress
			initialData={addressData}
			{householdLabel}
			{municipalityZoneItems}
			{communityItems}
			onBack={() => (step = 1)}
			onNext={(data) => {
				addressData = data;
				step = 3;
			}}
		/>
	{/if}

	<!-- ────────────────── STEP 3: Assets & Pets Form ────────────────── -->
	{#if step === 3}
		<div class="mx-auto w-full max-w-5xl">
			<EvacueePetAssetVehicle
				onBack={() => (step = 2)}
				onNext={(data) => {
					petsList = data.pets;
					assetDescription = data.assetDescription;
					vehicleRows = data.vehicles;
					step = 4;
				}}
			/>
		</div>
	{/if}

	<!-- ────────────────── STEP 4: Zone Selection ────────────────── -->
	{#if step === 4}
		{@const mockHeadEvacuee = {
			special_needs: headData?.special_needs ?? []
		} as unknown as Evacuee}
		<div class="mx-auto max-w-xl">
			<EvacueeSelectZone
				evacuee={mockHeadEvacuee}
				onBack={() => (step = 3)}
				onSubmit={(zone) => {
					handleRegisterHousehold(zone);
				}}
			/>
		</div>
	{/if}

	<!-- ────────────────── STEP 5: Summary & Add Members ────────────────── -->
	{#if step === 5 && createdHousehold}
		<HouseholdPreRegisterSummary {createdHousehold} {createdHead} />
	{/if}
</div>
