<script lang="ts">
	import { page } from '$app/state';
	import {
		buildKioskContextQuery,
		readKioskDisplayQuery,
		KioskPrintQrChooser
	} from '$lib/features/kiosk';

	const contextQuery = $derived(
		buildKioskContextQuery(readKioskDisplayQuery(page.url.searchParams))
	);
</script>

<KioskPrintQrChooser {contextQuery} />
