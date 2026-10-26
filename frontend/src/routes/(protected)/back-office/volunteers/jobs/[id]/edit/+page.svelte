<script lang="ts">
	/**
	 * `/back-office/volunteers/jobs/[id]/edit` — edit a volunteer job (#639).
	 * Thin shell: the screen lives in the feature slice (`JobFormPage`).
	 */
	import { JobFormPage } from '$lib/features/volunteers';

	let { data } = $props();
</script>

<svelte:head>
	<title>แก้ไขงานอาสาสมัคร · SmartShelter</title>
</svelte:head>

<JobFormPage jobId={data.id} />
