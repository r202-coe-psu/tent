<script lang="ts">
	import { VolunteerAccessPortal } from '$lib/features/volunteer-portal';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<svelte:head>
	<title>ตารางงานจิตอาสา — Smart Shelter</title>
</svelte:head>

<VolunteerAccessPortal mode="dashboard" portalId={params.portalId} />
