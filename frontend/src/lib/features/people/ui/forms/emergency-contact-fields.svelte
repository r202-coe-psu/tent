<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let {
		name = $bindable(''),
		phone = $bindable(''),
		relation = $bindable(''),
		disabled = false,
		required = false,
		formId,
		errors
	}: {
		name?: string;
		phone?: string;
		relation?: string;
		disabled?: boolean;
		required?: boolean;
		/** Associate inputs with an outer form when this block sits outside `<form>`. */
		formId?: string;
		errors?: {
			name?: string;
			phone?: string;
			relation?: string;
		};
	} = $props();

	const errClass =
		'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20';

	function onPhoneInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		phone = target.value.replace(/\D/g, '').slice(0, 10);
	}
</script>

<div class="space-y-4">
	<div class="space-y-1.5">
		<Label for="emergency-name" class="text-xs font-semibold text-foreground">
			ชื่อผู้ติดต่อ {#if required}<span class="text-destructive">*</span>{/if}
		</Label>
		<Input
			id="emergency-name"
			bind:value={name}
			{disabled}
			form={formId}
			autocomplete="name"
			placeholder="ระบุชื่อ-นามสกุล ผู้ติดต่อฉุกเฉิน"
			aria-invalid={!!errors?.name}
			aria-required={required || undefined}
			class="h-9 {errors?.name ? errClass : ''}"
		/>
		{#if errors?.name}
			<p class="text-2xs text-destructive">{errors.name}</p>
		{/if}
	</div>

	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label for="emergency-phone" class="text-xs font-semibold text-foreground">
				เบอร์โทรศัพท์ {#if required}<span class="text-destructive">*</span>{/if}
			</Label>
			<Input
				id="emergency-phone"
				value={phone}
				oninput={onPhoneInput}
				{disabled}
				form={formId}
				inputmode="numeric"
				maxlength={10}
				autocomplete="tel"
				placeholder="เบอร์โทรศัพท์ 10 หลัก"
				aria-invalid={!!errors?.phone}
				aria-required={required || undefined}
				class="h-9 {errors?.phone ? errClass : ''}"
			/>
			{#if errors?.phone}
				<p class="text-2xs text-destructive">{errors.phone}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label for="emergency-relation" class="text-xs font-semibold text-foreground">
				ความสัมพันธ์ {#if required}<span class="text-destructive">*</span>{/if}
			</Label>
			<Input
				id="emergency-relation"
				bind:value={relation}
				{disabled}
				form={formId}
				placeholder="เช่น บิดา มารดา คู่สมรส ญาติ"
				aria-invalid={!!errors?.relation}
				aria-required={required || undefined}
				class="h-9 {errors?.relation ? errClass : ''}"
			/>
			{#if errors?.relation}
				<p class="text-2xs text-destructive">{errors.relation}</p>
			{/if}
		</div>
	</div>
</div>
