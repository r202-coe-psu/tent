<script lang="ts">
	import { VolunteerAccessPortal, accessPortalI18n } from '$lib/features/volunteer-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	const t = $derived(getTranslation(accessPortalI18n, langState.current));
</script>

<svelte:head>
	<title>{t.pageTitleEntry}</title>
</svelte:head>

<VolunteerAccessPortal mode="entry" />
