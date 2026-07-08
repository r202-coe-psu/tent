<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { EvacueeProfileView } from '$lib/features/people';

	let { data } = $props();
</script>

<svelte:head>
	<title>ข้อมูลผู้พักพิง · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
	<button
		onclick={() => goto(resolve('/onsite/people'))}
		class="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="size-4" />
		<span>กลับไปหน้าลงทะเบียน</span>
	</button>

	<h1 class="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl dark:text-slate-50">
		ข้อมูลผู้พักพิง
	</h1>

	<EvacueeProfileView evacueeId={data.id} />
</div>
