<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	let {
		vehicleType = $bindable('none'),
		licensePlate = $bindable(''),
		assetDescription = $bindable('')
	}: {
		vehicleType: 'car' | 'motorcycle' | 'other' | 'none';
		licensePlate: string;
		assetDescription: string;
	} = $props();
</script>

<div class="space-y-6">
	<!-- Vehicle Section -->
	<div class="space-y-3">
		<h3 class="text-base font-bold text-slate-800 dark:text-slate-200">ข้อมูลยานพาหนะ</h3>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div class="space-y-1.5">
				<Label for="vehicle_type" class="text-xs font-semibold text-muted-foreground"
					>ประเภทยานพาหนะ</Label
				>
				<Select.Root type="single" bind:value={vehicleType}>
					<Select.Trigger id="vehicle_type" class="h-10 w-full bg-background text-sm">
						{{ none: 'ไม่มี', car: 'รถยนต์', motorcycle: 'รถจักรยานยนต์', other: 'อื่นๆ' }[
							vehicleType
						] ?? 'ไม่มี'}
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
					<Label for="license_plate" class="text-xs font-semibold text-muted-foreground"
						>เลขทะเบียนรถ</Label
					>
					<Input
						id="license_plate"
						type="text"
						class="h-10 bg-background text-sm"
						bind:value={licensePlate}
						placeholder="เช่น กง 1234 สงขลา"
					/>
				</div>
			{/if}
		</div>
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
