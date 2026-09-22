<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { getKioskDisplayContext, KioskShell } from '$lib/features/kiosk';

	let { children }: { children: Snippet } = $props();

	const displayContext = $derived(
		getKioskDisplayContext({
			shelter_name: page.url.searchParams.get('shelter_name'),
			shelter_code: page.url.searchParams.get('shelter_code'),
			station_name: page.url.searchParams.get('station_name'),
			device_name: page.url.searchParams.get('device_name')
		})
	);
	const showClock = $derived(!page.url.pathname.startsWith('/kiosk/scanner/'));
</script>

<KioskShell {...displayContext} {showClock}>
	{@render children()}
</KioskShell>
