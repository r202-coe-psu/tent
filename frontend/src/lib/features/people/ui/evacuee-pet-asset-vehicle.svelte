<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import Camera from '@lucide/svelte/icons/camera';
	import Image from '@lucide/svelte/icons/image';
	import X from '@lucide/svelte/icons/x';
	
	let {
		onBack,
		onNext
	}: {
		onBack: () => void;
		onNext: (data: {
			hasPets: boolean;
			petDescription: string;
			hasCage: boolean;
			petImageUrl: string | null;
			assetDescription: string;
			vehicleType: string;
			licensePlate: string;
		}) => void;
	} = $props();
	
	let hasPets = $state(false);
	let petDescription = $state('');
	let hasCage = $state(false);
	let petImageUrl = $state<string | null>(null);
	let assetDescription = $state('');
	let vehicleType = $state('');
	let licensePlate = $state('');
</script>

<div class="space-y-4">
	<!-- Header Card -->
	<div class="rounded-xl border border-border bg-card p-6 shadow-sm flex items-center gap-4">
		<div class="flex h-10 w-10 items-center justify-center rounded-full bg-[#e2e8f0] text-slate-700 font-bold text-lg">
			4
		</div>
		<div>
			<h2 class="text-lg font-bold">ทรัพย์สินและสัตว์เลี้ยง (Assets & Pets)</h2>
			<p class="text-sm text-muted-foreground">บันทึกข้อมูลสัมภาระ ยานพาหนะ สัตว์เลี้ยง และสถานะบ้าน</p>
		</div>
	</div>

	<!-- Form Content -->
	<div class="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
		<!-- Pets Section -->
		<div class="space-y-4">
			<div class="flex items-center gap-2">
				<Checkbox id="hasPets" bind:checked={hasPets} class="data-[state=checked]:bg-[#003B71] data-[state=checked]:text-primary-foreground data-[state=checked]:border-[#003B71]" />
				<label for="hasPets" class="text-sm font-semibold flex items-center gap-1 cursor-pointer">
					🐶 นำสัตว์เลี้ยงมาด้วย
				</label>
			</div>
			
			{#if hasPets}
				<div class="flex items-center gap-3">
					<Input bind:value={petDescription} placeholder="รายละเอียดสัตว์เลี้ยง" class="flex-1" />
					<div class="flex items-center gap-2 border rounded-md px-3 h-10 bg-background">
						<Checkbox id="hasCage" bind:checked={hasCage} />
						<label for="hasCage" class="text-sm cursor-pointer whitespace-nowrap">มีกรง</label>
					</div>
					<Button variant="outline" size="icon" class="h-10 w-10 shrink-0 bg-background">
						<Camera class="h-4 w-4 text-muted-foreground" />
					</Button>
					<Button variant="outline" size="icon" class="h-10 w-10 shrink-0 bg-background">
						<Image class="h-4 w-4 text-muted-foreground" />
					</Button>
				</div>
				
				<!-- Image Preview -->
				{#if petImageUrl}
					<div class="relative mt-2 h-[120px] w-full overflow-hidden rounded-md border bg-muted">
						<img src={petImageUrl} alt="Pet preview" class="h-full w-full object-cover" />
						<Button variant="secondary" size="icon" class="absolute right-2 top-2 h-6 w-6 rounded-full opacity-80 hover:opacity-100" onclick={() => petImageUrl = null}>
							<X class="h-3 w-3" />
						</Button>
					</div>
				{/if}
			{/if}
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<!-- Assets Section -->
			<div class="rounded-lg border bg-muted/20 p-4 space-y-3">
				<div class="text-sm font-semibold flex items-center gap-1">
					🎒 ทรัพย์สินมีค่า / สัมภาระ
				</div>
				<div class="flex items-center gap-2">
					<Input bind:value={assetDescription} placeholder="รายละเอียดทรัพย์สิน/สัมภาระ" class="flex-1 bg-background" />
					<Button variant="outline" size="icon" class="h-10 w-10 shrink-0 bg-background">
						<Camera class="h-4 w-4 text-muted-foreground" />
					</Button>
					<Button variant="outline" size="icon" class="h-10 w-10 shrink-0 bg-background">
						<Image class="h-4 w-4 text-muted-foreground" />
					</Button>
				</div>
			</div>

			<!-- Vehicles Section -->
			<div class="rounded-lg border bg-muted/20 p-4 space-y-3">
				<div class="text-sm font-semibold flex items-center gap-1">
					🚗 ยานพาหนะ
				</div>
				<div class="flex items-center gap-2">
					<Select.Root type="single" bind:value={vehicleType}>
						<Select.Trigger class="w-[120px] bg-background">
							{vehicleType || "ประเภท"}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="รถยนต์">รถยนต์</Select.Item>
							<Select.Item value="จักรยานยนต์">จักรยานยนต์</Select.Item>
							<Select.Item value="อื่นๆ">อื่นๆ</Select.Item>
						</Select.Content>
					</Select.Root>
					<Input bind:value={licensePlate} placeholder="ทะเบียนรถ" class="flex-1 bg-background" />
				</div>
			</div>
		</div>
	</div>

	<!-- Bottom Actions -->
	<div class="flex justify-between items-center bg-card p-6 rounded-xl border shadow-sm">
		<Button type="button" variant="outline" class="h-12 w-[48%] text-base font-medium" onclick={onBack}>
			ย้อนกลับ
		</Button>
		<Button
			type="button"
			class="h-12 w-[48%] text-base font-medium bg-[#003B71] hover:bg-[#002a50]"
			onclick={() =>
				onNext({
					hasPets,
					petDescription,
					hasCage,
					petImageUrl,
					assetDescription,
					vehicleType,
					licensePlate
				})}
		>
			ลงทะเบียนสำเร็จ
		</Button>
	</div>
</div>
