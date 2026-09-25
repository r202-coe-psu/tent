<script lang="ts">
	import { page } from '$app/state';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		readKioskDisplayQuery,
		KioskQrIdentityScan
	} from '$lib/features/kiosk';

	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
</script>

<KioskQrIdentityScan {contextQuery} displayShelterCode={displayContext.shelterCode} />
