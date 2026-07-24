<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { HouseholdProfileView } from '$lib/features/people';

	let { data } = $props();
</script>

<svelte:head>
	<title>ข้อมูลครัวเรือน · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
	<div>
		<button
			onclick={() => {
				const from = page.url.searchParams.get('from');
				if (from) {
					goto(from);
				} else {
					goto(resolve('/back-office/evacuee-management?tab=household'));
				}
			}}
			class="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline"
		>
			<ArrowLeft class="size-4" />
			<span>กลับไปหน้ารายชื่อครัวเรือน</span>
		</button>

		<h1 class="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl dark:text-slate-50">
			ทะเบียนครัวเรือน (Household Registry)
		</h1>
	</div>

	<HouseholdProfileView householdId={data.id} />
</div>
