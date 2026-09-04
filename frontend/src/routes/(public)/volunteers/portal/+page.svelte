<script lang="ts">
	import { PublicPageShell } from '$lib/features/public-portal';
	import { VolunteerAccessPortal } from '$lib/features/volunteer-portal';
</script>

<svelte:head>
	<title>พอร์ทัล & บัตรงานอาสา — Smart Shelter</title>
</svelte:head>

<PublicPageShell class="space-y-6">
	<VolunteerAccessPortal />
</PublicPageShell>
