<script lang="ts">
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { CHECKOUT_REASON_PRESETS, type CheckoutReasonChoice } from '../domain/people';
	import { CHECKOUT_REASON_I18N } from './_constants/checkout-reason.i18n';

	/**
	 * #1493: pick one checkout reason + optional detail (required for "อื่นๆ").
	 * The parent composes the stored remark with `composeCheckoutReason`.
	 */
	let {
		choice = $bindable(null),
		detail = $bindable(''),
		error = null,
		idPrefix,
		disabled = false,
		onchange
	}: {
		choice?: CheckoutReasonChoice | null;
		detail?: string;
		error?: string | null;
		/** Keeps ids unique per dialog. */
		idPrefix: string;
		disabled?: boolean;
		onchange?: () => void;
	} = $props();

	const t = $derived(getTranslation(CHECKOUT_REASON_I18N, langState.current));
	const options = $derived([
		...CHECKOUT_REASON_PRESETS.map((value) => ({ value, label: value })),
		{ value: 'other' as const, label: t.other }
	]);
	const detailRequired = $derived(choice === 'other');
	const errorId = $derived(`${idPrefix}-error`);
</script>

<div class="space-y-3">
	<div class="space-y-1.5">
		<p id="{idPrefix}-label" class="text-xs font-semibold text-foreground">
			{t.reasonLabel} <span class="text-destructive">*</span>
		</p>
		<!-- Under the heading so it stays on screen when the dialog scrolls on a phone. -->
		{#if error}
			<p id={errorId} class="text-xs font-medium text-destructive" role="alert">{error}</p>
		{/if}
		<RadioGroup.Root
			bind:value={
				() => choice ?? '',
				(next) => {
					choice = next as CheckoutReasonChoice;
					onchange?.();
				}
			}
			{disabled}
			aria-labelledby="{idPrefix}-label"
			aria-describedby={error ? errorId : undefined}
			class="grid grid-cols-1 gap-2 sm:grid-cols-2"
		>
			{#each options as option (option.value)}
				<Label
					for="{idPrefix}-{option.value}"
					class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
				>
					<RadioGroup.Item id="{idPrefix}-{option.value}" value={option.value} />
					{option.label}
				</Label>
			{/each}
		</RadioGroup.Root>
	</div>

	<div class="space-y-1.5">
		<Label for="{idPrefix}-detail" class="text-xs font-semibold text-muted-foreground">
			{t.detailLabel}
			{#if detailRequired}<span class="text-destructive">*</span>{:else}{t.optional}{/if}
		</Label>
		<Textarea
			id="{idPrefix}-detail"
			bind:value={detail}
			oninput={() => onchange?.()}
			{disabled}
			rows={2}
			required={detailRequired}
			aria-required={detailRequired}
			aria-describedby={error ? errorId : undefined}
			placeholder={t.detailPlaceholder}
			class="text-sm"
		/>
	</div>
</div>
