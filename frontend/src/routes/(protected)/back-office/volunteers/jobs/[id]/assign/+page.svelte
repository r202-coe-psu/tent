<script lang="ts">
	/**
	 * `/back-office/volunteers/jobs/[id]/assign` — dispatch volunteers into a
	 * sub-shift (01-tab-job-board.md §01.5). Thin shell: the screen itself lives
	 * in the feature slice (`JobAssignPage`), reached through the barrel.
	 */
	import { JobAssignPage } from '$lib/features/volunteers';

	let { data } = $props();
</script>

<svelte:head>
	<title>มอบหมายอาสาเข้ากะ · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-[100rem] p-4">
	<JobAssignPage jobId={data.id} shiftId={data.shiftId} />
</div>
