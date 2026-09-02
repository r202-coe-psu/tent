<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { HouseholdVehicle, PetGroup } from '$lib/features/people';

	let {
		vehicles = $bindable<HouseholdVehicle[]>([]),
		valuables = $bindable<string>(''),
		pets = $bindable<PetGroup[]>([]),
		disabled = false
	}: {
		vehicles?: HouseholdVehicle[];
		valuables?: string;
		pets?: PetGroup[];
		disabled?: boolean;
	} = $props();

	const vehicleTypeOptions = [
		{ value: 'car' as const, label: 'รถยนต์' },
		{ value: 'motorcycle' as const, label: 'รถจักรยานยนต์' },
		{ value: 'other' as const, label: 'อื่นๆ' }
	];

	const petSpeciesOptions = [
		{ value: 'dog' as const, label: 'สุนัข' },
		{ value: 'cat' as const, label: 'แมว' },
		{ value: 'bird' as const, label: 'นก' },
		{ value: 'other' as const, label: 'อื่นๆ' }
	];

	function addVehicle() {
		if (disabled) return;
		vehicles = [...vehicles, { type: 'car', license_plate: '' }];
	}

	function removeVehicle(index: number) {
		if (disabled) return;
		vehicles = vehicles.filter((_, i) => i !== index);
	}

	function addPet() {
		if (disabled) return;
		pets = [...pets, { species: 'dog', count: 1, notes: '', has_cage: false }];
	}

	function removePet(index: number) {
		if (disabled) return;
		pets = pets.filter((_, i) => i !== index);
	}
</script>

<div class="space-y-6">
	<!-- Vehicles Section -->
	<div class="space-y-3">
		<div class="flex items-center justify-between border-b border-border pb-2">
			<div>
				<h4 class="text-sm font-semibold text-foreground">ข้อมูลยานพาหนะ (Vehicles)</h4>
				<p class="text-xs text-muted-foreground">ยานพาหนะที่นำมายังศูนย์พักพิง</p>
			</div>
			{#if !disabled}
				<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={addVehicle}
					class="h-8 gap-1 text-xs text-primary"
				>
					<Plus class="size-3.5" /> เพิ่มคัน
				</Button>
			{/if}
		</div>

		{#if vehicles.length === 0}
			<p
				class="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground"
			>
				ไม่มียานพาหนะที่ลงทะเบียนไว้
			</p>
		{:else}
			<div class="space-y-2.5">
				{#each vehicles as vehicle, index (index)}
					<div class="flex items-end gap-2.5 rounded-lg border border-border/80 bg-muted/20 p-2.5">
						<div class="w-[140px] shrink-0 space-y-1">
							<Label class="text-2xs text-muted-foreground">ประเภทยานพาหนะ</Label>
							<Select.Root
								type="single"
								value={vehicle.type}
								onValueChange={(val) => {
									if (val === 'car' || val === 'motorcycle' || val === 'other') {
										vehicle.type = val;
									}
								}}
								{disabled}
							>
								<Select.Trigger class="!h-8 w-full rounded-md text-xs">
									{vehicleTypeOptions.find((o) => o.value === vehicle.type)?.label ?? 'เลือกประเภท'}
								</Select.Trigger>
								<Select.Content>
									{#each vehicleTypeOptions as opt (opt.value)}
										<Select.Item value={opt.value} label={opt.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>

						<div class="flex-1 space-y-1">
							<Label class="text-2xs text-muted-foreground">เลขทะเบียนรถ</Label>
							<Input
								bind:value={vehicle.license_plate}
								{disabled}
								placeholder="เช่น กง 4567 สงขลา"
								class="h-8 text-xs"
							/>
						</div>

						{#if !disabled}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onclick={() => removeVehicle(index)}
								class="size-8 shrink-0 text-destructive hover:bg-destructive/10"
								aria-label="ลบยานพาหนะ"
							>
								<X class="size-4" />
							</Button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Valuables / Assets Section -->
	<div class="space-y-2 border-t border-border pt-4">
		<Label for="valuables-desc" class="text-sm font-semibold text-foreground">
			สัมภาระและสิ่งของมีค่า (Assets & Valuables)
		</Label>
		<Textarea
			id="valuables-desc"
			bind:value={valuables}
			{disabled}
			rows={2}
			placeholder="เช่น กระเป๋าเดินทาง 2 ใบ, คอมพิวเตอร์โน้ตบุ๊ก 1 เครื่อง, อุปกรณ์การแพทย์ส่วนตัว"
			class="text-xs"
		/>
	</div>

	<!-- Pets Section -->
	<div class="space-y-3 border-t border-border pt-4">
		<div class="flex items-center justify-between border-b border-border pb-2">
			<div>
				<h4 class="text-sm font-semibold text-foreground">สัตว์เลี้ยงที่นำมาด้วย (Pets)</h4>
				<p class="text-xs text-muted-foreground">
					บันทึกเพื่อการจัดสรรพื้นที่และการดูแลด้านสุขอนามัย
				</p>
			</div>
			{#if !disabled}
				<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={addPet}
					class="h-8 gap-1 text-xs text-primary"
				>
					<Plus class="size-3.5" /> เพิ่มชนิดสัตว์เลี้ยง
				</Button>
			{/if}
		</div>

		{#if pets.length === 0}
			<p
				class="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground"
			>
				ไม่มีสัตว์เลี้ยงที่ลงทะเบียนไว้
			</p>
		{:else}
			<div class="space-y-2.5">
				{#each pets as pet, index (index)}
					<div class="flex items-end gap-2.5 rounded-lg border border-border/80 bg-muted/20 p-2.5">
						<div class="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
							<div class="space-y-1">
								<Label class="text-2xs text-muted-foreground">ชนิดสัตว์</Label>
								<Select.Root
									type="single"
									value={pet.species}
									onValueChange={(val) => {
										if (val === 'dog' || val === 'cat' || val === 'bird' || val === 'other') {
											pet.species = val;
										}
									}}
									{disabled}
								>
									<Select.Trigger class="!h-8 w-full rounded-md text-xs">
										{petSpeciesOptions.find((o) => o.value === pet.species)?.label ?? 'ชนิดสัตว์'}
									</Select.Trigger>
									<Select.Content>
										{#each petSpeciesOptions as opt (opt.value)}
											<Select.Item value={opt.value} label={opt.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							</div>

							<div class="space-y-1">
								<Label class="text-2xs text-muted-foreground">จำนวน (ตัว)</Label>
								<Input
									type="number"
									min={1}
									bind:value={pet.count}
									{disabled}
									class="h-8 text-xs"
								/>
							</div>

							<div class="space-y-1">
								<Label class="text-2xs text-muted-foreground">หมายเหตุ</Label>
								<Input
									bind:value={pet.notes}
									{disabled}
									placeholder="เช่น พันธุ์, ชื่อ"
									class="h-8 text-xs"
								/>
							</div>

							<div class="flex items-center gap-2 pb-1.5">
								<Checkbox
									id={`pet-cage-${index}`}
									checked={pet.has_cage ?? false}
									onCheckedChange={(checked) => (pet.has_cage = !!checked)}
									{disabled}
								/>
								<Label for={`pet-cage-${index}`} class="cursor-pointer text-xs">มีกรง</Label>
							</div>
						</div>

						{#if !disabled}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onclick={() => removePet(index)}
								class="size-8 shrink-0 text-destructive hover:bg-destructive/10"
								aria-label="ลบสัตว์เลี้ยง"
							>
								<X class="size-4" />
							</Button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
