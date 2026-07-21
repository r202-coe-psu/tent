<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import Users from '@lucide/svelte/icons/users';
	import Search from '@lucide/svelte/icons/search';
	import Pencil from '@lucide/svelte/icons/pencil';
	import UserX from '@lucide/svelte/icons/user-x';
	import { useEvacueesPaginated, useCheckInEvacuee, zoneLabel } from '$lib/features/people';
	import type { Evacuee } from '$lib/features/people';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useShelter } from '$lib/features/shelters';
	import { useMasterData } from '$lib/features/master-data';

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	let search = $state('');
	let selectedType = $state('');
	let selectedZone = $state('');

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	const vulnerableTypeOptions = $derived.by(() => {
		const supported = shelterQuery.data?.admission_policy?.supported_vulnerable_groups ?? [];
		const masterItems = vulnerableGroupQuery.data?.items ?? [];
		return supported.map((code) => {
			const masterItem = masterItems.find((item) => item.code === code);
			return { value: code, label: masterItem?.label ?? code };
		});
	});

	const zoneOptions = $derived(
		(shelterQuery.data?.zones ?? []).map((zone) => ({ value: zone.code, label: zone.name }))
	);

	const query = useEvacueesPaginated(
		() => currentPage,
		() => PAGE_SIZE,
		() => search,
		() => ({ specialNeed: selectedType || undefined, zone: selectedZone || undefined })
	);

	const checkIn = useCheckInEvacuee();

	// Inline check-in until T-06 dedicated flow ships — flips current_stay to active.
	async function handleCheckIn(evacuee: Evacuee) {
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		try {
			await checkIn.mutateAsync({ evacuee, ctx });
			await query.refetch();
			toast.success(`เช็คอิน ${evacuee.first_name} ${evacuee.last_name} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คอินไม่สำเร็จ');
		}
	}

	const STATUS_LABEL: Record<string, string> = {
		pre_registered: 'ลงทะเบียนล่วงหน้า',
		active: 'อยู่ในศูนย์',
		temporary_leave: 'ออกชั่วคราว',
		transferred: 'ย้ายศูนย์',
		checked_out: 'ย้ายออก/กลับภูมิลำเนา',
		deceased: 'เสียชีวิต'
	};

	const items = $derived(query.data?.items ?? []);
	const total = $derived(query.data?.total ?? 0);
	const totalPages = $derived(query.data?.totalPages ?? 1);

	function resetPageOnFilter() {
		currentPage = 1;
	}

	$effect(() => {
		if (selectedType && !vulnerableTypeOptions.some((option) => option.value === selectedType)) {
			selectedType = '';
			resetPageOnFilter();
		}
		if (selectedZone && !zoneOptions.some((option) => option.value === selectedZone)) {
			selectedZone = '';
			resetPageOnFilter();
		}
	});
</script>

<div class="flex max-h-screen flex-col gap-6 p-6">
	<!-- Header -->
	<div class="flex items-start justify-between gap-4">
		<div class="space-y-1">
			<h2 class="text-lg font-bold tracking-tight text-foreground">ทะเบียนผู้พักพิง</h2>
			<p class="text-sm text-muted-foreground">
				จำนวนทั้งหมด
				<span class="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary"
					>{total} คน</span
				>
			</p>
		</div>
		<Button size="sm" onclick={() => goto(resolve('/onsite/people'))}>
			<Users class="h-3.5 w-3.5" />
			เริ่มลงทะเบียน
		</Button>
	</div>

	<!-- Filters -->
	<div class="grid w-full grid-cols-1 gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))]">
		<div class="relative w-full min-w-0">
			<label for="evacuee-search" class="sr-only">ค้นหาผู้ประสบภัย</label>
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				id="evacuee-search"
				type="search"
				placeholder="ค้นหาชื่อ รหัสประจำตัว หรือเบอร์โทรศัพท์..."
				bind:value={search}
				oninput={resetPageOnFilter}
				class="h-8 rounded-xl bg-background pl-9 shadow-xs"
			/>
		</div>

		<div class="w-full min-w-0">
			<Select.Root
				type="single"
				bind:value={selectedType}
				onValueChange={resetPageOnFilter}
				disabled={shelterQuery.isLoading || vulnerableGroupQuery.isLoading}
			>
				<Select.Trigger
					class="h-11 w-full min-w-0 rounded-xl bg-background px-3 shadow-xs"
					aria-label="ประเภทผู้ประสบภัย"
				>
					<span class="truncate">
						{vulnerableTypeOptions.find((option) => option.value === selectedType)?.label ??
							'ทุกประเภท'}
					</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="ทุกประเภท" />
					{#if vulnerableTypeOptions.length === 0}
						<Select.Item
							value="__no_supported_type"
							label="ไม่มีกลุ่มเปราะบางที่เปิดใช้"
							disabled
						/>
					{:else}
						{#each vulnerableTypeOptions as option (option.value)}
							<Select.Item value={option.value} label={option.label} />
						{/each}
					{/if}
				</Select.Content>
			</Select.Root>
		</div>

		<div class="w-full min-w-0">
			<Select.Root
				type="single"
				bind:value={selectedZone}
				onValueChange={resetPageOnFilter}
				disabled={shelterQuery.isLoading}
			>
				<Select.Trigger
					class="h-11 w-full min-w-0 rounded-xl bg-background px-3 shadow-xs"
					aria-label="โซนที่จัดสรร"
				>
					<span class="truncate">
						{zoneOptions.find((option) => option.value === selectedZone)?.label ?? 'ทุกโซน'}
					</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="ทุกโซน" />
					{#if zoneOptions.length === 0}
						<Select.Item value="__no_zone" label="ศูนย์นี้ยังไม่มีโซน" disabled />
					{:else}
						{#each zoneOptions as option (option.value)}
							<Select.Item value={option.value} label={option.label} />
						{/each}
					{/if}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<!-- Table -->
	{#if query.isLoading}
		<div class="flex items-center justify-center py-16">
			<p class="text-sm text-muted-foreground">กำลังโหลดข้อมูล...</p>
		</div>
	{:else if query.isError}
		<div
			class="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
		>
			เกิดข้อผิดพลาด: {query.error?.message}
		</div>
	{:else if items.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20"
		>
			<UserX class="h-10 w-10 text-muted-foreground/30" />
			<p class="text-sm text-muted-foreground">ไม่พบผู้ประสบภัยในระบบ</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-border shadow-sm">
			<Table.Root>
				<Table.Header>
					<Table.Row class="bg-muted/40 hover:bg-muted/40">
						<Table.Head class="font-semibold text-foreground">ชื่อ-นามสกุล</Table.Head>
						<Table.Head class="font-semibold text-foreground">ประเภทผู้ประสบภัย</Table.Head>
						<Table.Head class="font-semibold text-foreground">ZONE จัดสรร</Table.Head>
						<Table.Head class="text-center font-semibold text-foreground">สถานะ</Table.Head>
						<Table.Head class="text-center font-semibold text-foreground">จัดการ</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each items as e (e._id)}
						<Table.Row class="transition-colors hover:bg-muted/20">
							<Table.Cell class="font-semibold text-foreground">
								{e.first_name}
								{e.last_name}
								{#if e.nickname}
									<span class="ml-1 text-xs font-normal text-muted-foreground">({e.nickname})</span>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<div class="flex flex-wrap gap-1">
									{#if e.special_needs && e.special_needs.length > 0}
										{#each e.special_needs as need (need)}
											{@const label =
												vulnerableGroupQuery.data?.items.find((i) => i.code === need)?.label ??
												need}
											<span
												class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
												>{label}</span
											>
										{/each}
									{:else}
										<span
											class="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground"
											>ทั่วไป</span
										>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell>
								<span class="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
									{zoneLabel(e.current_stay.zone)}
								</span>
							</Table.Cell>
							<Table.Cell class="text-center">
								<span
									class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium
										{e.current_stay.status === 'active'
										? 'bg-green-100 text-green-800'
										: 'bg-muted text-muted-foreground'}"
								>
									{STATUS_LABEL[e.current_stay.status] ?? e.current_stay.status}
								</span>
							</Table.Cell>
							<Table.Cell class="text-center">
								<div class="flex justify-center gap-1.5">
									{#if e.current_stay.status !== 'active'}
										<Button
											variant="outline"
											size="sm"
											onclick={() => handleCheckIn(e)}
											disabled={checkIn.isPending}
										>
											เช็คอิน
										</Button>
									{/if}
									<Button
										variant="outline"
										size="sm"
										onclick={() =>
											goto(resolve(`/back-office/evacuee-management/edit/-evacuee/${e._id}`))}
									>
										<Pencil class="h-3.5 w-3.5" />
										แก้ไข
									</Button>
								</div>
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
