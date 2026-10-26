<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		readKioskDisplayQuery,
		IdentityMethodSelector,
		KioskBannerAttract,
		KioskDeviceInfo
	} from '$lib/features/kiosk';
	let { data }: PageProps = $props();

	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
</script>

<svelte:head>
	<title>เลือกวิธียืนยันตัวตน — SmartShelter Kiosk</title>
</svelte:head>

<IdentityMethodSelector
	{contextQuery}
	qrCheckInEnabled={data.qrCheckInEnabled}
	reprintEnabled={data.phoneCheckInEnabled}
	thaidCheckInEnabled={data.thaidCheckInEnabled}
/>
<KioskDeviceInfo />
<KioskBannerAttract mode="live" />
