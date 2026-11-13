<script lang="ts">
	import type { KioskBannerGroupSummary } from '../../data/kiosk-banner.repository';
	import KioskBannerGroupTvCode from '../kiosk-banner-group-tv-code.svelte';

	/** Test-only parent: can swap `initial` for `refreshed` to simulate a refetch of the group. */
	let {
		initial,
		refreshed,
		origin
	}: {
		initial: KioskBannerGroupSummary;
		refreshed: KioskBannerGroupSummary;
		origin: string;
	} = $props();

	let useRefreshed = $state(false);
	const group = $derived(useRefreshed ? refreshed : initial);
</script>

<button type="button" data-testid="refetch" onclick={() => (useRefreshed = true)}>refetch</button>
<KioskBannerGroupTvCode {group} {origin} />
