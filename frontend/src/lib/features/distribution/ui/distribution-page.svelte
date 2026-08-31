<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import SearchX from '@lucide/svelte/icons/search-x';
	import { getShelterCode } from '$lib/db/shelter';
	import { useDistributionRequests } from '../application/queries';
	import RequestFilters from './request-filters.svelte';
	import RequestStatsHeader from './request-stats-header.svelte';
	import RequestTable from './request-table.svelte';
	import { filterDistributionRequests, type RequestStatusFilter } from './request-ui';

	const requestQuery = useDistributionRequests(
		() => undefined,
		() => getShelterCode()
	);
	const requests = $derived(requestQuery.data ?? []);
	let search = $state('');
	let status = $state<RequestStatusFilter>('all');

	const filteredRequests = $derived(filterDistributionRequests(requests, search, status));

	const hasFilters = $derived(status !== 'all' || search.trim().length > 0);
</script>

<main class="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
	<header class="space-y-1 border-b border-border/60 pb-5">
		<h1 class="text-3xl font-extrabold tracking-tight">จัดการคำร้องเบิกจ่าย</h1>
		<p class="text-sm text-muted-foreground">ติดตามสถานะคำร้องเบิกจ่ายสิ่งของภายในศูนย์พักพิง</p>
	</header>

	{#if requestQuery.isLoading}
		<Card.Root class="border-border/80 shadow-xs">
			<Card.Content
				class="flex min-h-72 flex-col items-center justify-center gap-3 p-6 text-muted-foreground"
			>
				<Loader2 class="h-8 w-8 animate-spin text-primary" />
				<p class="text-sm">กำลังโหลดคำร้องเบิกจ่าย...</p>
			</Card.Content>
		</Card.Root>
	{:else if requestQuery.isError}
		<Card.Root class="border-destructive/30 bg-destructive/5 shadow-xs">
			<Card.Content class="p-6">
				<h2 class="font-semibold text-destructive">ไม่สามารถโหลดคำร้องเบิกจ่ายได้</h2>
				<p class="mt-1 text-sm text-muted-foreground">โปรดลองใหม่อีกครั้งในภายหลัง</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<RequestStatsHeader {requests} />
		<Card.Root class="border-border/80 shadow-xs">
			<Card.Header>
				<Card.Title>รายการคำร้องเบิกจ่าย</Card.Title>
				<Card.Description>ค้นหาและกรองสถานะจากข้อมูลคำร้องจริงของศูนย์พักพิง</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<RequestFilters bind:search bind:status />
				{#if requests.length === 0}
					<div
						class="flex min-h-56 flex-col items-center justify-center gap-3 text-center text-muted-foreground"
					>
						<ClipboardList class="h-10 w-10" />
						<div>
							<p class="font-medium text-foreground">ยังไม่มีคำร้องเบิกจ่าย</p>
							<p class="mt-1 text-sm">คำร้องที่สร้างในศูนย์พักพิงจะแสดงที่นี่</p>
						</div>
					</div>
				{:else if filteredRequests.length === 0 && hasFilters}
					<div
						class="flex min-h-56 flex-col items-center justify-center gap-3 text-center text-muted-foreground"
					>
						<SearchX class="h-10 w-10" />
						<div>
							<p class="font-medium text-foreground">ไม่พบคำร้องที่ตรงกับเงื่อนไข</p>
							<p class="mt-1 text-sm">ลองเปลี่ยนคำค้นหาหรือสถานะที่เลือก</p>
						</div>
					</div>
				{:else}
					<RequestTable requests={filteredRequests} />
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</main>
