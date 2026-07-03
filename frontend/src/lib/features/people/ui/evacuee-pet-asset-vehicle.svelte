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
		<!-- Pets Section -->
		<div class="space-y-4">
			<div class="flex items-center gap-2">
				<Checkbox
					id="hasPets"
					bind:checked={hasPets}
					class="data-[state=checked]:border-[#003B71] data-[state=checked]:bg-[#003B71] data-[state=checked]:text-primary-foreground"
				/>
				<label for="hasPets" class="flex cursor-pointer items-center gap-1 text-sm font-semibold">
					🐶 นำสัตว์เลี้ยงมาด้วย
				</label>
			</div>

			{#if hasPets}
				<div class="flex items-center gap-3">
					<Input bind:value={petDescription} placeholder="รายละเอียดสัตว์เลี้ยง" class="flex-1" />
					<div class="flex h-10 items-center gap-2 rounded-md border bg-background px-3">
						<Checkbox id="hasCage" bind:checked={hasCage} />
						<label for="hasCage" class="cursor-pointer text-sm whitespace-nowrap">มีกรง</label>
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
						<Button
							variant="secondary"
							size="icon"
							class="absolute top-2 right-2 h-6 w-6 rounded-full opacity-80 hover:opacity-100"
							onclick={() => (petImageUrl = null)}
						>
							<X class="h-3 w-3" />
						</Button>
					</div>
				{/if}
			{/if}
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- Assets Section -->
			<div class="space-y-3 rounded-lg border bg-muted/20 p-4">
				<div class="flex items-center gap-1 text-sm font-semibold">🎒 ทรัพย์สินมีค่า / สัมภาระ</div>
				<div class="flex items-center gap-2">
					<Input
						bind:value={assetDescription}
						placeholder="รายละเอียดทรัพย์สิน/สัมภาระ"
						class="flex-1 bg-background"
					/>
					<Button variant="outline" size="icon" class="h-10 w-10 shrink-0 bg-background">
						<Camera class="h-4 w-4 text-muted-foreground" />
					</Button>
					<Button variant="outline" size="icon" class="h-10 w-10 shrink-0 bg-background">
						<Image class="h-4 w-4 text-muted-foreground" />
					</Button>
				</div>
			</div>

			<!-- Vehicles Section -->
			<div class="space-y-3 rounded-lg border bg-muted/20 p-4">
				<div class="flex items-center gap-1 text-sm font-semibold">🚗 ยานพาหนะ</div>
				<div class="flex items-center gap-2">
					<Select.Root type="single" bind:value={vehicleType}>
						<Select.Trigger class="w-[120px] bg-background">
							{vehicleType || 'ประเภท'}
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
			class="h-12 w-[48%] bg-[#003B71] text-base font-medium hover:bg-[#002a50]"
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
