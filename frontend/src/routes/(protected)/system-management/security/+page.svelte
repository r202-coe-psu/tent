<script lang="ts">
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import { RecaptchaSettings, ThaidSettings } from '$lib/features/shared';
</script>

<svelte:head>
	<title>ความปลอดภัย — SmartShelter</title>
</svelte:head>

<StaffPageShell title="ความปลอดภัย" maxWidth="3xl">
	<div class={spatial.container.staffPageCard}>
		<div class="divide-y divide-slate-200/80">
			<div class="px-5 py-4 sm:px-6">
				<RecaptchaSettings />
			</div>
			<div class="px-5 py-4 sm:px-6">
				<ThaidSettings />
			</div>
		</div>
	</div>
</StaffPageShell>
