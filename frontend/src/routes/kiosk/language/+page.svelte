<script lang="ts">
	import { page } from '$app/state';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		KioskLanguagePicker,
		readKioskDisplayQuery
	} from '$lib/features/kiosk';

	const contextQuery = $derived(
		buildKioskContextQuery(getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams)))
	);
</script>

<svelte:head>
	<title>เลือกภาษา / Choose your language — SmartShelter Kiosk</title>
</svelte:head>

<KioskLanguagePicker {contextQuery} />
