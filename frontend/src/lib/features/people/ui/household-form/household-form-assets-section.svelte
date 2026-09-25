<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';

	type VehicleRow = { id: number; type: 'car' | 'motorcycle' | 'other'; license_plate: string };

	let {
		vehicleRows,
		onAddVehicle,
		onRemoveVehicle,
		assetDescription = $bindable('')
	}: {
		vehicleRows: VehicleRow[];
		onAddVehicle: () => void;
		onRemoveVehicle: (id: number) => void;
		assetDescription: string;
	} = $props();

	const vehicleTypeOptions = [
		{ value: 'car', label: 'รถยนต์' },
		{ value: 'motorcycle', label: 'รถจักรยานยนต์' },
		{ value: 'other', label: 'อื่นๆ' }
	] as const;
</script>

<div class="space-y-6">
	<!-- Vehicle Section — supports multiple vehicles per household -->
	<div class="space-y-3">
		<div class="flex items-center justify-between gap-2">
			<h3 class="text-base font-bold text-slate-800 dark:text-slate-200">ข้อมูลยานพาหนะ</h3>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="h-8 shrink-0 bg-background"
				onclick={onAddVehicle}
			>
				<Plus class="mr-1 h-3.5 w-3.5" /> เพิ่มคัน
			</Button>
		</div>

		{#if vehicleRows.length === 0}
			<p class="text-xs text-muted-foreground">ยังไม่มียานพาหนะ — กด "เพิ่มคัน" เพื่อเพิ่มรายการ</p>
		{:else}
			<div class="space-y-2">
				{#each vehicleRows as vehicle (vehicle.id)}
					<div class="flex items-end gap-2">
						<div class="w-[140px] shrink-0 space-y-1.5">
							<Label class="text-xs font-semibold text-muted-foreground">ประเภท</Label>
							<Select.Root type="single" bind:value={vehicle.type}>
								<Select.Trigger class="h-10 w-full bg-background text-sm">
									{vehicleTypeOptions.find((o) => o.value === vehicle.type)?.label ?? 'ประเภท'}
								</Select.Trigger>
								<Select.Content>
									{#each vehicleTypeOptions as opt (opt.value)}
										<Select.Item value={opt.value} label={opt.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex-1 space-y-1.5">
							<Label class="text-xs font-semibold text-muted-foreground">เลขทะเบียนรถ</Label>
							<Input
								type="text"
								class="h-10 bg-background text-sm"
								bind:value={vehicle.license_plate}
								placeholder="เช่น กง 1234 สงขลา"
							/>
						</div>
						<Button
							type="button"
							variant="outline"
							size="icon"
							class="h-10 w-10 shrink-0 bg-background"
							onclick={() => onRemoveVehicle(vehicle.id)}
						>
							<X class="h-4 w-4 text-muted-foreground" />
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<hr class="border-border/50" />

	<!-- Assets / Valuables Section -->
	<div class="space-y-3">
		<h3 class="text-base font-bold text-slate-800 dark:text-slate-200">สัมภาระและสิ่งของมีค่า</h3>
		<textarea
			id="valuables"
			rows="3"
			class="flex min-h-[92px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
			bind:value={assetDescription}
			placeholder="เช่น กระเป๋าเดินทาง 2 ใบ, คอมพิวเตอร์โน้ตบุ๊ก 1 เครื่อง"
		></textarea>
	</div>
</div>
