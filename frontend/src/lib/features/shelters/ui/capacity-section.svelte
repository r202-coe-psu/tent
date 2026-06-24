<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';

	let {
		form,
		formData,
		disabled = false
	}: {
		form: SuperForm<Shelter>;
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();
</script>

<section class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border p-6">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<span
			class="flex h-6 w-6 items-center justify-center rounded-full bg-shelter-blue-bg text-xs font-bold text-shelter-blue-text"
			>2</span
		>
		<h2 class="text-base font-bold text-card-foreground">
			ข้อมูลความจุเชิงพื้นที่ (Capacity &amp; Structure)
		</h2>
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
					<Input
						{...props}
						bind:value={$formData.area_type}
						{disabled}
						placeholder="เช่น อาคารปิด (Indoor)"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>
</section>
