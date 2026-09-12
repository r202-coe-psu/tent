<script lang="ts">
	/**
	 * `/back-office/volunteers/jobs/[id]` — job detail + shift schedule
	 * (01-tab-job-board.md §01.5). Thin shell: the screen itself lives in the
	 * feature slice (`JobDetailPage`), reached through the barrel.
	 */
	import { JobDetailPage } from '$lib/features/volunteers';

	let { data } = $props();
</script>

<svelte:head>
	<title>รายละเอียดงานอาสาสมัคร · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-[100rem] p-4">
	<JobDetailPage jobId={data.id} />
</div>
