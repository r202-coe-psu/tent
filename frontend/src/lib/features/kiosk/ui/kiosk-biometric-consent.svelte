<script lang="ts">
	import ScanFace from '@lucide/svelte/icons/scan-face';
	import { Button } from '$lib/components/ui/button/index.js';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_FACE_I18N } from './_constants/kiosk-face.i18n';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';

	interface Props {
		onagree: () => void;
		ondecline: () => void;
		/** h2 when the page already has its own h1. */
		headingTag?: 'h1' | 'h2';
	}

	let { onagree, ondecline, headingTag = 'h1' }: Props = $props();

	const t = $derived(getTranslation(KIOSK_FACE_I18N, languageStore.current).consent);

	// Button sets whitespace-nowrap and a fixed height: long Thai labels must wrap inside the card.
	const wrapLabel = 'h-auto min-w-0 whitespace-normal py-3 text-center sm:flex-1';
	// Both long labels share one row: one size for both that keeps each on a single line.
	const labelSize = 'kiosk-portrait:px-4 kiosk-portrait:text-xl kiosk-compact:text-base';
</script>

<!--
	Consent for the face check, asked on its own: it is separate from consent to read the card, and
	saying no must stay a real choice (staff check the person instead; service is never withheld).
	Wording is a draft for the data-protection review.
-->
<div aria-labelledby="face-consent-title">
	<!-- Under another heading on a short screen the page title already says this: save the row. -->
	<div
		class={[
			'mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-900 kiosk-portrait:mb-6 kiosk-portrait:gap-3 kiosk-portrait:px-5 kiosk-portrait:py-2 kiosk-portrait:text-lg kiosk-compact:mb-2',
			headingTag === 'h2' && 'kiosk-compact:hidden'
		]}
	>
		<ScanFace class="size-4 kiosk-portrait:size-5" aria-hidden="true" />{t.badge}
	</div>
	<svelte:element
		this={headingTag}
		id="face-consent-title"
		class="text-2xl font-bold text-[#0A2647] sm:text-3xl kiosk-portrait:text-4xl kiosk-compact:text-2xl"
	>
		{t.heading}
	</svelte:element>
	<div
		class="mt-4 space-y-3 text-base leading-relaxed text-slate-700 kiosk-portrait:mt-6 kiosk-portrait:space-y-4 kiosk-portrait:text-xl kiosk-compact:mt-1.5 kiosk-compact:space-y-1 kiosk-compact:leading-snug"
	>
		<p>{t.purpose}</p>
		<p>
			<strong class="text-slate-900">{t.notKeptStrong}</strong>
			{t.notKeptRest}
		</p>
		<p class="font-semibold text-slate-900">{t.declineOk}</p>
	</div>
	<div
		class="mt-7 flex flex-col-reverse gap-3 sm:flex-row kiosk-portrait:mt-10 kiosk-portrait:gap-4 kiosk-compact:mt-3"
	>
		<Button
			type="button"
			variant="outline"
			onclick={ondecline}
			class={`${wrapLabel} ${KIOSK_NOTICE_SECONDARY_ACTION} ${labelSize}`}>{t.decline}</Button
		>
		<Button
			type="button"
			onclick={onagree}
			class={`${wrapLabel} ${KIOSK_NOTICE_PRIMARY_ACTION} ${labelSize}`}>{t.agree}</Button
		>
	</div>
</div>
