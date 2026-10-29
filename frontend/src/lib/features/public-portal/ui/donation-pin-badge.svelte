<script lang="ts">
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import type { DonationNeedUrgency } from '../domain/donation-map';
	import { DONATION_URGENCY_STYLE } from './donation-urgency';

	/** The number on a shelter's map pin, repeated on its cards so the two can be matched. */
	let { no, urgency }: { no: number; urgency: DonationNeedUrgency } = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
</script>

<span
	class="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-xs font-bold {DONATION_URGENCY_STYLE[
		urgency
	].badge}"
	data-testid="donation-pin-badge"
>
	<span class="sr-only">{t.needsMapPinPrefix}</span>{no}
</span>
