<script lang="ts">
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { Household, PetGroup } from '$lib/features/people';

	let {
		show,
		household,
		onClose,
		onSave
	}: {
		show: boolean;
		household: Household;
		onClose: () => void;
		onSave: (data: {
			vehicleType: string;
			licensePlate: string;
			valuables: string;
			pets: PetGroup[];
		}) => Promise<void>;
	} = $props();

	let vehicleType = $state(untrack(() => household.vehicle?.type ?? 'none'));
	let licensePlate = $state(untrack(() => household.vehicle?.license_plate ?? ''));
	let valuables = $state(untrack(() => household.assets?.description ?? ''));
	let petsList = $state<PetGroup[]>(
		untrack(() => (household.pets ? JSON.parse(JSON.stringify(household.pets)) : []))
	);

	function addPetRow() {
		petsList = [...petsList, { species: 'dog', count: 1, notes: '', has_cage: false }];
	}

	function removePetRow(index: number) {
		petsList = petsList.filter((_, i) => i !== index);
	}
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-xl animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					แก้ไขทรัพย์สินและสัตว์เลี้ยง (Assets &amp; Pets)
				</h3>
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="max-h-[400px] space-y-4 overflow-y-auto pr-1">
				<!-- Vehicle -->
				<div class="space-y-2 border-b border-border/50 pb-4">
					<h4 class="text-sm font-bold text-slate-800 dark:text-slate-200">ข้อมูลยานพาหนะ</h4>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-1.5">
							<Label for="vehicle_type">ประเภทยานพาหนะ</Label>
							<Select.Root type="single" bind:value={vehicleType}>
								<Select.Trigger id="vehicle_type" class="h-9 w-full">
									{{ none: 'ไม่มี', car: 'รถยนต์', motorcycle: 'รถจักรยานยนต์', other: 'อื่นๆ' }[
										vehicleType
									] ?? '— เลือก —'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="none" label="ไม่มี" />
									<Select.Item value="car" label="รถยนต์" />
									<Select.Item value="motorcycle" label="รถจักรยานยนต์" />
									<Select.Item value="other" label="อื่นๆ" />
								</Select.Content>
							</Select.Root>
						</div>
						{#if vehicleType !== 'none'}
							<div class="space-y-1.5">
								<Label for="license_plate">เลขทะเบียนรถ</Label>
								<Input
									id="license_plate"
									bind:value={licensePlate}
									placeholder="เช่น กง 4567 สงขลา"
								/>
							</div>
						{/if}
					</div>
				</div>

				<!-- Assets / Valuables -->
				<div class="space-y-1.5 border-b border-border/50 pb-4">
					<Label for="valuables" class="text-sm font-bold">สัมภาระและสิ่งของมีค่า</Label>
					<textarea
						id="valuables"
						rows="2"
						class="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
						bind:value={valuables}
						placeholder="เช่น กระเป๋าเดินทาง 2 ใบ, คอมพิวเตอร์โน้ตบุ๊ก 1 เครื่อง"
					></textarea>
				</div>

				<!-- Pets -->
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<h4 class="text-sm font-bold text-slate-800 dark:text-slate-200">
							สัตว์เลี้ยงที่นำมาด้วย
						</h4>
						<button
							onclick={addPetRow}
							class="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-primary hover:underline"
						>
							<Plus class="size-3.5" />
							<span>เพิ่มชนิดสัตว์เลี้ยง</span>
						</button>
					</div>

					{#if petsList.length === 0}
						<p
							class="rounded-xl bg-slate-50 py-4 text-center text-xs text-muted-foreground italic dark:bg-slate-900"
						>
							ไม่มีสัตว์เลี้ยงที่ลงทะเบียนไว้
						</p>
					{:else}
						<div class="space-y-2.5">
							{#each petsList as pet, i (i)}
								<div
									class="flex items-end gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
								>
									<div class="grid flex-1 grid-cols-2 gap-3 md:grid-cols-4">
										<div class="space-y-1">
											<Label for="pet_species_{i}" class="text-[10px]">ชนิดสัตว์</Label>
											<Select.Root type="single" bind:value={pet.species}>
												<Select.Trigger id="pet_species_{i}" class="h-8 text-xs">
													{{ dog: '🐶 สุนัข', cat: '🐱 แมว', bird: '🐦 นก', other: '🐾 อื่นๆ' }[
														pet.species
													]}
												</Select.Trigger>
												<Select.Content>
													<Select.Item value="dog" label="🐶 สุนัข" />
													<Select.Item value="cat" label="🐱 แมว" />
													<Select.Item value="bird" label="🐦 นก" />
													<Select.Item value="other" label="🐾 อื่นๆ" />
												</Select.Content>
											</Select.Root>
										</div>
										<div class="space-y-1">
											<Label for="pet_count_{i}" class="text-[10px]">จำนวน (ตัว)</Label>
											<Input
												id="pet_count_{i}"
												type="number"
												min={1}
												class="h-8 text-xs"
												bind:value={pet.count}
											/>
										</div>
										<div class="space-y-1">
											<Label for="pet_notes_{i}" class="text-[10px]">หมายเหตุ</Label>
											<Input
												id="pet_notes_{i}"
												class="h-8 text-xs"
												bind:value={pet.notes}
												placeholder="หมายเหตุ"
											/>
										</div>
										<div class="flex flex-col justify-end space-y-1 pb-1">
											<div class="flex items-center gap-1.5">
												<Checkbox
													id="pet_cage_{i}"
													checked={pet.has_cage ?? false}
													onCheckedChange={(v) => (pet.has_cage = !!v)}
												/>
												<Label for="pet_cage_{i}" class="cursor-pointer text-[10px]">มีกรง</Label>
											</div>
										</div>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										onclick={() => removePetRow(i)}
										class="size-8 shrink-0 text-destructive hover:bg-destructive/10"
									>
										<X class="size-4" />
									</Button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-4">
				<Button variant="outline" onclick={onClose}>ยกเลิก</Button>
				<Button onclick={() => onSave({ vehicleType, licensePlate, valuables, pets: petsList })}>
					บันทึกข้อมูล
				</Button>
			</div>
		</div>
	</div>
{/if}
