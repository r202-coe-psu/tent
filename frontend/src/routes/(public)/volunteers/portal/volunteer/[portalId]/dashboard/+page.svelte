<script lang="ts">
	import { VolunteerAccessPortal, accessPortalI18n } from '$lib/features/volunteer-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const t = $derived(getTranslation(accessPortalI18n, langState.current));
</script>

<svelte:head>
	<title>{t.pageTitleDashboard}</title>
</svelte:head>

<VolunteerAccessPortal mode="dashboard" portalId={params.portalId} />
