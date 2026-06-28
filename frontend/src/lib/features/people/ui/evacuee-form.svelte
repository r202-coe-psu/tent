<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { EvacueeInput, HouseholdInput } from '../domain/people';
	import SearchSection from './evacuee-search.svelte';
	import EwarSymptomSection from './evacuee-ewar-symptom.svelte';
	import RegistrationSection from './evacuee-registration.svelte';
	import HouseholdRegisterForm from './household-register-form.svelte';
	import EvacueePetAssetVehicle from './evacuee-pet-asset-vehicle.svelte';
	import EvacueeSelectZone from './evacuee-select-zone.svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		useEvacuees,
		useHouseholds,
		useCreateHousehold,
		useUpdateEvacuee,
		peopleRepository,
		SHELTER_CODE
	} from '../index';

	let {
		onsubmit,
		pending = false,
		step = $bindable(1)
	}: {
		onsubmit: (input: EvacueeInput, symptoms: string[]) => Promise<any> | any;
		pending?: boolean;
		step?: 1 | 2 | 3 | 4 | 5 | 6;
	} = $props();

	const selectedSymptoms = new SvelteSet<string>();
	let isHealthy = $state(false);
	let newlyRegisteredEvacuee = $state<any>(null);
	let isSubmittingEvacuee = $state(false);
	let isSubmittingHousehold = $state(false);

	let pendingEvacueeInput = $state<EvacueeInput | null>(null);
	let pendingSymptoms = $state<string[]>([]);

	let selectedHousehold = $state<any>(null);
	let isCreatingNewHousehold = $state(false);
	let newHouseholdAddress = $state<Partial<HouseholdInput> | null>(null);

	let tempEvacuee = $derived.by(() => {
		if (!pendingEvacueeInput) return null;
		return {
			_id: 'temp-new-evacuee',
			...pendingEvacueeInput,
			current_stay: {
				status: 'checked_in',
				zone: null
			}
		} as any;
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
	const updateEvacueeMutation = useUpdateEvacuee();

	function handleRegistrationSubmit(input: EvacueeInput) {
		pendingEvacueeInput = input;
		pendingSymptoms = Array.from(selectedSymptoms);
		selectedSymptoms.clear();
		isHealthy = false;
		step = 4;
	}

	function handleHouseholdSelect(household: any) {
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

	function handleHouseholdCancel() {
		step = 1;
		newlyRegisteredEvacuee = null;
		pendingEvacueeInput = null;
		pendingSymptoms = [];
		selectedHousehold = null;
		isCreatingNewHousehold = false;
		newHouseholdAddress = null;
	}

	async function handleFinalSubmit(petAssetVehicleData: {
		hasPets: boolean;
		petDescription: string;
		hasCage: boolean;
		petImageUrl: string | null;
		assetDescription: string;
		vehicleType: string;
		licensePlate: string;
	}) {
		if (isSubmittingHousehold) return;
		isSubmittingHousehold = true;

		try {
			const ctx = {
				shelterCode: shelterStore.selectedShelterCode ?? SHELTER_CODE,
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

			// 2. Map pets
			const pets: any[] = [];
			if (petAssetVehicleData.hasPets && petAssetVehicleData.petDescription) {
				const desc = petAssetVehicleData.petDescription.toLowerCase();
				let species: 'dog' | 'cat' | 'bird' | 'other' = 'other';
				if (desc.includes('dog') || desc.includes('หมา') || desc.includes('สุนัข')) {
					species = 'dog';
				} else if (desc.includes('cat') || desc.includes('แมว')) {
					species = 'cat';
				} else if (desc.includes('bird') || desc.includes('นก')) {
					species = 'bird';
				}

				pets.push({
					species,
					count: 1,
					notes: petAssetVehicleData.petDescription,
					has_cage: petAssetVehicleData.hasCage,
					image_url: petAssetVehicleData.petImageUrl
				});
			}

			// 3. Map assets
			let assets: any = null;
			if (petAssetVehicleData.assetDescription) {
				assets = {
					description: petAssetVehicleData.assetDescription,
					image_url: null
				};
			}

			// 4. Map vehicle
			let vehicle: any = null;
			if (petAssetVehicleData.vehicleType) {
				let type: 'car' | 'motorcycle' | 'other' = 'other';
				if (petAssetVehicleData.vehicleType === 'รถยนต์') {
					type = 'car';
				} else if (petAssetVehicleData.vehicleType === 'จักรยานยนต์') {
					type = 'motorcycle';
				}
				vehicle = {
					type,
					license_plate: petAssetVehicleData.licensePlate || null
				};
			}

			let householdId: string | null = null;

			// 5. Create or Join household
			if (selectedHousehold) {
				householdId = selectedHousehold._id;
				
				// Append new pets if any
				let updatedPets = [...(selectedHousehold.pets || [])];
				if (pets.length > 0) {
					updatedPets.push(...pets);
				}

				await peopleRepository().updateHousehold({
					...selectedHousehold,
					label: selectedHousehold.label || `ครอบครัวผู้ประสบภัย ${selectedHousehold._id}`,
					pets: updatedPets,
					assets: assets || selectedHousehold.assets || null,
					vehicle: vehicle || selectedHousehold.vehicle || null
				});
			} else if (isCreatingNewHousehold || pets.length > 0 || assets || vehicle) {
				const addr = newHouseholdAddress || {};
				const householdLabel = `ครอบครัว${registeredEvacuee.first_name} ${registeredEvacuee.last_name}`;
				
				const householdInput: any = {
					label: householdLabel,
					head_evacuee_id: registeredEvacuee._id,
					municipality_zone: null,
					community: null,
					pets: pets,
					assets: assets,
					vehicle: vehicle,
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
		} catch (err: any) {
			toast.error(`เกิดข้อผิดพลาดในการบันทึก: ${err.message || err}`);
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

			await updateEvacueeMutation.mutateAsync({
				...latestEvacuee,
				current_stay: {
					status: 'checked_in',
					zone: zone,
					since: new Date().toISOString()
				}
			});
			toast.success('บันทึกข้อมูลและจัดสรรพื้นที่สำเร็จ');
			
			// Reset and go back to step 1
			step = 1;
			newlyRegisteredEvacuee = null;
			selectedHousehold = null;
			isCreatingNewHousehold = false;
			newHouseholdAddress = null;
		} catch (err: any) {
			toast.error(`เกิดข้อผิดพลาดในการจัดสรรพื้นที่: ${err.message || err}`);
		}
	}
</script>

<!-- ── Step indicator ─────────────────────────────────────────────────────────── -->
<div class="mb-6 flex items-center gap-3">
	{#each [1, 2, 3, 4, 5, 6] as s (s)}
		<div class="flex items-center gap-2">
			<div
				class="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition-colors {step ===
				s
					? 'bg-primary text-primary-foreground'
					: step > s
						? 'bg-green-600 text-white'
						: 'bg-muted text-muted-foreground'}"
			>
				{step > s ? '✓' : s}
			</div>
			<span class="text-sm font-medium {step === s ? 'text-foreground' : 'text-muted-foreground'}">
				{s === 1 ? 'ตรวจสอบประวัติ' : s === 2 ? 'ประเมินอาการ (EWAR)' : s === 3 ? 'ข้อมูลผู้ประสบภัย' : s === 4 ? 'ข้อมูลครัวเรือน' : s === 5 ? 'ทรัพย์สินและสัตว์เลี้ยง' : 'จัดสรรพื้นที่ (Zoning)'}
			</span>
		</div>
		{#if s < 6}
			<div class="h-px flex-1 bg-border hidden sm:block"></div>
		{/if}
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
		<div class="flex justify-between items-center border-t border-border pt-6">
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
					class="h-10 px-6 text-sm font-medium bg-[#003B71] hover:bg-[#002a50]"
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
