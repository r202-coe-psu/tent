<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type {
		EvacueeInput,
		HouseholdInput,
		HouseholdAsset,
		Evacuee,
		Household,
		PetGroup
	} from '../domain/people';
	import SearchSection from './evacuee-search.svelte';
	import EwarSymptomSection from './evacuee-ewar-symptom.svelte';
	import RegistrationSection from './evacuee-registration.svelte';
	import HouseholdRegisterForm from './household-register-form.svelte';
	import EvacueePetAssetVehicle from './evacuee-pet-asset-vehicle.svelte';
	import EvacueeSelectZone from './evacuee-select-zone.svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		useEvacuees,
		useHouseholds,
		useCreateHousehold,
		useUpdateHousehold,
		useUpdateEvacuee,
		useCheckInEvacuee,
		peopleRepository
	} from '../index';
	import { getShelterCode } from '$lib/db/shelter';

	let {
		onsubmit,
		pending = false,
		step = $bindable(1),
		onComplete
	}: {
		onsubmit: (input: EvacueeInput, symptoms: string[]) => Promise<Evacuee> | Evacuee;
		pending?: boolean;
		step?: 1 | 2 | 3 | 4 | 5 | 6;
		onComplete?: (evacuee: Evacuee) => void;
	} = $props();

	const selectedSymptoms = new SvelteSet<string>();
	let isHealthy = $state(false);
	let newlyRegisteredEvacuee = $state<Evacuee | null>(null);
	let isSubmittingEvacuee = $state(false);
	let isSubmittingHousehold = $state(false);

	let pendingEvacueeInput = $state<EvacueeInput | null>(null);
	let pendingSymptoms = $state<string[]>([]);

	let selectedHousehold = $state<Household | null>(null);
	let isCreatingNewHousehold = $state(false);
	let newHouseholdAddress = $state<Partial<HouseholdInput> | null>(null);

	let tempEvacuee = $derived.by((): Evacuee | null => {
		if (!pendingEvacueeInput) return null;
		return {
			_id: 'temp-new-evacuee',
			...pendingEvacueeInput,
			current_stay: {
				status: 'active',
				zone: null
			}
		} as Evacuee;
	});

	let combinedEvacuees = $derived.by(() => {
		const list = evacueesQuery.data ? [...evacueesQuery.data] : [];
		if (tempEvacuee) {
			list.push(tempEvacuee);
		}
		return list;
	});

	// Fetch data for HouseholdRegisterForm
	const evacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();

	const createHouseholdMutation = useCreateHousehold();
	const updateHouseholdMutation = useUpdateHousehold();
	const updateEvacueeMutation = useUpdateEvacuee();
	const checkInMutation = useCheckInEvacuee();

	function handleRegistrationSubmit(input: EvacueeInput) {
		pendingEvacueeInput = input;
		pendingSymptoms = Array.from(selectedSymptoms);
		selectedSymptoms.clear();
		isHealthy = false;
		step = 4;
	}

	function handleHouseholdSelect(household: Household) {
		selectedHousehold = household;
		isCreatingNewHousehold = false;
		newHouseholdAddress = null;
	}

	function handleHouseholdRegisterSubmit(addressInput: Partial<HouseholdInput>) {
		newHouseholdAddress = addressInput;
		isCreatingNewHousehold = true;
		selectedHousehold = null;
		step = 5;
	}

	async function handleFinalSubmit(petAssetVehicleData: {
		pets: PetGroup[];
		assetDescription: string;
		vehicles: { type: 'car' | 'motorcycle' | 'other'; license_plate: string | null }[];
	}) {
		if (isSubmittingHousehold) return;
		isSubmittingHousehold = true;

		try {
			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			};

			// 1. Register evacuee
			let registeredEvacuee = newlyRegisteredEvacuee;
			if (pendingEvacueeInput) {
				registeredEvacuee = await onsubmit(pendingEvacueeInput, pendingSymptoms);
				newlyRegisteredEvacuee = registeredEvacuee;
				pendingEvacueeInput = null;
				pendingSymptoms = [];
			}

			if (!registeredEvacuee) {
				throw new Error('ไม่พบข้อมูลผู้ประสบภัยที่กำลังลงทะเบียน');
			}

			// 2. Map pets — a household may bring several (schema pets[])
			const pets = petAssetVehicleData.pets.filter((p) => p.count > 0);

			// 3. Map assets
			let assets: HouseholdAsset | null = null;
			if (petAssetVehicleData.assetDescription) {
				assets = {
					description: petAssetVehicleData.assetDescription,
					image_url: null
				};
			}

			// 4. Map vehicles (household may bring several — schema vehicles[])
			const vehicles = petAssetVehicleData.vehicles.map((v) => ({
				type: v.type,
				license_plate: v.license_plate?.trim() || null
			}));

			let householdId: string | null = null;

			// 5. Create or Join household
			if (selectedHousehold) {
				householdId = selectedHousehold._id;

				const latestHousehold = await peopleRepository().getHousehold(selectedHousehold._id);
				if (!latestHousehold) throw new Error('ไม่พบครัวเรือนในระบบ');

				// Edit in place: the step 5 form was prefilled with the household's existing
				// pets/assets/vehicles, so the submitted data is the full edited set — replace,
				// don't append (which would duplicate the prefilled entries).
				await updateHouseholdMutation.mutateAsync({
					...latestHousehold,
					label: latestHousehold.label || `ครอบครัวผู้ประสบภัย ${latestHousehold._id}`,
					pets,
					assets,
					vehicles
				});
			} else if (isCreatingNewHousehold || pets.length > 0 || assets || vehicles.length > 0) {
				const addr = newHouseholdAddress || {};
				const householdLabel = `ครอบครัว${registeredEvacuee.first_name} ${registeredEvacuee.last_name}`;

				const householdInput: HouseholdInput = {
					label: householdLabel,
					head_evacuee_id: registeredEvacuee._id,
					municipality_zone: null,
					community: null,
					pets: pets,
					assets: assets,
					vehicles: vehicles,
					notes: '',
					address_no: addr.address_no || null,
					village_no: addr.village_no || null,
					subdistrict: addr.subdistrict || null,
					district: addr.district || null,
					province: addr.province || null,
					postal_code: addr.postal_code || null
				};

				const res = await createHouseholdMutation.mutateAsync({ input: householdInput, ctx });
				householdId = res._id;
			}

			// 6. Link evacuee to household
			if (householdId) {
				const updated = await updateEvacueeMutation.mutateAsync({
					...registeredEvacuee,
					household_id: householdId
				});
				newlyRegisteredEvacuee = updated;
				toast.success('ลงทะเบียนผู้ประสบภัยและครัวเรือนสำเร็จ');
			} else {
				toast.success('ลงทะเบียนผู้ประสบภัยสำเร็จ');
			}

			// Go to step 6 (Zoning)
			step = 6;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error(`เกิดข้อผิดพลาดในการบันทึก: ${message}`);
		} finally {
			isSubmittingHousehold = false;
		}
	}

	async function handleZoneSubmit(zone: string) {
		if (!newlyRegisteredEvacuee) {
			toast.error('ไม่พบข้อมูลผู้ประสบภัยที่กำลังคัดแยก');
			return;
		}

		try {
			// Fetch the latest evacuee document to avoid CouchDB MVCC revision conflicts
			const latestEvacuee = await peopleRepository().getEvacuee(newlyRegisteredEvacuee._id);
			if (!latestEvacuee) {
				toast.error('ไม่พบข้อมูลผู้ประสบภัยในระบบ');
				return;
			}

			// Check-in writes an append-only movement first, then applies current_stay —
			// occupancy views and movement history depend on the movement stream
			// (current_stay is only a snapshot, schema.md §1.1).
			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			};
			const finishedEvacuee = await checkInMutation.mutateAsync({
				evacuee: latestEvacuee,
				ctx,
				zone
			});
			toast.success('บันทึกข้อมูลและจัดสรรพื้นที่สำเร็จ');

			// Reset internal state
			step = 1;
			newlyRegisteredEvacuee = null;
			selectedHousehold = null;
			isCreatingNewHousehold = false;
			newHouseholdAddress = null;

			// Notify parent to show the success/wristband screen
			onComplete?.(finishedEvacuee);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error(`เกิดข้อผิดพลาดในการจัดสรรพื้นที่: ${message}`);
		}
	}
</script>

<!-- ── Step wizard indicator ───────────────────────────────────────────────────── -->
{#snippet stepLabel(s: number)}
	{s === 1
		? 'ตรวจสอบประวัติ'
		: s === 2
			? 'ประเมินอาการ'
			: s === 3
				? 'ข้อมูลผู้ประสบภัย'
				: s === 4
					? 'ข้อมูลครัวเรือน'
					: s === 5
						? 'ทรัพย์สินและสัตว์เลี้ยง'
						: 'จัดสรรพื้นที่'}
{/snippet}

<div class="mb-8 flex items-start">
	{#each [1, 2, 3, 4, 5, 6] as s (s)}
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
					class="h-0.5 flex-1 transition-colors {s === 6
						? 'invisible'
						: step > s
							? 'bg-green-500'
							: 'bg-border'}"
				></div>
			</div>
			<!-- label below -->
			<span
				class="hidden text-center text-xs leading-tight font-medium sm:block {step === s
					? 'text-foreground'
					: step > s
						? 'text-green-700'
						: 'text-muted-foreground'}"
			>
				{@render stepLabel(s)}
			</span>
		</div>
	{/each}
</div>

{#if step === 1}
	<SearchSection onNext={() => (step = 2)} />
{:else if step === 2}
	<EwarSymptomSection
		bind:isHealthy
		{selectedSymptoms}
		onBack={() => (step = 1)}
		onNext={() => (step = 3)}
	/>
{:else if step === 3}
	<RegistrationSection
		onsubmit={handleRegistrationSubmit}
		pending={isSubmittingEvacuee || pending}
		onBack={() => (step = 2)}
		hasSymptomsSelected={selectedSymptoms.size > 0}
	/>
{:else if step === 4}
	<div class="space-y-6">
		<HouseholdRegisterForm
			allEvacuees={combinedEvacuees}
			households={householdsQuery.data ?? []}
			onsubmit={handleHouseholdRegisterSubmit}
			onselect={handleHouseholdSelect}
			pending={isSubmittingHousehold}
			bind:showNewHouseholdForm={isCreatingNewHousehold}
		/>
		<div class="flex items-center justify-between border-t border-border pt-6">
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					step = 3;
				}}
				class="h-10 gap-1 px-6 py-2 text-sm font-medium"
			>
				ย้อนกลับ
			</Button>
			{#if !isCreatingNewHousehold}
				<Button
					type="button"
					class="h-10 bg-[#003B71] px-6 text-sm font-medium hover:bg-[#002a50]"
					onclick={() => {
						step = 5;
					}}
				>
					{selectedHousehold ? 'ถัดไป ⏩' : 'ข้าม / ถัดไป'}
				</Button>
			{/if}
		</div>
	</div>
{:else if step === 5}
	<EvacueePetAssetVehicle
		household={selectedHousehold}
		onBack={() => (step = 4)}
		onNext={handleFinalSubmit}
	/>
{:else if step === 6}
	<EvacueeSelectZone
		evacuee={newlyRegisteredEvacuee}
		onBack={() => (step = 5)}
		onSubmit={handleZoneSubmit}
	/>
{/if}
