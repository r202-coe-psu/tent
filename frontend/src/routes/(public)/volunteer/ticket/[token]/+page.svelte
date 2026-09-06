<script lang="ts">
	import { page } from '$app/state';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { DigitalPass } from '$lib/features/volunteer-portal';
	import { languageStore } from '$lib/stores/language.svelte';
	import { ticketI18n } from '$lib/features/volunteer-portal/i18n/ticket.i18n';

	const token = $derived(page.params.token ?? '');
	const t = $derived(ticketI18n[languageStore.current]);
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
	<!-- A pass URL is a bearer credential; keep it out of search results. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<PublicPageShell>
	<DigitalPass {token} />
</PublicPageShell>
