<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input';
	import { PUBLIC_SEARCH_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import {
		SEARCH_NAME_MAX,
		SEARCH_PURPOSE_NOTE_MAX,
		SEARCH_PURPOSES,
		parseSearchConsent,
		type SearchConsent,
		type SearchConsentField,
		type SearchPurpose
	} from '../domain/search-consent';

	/** CR-231: the one consent + purpose dialog shared by /search and the home-page modal. */
	interface Props {
		open?: boolean;
		/** Called with the validated consent; the caller stores it and runs the search. */
		onconfirm: (consent: SearchConsent) => void;
	}

	let { open = $bindable(false), onconfirm }: Props = $props();

	const t = $derived(getTranslation(PUBLIC_SEARCH_I18N, langState.current));

	let firstName = $state('');
	let lastName = $state('');
	let phone = $state('');
	let purpose = $state<SearchPurpose | ''>('');
	let purposeNote = $state('');
	let accepted = $state(false);
	let errors = $state<Partial<Record<SearchConsentField, true>>>({});

	const purposeLabel = $derived<Record<SearchPurpose, string>>({
		find_family: t.consentPurposeFindFamily,
		find_acquaintance: t.consentPurposeFindAcquaintance,
		coordinate_aid: t.consentPurposeCoordinateAid,
		other: t.consentPurposeOther
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const result = parseSearchConsent({
			searcher: { first_name: firstName, last_name: lastName, phone },
			purpose,
			purpose_note: purposeNote,
			consent_accepted: accepted
		});
		if (!result.ok) {
			errors = result.errors;
			return;
		}
		errors = {};
		onconfirm(result.consent);
	}
</script>

{#snippet fieldError(field: SearchConsentField, message: string)}
	{#if errors[field]}
		<p id="consent-err-{field}" class="mt-1 text-sm text-danger" role="alert">{message}</p>
	{/if}
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90svh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{t.consentTitle}</Dialog.Title>
			<Dialog.Description>{t.consentDesc}</Dialog.Description>
		</Dialog.Header>

		<form class="space-y-4" onsubmit={submit} novalidate>
			<div>
				<label for="consent-first-name" class="mb-1 block text-sm font-medium">
					{t.consentFirstName}
				</label>
				<Input
					id="consent-first-name"
					bind:value={firstName}
					maxlength={SEARCH_NAME_MAX}
					autocomplete="given-name"
					aria-invalid={errors.first_name ? 'true' : undefined}
					aria-describedby={errors.first_name ? 'consent-err-first_name' : undefined}
				/>
				{@render fieldError('first_name', t.consentErrorFirstName)}
			</div>

			<div>
				<label for="consent-last-name" class="mb-1 block text-sm font-medium">
					{t.consentLastName}
				</label>
				<Input
					id="consent-last-name"
					bind:value={lastName}
					maxlength={SEARCH_NAME_MAX}
					autocomplete="family-name"
					aria-invalid={errors.last_name ? 'true' : undefined}
					aria-describedby={errors.last_name ? 'consent-err-last_name' : undefined}
				/>
				{@render fieldError('last_name', t.consentErrorLastName)}
			</div>

			<div>
				<label for="consent-phone" class="mb-1 block text-sm font-medium">{t.consentPhone}</label>
				<Input
					id="consent-phone"
					type="tel"
					inputmode="numeric"
					bind:value={phone}
					autocomplete="tel"
					aria-invalid={errors.phone ? 'true' : undefined}
					aria-describedby={errors.phone
						? 'consent-err-phone consent-phone-hint'
						: 'consent-phone-hint'}
				/>
				<p id="consent-phone-hint" class="mt-1 text-xs text-muted-foreground">
					{t.consentPhoneHint}
				</p>
				{@render fieldError('phone', t.consentErrorPhone)}
			</div>

			<fieldset aria-describedby={errors.purpose ? 'consent-err-purpose' : undefined}>
				<legend class="mb-1 text-sm font-medium">{t.consentPurposeLegend}</legend>
				<div class="space-y-2">
					{#each SEARCH_PURPOSES as value (value)}
						<label class="flex items-center gap-2 text-sm">
							<input
								type="radio"
								name="consent-purpose"
								{value}
								bind:group={purpose}
								class="size-4 accent-primary"
							/>
							{purposeLabel[value]}
						</label>
					{/each}
				</div>
				{@render fieldError('purpose', t.consentErrorPurpose)}
			</fieldset>

			{#if purpose === 'other'}
				<div>
					<label for="consent-purpose-note" class="mb-1 block text-sm font-medium">
						{t.consentPurposeNote}
					</label>
					<Input
						id="consent-purpose-note"
						bind:value={purposeNote}
						maxlength={SEARCH_PURPOSE_NOTE_MAX}
						aria-invalid={errors.purpose_note ? 'true' : undefined}
						aria-describedby={errors.purpose_note ? 'consent-err-purpose_note' : undefined}
					/>
					{@render fieldError('purpose_note', t.consentErrorPurposeNote)}
				</div>
			{/if}

			<div>
				<div class="flex items-start gap-2 text-sm">
					<input
						id="consent-accept"
						type="checkbox"
						bind:checked={accepted}
						aria-invalid={errors.consent_accepted ? 'true' : undefined}
						aria-describedby={errors.consent_accepted ? 'consent-err-consent_accepted' : undefined}
						class="mt-0.5 size-4 accent-primary"
					/>
					<label for="consent-accept">
						{t.consentAccept}
						<a
							href={resolve('/policy')}
							target="_blank"
							rel="noopener"
							class="text-primary underline"
						>
							{t.consentPolicyLink}
						</a>
					</label>
				</div>
				{@render fieldError('consent_accepted', t.consentErrorAccept)}
			</div>

			<Dialog.Footer class="gap-2">
				<Button type="button" variant="outline" onclick={() => (open = false)}>
					{t.consentCancel}
				</Button>
				<Button type="submit">{t.consentConfirm}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
