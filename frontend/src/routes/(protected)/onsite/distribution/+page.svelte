<script lang="ts">
	import { FrontlineStationPage, parseOnsiteDistributionParams } from '$lib/features/distribution';
	import { page } from '$app/state';

	// `?mode=&tab=&pool=` come from a link; the desk owns the URL after that and rewrites it whole.
	const urlState = $derived(parseOnsiteDistributionParams(page.url.searchParams));
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
/>
