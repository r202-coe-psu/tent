<script lang="ts">
	import { page } from '$app/state';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_HOME_PAGE_I18N } from './page.i18n';
	import type { PageProps } from './$types';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		readKioskDisplayQuery,
		IdentityMethodSelector,
		KioskBannerAttract,
		KioskDeviceInfo,
		returnToKioskLanguagePicker
	} from '$lib/features/kiosk';
	let { data }: PageProps = $props();

	const t = $derived(getTranslation(KIOSK_HOME_PAGE_I18N, languageStore.current));
	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams), languageStore.current)
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
</script>

<svelte:head>
	<title>{t.pageTitle} — SmartShelter Kiosk</title>
</svelte:head>

<IdentityMethodSelector
	{contextQuery}
	qrCheckInEnabled={data.qrCheckInEnabled}
	reprintEnabled={data.phoneCheckInEnabled}
	thaidCheckInEnabled={data.thaidCheckInEnabled}
/>
<KioskDeviceInfo />
<KioskBannerAttract mode="live" onDismiss={() => returnToKioskLanguagePicker(contextQuery)} />
