<script lang="ts">
	import { PublicPageShell } from '$lib/features/public-portal';
	import { TicketFinder, ticketI18n } from '$lib/features/volunteer-portal';
	import { languageStore } from '$lib/stores/language.svelte';

	const t = $derived(ticketI18n[languageStore.current]);
</script>

<svelte:head>
	<title>{t.finderPageTitle}</title>
</svelte:head>

<!--
	The same finder the board's second tab renders, on its own URL so it can be linked
	to directly (CR-092 §5) — a volunteer who lost their pass link is told to come here,
	not "open the board and switch tabs".
-->
<PublicPageShell class="space-y-6 lg:px-8" maxWidth="max-w-7xl">
	<header class="space-y-1 text-center">
		<h1 class="text-2xl font-bold">{t.finderTitle}</h1>
		<p class="text-sm text-muted-foreground">{t.finderSubtitle}</p>
	</header>

	<TicketFinder />
</PublicPageShell>
