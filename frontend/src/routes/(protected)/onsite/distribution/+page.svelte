<script lang="ts">
	import {
		FrontlineStationPage,
		mergeOnsitePoolParam,
		parseOnsiteDistributionParams
	} from '$lib/features/distribution';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// `?tab=returns&pool=<id>` opens the returns tab with that bulk return pool's detail.
	const urlState = $derived.by(() => {
		try {
			return parseOnsiteDistributionParams(page.url.searchParams);
		} catch {
			return { tab: null, pool: null };
		}
	});

	// Keep `pool` in the URL on select / close; other params are preserved.
	function updatePoolParam(poolId: string | null) {
		try {
			const qs = mergeOnsitePoolParam(page.url.searchParams, poolId).toString();
			if (qs === page.url.searchParams.toString()) return;
			void goto(
				resolve(
					`/onsite/distribution${qs ? `?${qs}` : ''}` as
						'/onsite/distribution' | `/onsite/distribution?${string}`
				),
				{ replaceState: true, keepFocus: true, noScroll: true }
			);
		} catch {
			// page.url unavailable — nothing to persist
		}
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
/>
