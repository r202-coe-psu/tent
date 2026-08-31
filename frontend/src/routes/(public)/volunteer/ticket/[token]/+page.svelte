<script lang="ts">
	import { page } from '$app/state';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { DigitalPass } from '$lib/features/volunteer-portal';

	const token = $derived(page.params.token ?? '');
</script>

<svelte:head>
	<title>บัตรประจำตัวจิตอาสาดิจิทัล — Smart Shelter</title>
	<!-- A pass URL is a bearer credential; keep it out of search results. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<PublicPageShell>
	<DigitalPass {token} />
</PublicPageShell>
