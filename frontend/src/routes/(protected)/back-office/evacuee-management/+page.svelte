<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Users from '@lucide/svelte/icons/users';
	import IdCard from '@lucide/svelte/icons/id-card';
	import Search from '@lucide/svelte/icons/search';
	import {
		useEvacueesPaginated,
		maskNationalId,
		zoneLabel,
		SPECIAL_NEED_CHIPS
	} from '$lib/features/people';
	import type { SpecialNeed } from '$lib/features/people';

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	let q = $state('');

	const query = useEvacueesPaginated(
		() => currentPage,
		() => PAGE_SIZE
	);

	const filtered = $derived.by(() => {
		const items = query.data?.items ?? [];
		const needle = q.trim().toLowerCase();
		if (!needle) return items;
		return items.filter((e) => {
			const masked = maskNationalId(e.national_id).toLowerCase();
			return (
				e.first_name.toLowerCase().includes(needle) ||
				e.last_name.toLowerCase().includes(needle) ||
				(e.nickname?.toLowerCase().includes(needle) ?? false) ||
				masked.includes(needle) ||
				(e.national_id?.includes(needle) ?? false)
			);
		});
	});

	const total = $derived(query.data?.total ?? 0);
	const totalPages = $derived(query.data?.totalPages ?? 1);
</script>

<svelte:head>
	<title>จัดการผู้ประสบภัย · SmartShelter</title>
</svelte:head>

<header class="flex shrink-0 items-center gap-2 border-b border-sidebar-border bg-card px-4 py-2.5">
	<Users class="h-4 w-4 text-primary" />
	<h1 class="text-base font-bold text-foreground">จัดการผู้ประสบภัย</h1>
</header>

<div class="flex w-full flex-1 flex-col gap-4 p-4">
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
				<span class="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary">{total} คน</span>
			</p>
		</div>
		<Button size="sm" onclick={() => toast.info('เร็วๆ นี้')}>
			<Users class="h-3.5 w-3.5" />
			เริ่มลงทะเบียน
		</Button>
	</div>

	<div class="relative">
		<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
		<Input
			type="text"
			placeholder="ค้นหาชื่อ หรือ รหัสประจำตัว..."
			bind:value={q}
			class="rounded-full pl-9"
		/>
	</div>

	{#if query.isLoading}
		<p class="text-sm text-muted-foreground">Loading...</p>
	{:else if query.isError}
		<p class="text-sm text-destructive">Error: {query.error?.message}</p>
	{:else if filtered.length === 0}
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
					{#each filtered as e (e._id)}
						<Table.Row>
							<Table.Cell class="font-mono text-muted-foreground"
								>{maskNationalId(e.national_id)}</Table.Cell
							>
							<Table.Cell class="font-bold text-foreground">{e.first_name} {e.last_name}</Table.Cell
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
								<Button variant="outline" size="sm" onclick={() => toast.info('เร็วๆ นี้')}
									>ตรวจประวัติ</Button
								>
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
