<script lang="ts">
	import { ReadinessAssessmentPage } from '$lib/features/shelter-readiness';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Keep header selector aligned with current shelter
	$effect(() => {
		if (data.shelterCode && shelterStore.selectedShelterCode !== data.shelterCode) {
			shelterStore.selectedShelterCode = data.shelterCode;
		}
	});

	const shelterName = $derived(`ศูนย์พักพิง (${data.shelterCode})`);

	const currentUser = $derived(
		authStore.user?.display_name || authStore.user?.name || 'เจ้าหน้าที่ผู้ตรวจ'
	);
</script>

<svelte:head>
	<title>แบบประเมินความพร้อมศูนย์ {data.shelterCode} · SmartShelter</title>
</svelte:head>

<div class="min-h-screen w-full bg-slate-50/50 p-4 sm:p-6 lg:p-8">
	<ReadinessAssessmentPage
		shelterCode={data.shelterCode}
		{shelterName}
		initialAssessments={data.initialAssessments}
		{currentUser}
	/>
</div>
