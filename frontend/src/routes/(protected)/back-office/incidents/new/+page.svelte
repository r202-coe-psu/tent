<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '$lib/components/ui/button/index.js';
	import { IncidentCreateForm, type ShelterIncident } from '$lib/features/incidents';

	function openCreated(incident: ShelterIncident) {
		goto(resolve(`/back-office/incidents/${encodeURIComponent(incident._id)}`));
	}
</script>

<svelte:head>
	<title>บันทึกเหตุการณ์ใหม่ | SmartShelter Thailand</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
	<header
		class="flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center"
	>
		<div class="space-y-1">
			<h2 class="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
				บันทึกเหตุการณ์ใหม่
			</h2>
			<p class="text-sm text-muted-foreground">
				ไม่จำเป็นต้องผูกกับผู้เข้าพัก และระบุคู่กรณีภายหลังได้หากยังไม่ทราบตัวตน
			</p>
		</div>
		<Button
			variant="outline"
			href={resolve('/back-office/incidents')}
			class="min-h-11 shrink-0 gap-1.5 rounded-xl"
		>
			<ArrowLeft class="h-4 w-4" />
			ย้อนกลับ
		</Button>
	</header>

	<IncidentCreateForm oncreated={openCreated} />
</div>
