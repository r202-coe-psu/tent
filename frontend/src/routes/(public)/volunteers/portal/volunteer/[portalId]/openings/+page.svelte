<script lang="ts">
	import { VolunteerAccessPortal } from '$lib/features/volunteer-portal';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<svelte:head>
	<title>งานอาสาที่เปิดรับ — Smart Shelter</title>
</svelte:head>

<VolunteerAccessPortal mode="openings" portalId={params.portalId} />
