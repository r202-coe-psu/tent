<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { languageStore } from '$lib/stores/language.svelte';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		goToKioskClosed,
		isKioskHomePath,
		KIOSK_LANGUAGE_PATH,
		KioskServiceWatch,
		KioskShell,
		readKioskDisplayQuery,
		readKioskServiceOpen
	} from '$lib/features/kiosk';

	let { children }: { children: Snippet } = $props();

	const query = $derived(readKioskDisplayQuery(page.url.searchParams));
	const displayContext = $derived(getKioskDisplayContext(query, languageStore.current));
	const contextQuery = $derived(buildKioskContextQuery(query));
	const showClock = $derived(!page.url.pathname.startsWith('/kiosk/scanner/'));

	// Only an idle home screen / language picker needs this: mid-flow pages are cut at the next action
	// (403 KIOSK_CLOSED), and the closed page watches for the opposite change itself.
	const watchesClosing = $derived(
		isKioskHomePath(page.url.pathname) || page.url.pathname === KIOSK_LANGUAGE_PATH
	);
	$effect(() => {
		if (!watchesClosing) return;
		const search = contextQuery;
		const watch = new KioskServiceWatch({
			readServiceOpen: () => readKioskServiceOpen(fetch),
			until: 'closed',
			onChange: () => goToKioskClosed(search)
		});
		watch.start();
		return () => watch.stop();
	});
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
