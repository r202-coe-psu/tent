<script lang="ts">
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import { SystemBannerSettings } from '$lib/features/shared';
</script>

<svelte:head>
	<title>แบนเนอร์ระบบ — SmartShelter</title>
</svelte:head>

<StaffPageShell title="แบนเนอร์ระบบ">
	<div class={spatial.container.staffPageCard}>
		<SystemBannerSettings />
	</div>
</StaffPageShell>
