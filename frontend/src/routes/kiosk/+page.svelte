<script lang="ts">
	import { page } from '$app/state';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		IdentityMethodSelector
	} from '$lib/features/kiosk';

	const displayContext = $derived(
		getKioskDisplayContext({
			shelter_name: page.url.searchParams.get('shelter_name'),
			shelter_code: page.url.searchParams.get('shelter_code'),
			station_name: page.url.searchParams.get('station_name'),
			device_name: page.url.searchParams.get('device_name')
		})
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
</script>

<svelte:head>
	<title>เลือกวิธียืนยันตัวตน — SmartShelter Kiosk</title>
</svelte:head>

<IdentityMethodSelector {contextQuery} />
