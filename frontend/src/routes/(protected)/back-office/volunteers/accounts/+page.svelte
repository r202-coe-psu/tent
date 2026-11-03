<script lang="ts">
	/**
	 * `/back-office/volunteers/accounts` — the shelter's volunteer accounts (CR-221 FR-5, FR-8).
	 * Thin shell: the screen lives in the feature slice (`VolunteerAccountsPage`).
	 */
	import { VolunteerAccountsPage } from '$lib/features/volunteers';
</script>

<svelte:head>
	<title>บัญชีจิตอาสา · SmartShelter</title>
</svelte:head>

<VolunteerAccountsPage />
