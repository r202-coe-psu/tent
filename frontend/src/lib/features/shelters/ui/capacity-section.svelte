<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, AreaType } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	let {
		form,
		formData,
		disabled = false
	}: {
		form: SuperForm<Shelter>;
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();

	const areaTypeOptions: { value: AreaType; label: string }[] = [
		{ value: 'indoor', label: 'อาคารปิด (Indoor)' },
		{ value: 'outdoor', label: 'ลานเปิด (Outdoor)' },
		{ value: 'hybrid', label: 'แบบผสม (Hybrid)' }
	];
</script>

<section class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border p-6">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<Building2 class="h-5 w-5 text-shelter-blue-text" />
		<span class="text-sm font-bold text-black">2.</span>
		<h2 class="text-base font-bold text-black">ข้อมูลความจุเชิงพื้นที่</h2>
	</div>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
		<Form.Field {form} name="capacity">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ความจุสูงสุด (Max Capacity)<span class="text-destructive">*</span></Form.Label
					>
					<div class="flex">
						<Input
							{...props}
							type="number"
							bind:value={$formData.capacity}
							{disabled}
							placeholder="เช่น 150"
							class="rounded-r-none"
						/>
						<span
							class="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground"
							>คน</span
						>
					</div>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="area_m2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>พื้นที่ใช้สอยรวม (Total Area)</Form.Label>
					<div class="flex">
						<Input
							{...props}
							type="number"
							step="any"
							value={$formData.area_m2 ?? ''}
							oninput={(e) =>
								($formData.area_m2 =
									e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
							{disabled}
							placeholder="0"
							class="rounded-r-none"
						/>
						<span
							class="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground"
							>ตร.ม.</span
						>
					</div>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="area_type">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>สถานะพื้นที่อาคาร</Form.Label>
					<Select.Root
						type="single"
						bind:value={
							() => $formData.area_type ?? '',
							(v) => ($formData.area_type = (v || null) as typeof $formData.area_type)
						}
						{disabled}
					>
						<Select.Trigger
							{...props}
							class="flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
						>
							{areaTypeOptions.find((o) => o.value === $formData.area_type)?.label ?? '— เลือก —'}
						</Select.Trigger>
						<Select.Content>
							{#each areaTypeOptions as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>
</section>
