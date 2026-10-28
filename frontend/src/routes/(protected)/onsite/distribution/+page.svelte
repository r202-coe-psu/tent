<script lang="ts">
	import {
		FrontlineStationPage,
		mergeOnsitePoolParam,
		mergeOnsiteTabParam,
		parseOnsiteDistributionParams,
		ONSITE_DISTRIBUTION_PATH,
		type FrontlineTab,
		type OnsiteDistributionHref
	} from '$lib/features/distribution';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// `?tab=returns&pool=<id>` opens the returns tab with that bulk return pool's detail.
	const urlState = $derived(parseOnsiteDistributionParams(page.url.searchParams));

	// Replace the query string (other params preserved); skipped when nothing changed.
	function replaceQuery(next: URLSearchParams) {
		const qs = next.toString();
		if (qs === page.url.searchParams.toString()) return;
		const href: OnsiteDistributionHref = qs
			? `${ONSITE_DISTRIBUTION_PATH}?${qs}`
			: ONSITE_DISTRIBUTION_PATH;
		void goto(resolve(href), { replaceState: true, keepFocus: true, noScroll: true });
	}

	// Keep `pool` in the URL on select / close.
	function updatePoolParam(poolId: string | null) {
		replaceQuery(mergeOnsitePoolParam(page.url.searchParams, poolId));
	}

	// Keep `tab` in the URL; `pool` is dropped once the user leaves the returns tab.
	function updateTabParam(tab: FrontlineTab) {
		replaceQuery(mergeOnsiteTabParam(page.url.searchParams, tab));
	}
</script>

<svelte:head>
	<title>จุดแจกจ่ายพัสดุและอาหาร (Station 4) · SmartShelter</title>
	<meta
		name="description"
		content="สถานีแจกจ่ายอาหารปรุงสุก พัสดุบรรเทาทุกข์ และระบบยืม-คืน สำหรับผู้ปฏิบัติงานส่วนหน้า (Frontline Distribution Desk — Station 4)"
	/>
</svelte:head>

<FrontlineStationPage
	initialTab={urlState.tab ?? 'receive'}
	initialPoolId={urlState.pool}
	onSelectedPoolChange={updatePoolParam}
	onTabChange={updateTabParam}
/>
