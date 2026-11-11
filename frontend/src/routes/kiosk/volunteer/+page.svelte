<script lang="ts">
	import { page } from '$app/state';
	import {
		buildKioskContextQuery,
		readKioskDisplayQuery,
		KioskVolunteerCard
	} from '$lib/features/kiosk';

	const contextQuery = $derived(
		buildKioskContextQuery(readKioskDisplayQuery(page.url.searchParams))
	);
</script>

<KioskVolunteerCard {contextQuery} />
