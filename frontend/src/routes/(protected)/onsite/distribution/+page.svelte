<script lang="ts">
	import { FrontlineStationPage, parseOnsiteDistributionParams } from '$lib/features/distribution';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';

	// `?mode=&tab=&pool=` come from a link; the desk owns the URL after that and rewrites it whole.
	// The desk's last shallow write lives in `page.state.deskSearch` (restored on Back); `page.url`
	// still holds the original link, so it is only used when no desk write has happened.
	const urlState = $derived(
		parseOnsiteDistributionParams(
			page.state.deskSearch !== undefined
				? new URLSearchParams(page.state.deskSearch)
				: page.url.searchParams
		)
	);

	// Shallow `replaceState` leaves `page.url` stale, so following the same link again changes no
	// prop. This counter bumps on real navigations only (not on shallow writes) to re-apply it.
	let linkKey = $state(0);
	afterNavigate((nav) => {
		if (nav.type !== 'enter') linkKey++;
	});
</script>

<svelte:head>
	<title>จุดแจกจ่ายพัสดุและอาหาร (Station 4) · SmartShelter</title>
	<meta
		name="description"
		content="สถานีแจกจ่ายอาหารปรุงสุก พัสดุบรรเทาทุกข์ และระบบยืม-คืน สำหรับผู้ปฏิบัติงานส่วนหน้า (Frontline Distribution Desk — Station 4)"
	/>
</svelte:head>

<FrontlineStationPage
	initialMode={urlState.mode}
	initialTab={urlState.tab ?? 'receive'}
	initialPoolId={urlState.pool}
	{linkKey}
/>
