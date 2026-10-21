<script lang="ts">
	/**
	 * `/back-office/volunteers/jobs/new` — announce a new volunteer job (#639).
	 * Thin shell: the screen lives in the feature slice (`JobFormPage`).
	 */
	import { JobFormPage } from '$lib/features/volunteers';
</script>

<svelte:head>
	<title>ประกาศงานอาสาสมัครใหม่ · SmartShelter</title>
</svelte:head>

<JobFormPage />
