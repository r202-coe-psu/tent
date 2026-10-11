<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';

	let {
		name = $bindable(''),
		phone = $bindable(''),
		relation = $bindable(''),
		disabled = false,
		required = false,
		formId,
		idPrefix = 'emergency',
		errors
	}: {
		name?: string;
		phone?: string;
		relation?: string;
		disabled?: boolean;
		required?: boolean;
		/** Associate inputs with an outer form when this block sits outside `<form>`. */
		formId?: string;
		/** Prefix of the control ids — keep the default for the first card, make it unique for the rest. */
		idPrefix?: string;
		errors?: {
			name?: string;
			phone?: string;
			relation?: string;
		};
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	const nameId = $derived(`${idPrefix}-name`);
	const phoneId = $derived(`${idPrefix}-phone`);
	const relationId = $derived(`${idPrefix}-relation`);

	const errClass =
		'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20';

	function onPhoneInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		phone = target.value.replace(/\D/g, '').slice(0, 10);
	}
</script>

<div class="space-y-4">
	<div class="space-y-1.5">
		<Label for={nameId} class="text-xs font-semibold text-foreground">
			{t.emergencyNameLabel}
			{#if required}<span class="text-destructive">*</span>{/if}
		</Label>
		<Input
			id={nameId}
			bind:value={name}
			{disabled}
			form={formId}
			autocomplete="name"
			placeholder={t.emergencyNamePlaceholder}
			aria-invalid={!!errors?.name}
			aria-describedby={errors?.name ? `${nameId}-error` : undefined}
			aria-required={required || undefined}
			class="h-9 {errors?.name ? errClass : ''}"
		/>
		{#if errors?.name}
			<p id="{nameId}-error" class="text-2xs text-destructive">{errors.name}</p>
		{/if}
	</div>

	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label for={phoneId} class="text-xs font-semibold text-foreground">
				{t.phoneFieldLabel}
				{#if required}<span class="text-destructive">*</span>{/if}
			</Label>
			<Input
				id={phoneId}
				value={phone}
				oninput={onPhoneInput}
				{disabled}
				form={formId}
				inputmode="numeric"
				maxlength={10}
				autocomplete="tel"
				placeholder={t.phonePlaceholder}
				aria-invalid={!!errors?.phone}
				aria-describedby={errors?.phone ? `${phoneId}-error` : undefined}
				aria-required={required || undefined}
				class="h-9 {errors?.phone ? errClass : ''}"
			/>
			{#if errors?.phone}
				<p id="{phoneId}-error" class="text-2xs text-destructive">{errors.phone}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label for={relationId} class="text-xs font-semibold text-foreground">
				{t.emergencyRelationLabel}
				{#if required}<span class="text-destructive">*</span>{/if}
			</Label>
			<Input
				id={relationId}
				bind:value={relation}
				{disabled}
				form={formId}
				placeholder={t.emergencyRelationPlaceholder}
				aria-invalid={!!errors?.relation}
				aria-describedby={errors?.relation ? `${relationId}-error` : undefined}
				aria-required={required || undefined}
				class="h-9 {errors?.relation ? errClass : ''}"
			/>
			{#if errors?.relation}
				<p id="{relationId}-error" class="text-2xs text-destructive">{errors.relation}</p>
			{/if}
		</div>
	</div>
</div>
