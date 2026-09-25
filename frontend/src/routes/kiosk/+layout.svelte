<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { getKioskDisplayContext, KioskShell, readKioskDisplayQuery } from '$lib/features/kiosk';

	let { children }: { children: Snippet } = $props();

	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const showClock = $derived(!page.url.pathname.startsWith('/kiosk/scanner/'));
</script>

<KioskShell
	shelterName={displayContext.shelterName}
	shelterCode={displayContext.shelterCode}
	stationName={displayContext.stationName}
	deviceName={displayContext.deviceName}
	{showClock}
>
	{@render children()}
</KioskShell>
