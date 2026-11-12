<script lang="ts">
	import { resolve } from '$app/paths';
	import BackLink from '$lib/components/back-link.svelte';
	import { HouseholdProfileView } from '$lib/features/people';

	let { data } = $props();
</script>

<svelte:head>
	<title>ข้อมูลครัวเรือน · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
	<div>
		<BackLink
			href={resolve('/back-office/evacuee-management?tab=household')}
			label="กลับไปรายชื่อครัวเรือน"
			class="mb-4 -ml-3"
		/>

		<h1 class="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl dark:text-slate-50">
			ทะเบียนครัวเรือน (Household Registry)
		</h1>
	</div>

	<HouseholdProfileView householdId={data.id} />
</div>
