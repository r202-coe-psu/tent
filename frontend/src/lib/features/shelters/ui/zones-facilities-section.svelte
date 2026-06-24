<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Zone, Shelter, ZoneType, SubStorageType } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let {
		form,
		formData,
		disabled = false
	}: {
		form: SuperForm<Shelter>;
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();

	const zoneTypeOptions: { value: ZoneType; label: string }[] = [
		{ value: 'general', label: 'ทั่วไป' },
		{ value: 'male', label: 'ชายล้วน' },
		{ value: 'female', label: 'หญิงล้วน' },
		{ value: 'vulnerable', label: 'เปราะบาง' },
		{ value: 'pet', label: 'สัตว์เลี้ยง' },
		{ value: 'quarantine', label: 'กักโรค' }
	];

	function addNewZone() {
		const zones = $formData.zones ?? [];
		let newCode = `Z${zones.length + 1}`;
		while (zones.some((z: Zone) => z.code === newCode)) {
			newCode = `Z${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
		}
		$formData.zones = [
			...zones,
			{
				code: newCode,
				name: '',
				capacity: 0,
				type: 'general' as ZoneType,
				status: 'active' as const,
				closed_at: null,
				closed_by: null,
				reason: null
			}
		];
		toast.success('เพิ่มโซนสำเร็จ');
	}

	function deleteZone(index: number) {
		$formData.zones = $formData.zones.filter((_: Zone, i: number) => i !== index);
		toast.success('ลบโซนสำเร็จ');
	}

	// Sub-storage editing
	const subStorageOptions: { value: SubStorageType; label: string }[] = [
		{ value: 'general', label: 'ทั่วไป' },
		{ value: 'food_dry', label: 'อาหารแห้ง' },
		{ value: 'drinking_water', label: 'น้ำดื่ม' },
		{ value: 'medical_supplies', label: 'เวชภัณฑ์' }
	];

	let newSubStorageName = $state('');
	let newSubStorageType = $state<SubStorageType>('general');

	function addSubStorage() {
		if (!newSubStorageName.trim()) {
			toast.error('กรุณากรอกชื่อสถานที่จัดเก็บ');
			return;
		}
		const current = $formData.common_areas.sub_storage ?? [];
		$formData.common_areas = {
			...$formData.common_areas,
			sub_storage: [...current, { name: newSubStorageName.trim(), type: newSubStorageType }]
		};
		newSubStorageName = '';
		newSubStorageType = 'general';
	}

	function removeSubStorage(index: number) {
		const current = $formData.common_areas.sub_storage ?? [];
		$formData.common_areas = {
			...$formData.common_areas,
			sub_storage: current.filter((_item: unknown, i: number) => i !== index)
		};
	}
</script>

<section
	class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border bg-amber-50/30 p-6 shadow-sm"
>
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<span
			class="bg-shelter-orange-bg text-shelter-orange-text flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
			>3</span
		>
		<h2 class="text-base font-bold text-card-foreground">การจัดการโซนและสิ่งอำนวยความสะดวก</h2>
	</div>
	<!-- 3a. Living Zones -->

	<div class="space-y-4 rounded-xl border border-shelter-border bg-background p-5">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-bold text-card-foreground">การตั้งค่าโซนที่พัก (Living Zones)</h3>
			<Button
				variant="outline"
				size="sm"
				onclick={addNewZone}
				{disabled}
				class="rounded-full border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100 hover:text-orange-700"
			>
				<Plus class="mr-1 h-4 w-4" /> เพิ่มโซน
			</Button>
		</div>

		<div class="space-y-3">
			<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
			{#each $formData.zones ?? [] as _, index (index)}
				<div
					class="flex items-center gap-3 rounded-xl border border-shelter-border bg-muted/30 p-2"
				>
					<Input
						bind:value={$formData.zones[index].name}
						placeholder="ชื่อโซน"
						class="flex-1 bg-white"
						{disabled}
					/>
					<Select.Root type="single" bind:value={$formData.zones[index].type} {disabled}>
						<Select.Trigger
							class="flex !h-9 w-[200px] items-start rounded-md border border-input bg-white px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
						>
							{zoneTypeOptions.find((o) => o.value === $formData.zones[index].type)?.label ??
								'— เลือก —'}
						</Select.Trigger>
						<Select.Content>
							{#each zoneTypeOptions as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
					<div class="relative w-[140px]">
						<Input
							type="number"
							bind:value={$formData.zones[index].capacity}
							class="bg-white pr-10 text-right"
							{disabled}
						/>
						<span class="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
							คน
						</span>
					</div>
					<Button
						variant="ghost"
						size="icon"
						class="text-destructive hover:bg-destructive/10 hover:text-destructive"
						onclick={() => deleteZone(index)}
						{disabled}
					>
						<Trash2 class="h-4 w-4" />
					</Button>
				</div>
			{/each}
			{#if ($formData.zones ?? []).length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">ยังไม่มีโซน กรุณาเพิ่มโซนใหม่</p>
			{/if}
		</div>
	</div>

	<!-- 3b. WASH Facilities -->
	<div class="space-y-4 rounded-xl border border-shelter-border bg-background p-5">
		<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
			ข้อมูลห้องน้ำและสุขอนามัย (WASH Facilities)
		</h3>

		<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
			<Form.Field {form} name="facilities.toilets_male">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>🚹 ห้องน้ำชาย</Form.Label>
						<Input
							{...props}
							type="number"
							min="0"
							value={$formData.facilities.toilets_male ?? ''}
							oninput={(e) =>
								($formData.facilities.toilets_male =
									e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
							{disabled}
							placeholder="0"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="facilities.toilets_female">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>🚺 ห้องน้ำหญิง</Form.Label>
						<Input
							{...props}
							type="number"
							min="0"
							value={$formData.facilities.toilets_female ?? ''}
							oninput={(e) =>
								($formData.facilities.toilets_female =
									e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
							{disabled}
							placeholder="0"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="facilities.toilets_accessible">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>♿ ห้องน้ำคนพิการ</Form.Label>
						<Input
							{...props}
							type="number"
							min="0"
							value={$formData.facilities.toilets_accessible ?? ''}
							oninput={(e) =>
								($formData.facilities.toilets_accessible =
									e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
							{disabled}
							placeholder="0"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="facilities.showers">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>🚿 ห้องอาบน้ำ</Form.Label>
						<Input
							{...props}
							type="number"
							min="0"
							value={$formData.facilities.showers ?? ''}
							oninput={(e) =>
								($formData.facilities.showers =
									e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
							{disabled}
							placeholder="0"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		<label class="flex items-center space-x-2 text-sm">
			<Checkbox
				bind:checked={
					() => $formData.facilities.car_toilet_accessible ?? false,
					(v) => ($formData.facilities.car_toilet_accessible = v)
				}
				{disabled}
			/>
			<span>✅ รถสุขาเคลื่อนที่สามารถเข้าถึงได้</span>
		</label>
	</div>

	<!-- 3c. Common Areas -->
	<div class="space-y-4 rounded-xl border border-shelter-border bg-background p-5">
		<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
			ข้อมูลพื้นที่ส่วนกลาง (Common Areas)
		</h3>

		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<label
				class="flex items-center space-x-2 rounded-lg border border-shelter-border p-3 text-sm"
			>
				<Checkbox
					bind:checked={
						() => $formData.common_areas.central_kitchen ?? false,
						(v) => ($formData.common_areas.central_kitchen = v)
					}
					{disabled}
				/>
				<span>👨‍🍳 ลานประกอบอาหาร (ครัวกลาง)</span>
			</label>
			<label
				class="flex items-center space-x-2 rounded-lg border border-shelter-border p-3 text-sm"
			>
				<Checkbox
					bind:checked={
						() => $formData.common_areas.helipad ?? false,
						(v) => ($formData.common_areas.helipad = v)
					}
					{disabled}
				/>
				<span>🚁 พื้นที่จอดเฮลิคอปเตอร์ (Helipad)</span>
			</label>
		</div>

		<div>
			<div class="mb-1 block text-xs font-bold text-muted-foreground">
				📦 คลังย่อยและสถานที่จัดเก็บ
			</div>
			{#if ($formData.common_areas.sub_storage ?? []).length > 0}
				<div class="mb-2 space-y-1">
					{#each $formData.common_areas.sub_storage ?? [] as item, i (i)}
						<div
							class="flex items-center justify-between rounded-lg border border-shelter-border p-2 text-sm"
						>
							<div class="flex items-center gap-2">
								<span class="font-medium">{item.name}</span>
								<span class="text-xs text-muted-foreground">
									({subStorageOptions.find((o) => o.value === item.type)?.label ?? item.type})
								</span>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onclick={() => removeSubStorage(i)}
								{disabled}
								title="ลบ"
							>
								<Trash2 class="h-3.5 w-3.5 text-destructive" />
							</Button>
						</div>
					{/each}
				</div>
			{/if}
			<div class="flex gap-2">
				<Input
					bind:value={newSubStorageName}
					{disabled}
					placeholder="ชื่อสถานที่จัดเก็บ (เช่น อาหารแห้ง (เสธียง))"
					class="flex-1"
				/>
				<Select.Root type="single" bind:value={newSubStorageType} {disabled}>
					<Select.Trigger
						class="flex !h-9 w-[180px] items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
					>
						{subStorageOptions.find((o) => o.value === newSubStorageType)?.label ?? '— เลือก —'}
					</Select.Trigger>
					<Select.Content>
						{#each subStorageOptions as opt (opt.value)}
							<Select.Item value={opt.value} label={opt.label} />
						{/each}
					</Select.Content>
				</Select.Root>
				<Button type="button" size="sm" onclick={addSubStorage} {disabled}>
					<Plus class="h-3.5 w-3.5" />
					เพิ่ม
				</Button>
			</div>
		</div>

		<Form.Field {form} name="common_areas.parking_capacity">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>🚗 พื้นที่จอดรถ (คัน)</Form.Label>
					<Input
						{...props}
						type="number"
						min="0"
						value={$formData.common_areas.parking_capacity ?? ''}
						oninput={(e) =>
							($formData.common_areas.parking_capacity =
								e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
						{disabled}
						placeholder="0"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>
</section>
