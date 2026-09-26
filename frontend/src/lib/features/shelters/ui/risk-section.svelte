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
	id="risk"
	class="shelter-form-scroll-mt mb-6 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs transition-shadow hover:shadow-sm sm:p-8"
>
	<div class="flex items-center gap-3 border-b border-slate-100 pb-4">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600"
		>
			<ShieldAlert class="h-5 w-5" />
		</div>
		<div>
			<div class="flex items-center gap-2">
				<span class="text-xs font-bold tracking-wider text-[#0284C7] uppercase">ส่วนที่ 6</span>
			</div>
			<h2 class="text-base font-bold text-[#0A2647] sm:text-lg">
				ข้อมูลการประเมินความเสี่ยงและโครงสร้าง
			</h2>
		</div>
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
					placeholder="เช่น เข้าถึงได้สะดวก ไม่มีน้ำท่วมขัง"
					class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
				></textarea>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<div
		class="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 text-sm text-rose-900 shadow-2xs"
	>
		<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
		<p class="text-xs leading-relaxed font-medium text-rose-800">
			ข้อมูลส่วนนี้จะถูกใช้เพื่อช่วย EOC ทราบถึงข้อจำกัดของศูนย์แบบ Real-time
		</p>
	</div>
</section>
