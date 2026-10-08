<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQueryClient } from '@tanstack/svelte-query';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { IncidentList, startIncidentLiveQuery } from '$lib/features/incidents';
	import { getShelterCode } from '$lib/db/shelter';

	const queryClient = useQueryClient();
	const shelterCode = $derived(getShelterCode());

	// Reactivity comes from the shelter DB changes feed — never poll.
	$effect(() => {
		const handle = startIncidentLiveQuery(queryClient);
		return () => handle.stop();
	});
</script>

<svelte:head>
	<title>บันทึกเหตุการณ์ประจำวัน | SmartShelter Thailand</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
	<header
		class="flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center"
	>
		<div class="space-y-1">
			<h2 class="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
				บันทึกเหตุการณ์ประจำวัน
			</h2>
			<p class="text-sm text-muted-foreground">
				เจ้าหน้าที่ทุกคนเปิดบันทึกได้ และเป็นผู้รับผิดชอบเคสทันที —
				ค่าเริ่มต้นแสดงเคสที่ยังไม่ปิดสำหรับส่งเวร
			</p>
		</div>
		<Button
			href={resolve('/back-office/incidents/new')}
			class="min-h-11 w-full gap-2 rounded-xl font-semibold shadow-sm sm:w-auto"
		>
			<Plus class="h-4.5 w-4.5" />
			บันทึกเหตุการณ์ใหม่
		</Button>
	</header>

	<IncidentList {shelterCode} />
</div>
