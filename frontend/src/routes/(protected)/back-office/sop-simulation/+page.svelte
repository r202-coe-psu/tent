<script lang="ts">
	import { ScenarioWorkspace } from '$lib/features/sop-simulation';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import Building2 from '@lucide/svelte/icons/building-2';
</script>

<svelte:head>
	<title>SOP What-if Simulation · SmartShelter</title>
	<meta
		name="description"
		content="จำลองจำนวนผู้พักพิง ระยะเวลา และ SOP ratio โดยไม่เปลี่ยนข้อมูลคำนวณจริง"
	/>
</svelte:head>

<div class="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
	{#if shelterStore.selectedShelterCode}
		{#key shelterStore.selectedShelterCode}
			<ScenarioWorkspace shelterCode={shelterStore.selectedShelterCode} />
		{/key}
	{:else}
		<div
			class="mx-auto flex min-h-[20rem] max-w-2xl items-center justify-center rounded-2xl border border-dashed bg-card/60 p-8 text-center"
		>
			<div class="max-w-sm">
				<div class="mx-auto grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
					<Building2 class="size-5" />
				</div>
				<p class="mt-4 text-[11px] font-extrabold tracking-[0.14em] text-primary uppercase">
					เริ่มต้นการจำลอง
				</p>
				<h2 class="mt-2 text-lg font-black tracking-tight">เลือกศูนย์พักพิงก่อนเริ่มงาน</h2>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					เลือกศูนย์จากตัวเลือกด้านบนเพื่อโหลด baseline ล่าสุดและตั้งสถานการณ์ what-if
				</p>
			</div>
		</div>
	{/if}
</div>
