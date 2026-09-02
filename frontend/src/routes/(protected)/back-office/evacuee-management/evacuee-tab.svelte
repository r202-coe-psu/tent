<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import Users from '@lucide/svelte/icons/users';
	import Search from '@lucide/svelte/icons/search';
	import Pencil from '@lucide/svelte/icons/pencil';
	import UserX from '@lucide/svelte/icons/user-x';
	import {
		useEvacueesPaginated,
		useCheckInEvacuee,
		useCancelEvacueePreRegistration,
		listMatchingEvacueeIds,
		canCheckInEvacuee,
		canCancelEvacueePreRegistration,
		stayStatusSchema,
		zoneLabel,
		type Evacuee,
		type StayStatus
	} from '$lib/features/people';
	import { authStore } from '$lib/stores/auth.svelte';
	import { canCancelHold } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useShelter } from '$lib/features/shelters';
	import { useMasterData } from '$lib/features/master-data';

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	let search = $state('');
	let selectedType = $state('');
	let selectedZone = $state('');
	let selectedStatus = $state('');
	let selectedIds = $state<string[]>([]);
	let isSelectingAllMatching = $state(false);
	let isBulkCancelling = $state(false);

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	const canCancel = $derived(canCancelHold(authStore.user?.roles ?? []));

	const statusConfig = {
		pre_registered: {
			label: 'ลงทะเบียนล่วงหน้า',
			colorClass:
				'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
		},
		arriving: {
			label: 'รอตรวจ/จัดโซน',
			colorClass:
				'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
		},
		active: {
			label: 'อยู่ในศูนย์',
			colorClass:
				'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
		},
		temporary_leave: {
			label: 'ออกชั่วคราว',
			colorClass:
				'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
		},
		transferred: {
			label: 'ย้ายศูนย์',
			colorClass:
				'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
		},
		checked_out: {
			label: 'ย้ายออก/กลับภูมิลำเนา',
			colorClass:
				'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
		},
		deceased: {
			label: 'เสียชีวิต',
			colorClass:
				'bg-slate-200 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-700'
		},
		cancelled: {
			label: 'ยกเลิกการลงทะเบียนล่วงหน้า',
			colorClass:
				'bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800'
		}
	} satisfies Record<StayStatus, { label: string; colorClass: string }>;

	const statusOptions = stayStatusSchema.options.map((value) => ({
		value,
		label: statusConfig[value].label
	}));

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

	const filters = $derived({
		specialNeed: selectedType || undefined,
		zone: selectedZone || undefined,
		status: (selectedStatus || undefined) as StayStatus | undefined
	});

	const query = useEvacueesPaginated(
		() => currentPage,
		() => PAGE_SIZE,
		() => search,
		() => filters
	);

	const checkIn = useCheckInEvacuee();
	const cancelEvacuee = useCancelEvacueePreRegistration();

	const items = $derived(query.data?.items ?? []);
	const total = $derived(query.data?.total ?? 0);
	const totalPages = $derived(query.data?.totalPages ?? 1);

	const pageIds = $derived(items.map((e) => e._id));
	const allPageSelected = $derived(
		pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id))
	);
	const somePageSelected = $derived(
		pageIds.some((id) => selectedIds.includes(id)) && !allPageSelected
	);
	const selectedEligibleCount = $derived(
		items.filter((e) => selectedIds.includes(e._id) && canCancelEvacueePreRegistration(e)).length
	);

	function clearSelection() {
		selectedIds = [];
	}

	function resetPageOnFilter() {
		currentPage = 1;
		clearSelection();
	}

	function toggleId(id: string, checked: boolean | 'indeterminate') {
		if (checked === true) {
			if (!selectedIds.includes(id)) selectedIds = [...selectedIds, id];
			return;
		}
		selectedIds = selectedIds.filter((x) => x !== id);
	}

	function toggleSelectPage(checked: boolean | 'indeterminate') {
		if (checked === true) {
			const next = [...selectedIds];
			for (const id of pageIds) {
				if (!next.includes(id)) next.push(id);
			}
			selectedIds = next;
			return;
		}
		selectedIds = selectedIds.filter((id) => !pageIds.includes(id));
	}

	async function selectAllMatching() {
		isSelectingAllMatching = true;
		try {
			selectedIds = await listMatchingEvacueeIds(search, filters);
			toast.success(`เลือกแล้ว ${selectedIds.length} รายการตามตัวกรอง`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เลือกทั้งหมดไม่สำเร็จ');
		} finally {
			isSelectingAllMatching = false;
		}
	}

	async function handleCheckIn(evacuee: Evacuee) {
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		try {
			await checkIn.mutateAsync({ evacuee, ctx });
			toast.success(`เช็คอิน ${evacuee.first_name} ${evacuee.last_name} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คอินไม่สำเร็จ');
		}
	}

	async function handleBulkCancel() {
		if (!canCancel || selectedIds.length === 0) return;
		if (
			!window.confirm(
				`ยืนยันยกเลิกการลงทะเบียนล่วงหน้าของ ${selectedIds.length} รายการที่เลือกหรือไม่?\n(เฉพาะสถานะลงทะเบียนล่วงหน้าจะถูกยกเลิก)`
			)
		) {
			return;
		}

		isBulkCancelling = true;
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		let ok = 0;
		let failed = 0;
		for (const id of selectedIds) {
			try {
				await cancelEvacuee.mutateAsync({ evacueeId: id, ctx });
				ok += 1;
			} catch {
				failed += 1;
			}
		}
		isBulkCancelling = false;
		clearSelection();
		if (ok > 0) toast.success(`ยกเลิกการลงทะเบียนล่วงหน้าสำเร็จ ${ok} รายการ`);
		if (failed > 0)
			toast.error(`ยกเลิกไม่สำเร็จ ${failed} รายการ (อาจไม่ใช่สถานะลงทะเบียนล่วงหน้า)`);
	}

	$effect(() => {
		if (shelterQuery.isLoading || vulnerableGroupQuery.isLoading) return;
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
	<div class="grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
		<div class="w-full min-w-0 space-y-2">
			<label for="evacuee-search" class="text-xs font-semibold text-foreground">ค้นหา</label>
			<div class="relative">
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
		</div>

		<div class="w-full min-w-0 space-y-2">
			<label for="evacuee-type-filter" class="text-xs font-semibold text-foreground"
				>ประเภทผู้ประสบภัย</label
			>
			<Select.Root
				type="single"
				bind:value={selectedType}
				onValueChange={resetPageOnFilter}
				disabled={shelterQuery.isLoading || vulnerableGroupQuery.isLoading}
			>
				<Select.Trigger
					id="evacuee-type-filter"
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

		<div class="w-full min-w-0 space-y-2">
			<label for="evacuee-zone-filter" class="text-xs font-semibold text-foreground"
				>โซนที่จัดสรร</label
			>
			<Select.Root
				type="single"
				bind:value={selectedZone}
				onValueChange={resetPageOnFilter}
				disabled={shelterQuery.isLoading}
			>
				<Select.Trigger
					id="evacuee-zone-filter"
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

		<div class="w-full min-w-0 space-y-2">
			<label for="evacuee-status-filter" class="text-xs font-semibold text-foreground">สถานะ</label>
			<Select.Root type="single" bind:value={selectedStatus} onValueChange={resetPageOnFilter}>
				<Select.Trigger
					id="evacuee-status-filter"
					class="h-11 w-full min-w-0 rounded-xl bg-background px-3 shadow-xs"
					aria-label="สถานะการพักพิง"
				>
					<span class="truncate">
						{statusOptions.find((option) => option.value === selectedStatus)?.label ?? 'ทุกสถานะ'}
					</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="ทุกสถานะ" />
					{#each statusOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	{#if selectedIds.length > 0}
		<div
			class="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur"
		>
			<p class="text-sm font-medium text-foreground">
				เลือกแล้ว <span class="text-primary tabular-nums">{selectedIds.length}</span> คน
				{#if canCancel && selectedEligibleCount > 0}
					<span class="text-muted-foreground">
						· ยกเลิกได้บนหน้านี้ {selectedEligibleCount} คน</span
					>
				{/if}
			</p>
			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={selectAllMatching}
					disabled={isSelectingAllMatching || total === 0}
				>
					{isSelectingAllMatching ? 'กำลังเลือก...' : 'เลือกทั้งหมดตามตัวกรอง'}
				</Button>
				<Button variant="ghost" size="sm" onclick={clearSelection}>ล้างการเลือก</Button>
				{#if canCancel}
					<Button
						variant="destructive"
						size="sm"
						onclick={handleBulkCancel}
						disabled={isBulkCancelling || selectedIds.length === 0}
					>
						{isBulkCancelling ? 'กำลังยกเลิก...' : 'ยกเลิกการลงทะเบียนล่วงหน้า'}
					</Button>
				{/if}
			</div>
		</div>
	{/if}

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
						<Table.Head class="w-12">
							<Checkbox
								checked={allPageSelected}
								indeterminate={somePageSelected}
								onCheckedChange={toggleSelectPage}
								aria-label="เลือกทั้งหน้า"
							/>
						</Table.Head>
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
							<Table.Cell>
								<Checkbox
									checked={selectedIds.includes(e._id)}
									onCheckedChange={(checked) => toggleId(e._id, checked)}
									aria-label={`เลือก ${e.first_name} ${e.last_name}`}
								/>
							</Table.Cell>
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
												class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-2xs font-medium text-amber-700"
												>{label}</span
											>
										{/each}
									{:else}
										<span class="rounded-full bg-muted px-2.5 py-0.5 text-2xs text-muted-foreground"
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
								{@const config = statusConfig[e.current_stay.status]}
								<span
									class="inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium {config?.colorClass ??
										'border-border bg-muted text-muted-foreground'}"
								>
									{config?.label ?? e.current_stay.status}
								</span>
							</Table.Cell>
							<Table.Cell class="text-center">
								<div class="flex justify-center gap-1.5">
									{#if canCheckInEvacuee(e)}
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
