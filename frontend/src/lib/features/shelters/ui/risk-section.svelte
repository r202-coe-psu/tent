<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';

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

<section
	class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border bg-shelter-rose-bg/10 p-6"
>
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<ShieldAlert class="h-5 w-5 text-shelter-rose-text" />
		<span class="text-sm font-bold text-shelter-rose-text">5.</span>
		<h2 class="text-base font-bold text-card-foreground">
			ข้อมูลการประเมินความเสี่ยงและโครงสร้าง (Risk &amp; Structure)
		</h2>
	</div>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<Form.Field {form} name="risk.elevation_m">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ระดับความสูงจากทะเล (Elevation)</Form.Label>
					<div class="flex">
						<Input
							{...props}
							type="number"
							min="0"
							step="any"
							value={$formData.risk.elevation_m ?? ''}
							oninput={(e) =>
								($formData.risk.elevation_m =
									e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
							{disabled}
							placeholder="0"
							class="rounded-r-none"
						/>
						<span
							class="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground"
							>เมตร</span
						>
					</div>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="risk.entrance_description">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ลักษณะโครงสร้างทางเข้า</Form.Label>
					<Input
						{...props}
						bind:value={$formData.risk.entrance_description}
						{disabled}
						placeholder="เช่น ถนนคอนกรีต 2 เลน"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<Form.Field {form} name="risk.secondary_muster_point">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>จุดรวมพลสำรอง (Secondary Muster Point)</Form.Label>
				<Input
					{...props}
					value={$formData.risk.secondary_muster_point ?? ''}
					oninput={(e) => ($formData.risk.secondary_muster_point = e.currentTarget.value || null)}
					{disabled}
					placeholder="เช่น ลานหน้าอาคารเรียน 2 / สนามกีฬากลาง"
				/>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<Form.Field {form} name="risk.constraints">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>ข้อจำกัดพิเศษ (Remark / Constraints)</Form.Label>
				<textarea
					{...props}
					bind:value={$formData.risk.constraints}
					{disabled}
					rows="3"
					placeholder="เช่น อายุผู้คุ้มได้สะดวก ไม่มีน้ำท่วมขัง"
					class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
				></textarea>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<div
		class="flex items-start gap-2 rounded-lg border border-shelter-border bg-muted/30 p-3 text-sm text-shelter-rose-text"
	>
		<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-shelter-rose-text" />
		<p>ข้อมูลส่วนนี้จะถูกใช้เพื่อช่วย EOC กราบถึงข้อจำกัดของศูนย์แบบ Real-time</p>
	</div>
</section>
