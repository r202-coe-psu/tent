<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Users from '@lucide/svelte/icons/users';
	import Home from '@lucide/svelte/icons/home';
	import IdCard from '@lucide/svelte/icons/id-card';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import {
		useEvacuees,
		useEvacueesPaginated,
		useHouseholdsPaginated,
		SHELTER_CODE,
		maskNationalId,
		zoneLabel,
		SPECIAL_NEED_CHIPS,
		type Household
	} from '$lib/features/people';
	import type { SpecialNeed } from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { useMasterData } from '$lib/features/master-data';
	import { authStore } from '$lib/stores/auth.svelte';

	type TabKey = 'evacuee' | 'household';
	let activeTab = $state<TabKey>(($page.url.searchParams.get('tab') as TabKey) || 'evacuee');

	const PAGE_SIZE = 10;

	// Evacuee Tab State
	let evacueePage = $state(1);
	let evacueeSearch = $state('');

	const evacueesPaginatedQuery = useEvacueesPaginated(
		() => evacueePage,
		() => PAGE_SIZE
	);

	const filteredEvacuees = $derived.by(() => {
		const items = evacueesPaginatedQuery.data?.items ?? [];
		const needle = evacueeSearch.trim().toLowerCase();
		if (!needle) return items;
		return items.filter((e) => {
			const masked = maskNationalId(e.person_id?.number).toLowerCase();
			return (
				e.first_name.toLowerCase().includes(needle) ||
				e.last_name.toLowerCase().includes(needle) ||
				(e.nickname?.toLowerCase().includes(needle) ?? false) ||
				masked.includes(needle) ||
				(e.person_id?.number?.includes(needle) ?? false)
			);
		});
	});

	const evacueesTotal = $derived(evacueesPaginatedQuery.data?.total ?? 0);
	const evacueesTotalPages = $derived(evacueesPaginatedQuery.data?.totalPages ?? 1);

	// Household Tab State
	let householdPage = $state(1);
	let householdSearch = $state('');

	const householdsQuery = useHouseholdsPaginated(
		() => householdPage,
		() => PAGE_SIZE
	);

	// We need all evacuees to resolve head names and household members
	const allEvacueesQuery = useEvacuees();

	const filteredHouseholds = $derived.by(() => {
		const items = householdsQuery.data?.items ?? [];
		const needle = householdSearch.trim().toLowerCase();
		if (!needle) return items;
		return items.filter((h) => {
			const labelMatch = h.label.toLowerCase().includes(needle);
			const mzLabel = (municipalityZoneLabels[h.municipality_zone ?? ''] ?? h.municipality_zone ?? '').toLowerCase();
			const commLabel = (communityLabels[h.community ?? ''] ?? h.community ?? '').toLowerCase();
			const zoneMatch = mzLabel.includes(needle) || commLabel.includes(needle);

			const head = allEvacueesQuery.data?.find((e) => e._id === h.head_evacuee_id);
			const headName = head ? `${head.first_name} ${head.last_name}`.toLowerCase() : '';
			const headMatch = headName.includes(needle);

			return labelMatch || zoneMatch || headMatch;
		});
	});

	const householdsTotal = $derived(householdsQuery.data?.total ?? 0);
	const householdsTotalPages = $derived(householdsQuery.data?.totalPages ?? 1);

	// Master data for resolving household codes to labels
	const municipalityZoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');

	const municipalityZoneLabels = $derived(
		Object.fromEntries(
			(municipalityZoneQuery.data?.items ?? []).map((item) => [item.code, item.label])
		)
	);
	const communityLabels = $derived(
		Object.fromEntries(
			(communityQuery.data?.items ?? []).map((item) => [item.code, item.label])
		)
	);

	// Shelter zones
	const shelterQuery = useShelter(() => SHELTER_CODE);
	const zones = $derived(shelterQuery.data?.zones ?? []);
</script>

<svelte:head>
	<title>จัดการผู้ประสบภัย · SmartShelter</title>
</svelte:head>

<div class="flex shrink-0 gap-2 border-b border-border bg-card px-4 py-2">
	<Button
		size="sm"
		variant={activeTab === 'evacuee' ? 'default' : 'outline'}
		onclick={() => (activeTab = 'evacuee')}
	>
		<Users class="h-3.5 w-3.5" />
		รายชื่อผู้ประสบภัย
	</Button>
	<Button
		size="sm"
		variant={activeTab === 'household' ? 'default' : 'outline'}
		onclick={() => (activeTab = 'household')}
	>
		<Home class="h-3.5 w-3.5" />
		รายชื่อครัวเรือน
	</Button>
</div>

<div class="flex w-full flex-1 flex-col gap-4 p-4">
	{#if activeTab === 'evacuee'}
		<div class="flex flex-col gap-1 border-l-4 border-primary pl-3">
			<h2 class="text-sm font-bold text-foreground">ลิสต์ผู้ประสบภัย และจัดสรรโซน</h2>
		</div>

		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="flex items-center gap-2">
					<IdCard class="h-4 w-4 text-primary" />
					<h3 class="text-sm font-bold text-foreground">ทะเบียนผู้พักพิง (Evacuee Registry)</h3>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">
					จำนวนผู้พักพิงในระบบทั้งหมด
					<span class="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary"
						>{evacueesTotal} คน</span
					>
				</p>
			</div>
			<Button size="sm" onclick={() => goto(resolve('/onsite/people'))}>
				<Users class="h-3.5 w-3.5" />
				เริ่มลงทะเบียน
			</Button>
		</div>

		<div class="relative">
			<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="text"
				placeholder="ค้นหาชื่อ หรือ รหัสประจำตัว..."
				bind:value={evacueeSearch}
				class="rounded-full pl-9"
			/>
		</div>

		{#if evacueesPaginatedQuery.isLoading}
			<p class="text-sm text-muted-foreground">Loading...</p>
		{:else if evacueesPaginatedQuery.isError}
			<p class="text-sm text-destructive">Error: {evacueesPaginatedQuery.error?.message}</p>
		{:else if filteredEvacuees.length === 0}
			<p class="text-sm text-muted-foreground">ไม่พบผู้ประสบภัยในระบบ</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>ID CARD REF.</Table.Head>
							<Table.Head>ชื่อ-นามสกุล</Table.Head>
							<Table.Head>ประเภทผู้ประสบภัย</Table.Head>
							<Table.Head>ZONE จัดสรร</Table.Head>
							<Table.Head class="text-center">จัดการ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filteredEvacuees as e (e._id)}
							<Table.Row>
								<Table.Cell class="font-mono text-muted-foreground"
									>{maskNationalId(e.person_id?.number)}</Table.Cell
								>
								<Table.Cell class="font-bold text-foreground"
									>{e.first_name} {e.last_name}</Table.Cell
								>
								<Table.Cell>
									<div class="flex flex-wrap gap-1">
										{#if e.special_needs && e.special_needs.length > 0}
											{#each e.special_needs as need (need)}
												{@const chip = SPECIAL_NEED_CHIPS[need as SpecialNeed]}
												<span class="rounded bg-muted px-2 py-0.5 text-[11px]"
													>{chip.emoji} {chip.label}</span
												>
											{/each}
										{:else}
											<span class="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
												>ทั่วไป</span
											>
										{/if}
									</div>
								</Table.Cell>
								<Table.Cell class="font-medium">{zoneLabel(e.current_stay.zone)}</Table.Cell>
								<Table.Cell class="text-center">
									<Button
										variant="outline"
										size="sm"
										onclick={() =>
											goto(resolve(`/back-office/evacuee-management/edit/-evacuee/${e._id}`))}
									>
										<Pencil class="mr-1 h-3.5 w-3.5" />
										แก้ไขข้อมูล
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			{#if evacueesTotalPages > 1}
				<Pagination.Root bind:page={evacueePage} count={evacueesTotal} perPage={PAGE_SIZE}>
					{#snippet children({ pages })}
						<Pagination.Content>
							<Pagination.Previous />
							{#each pages as p, i (i)}
								<Pagination.Item>
									{#if p.type === 'page'}
										<Pagination.Link page={p} isActive={p.value === evacueePage} />
									{:else}
										<Pagination.Ellipsis />
									{/if}
								</Pagination.Item>
							{/each}
							<Pagination.Next />
						</Pagination.Content>
					{/snippet}
				</Pagination.Root>
			{/if}
		{/if}
	{:else if activeTab === 'household'}
		<div class="flex flex-col gap-1 border-l-4 border-primary pl-3">
			<h2 class="text-sm font-bold text-foreground">รายชื่อครัวเรือน</h2>
		</div>

		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="flex items-center gap-2">
					<Home class="h-4 w-4 text-primary" />
					<h3 class="text-sm font-bold text-foreground">ทะเบียนครัวเรือน (Household Registry)</h3>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">
					จำนวนครัวเรือนในระบบทั้งหมด
					<span class="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary"
						>{householdsTotal} ครัวเรือน</span
					>
				</p>
			</div>
			<Button size="sm" onclick={() => goto(resolve('/back-office/households/new'))}>
				<Plus class="mr-1 h-3.5 w-3.5" />
				เพิ่มครัวเรือน
			</Button>
		</div>

		<div class="relative">
			<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="text"
				placeholder="ค้นหาชื่อครัวเรือน, โซน หรือ หัวหน้าครัวเรือน..."
				bind:value={householdSearch}
				class="rounded-full pl-9"
			/>
		</div>

		{#if householdsQuery.isLoading}
			<p class="text-sm text-muted-foreground">Loading...</p>
		{:else if householdsQuery.isError}
			<p class="text-sm text-destructive">Error: {householdsQuery.error?.message}</p>
		{:else if filteredHouseholds.length === 0}
			<p class="text-sm text-muted-foreground">ไม่พบข้อมูลครัวเรือนในระบบ</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>ชื่อครัวเรือน</Table.Head>
							<Table.Head>หัวหน้าครัวเรือน</Table.Head>
							<Table.Head>สมาชิก</Table.Head>
							<Table.Head>เขต / ชุมชน</Table.Head>
							<Table.Head>สัตว์เลี้ยง</Table.Head>
							<Table.Head class="text-center">จัดการ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filteredHouseholds as h (h._id)}
							{@const head = allEvacueesQuery.data?.find((e) => e._id === h.head_evacuee_id)}
							{@const headName = head ? `${head.first_name} ${head.last_name}` : '—'}
							{@const members =
								allEvacueesQuery.data?.filter((e) => e.household_id === h._id) ?? []}
							<Table.Row>
								<Table.Cell class="font-bold text-foreground">{h.label}</Table.Cell>
								<Table.Cell class="font-medium text-foreground">{headName}</Table.Cell>
								<Table.Cell>
									<div class="flex flex-wrap gap-1">
										{#if members.length > 0}
											{#each members as m}
												<span
													class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
													>{m.first_name} {m.last_name}</span
												>
											{/each}
										{:else}
											<span class="text-[11px] text-muted-foreground italic">ไม่มีสมาชิก</span>
										{/if}
									</div>
								</Table.Cell>
								<Table.Cell>
									<div class="flex flex-wrap gap-1">
										{#if h.municipality_zone || h.community}
											{#if h.municipality_zone}
												<span
													class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
													>{municipalityZoneLabels[h.municipality_zone] ?? h.municipality_zone}</span
												>
											{/if}
											{#if h.community}
												<span
													class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
													>{communityLabels[h.community] ?? h.community}</span
												>
											{/if}
										{:else}
											<span class="text-[11px] text-muted-foreground italic">ไม่มี</span>
										{/if}
									</div>
								</Table.Cell>
								<Table.Cell>
									<div class="flex flex-wrap gap-1">
										{#if h.pets && h.pets.length > 0}
											{#each h.pets as p}
												{@const petEmoji =
													p.species === 'dog'
														? '🐶'
														: p.species === 'cat'
															? '🐱'
															: p.species === 'bird'
																? '🐦'
																: '🐾'}
												<span
													class="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-secondary-foreground"
													>{petEmoji} {p.count}</span
												>
											{/each}
										{:else}
											<span class="text-[11px] text-muted-foreground">ไม่มี</span>
										{/if}
									</div>
								</Table.Cell>
								<Table.Cell class="text-center">
									<Button
										variant="outline"
										size="sm"
										onclick={() => goto(resolve(`/back-office/households/edit/${h._id}`))}
									>
										แก้ไขข้อมูล
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			{#if householdsTotalPages > 1}
				<Pagination.Root bind:page={householdPage} count={householdsTotal} perPage={PAGE_SIZE}>
					{#snippet children({ pages })}
						<Pagination.Content>
							<Pagination.Previous />
							{#each pages as p, i (i)}
								<Pagination.Item>
									{#if p.type === 'page'}
										<Pagination.Link page={p} isActive={p.value === householdPage} />
									{:else}
										<Pagination.Ellipsis />
									{/if}
								</Pagination.Item>
							{/each}
							<Pagination.Next />
						</Pagination.Content>
					{/snippet}
				</Pagination.Root>
			{/if}
		{/if}
	{/if}
</div>
