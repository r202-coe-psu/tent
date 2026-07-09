<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		useShelter,
		luggageRuleLabels,
		parkingRuleLabels,
		petCategoryLabels,
		petConditionLabels,
		type PetCondition
	} from '$lib/features/shelters/index.js';
	import type { Household, HouseholdVehicle, PetGroup } from '../domain/people';

	let {
		household = null,
		onBack,
		onNext
	}: {
		// When an existing household is selected in step 4, its pets/assets/vehicles
		// are fetched in so the user edits them in place instead of creating over.
		household?: Household | null;
		onBack: () => void;
		onNext: (data: {
			pets: PetGroup[];
			assetDescription: string;
			vehicles: HouseholdVehicle[];
		}) => void;
	} = $props();

	// A household may bring several pets (schema.md §1.3 `pets[]`).
	// `id` is a client-only key for the {#each} — stripped before onNext.
	type PetRow = {
		id: number;
		species: 'dog' | 'cat' | 'bird' | 'other';
		count: number;
		notes: string;
		has_cage: boolean;
	};
	let nextPetId = 0;

	// Prefill from the selected household (edit mode); otherwise start empty (new).
	// The prop is stable for this component's lifetime (mounted fresh at step 5),
	// so this init-only read is intentional — untrack keeps it non-reactive.
	let assetDescription = $state(untrack(() => household?.assets?.description ?? ''));
	let petRows = $state<PetRow[]>(
		untrack(() =>
			(household?.pets ?? []).map((p) => ({
				id: nextPetId++,
				species: p.species,
				count: p.count,
				notes: p.notes ?? '',
				has_cage: p.has_cage ?? false
			}))
		)
	);

	const petSpeciesOptions = [
		{ value: 'dog', label: '🐶 สุนัข' },
		{ value: 'cat', label: '🐱 แมว' },
		{ value: 'bird', label: '🐦 นก' },
		{ value: 'other', label: '🐾 อื่นๆ' }
	] as const;

	function addPet() {
		petRows = [
			...petRows,
			{ id: nextPetId++, species: 'dog', count: 1, notes: '', has_cage: false }
		];
	}

	function removePet(id: number) {
		petRows = petRows.filter((p) => p.id !== id);
	}

	// A household may bring several vehicles (schema.md §1.3 `vehicles[]`, CR-016).
	type VehicleRow = { id: number; type: 'car' | 'motorcycle' | 'other'; license_plate: string };
	let nextVehicleId = 0;
	let vehicleRows = $state<VehicleRow[]>(
		untrack(() =>
			(household?.vehicles ?? []).map((v) => ({
				id: nextVehicleId++,
				type: v.type,
				license_plate: v.license_plate ?? ''
			}))
		)
	);

	const vehicleTypeOptions = [
		{ value: 'car', label: 'รถยนต์' },
		{ value: 'motorcycle', label: 'จักรยานยนต์' },
		{ value: 'other', label: 'อื่นๆ' }
	] as const;

	function addVehicle() {
		vehicleRows = [...vehicleRows, { id: nextVehicleId++, type: 'car', license_plate: '' }];
	}

	function removeVehicle(id: number) {
		vehicleRows = vehicleRows.filter((v) => v.id !== id);
	}

	// Disclaimer text is not free-form — it's read from this shelter's configured
	// luggage_policy / parking_policy / admission_policy.pet_policy (CR-023 Addendum A),
	// so it reflects what the shelter admin actually selected, not a hardcoded list.
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelter = $derived(shelterQuery.data);

	// Generic fallback bullets shown when the shelter hasn't configured a relevant
	// policy yet — so the disclaimer never silently disappears just because CR-023
	// admin setup is incomplete for this shelter.
	const FALLBACK_ASSET_ITEM =
		'ทรัพย์สินมีค่าที่นำติดตัวมา ผู้พักพิงต้องเก็บและรับผิดชอบด้วยตนเอง ศูนย์ไม่รับผิดชอบกรณีสูญหาย';
	const FALLBACK_VEHICLE_ITEM = 'ต้องลงทะเบียนยานพาหนะทุกคัน และจอดในพื้นที่ที่ศูนย์กำหนดเท่านั้น';
	const FALLBACK_PET_ITEM =
		'ต้องดูแลควบคุมสัตว์เลี้ยง (กรง/สายจูง) ตลอดเวลา และรับผิดชอบต่อสัตว์เลี้ยงของตนเอง';

	// Grouped by section — everything the shelter admin actually configured across the
	// three CR-023 policies this step touches (assets/luggage, vehicles/parking, pets),
	// falling back to a generic notice per section when the shelter has nothing configured.
	type DisclaimerGroup = { label: string; items: string[] };
	const disclaimerGroups = $derived.by(() => {
		const groups: DisclaimerGroup[] = [];

		if (assetDescription.trim() || petRows.length > 0 || vehicleRows.length > 0) {
			const items: string[] = [];
			const rules = shelter?.luggage_policy?.rules ?? [];
			for (const rule of rules) items.push(luggageRuleLabels[rule]);
			if (shelter?.luggage_policy?.rules_other) items.push(shelter.luggage_policy.rules_other);
			if (items.length === 0) items.push(FALLBACK_ASSET_ITEM);
			groups.push({ label: '🎒 ทรัพย์สินมีค่า / สัมภาระ', items });
		}

		if (vehicleRows.length > 0) {
			const items: string[] = [];
			const rules = shelter?.parking_policy?.rules ?? [];
			for (const rule of rules) items.push(parkingRuleLabels[rule]);
			if (shelter?.parking_policy?.rules_other) items.push(shelter.parking_policy.rules_other);
			if (items.length === 0) items.push(FALLBACK_VEHICLE_ITEM);
			groups.push({ label: '🚗 ยานพาหนะ', items });
		}

		if (petRows.length > 0) {
			const items: string[] = [];
			const petPolicy = shelter?.admission_policy?.pet_policy;
			if (petPolicy?.policy === 'no_pets') {
				items.push('ศูนย์นี้ไม่อนุญาตให้นำสัตว์เลี้ยงเข้าพัก (No Pets Allowed)');
			} else {
				const categories = petPolicy?.categories ?? [];
				for (const entry of categories) {
					items.push(petCategoryLabels[entry.category]);
					for (const cond of entry.conditions ?? []) {
						items.push(petConditionLabels[cond as PetCondition]);
					}
					if (entry.other) items.push(entry.other);
				}
				if (categories.length === 0) items.push(FALLBACK_PET_ITEM);
			}
			groups.push({ label: '🐶 สัตว์เลี้ยง', items });
		}

		return groups;
	});

	let disclaimerAcknowledged = $state(false);
	const disclaimerRequired = $derived(disclaimerGroups.length > 0);
</script>

<div class="space-y-4">
	<!-- Header Card -->
	<div class="flex items-center gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
		<div
			class="flex h-10 w-10 items-center justify-center rounded-full bg-[#e2e8f0] text-lg font-bold text-slate-700"
		>
			4
		</div>
		<div>
			<h2 class="text-lg font-bold">ทรัพย์สินและสัตว์เลี้ยง (Assets & Pets)</h2>
			<p class="text-sm text-muted-foreground">
				บันทึกข้อมูลสัมภาระ ยานพาหนะ สัตว์เลี้ยง และสถานะบ้าน
			</p>
		</div>
	</div>

	<!-- Form Content -->
	<div class="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
		<!-- Pets Section — a household may bring several -->
		<div class="space-y-3 rounded-lg border bg-muted/20 p-4">
			<div class="flex items-center justify-between gap-2">
				<div class="flex items-center gap-1 text-sm font-semibold">🐶 สัตว์เลี้ยงที่นำมาด้วย</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="h-8 shrink-0 bg-background"
					onclick={addPet}
				>
					<Plus class="mr-1 h-3.5 w-3.5" /> เพิ่มสัตว์เลี้ยง
				</Button>
			</div>

			{#if petRows.length === 0}
				<p class="text-xs text-muted-foreground">
					ยังไม่มีสัตว์เลี้ยง — กด "เพิ่มสัตว์เลี้ยง" เพื่อเพิ่มรายการ
				</p>
			{:else}
				<div class="space-y-2">
					{#each petRows as pet (pet.id)}
						<div class="flex items-end gap-2 rounded-lg border bg-muted/20 p-3">
							<div class="w-[110px] shrink-0 space-y-1">
								<Label class="text-[10px] text-muted-foreground">ชนิดสัตว์</Label>
								<Select.Root type="single" bind:value={pet.species}>
									<Select.Trigger class="h-9 w-full bg-background text-sm">
										{petSpeciesOptions.find((o) => o.value === pet.species)?.label ?? 'ชนิด'}
									</Select.Trigger>
									<Select.Content>
										{#each petSpeciesOptions as opt (opt.value)}
											<Select.Item value={opt.value} label={opt.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="w-[72px] shrink-0 space-y-1">
								<Label class="text-[10px] text-muted-foreground">จำนวน</Label>
								<Input
									type="number"
									min={1}
									class="h-9 bg-background text-sm"
									bind:value={pet.count}
								/>
							</div>
							<div class="flex-1 space-y-1">
								<Label class="text-[10px] text-muted-foreground">หมายเหตุ</Label>
								<Input
									class="h-9 bg-background text-sm"
									bind:value={pet.notes}
									placeholder="เช่น พันธุ์ / สี"
								/>
							</div>
							<div
								class="flex h-9 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3"
							>
								<Checkbox
									id="pet_cage_{pet.id}"
									checked={pet.has_cage}
									onCheckedChange={(v) => (pet.has_cage = !!v)}
								/>
								<label for="pet_cage_{pet.id}" class="cursor-pointer text-xs whitespace-nowrap">
									มีกรง
								</label>
							</div>
							<Button
								type="button"
								variant="outline"
								size="icon"
								class="h-9 w-9 shrink-0 bg-background"
								onclick={() => removePet(pet.id)}
							>
								<X class="h-4 w-4 text-muted-foreground" />
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Assets Section -->
		<div class="space-y-3 rounded-lg border bg-muted/20 p-4">
			<div class="flex items-center gap-1 text-sm font-semibold">🎒 ทรัพย์สินมีค่า / สัมภาระ</div>
			<div class="flex items-center gap-2">
				<Input
					bind:value={assetDescription}
					placeholder="รายละเอียดทรัพย์สิน/สัมภาระ"
					class="flex-1 bg-background"
				/>
			</div>
		</div>

		<!-- Vehicles Section -->
		<div class="space-y-3 rounded-lg border bg-muted/20 p-4">
			<div class="flex items-center justify-between gap-2">
				<div class="flex items-center gap-1 text-sm font-semibold">🚗 ยานพาหนะ</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="h-8 shrink-0 bg-background"
					onclick={addVehicle}
				>
					<Plus class="mr-1 h-3.5 w-3.5" /> เพิ่มคัน
				</Button>
			</div>

			{#if vehicleRows.length === 0}
				<p class="text-xs text-muted-foreground">
					ยังไม่มียานพาหนะ — กด "เพิ่มคัน" เพื่อเพิ่มรายการ
				</p>
			{:else}
				<div class="space-y-2">
					{#each vehicleRows as vehicle (vehicle.id)}
						<div class="flex items-center gap-2">
							<Select.Root type="single" bind:value={vehicle.type}>
								<Select.Trigger class="w-[120px] shrink-0 bg-background">
									{vehicleTypeOptions.find((o) => o.value === vehicle.type)?.label ?? 'ประเภท'}
								</Select.Trigger>
								<Select.Content>
									{#each vehicleTypeOptions as opt (opt.value)}
										<Select.Item value={opt.value} label={opt.label} />
									{/each}
								</Select.Content>
							</Select.Root>
							<Input
								bind:value={vehicle.license_plate}
								placeholder="ทะเบียนรถ"
								class="flex-1 bg-background"
							/>
							<Button
								type="button"
								variant="outline"
								size="icon"
								class="h-10 w-10 shrink-0 bg-background"
								onclick={() => removeVehicle(vehicle.id)}
							>
								<X class="h-4 w-4 text-muted-foreground" />
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	{#if disclaimerRequired}
		<!-- Shelter Disclaimer — sourced from this shelter's configured policies -->
		<div class="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
			<div class="flex items-center gap-2">
				<ShieldAlert class="h-5 w-5 text-amber-600" />
				<h3 class="text-sm font-bold text-amber-800">
					ข้อตกลงและเงื่อนไขของศูนย์พักพิง (Disclaimer)
				</h3>
			</div>
			<div class="space-y-3">
				{#each disclaimerGroups as group (group.label)}
					<div>
						<h4 class="mb-1 text-sm font-semibold text-amber-800">{group.label}</h4>
						<ul class="list-disc space-y-1 pl-6 text-sm text-amber-900">
							{#each group.items as item (item)}
								<li>{item}</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
			<label class="flex items-start gap-2 pt-1 text-sm">
				<Checkbox
					checked={disclaimerAcknowledged}
					onCheckedChange={(v) => (disclaimerAcknowledged = v === true)}
				/>
				<span class="font-bold text-amber-900">
					ข้าพเจ้าและครอบครัวรับทราบและยินยอมปฏิบัติตามกฎระเบียบของศูนย์พักพิง
					รวมถึงรับผิดชอบต่อทรัพย์สินมีค่าของตนเองหากเกิดการสูญหาย
				</span>
			</label>
		</div>
	{/if}

	<!-- Bottom Actions -->
	<div class="flex items-center justify-between rounded-xl border bg-card p-6 shadow-sm">
		<Button
			type="button"
			variant="outline"
			class="h-12 w-[48%] text-base font-medium"
			onclick={onBack}
		>
			ย้อนกลับ
		</Button>
		<Button
			type="button"
			disabled={disclaimerRequired && !disclaimerAcknowledged}
			class="h-12 w-[48%] bg-[#003B71] text-base font-medium hover:bg-[#002a50]"
			onclick={() =>
				onNext({
					pets: petRows.map((p) => ({
						species: p.species,
						count: Number(p.count) || 1,
						notes: p.notes.trim() || undefined,
						has_cage: p.has_cage
					})),
					assetDescription,
					vehicles: vehicleRows.map((v) => ({
						type: v.type,
						license_plate: v.license_plate.trim() || null
					}))
				})}
		>
			ลงทะเบียนสำเร็จ
		</Button>
	</div>
</div>
