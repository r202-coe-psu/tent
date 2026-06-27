<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Building from '@lucide/svelte/icons/building';
	import Plus from '@lucide/svelte/icons/plus';
	import { ShelterList, useShelters, type ShelterSummary } from '$lib/features/shelters';

	const sheltersQuery = useShelters();

	function handleCreateNew() {
		goto(resolve('/back-office/shelters/create'));
	}

	function handleEdit(shelter: ShelterSummary) {
		goto(resolve(`/back-office/shelters/edit/${encodeURIComponent(shelter.code)}`));
	}
</script>

<svelte:head>
	<title>ตั้งค่าศูนย์พักพิง · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 flex-col gap-6 p-6">
	<div class="flex items-center justify-between gap-4 border-l-4 border-border pl-3">
		<h2 class="text-sm font-bold text-foreground">จัดการโครงสร้างศูนย์พักพิง</h2>
		<Button size="sm" onclick={handleCreateNew}>
			<Plus class="mr-2 h-4 w-4" /> เพิ่มศูนย์พักพิงใหม่
		</Button>
	</div>

	<Card.Root>
		<Card.Header>
			<div class="flex items-center gap-2">
				<Building class="h-4 w-4 text-muted-foreground" />
				<Card.Title class="text-sm">ศูนย์พักพิงในระบบ</Card.Title>
			</div>
		</Card.Header>
		<Card.Content>
			{#if sheltersQuery.isLoading}
				<p class="text-sm text-muted-foreground">กำลังโหลด...</p>
			{:else if sheltersQuery.isError}
				<p class="text-sm text-destructive">เกิดข้อผิดพลาด: {sheltersQuery.error?.message}</p>
			{:else}
				<ShelterList shelters={sheltersQuery.data ?? []} onedit={handleEdit} />
			{/if}
		</Card.Content>
	</Card.Root>
</div>
