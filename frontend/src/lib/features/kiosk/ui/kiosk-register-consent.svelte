<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { ConsentBlock, ConsentBlockState, type ConsentDecision } from '$lib/features/consent';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_QR_FLOW_I18N } from './_constants/kiosk-qr-flow.i18n';
	import { KIOSK_NOTICE_SECONDARY_ACTION } from './kiosk-notice-actions';
	interface Props {
		/** Where the details come from: the card chip, or what ThaiD verified (no photo). */
		source?: 'smart-card' | 'thaid';
		onconsent: (decision: ConsentDecision) => void;
		oncancel: () => void;
	}
	let { source = 'smart-card', onconsent, oncancel }: Props = $props();

	const t = $derived(getTranslation(KIOSK_QR_FLOW_I18N, languageStore.current).registerConsent);
	const block = new ConsentBlockState({ channel: 'kiosk' });
</script>

<div
	class="mx-auto mt-6 flex w-full max-w-3xl flex-col gap-4 kiosk-compact:mt-0 kiosk-compact:gap-2"
>
	<section
		class="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-8 kiosk-portrait:p-8 kiosk-compact:p-4"
		aria-labelledby="consent-title"
	>
		<div
			class="mb-5 inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-900 kiosk-portrait:mb-6 kiosk-portrait:px-5 kiosk-portrait:py-2 kiosk-portrait:text-lg kiosk-compact:mb-2"
		>
			{t.tag}
		</div>
		<h1
			id="consent-title"
			class="text-2xl font-bold text-[#0A2647] sm:text-3xl kiosk-portrait:text-4xl kiosk-compact:text-2xl"
		>
			{source === 'thaid' ? t.headingThaid : t.headingCard}
		</h1>
		<div
			class="mt-4 space-y-3 text-base leading-relaxed text-slate-700 kiosk-portrait:mt-6 kiosk-portrait:text-xl kiosk-compact:mt-2 kiosk-compact:space-y-1.5 kiosk-compact:leading-snug"
		>
			<p>{source === 'thaid' ? t.bodyThaid : t.bodyCard}</p>
			<p>{t.pending}</p>
			{#if source !== 'thaid'}
				<p class="font-semibold text-slate-900">
					{t.insertCard}
				</p>
			{/if}
		</div>
	</section>
	<ConsentBlock {block} confirm="standalone" size="kiosk" showLinks={false} onconfirm={onconsent} />
	<Button type="button" variant="outline" onclick={oncancel} class={KIOSK_NOTICE_SECONDARY_ACTION}
		>{t.cancel}</Button
	>
</div>
