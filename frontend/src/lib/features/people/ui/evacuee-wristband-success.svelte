<script lang="ts">
	import type { Evacuee } from '../domain/people';
	import EvacueeQrModal from './evacuee-qr-modal.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { EVACUEE_QR_MODAL_I18N } from './_constants/evacuee-qr-modal.i18n';

	const t = $derived(getTranslation(EVACUEE_QR_MODAL_I18N, languageStore.current));

	let {
		evacuee,
		onBack
	}: {
		evacuee: Evacuee;
		onBack: () => void;
	} = $props();
</script>

<EvacueeQrModal
	show={true}
	{evacuee}
	embedded={true}
	closeLabel={t.backOrRegisterNew}
	onClose={onBack}
/>
