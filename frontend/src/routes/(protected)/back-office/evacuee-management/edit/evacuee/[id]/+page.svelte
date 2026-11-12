<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BackLink from '$lib/components/back-link.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import { EvacueeProfileView } from '$lib/features/people';

	let { data } = $props();
</script>

<svelte:head>
	<title>ข้อมูลผู้พักพิง · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
	<div>
		<BackLink
			href={resolve('/back-office/evacuee-management?tab=evacuee')}
			label="กลับไปรายชื่อผู้เข้าพัก"
			class="mb-4 -ml-3"
		/>

		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<h1 class="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl dark:text-slate-50">
				ทะเบียนผู้พักพิง (Evacuee Registry)
			</h1>
			<button
				class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-50 shadow-sm transition-colors hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-950 dark:hover:bg-slate-200"
				onclick={() => goto(resolve('/onsite/people'))}
			>
				<Plus class="size-4" />
				<span>เริ่มลงทะเบียน</span>
			</button>
		</div>
	</div>

	<EvacueeProfileView evacueeId={data.id} />
</div>
