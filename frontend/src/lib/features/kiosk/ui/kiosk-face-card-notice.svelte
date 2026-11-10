<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_FACE_I18N } from './_constants/kiosk-face.i18n';
	import KioskInlineAlert from './kiosk-inline-alert.svelte';

	interface Props {
		/** The chip photo has been read: the card may be taken out. */
		removable: boolean;
	}

	let { removable }: Props = $props();

	const t = $derived(getTranslation(KIOSK_FACE_I18N, languageStore.current).cardNotice);
</script>

<!--
	Check-in reads the chip photo while the person is at the camera, so the card has to stay in
	until the system says otherwise (same amber warning as the card-reading page).
-->
{#if removable}
	<KioskInlineAlert
		tone="success"
		icon={CheckCircle2}
		class="mb-4 kiosk-compact:mb-2"
		role="status"
		data-testid="kiosk-face-card-notice"
		data-card-removable="true">{t.removable}</KioskInlineAlert
	>
{:else}
	<KioskInlineAlert
		tone="warning"
		icon={CircleAlert}
		class="mb-4 kiosk-compact:mb-2"
		role="status"
		data-testid="kiosk-face-card-notice"
		data-card-removable="false">{t.keepInserted}</KioskInlineAlert
	>
{/if}
