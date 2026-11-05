<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BackLink from '$lib/components/back-link.svelte';
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
		<BackLink
			href={resolve('/back-office/incidents')}
			label="กลับไปบันทึกเหตุการณ์ประจำวัน"
			class="shrink-0 rounded-xl"
		/>
	</header>

	<IncidentCreateForm oncreated={openCreated} />
</div>
