<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Pencil from '@lucide/svelte/icons/pencil';
	import { useHouseholdsPaginated, useEvacuees } from '$lib/features/people';
	import { useMasterData } from '$lib/features/master-data';

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	let search = $state('');

	const allEvacueesQuery = useEvacuees();
	const municipalityZoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');

	const municipalityZoneLabels = $derived(
		Object.fromEntries(
			(municipalityZoneQuery.data?.items ?? []).map((item) => [item.code, item.label])
		)
	);
	const communityLabels = $derived(
		Object.fromEntries((communityQuery.data?.items ?? []).map((item) => [item.code, item.label]))
	);

	const householdsQuery = useHouseholdsPaginated(
		() => currentPage,
		() => PAGE_SIZE,
		() => search,
		() => ({
			municipalityZone: municipalityZoneLabels,
			community: communityLabels
		})
	);

	const items = $derived(householdsQuery.data?.items ?? []);
	const total = $derived(householdsQuery.data?.total ?? 0);
	const totalPages = $derived(householdsQuery.data?.totalPages ?? 1);

	function resetPageOnSearch() {
		currentPage = 1;
	}
</script>

<div class="flex flex-col gap-6 p-6">
	<!-- Header -->
	<div class="flex items-start justify-between gap-4">
		<div class="space-y-1">
			<h2 class="text-lg font-bold tracking-tight text-foreground">ทะเบียนครัวเรือน</h2>
			<p class="text-sm text-muted-foreground">
				จำนวนทั้งหมด
				<span class="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary"
					>{total} ครัวเรือน</span
				>
			</p>
		</div>
		<div class="flex gap-2">
			<Button
				variant="outline"
				size="sm"
				onclick={() => goto(resolve('/back-office/households/pre-register'))}
			>
				<Plus class="h-3.5 w-3.5" />
				ลงทะเบียนล่วงหน้า
			</Button>
			<Button size="sm" onclick={() => goto(resolve('/back-office/households/new?path=c'))}>
				<Plus class="h-3.5 w-3.5" />
				จัดกลุ่มหลังเข้าพัก (Path C)
			</Button>
		</div>
	</div>

	<!-- Search -->
	<div class="relative max-w-sm">
		<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
		<Input
			type="text"
			placeholder="ค้นหาชื่อครัวเรือน, เขต หรือ หัวหน้า..."
			bind:value={search}
			oninput={resetPageOnSearch}
			class="rounded-full pl-9"
		/>
	</div>

	<!-- Table -->
	{#if householdsQuery.isLoading}
		<div class="flex items-center justify-center py-16">
			<p class="text-sm text-muted-foreground">กำลังโหลดข้อมูล...</p>
		</div>
	{:else if householdsQuery.isError}
		<div
			class="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
		>
			เกิดข้อผิดพลาด: {householdsQuery.error?.message}
		</div>
	{:else if items.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20"
		>
			<FolderOpen class="h-10 w-10 text-muted-foreground/30" />
			<p class="text-sm text-muted-foreground">ไม่พบข้อมูลครัวเรือนในระบบ</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-border shadow-sm">
			<Table.Root>
				<Table.Header>
					<Table.Row class="bg-muted/40 hover:bg-muted/40">
						<Table.Head class="font-semibold text-foreground">ชื่อครัวเรือน</Table.Head>
						<Table.Head class="font-semibold text-foreground">หัวหน้าครัวเรือน</Table.Head>
						<Table.Head class="font-semibold text-foreground">สมาชิก</Table.Head>
						<Table.Head class="font-semibold text-foreground">เขต / ชุมชน</Table.Head>
						<Table.Head class="font-semibold text-foreground">สัตว์เลี้ยง</Table.Head>
						<Table.Head class="text-center font-semibold text-foreground">จัดการ</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each items as h (h._id)}
						{@const head = allEvacueesQuery.data?.find((e) => e._id === h.head_evacuee_id)}
						{@const headName = head ? `${head.first_name} ${head.last_name}` : '—'}
						{@const members = allEvacueesQuery.data?.filter((e) => e.household_id === h._id) ?? []}
						<Table.Row class="transition-colors hover:bg-muted/20">
							<Table.Cell class="font-semibold text-foreground">{h.label}</Table.Cell>
							<Table.Cell class="font-medium text-foreground">{headName}</Table.Cell>
							<Table.Cell>
								<div class="flex flex-wrap gap-1">
									{#if members.length > 0}
										{#each members as m (m._id)}
											<span
												class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
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
												class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700"
												>{municipalityZoneLabels[h.municipality_zone] ?? h.municipality_zone}</span
											>
										{/if}
										{#if h.community}
											<span
												class="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
												>{communityLabels[h.community] ?? h.community}</span
											>
										{/if}
									{:else}
										<span class="text-[11px] text-muted-foreground italic">ไม่ระบุ</span>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell>
								<div class="flex flex-wrap gap-1">
									{#if h.pets && h.pets.length > 0}
										{#each h.pets as p, i (i)}
											{@const petEmoji =
												p.species === 'dog'
													? '🐶'
													: p.species === 'cat'
														? '🐱'
														: p.species === 'bird'
															? '🐦'
															: '🐾'}
											<span
												class="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground"
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
									onclick={() =>
										goto(
											resolve(
												`/back-office/households/edit/${h._id}?from=/back-office/evacuee-management?tab=household`
											)
										)}
								>
									<Pencil class="h-3.5 w-3.5" />
									แก้ไข
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>

		{#if totalPages > 1}
			<Pagination.Root bind:page={currentPage} count={total} perPage={PAGE_SIZE}>
				{#snippet children({ pages })}
					<Pagination.Content>
						<Pagination.Previous />
						{#each pages as p, i (i)}
							<Pagination.Item>
								{#if p.type === 'page'}
									<Pagination.Link page={p} isActive={p.value === currentPage} />
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
</div>
