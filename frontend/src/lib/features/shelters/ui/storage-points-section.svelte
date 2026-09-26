<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, SubStorageItem, SubStorageType } from '../domain/schema';
	import { SUB_STORAGE_TYPE_LABELS } from '../domain/storage-points';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import { ulid } from '$lib/db/ulid';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Warehouse from '@lucide/svelte/icons/warehouse';

	let {
		form,
		formData,
		disabled = false
	}: {
		form: SuperForm<Shelter>;
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();

	const typeOptions = Object.entries(SUB_STORAGE_TYPE_LABELS) as [SubStorageType, string][];

	function setPoints(points: SubStorageItem[]) {
		$formData.common_areas = { ...$formData.common_areas, sub_storage: points };
	}

	function addPoint() {
		setPoints([
			...($formData.common_areas.sub_storage ?? []),
			{ id: ulid(), name: '', type: 'general', area_m2: null }
		]);
	}

	// Ledger lots keep the name they were received under (`lot.storage_zone`), so
	// removing a point never loses where existing stock was put away.
	function removePoint(id: string) {
		setPoints(($formData.common_areas.sub_storage ?? []).filter((p) => p.id !== id));
		toast.success('ลบจุดเก็บของสำเร็จ');
	}
</script>

<section
	id="storage-points"
	class="shelter-form-scroll-mt mt-6 mb-6 space-y-4 rounded-2xl border border-shelter-border p-6"
>
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<Warehouse class="h-5 w-5 text-teal-600" />
		<span class="text-sm font-bold text-black">5.</span>
		<h2 class="text-base font-bold text-black">จุดเก็บของ</h2>
	</div>

	<div class="flex items-center justify-between gap-3">
		<div>
			<h3 class="text-sm font-bold text-card-foreground">รายการจุดเก็บของ / คลังย่อย</h3>
			<p class="text-xs text-muted-foreground">
				ใช้เป็นตัวเลือก "สถานที่จัดเก็บ" ตอนรับเข้าและปรับปรุงสต๊อกของศูนย์นี้
			</p>
		</div>
		<Button
			type="button"
			variant="outline"
			size="sm"
			onclick={addPoint}
			{disabled}
			class="shrink-0 rounded-full border-teal-200 bg-teal-50 text-teal-700 shadow-sm hover:bg-teal-100 hover:text-teal-800"
		>
			<Plus class="mr-1 h-4 w-4" /> เพิ่มจุดเก็บของ
		</Button>
	</div>

	<div class="space-y-2">
		{#each $formData.common_areas.sub_storage ?? [] as point, i (point.id)}
			<div
				class="flex flex-col gap-3 rounded-lg border border-shelter-border p-3 sm:flex-row sm:items-start"
			>
				<Form.Field {form} name={`common_areas.sub_storage[${i}].name`} class="min-w-0 flex-1">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ชื่อจุดเก็บของ</Form.Label>
							<Input
								{...props}
								bind:value={point.name}
								placeholder="เช่น สนามปิงปอง, ห้องเรียน 3"
								class="bg-white"
								{disabled}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name={`common_areas.sub_storage[${i}].type`} class="sm:w-44">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ประเภท</Form.Label>
							<Select.Root type="single" bind:value={point.type} {disabled}>
								<Select.Trigger {...props} class="w-full bg-white">
									{SUB_STORAGE_TYPE_LABELS[point.type] ?? '— เลือก —'}
								</Select.Trigger>
								<Select.Content>
									{#each typeOptions as [value, label] (value)}
										<Select.Item {value} {label} />
									{/each}
								</Select.Content>
							</Select.Root>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name={`common_areas.sub_storage[${i}].area_m2`} class="sm:w-32">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>พื้นที่ (ตร.ม.)</Form.Label>
							<Input
								{...props}
								type="number"
								min="0"
								step="any"
								value={point.area_m2 ?? ''}
								oninput={(e) =>
									(point.area_m2 =
										e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
								placeholder="—"
								class="bg-white tabular-nums"
								{disabled}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<div class="flex shrink-0 justify-end sm:pt-6">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="text-destructive hover:bg-destructive/10 hover:text-destructive"
						onclick={() => removePoint(point.id)}
						{disabled}
						title="ลบจุดเก็บของ"
					>
						<Trash2 class="h-4 w-4" />
						<span class="sr-only">ลบจุดเก็บของ</span>
					</Button>
				</div>
			</div>
		{:else}
			<p class="py-4 text-center text-sm text-muted-foreground">
				ยังไม่มีจุดเก็บของ — ตอนรับเข้าสต๊อกจะเลือกได้เฉพาะ "ไม่ระบุ (คลังหลัก)"
			</p>
		{/each}
	</div>
</section>
