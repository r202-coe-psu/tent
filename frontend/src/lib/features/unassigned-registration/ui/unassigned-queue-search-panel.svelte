<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';

	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';

	import {
		CLAIM_FLOW_STATUS_GUIDANCE,
		formatOpenMemberName,
		isOnlineRequiredError,
		useUnassignedRegistrationSearch,
		UnassignedRegistrationApiError,
		type UnassignedRegistrationSearchHit
	} from '../application/queries';
	import ClaimDialog from './claim-dialog.svelte';
	import UnassignedQueueBadge from './unassigned-queue-badge.svelte';

	let searchQuery = $state('');
	let submittedQuery = $state('');
	let selected = $state<UnassignedRegistrationSearchHit | null>(null);
	let claimOpen = $state(false);

	const search = useUnassignedRegistrationSearch(() => submittedQuery);

	const results = $derived(search.data?.results ?? []);
	const isPending = $derived(search.isPending && submittedQuery.length > 0);
	const isError = $derived(search.isError);
	const onlineRequired = $derived(
		isError &&
			(isOnlineRequiredError(search.error) ||
				(search.error instanceof UnassignedRegistrationApiError &&
					search.error.code === 'ONLINE_REQUIRED'))
	);
	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	function runSearch() {
		submittedQuery = searchQuery.trim();
		selected = null;
		claimOpen = false;
	}

	function openClaimModal(hit: UnassignedRegistrationSearchHit) {
		selected = hit;
		claimOpen = true;
	}

	function clearSearch() {
		searchQuery = '';
		submittedQuery = '';
		selected = null;
		claimOpen = false;
	}
</script>

<div class="flex flex-col gap-4">
	<div class="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm text-slate-700">
		{CLAIM_FLOW_STATUS_GUIDANCE}
	</div>

	<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
		<div class="relative flex-1">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				placeholder="ชื่อ เบอร์โทร หรือเลขบัตร ของสมาชิกที่ยัง open..."
				bind:value={searchQuery}
				class="h-10 pl-9"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						runSearch();
					}
				}}
			/>
			{#if searchQuery}
				<button
					type="button"
					class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
					onclick={clearSearch}
				>
					<X class="size-3.5" />
				</button>
			{/if}
		</div>
		<Button type="button" onclick={runSearch} class="gap-2">
			<Search class="size-4" />
			ค้นหาคิวกลาง
		</Button>
	</div>

	{#if !submittedQuery}
		<p class="text-sm text-muted-foreground">พิมพ์คำค้นแล้วกดค้นหาเพื่อดึงรายการจากคิวกลาง</p>
	{:else if isPending}
		<div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
			กำลังค้นหา...
		</div>
	{:else if isError}
		<div
			class="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-950"
		>
			<p>
				{#if onlineRequired}
					ต้องเชื่อมต่อส่วนกลางเพื่อค้นหาคิวลงทะเบียนล่วงหน้า (ไม่ระบุศูนย์)
				{:else}
					ค้นหาไม่สำเร็จ — ตรวจสอบการเชื่อมต่อส่วนกลางแล้วลองใหม่
				{/if}
			</p>
			<Button type="button" variant="outline" onclick={runSearch}>ลองอีกครั้ง</Button>
		</div>
	{:else if results.length === 0}
		<div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
			ไม่พบสมาชิก open ที่ตรงกับคำค้น
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-muted/30">
							<Table.Head class="pl-4">แหล่ง</Table.Head>
							<Table.Head>สมาชิก open</Table.Head>
							<Table.Head>เบอร์โทร</Table.Head>
							<Table.Head>เลขบัตร</Table.Head>
							<Table.Head>สร้างเมื่อ</Table.Head>
							<Table.Head class="pr-4">การดำเนินการ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each results as hit (hit.id)}
							{#each hit.open_members as member (member.reserved_evacuee_id)}
								<Table.Row>
									<Table.Cell class="pl-4">
										<UnassignedQueueBadge compact />
									</Table.Cell>
									<Table.Cell class="font-medium">{formatOpenMemberName(member)}</Table.Cell>
									<Table.Cell class="text-sm tabular-nums">{member.phone ?? '—'}</Table.Cell>
									<Table.Cell class="text-sm tabular-nums">
										{member.person_id?.number ?? '—'}
									</Table.Cell>
									<Table.Cell class="text-xs text-muted-foreground">
										{hit.created_at.slice(0, 16).replace('T', ' ')}
									</Table.Cell>
									<Table.Cell class="pr-4">
										<Button
											type="button"
											size="sm"
											variant="secondary"
											onclick={() => openClaimModal(hit)}
										>
											รับเข้าศูนย์
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
	{/if}
</div>

<ClaimDialog bind:open={claimOpen} bind:hit={selected} {shelterCode} />
