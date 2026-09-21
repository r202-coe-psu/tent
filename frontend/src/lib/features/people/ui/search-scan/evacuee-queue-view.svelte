<script lang="ts">
	import { resolve } from '$app/paths';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Eye from '@lucide/svelte/icons/eye';
	import Globe from '@lucide/svelte/icons/globe';
	import Home from '@lucide/svelte/icons/home';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Users from '@lucide/svelte/icons/users';
	import Zap from '@lucide/svelte/icons/zap';

	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { paginateItems } from '$lib/db/paginate';
	import { getShelterCode } from '$lib/db/shelter';
	import { useMasterData } from '$lib/features/master-data';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';

	import { useEvacuees, useHouseholds, useScreenings } from '../../application/queries';
	import { formatPersonName, maskNationalId, matchesEvacueeSearch, zoneLabel } from '../../domain/people';
	import { nextQueueLabel } from '../../domain/intake-pipeline';
	import type { Evacuee } from '../../domain/people';
	import RegisteredViaBadge from '../shared/registered-via-badge.svelte';
	import StayStatusBadge from '../shared/stay-status-badge.svelte';

	const PAGE_SIZE = 10;

	type WorkflowTab = 'pre_registered' | 'arriving' | 'all';
	type ArrivingSubTab = 'all' | 'medical' | 'zoning';
	type PreRegChannelFilter = 'all' | 'kiosk' | 'web' | 'other';

	let {
		enableMedical = false,
		canMedical = false,
		canZoning = false,
		/** Free-text filter applied to every tab (bound to the intake omnibox on Station 1). */
		filterQuery = '',
		/** Initial workflow tab; Station 1 keeps `pre_registered`, search-edit uses `all`. */
		initialTab = 'pre_registered',
		onOpenRow,
		onReportIn,
		onProfile,
		onGoMedical,
		onGoZoning
	}: {
		enableMedical?: boolean;
		canMedical?: boolean;
		canZoning?: boolean;
		filterQuery?: string;
		initialTab?: WorkflowTab;
		onOpenRow: (evacuee: Evacuee) => void;
		onReportIn: (evacuee: Evacuee) => void;
		onProfile: (evacuee: Evacuee) => void;
		onGoMedical?: (evacuee: Evacuee) => void;
		onGoZoning?: (evacuee: Evacuee) => void;
	} = $props();

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);

	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const householdMap = $derived(new Map((householdsQuery.data ?? []).map((h) => [h._id, h])));
	const screenings = $derived(screeningsQuery.data ?? []);
	const screenedIds = $derived(new Set(screenings.map((s) => s.evacuee_id)));
	const screeningByEvacuee = $derived(new Map(screenings.map((s) => [s.evacuee_id, s])));

	const TRIAGE_LABELS: Record<string, string> = {
		green: 'เขียว',
		yellow: 'เหลือง',
		red: 'แดง'
	};

	let activeTab = $state<WorkflowTab>(initialTab);
	let arrivingSubTab = $state<ArrivingSubTab>('all');
	let preRegChannelFilter = $state<PreRegChannelFilter>('all');
	let allStatusFilter = $state<string>('all');
	let allZoneFilter = $state<string>('all');
	let currentPage = $state(1);

	// Summary KPI counts
	const preRegisteredEvacuees = $derived(
		allEvacuees.filter((e) => e.current_stay?.status === 'pre_registered')
	);
	const arrivingEvacuees = $derived(
		allEvacuees.filter((e) => e.current_stay?.status === 'arriving')
	);
	const inShelterEvacuees = $derived(
		allEvacuees.filter(
			(e) => e.current_stay?.status === 'active' || e.current_stay?.status === 'room_confirmed'
		)
	);
	const roomConfirmedCount = $derived(
		allEvacuees.filter((e) => e.current_stay?.status === 'room_confirmed').length
	);
	const waitingMedicalCount = $derived(
		arrivingEvacuees.filter((e) => enableMedical && !screenedIds.has(e._id)).length
	);
	const waitingZoningCount = $derived(
		arrivingEvacuees.filter((e) => !enableMedical || screenedIds.has(e._id)).length
	);

	// Pre-registered channel counts
	const kioskPreRegCount = $derived(
		preRegisteredEvacuees.filter((e) => e.registered_via === 'kiosk' || !!e.card_snapshot).length
	);
	const webPreRegCount = $derived(
		preRegisteredEvacuees.filter((e) => e.registered_via === 'web').length
	);
	const otherPreRegCount = $derived(
		preRegisteredEvacuees.filter(
			(e) => e.registered_via !== 'kiosk' && !e.card_snapshot && e.registered_via !== 'web'
		).length
	);

	const preRegisteredFiltered = $derived(
		preRegisteredEvacuees
			.filter((e) => {
				if (!matchesEvacueeSearch(e, filterQuery)) return false;
				const isKiosk = e.registered_via === 'kiosk' || !!e.card_snapshot;
				const isWeb = e.registered_via === 'web';
				if (preRegChannelFilter === 'kiosk') return isKiosk;
				if (preRegChannelFilter === 'web') return isWeb;
				if (preRegChannelFilter === 'other') return !isKiosk && !isWeb;
				return true;
			})
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	const arrivingFiltered = $derived(
		arrivingEvacuees
			.filter((e) => {
				if (!matchesEvacueeSearch(e, filterQuery)) return false;
				const hasScreening = screenedIds.has(e._id);
				if (arrivingSubTab === 'medical') return enableMedical && !hasScreening;
				if (arrivingSubTab === 'zoning') return !enableMedical || hasScreening;
				return true;
			})
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	const allFiltered = $derived(
		allEvacuees
			.filter((e) => {
				if (!matchesEvacueeSearch(e, filterQuery)) return false;
				if (allStatusFilter !== 'all' && e.current_stay?.status !== allStatusFilter) return false;
				if (allZoneFilter !== 'all' && e.current_stay?.zone !== allZoneFilter) return false;
				return true;
			})
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	const activeFiltered = $derived(
		activeTab === 'pre_registered'
			? preRegisteredFiltered
			: activeTab === 'arriving'
				? arrivingFiltered
				: allFiltered
	);

	// Hybrid: full `useEvacuees()` for KPI/tab filters; client `paginateItems` for the table.
	// Back-office `listEvacueesPaginated` uses limited Couch `_all_docs` when unfiltered.
	const pagedRows = $derived(paginateItems(activeFiltered, currentPage, PAGE_SIZE));

	$effect(() => {
		void [
			activeTab,
			arrivingSubTab,
			preRegChannelFilter,
			allStatusFilter,
			allZoneFilter,
			filterQuery
		];
		currentPage = 1;
	});

	const availableZones = $derived(
		Array.from(new Set(allEvacuees.map((e) => e.current_stay?.zone).filter(Boolean))) as string[]
	);

	function specialNeedsShort(needs: string[]): string {
		if (!needs?.length) return '—';
		return needs
			.slice(0, 2)
			.map((n) => vulnerableGroupQuery.data?.items.find((i) => i.code === n)?.label ?? n)
			.join(', ');
	}

	function formatUpdated(iso?: string | null): string {
		if (!iso) return '—';
		try {
			const d = new Date(iso);
			return d.toLocaleString('th-TH', {
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}

	function nextQueueBadgeVariant(
		next: string
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (next === 'รอแพทย์') return 'destructive';
		if (next === 'รอโซน') return 'default';
		if (next === 'รอยืนยันถึงโซน') return 'default';
		if (next === 'พักแล้ว') return 'secondary';
		return 'outline';
	}
</script>

<!-- Queue Stat Summary Cards -->
<section aria-label="สรุปยอดคิวผู้ประสบภัย" class="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
	<!-- Card 1: Pre-registered -->
	<button
		type="button"
		onclick={() => (activeTab = 'pre_registered')}
		class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
		'pre_registered'
			? 'border-blue-300 bg-blue-50/50 shadow-2xs ring-2 ring-blue-500/20'
			: 'border-slate-200/80 bg-white shadow-2xs'}"
	>
		<div class="flex items-center justify-between">
			<span class="text-xs font-semibold text-blue-900">รอรายงานตัว</span>
			<div
				class="flex size-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 transition-colors group-hover:bg-blue-200"
			>
				<CalendarClock class="size-4" />
			</div>
		</div>
		<div class="mt-2">
			<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
				{preRegisteredEvacuees.length}
				<span class="text-xs font-normal text-slate-500">คน</span>
			</p>
			<p class="mt-0.5 text-2xs text-slate-500">ลงทะเบียนล่วงหน้า / ออนไลน์</p>
		</div>
	</button>

	<!-- Card 2: Arriving -->
	<button
		type="button"
		onclick={() => (activeTab = 'arriving')}
		class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
		'arriving'
			? 'border-amber-300 bg-amber-50/50 shadow-2xs ring-2 ring-amber-500/20'
			: 'border-slate-200/80 bg-white shadow-2xs'}"
	>
		<div class="flex items-center justify-between">
			<span class="text-xs font-semibold text-amber-900">รอส่งต่อเข้าพัก</span>
			<div
				class="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 transition-colors group-hover:bg-amber-200"
			>
				<Clock class="size-4" />
			</div>
		</div>
		<div class="mt-2">
			<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
				{arrivingEvacuees.length}
				<span class="text-xs font-normal text-slate-500">คน</span>
			</p>
			<p class="mt-0.5 text-2xs text-slate-500">
				{#if enableMedical}
					รอตรวจแพทย์ {waitingMedicalCount} ·
				{/if}รอจัดโซน {waitingZoningCount}
			</p>
		</div>
	</button>

	<!-- Card 3: In Shelter -->
	<button
		type="button"
		onclick={() => (activeTab = 'all')}
		class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
		'all'
			? 'border-green-300 bg-green-50/50 shadow-2xs ring-2 ring-green-500/20'
			: 'border-slate-200/80 bg-white shadow-2xs'}"
	>
		<div class="flex items-center justify-between">
			<span class="text-xs font-semibold text-green-900">พักในศูนย์แล้ว</span>
			<div
				class="flex size-7 items-center justify-center rounded-lg bg-green-100 text-green-700 transition-colors group-hover:bg-green-200"
			>
				<Home class="size-4" />
			</div>
		</div>
		<div class="mt-2">
			<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
				{inShelterEvacuees.length}
				<span class="text-xs font-normal text-slate-500">คน</span>
			</p>
			<p class="mt-0.5 text-2xs text-slate-500">ยืนยันถึงโซนแล้ว {roomConfirmedCount} คน</p>
		</div>
	</button>

	<!-- Card 4: Central Pool Info -->
	<div
		class="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
	>
		<div class="flex items-center justify-between">
			<span class="text-xs font-semibold text-slate-700">คิวกลาง (Central Pool)</span>
			<div class="flex size-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
				<Globe class="size-4" />
			</div>
		</div>
		<div class="mt-2">
			<p class="text-base font-bold text-slate-800">พร้อมดึงเข้าศูนย์</p>
			<p class="mt-0.5 text-2xs text-slate-500">ค้นหาเพื่อ Claim เข้าศูนย์นี้ได้ทันที</p>
		</div>
	</div>
</section>

<!-- Workflow Tabs & Lists -->
<section class="flex flex-col gap-4">
	<!-- Tab Switcher Navigation -->
	<div class="border-b border-border">
		<nav class="flex gap-1 overflow-x-auto" aria-label="แท็บกระบวนการลงทะเบียน">
			<button
				type="button"
				onclick={() => (activeTab = 'all')}
				class="flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-semibold transition-colors {activeTab ===
				'all'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<Users class="size-4" />
				<span>ผู้ประสบภัยทั้งหมด (All Evacuees)</span>
				<span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
					{allEvacuees.length}
				</span>
			</button>

			<button
				type="button"
				onclick={() => (activeTab = 'pre_registered')}
				class="flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-semibold transition-colors {activeTab ===
				'pre_registered'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<CalendarClock class="size-4" />
				<span>รอรายงานตัว (Pre-registered)</span>
				<span
					class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800 tabular-nums dark:bg-blue-950 dark:text-blue-300"
				>
					{preRegisteredEvacuees.length}
				</span>
			</button>

			<button
				type="button"
				onclick={() => (activeTab = 'arriving')}
				class="flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-semibold transition-colors {activeTab ===
				'arriving'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<Clock class="size-4" />
				<span>รอส่งต่อเข้าพัก (Arriving)</span>
				<span
					class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 tabular-nums dark:bg-amber-950 dark:text-amber-300"
				>
					{arrivingEvacuees.length}
				</span>
			</button>
		</nav>
	</div>

	<!-- Tab 1: All Evacuees (ผู้ประสบภัยทั้งหมด) -->
	{#if activeTab === 'all'}
		<div class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<div
				class="flex flex-col gap-3 border-b border-slate-200/80 bg-white px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex flex-wrap items-center gap-3">
					<div class="flex items-center gap-1.5 text-xs text-slate-600">
						<span class="font-medium">สถานะ:</span>
						<select
							bind:value={allStatusFilter}
							class="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:ring-1 focus:ring-primary focus:outline-hidden"
						>
							<option value="all">ทุกสถานะ</option>
							<option value="pre_registered">ลงทะเบียนล่วงหน้า</option>
							<option value="arriving">รอเข้าพัก</option>
							<option value="active">เข้าพักแล้ว</option>
							<option value="room_confirmed">ยืนยันถึงโซนแล้ว</option>
							<option value="temporary_leave">ออกชั่วคราว</option>
							<option value="transferred">ย้ายศูนย์</option>
							<option value="checked_out">เช็คเอาต์</option>
							<option value="deceased">เสียชีวิต</option>
							<option value="cancelled">ยกเลิก</option>
						</select>
					</div>

					{#if availableZones.length > 0}
						<div class="flex items-center gap-1.5 text-xs text-slate-600">
							<span class="font-medium">โซน:</span>
							<select
								bind:value={allZoneFilter}
								class="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:ring-1 focus:ring-primary focus:outline-hidden"
							>
								<option value="all">ทุกโซน</option>
								{#each availableZones as z (z)}
									<option value={z}>โซน {zoneLabel(z, shelterZones)}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>
				<span class="text-xs text-slate-500">
					แสดง {allFiltered.length} จาก {allEvacuees.length} รายการ
				</span>
			</div>

			{#if allFiltered.length === 0}
				<div
					class="flex h-44 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500"
				>
					<p class="font-medium text-slate-700">ไม่พบข้อมูลที่ตรงกับเงื่อนไข</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header class="border-b border-slate-200/90 bg-slate-50">
							<Table.Row class="border-b-0 hover:bg-transparent">
								<Table.Head class="h-11 pl-5 text-xs font-semibold text-slate-600"
									>ชื่อ-นามสกุล</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600">สถานะ</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600">โซน</Table.Head>
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>ครอบครัว</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>ความต้องการพิเศษ</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>อัปเดตล่าสุด</Table.Head
								>
								<Table.Head class="h-11 pr-5 text-xs font-semibold text-slate-600"
									>คิวถัดไป</Table.Head
								>
								<Table.Head class="h-11 pr-5 text-right text-xs font-semibold text-slate-600"
									>การจัดการ</Table.Head
								>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each pagedRows.items as row (row._id)}
								{@const next = nextQueueLabel(row, {
									enableMedicalScreening: enableMedical,
									hasScreening: screenedIds.has(row._id)
								})}
								{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
								<Table.Row
									class="cursor-pointer hover:bg-slate-50/80"
									onclick={() => onOpenRow(row)}
								>
									<Table.Cell class="py-3 pl-5 font-semibold text-slate-900">
										{formatPersonName(row)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										<StayStatusBadge status={row.current_stay?.status} size="sm" />
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs font-medium">
										{row.current_stay?.zone
											? `โซน ${zoneLabel(row.current_stay.zone, shelterZones)}`
											: '—'}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs text-slate-600">
										{hh?.label ?? '—'}
									</Table.Cell>
									<Table.Cell class="max-w-[14rem] truncate px-3 py-3 text-xs text-slate-600">
										{specialNeedsShort(row.special_needs)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs text-slate-500 tabular-nums">
										{formatUpdated(row.updated_at)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										<Badge variant="secondary" class="text-xs">{next}</Badge>
									</Table.Cell>
									<Table.Cell class="py-3 pr-5 text-right">
										<Button
											size="sm"
											variant="outline"
											class="gap-1.5 rounded-lg border-slate-200 px-3 font-semibold text-slate-700"
											onclick={(e) => {
												e.stopPropagation();
												onProfile(row);
											}}
										>
											<Eye class="size-3.5" />
											<span>ดูโปรไฟล์</span>
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if pagedRows.totalPages > 1}
					<div class="border-t border-slate-200/80 px-5 py-3">
						<PaginationControls
							bind:page={currentPage}
							count={allFiltered.length}
							perPage={PAGE_SIZE}
						/>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Tab 2: Pre-registered (รอรายงานตัว) -->
	{:else if activeTab === 'pre_registered'}
		<div class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<div
				class="flex flex-col gap-3 border-b border-slate-200/80 bg-white px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs font-semibold text-slate-700">กรองช่องทาง:</span>
					<button
						type="button"
						onclick={() => (preRegChannelFilter = 'all')}
						class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {preRegChannelFilter ===
						'all'
							? 'border-primary bg-primary/10 font-bold text-primary'
							: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					>
						ทั้งหมด ({preRegisteredEvacuees.length})
					</button>
					<button
						type="button"
						onclick={() => (preRegChannelFilter = 'kiosk')}
						class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors {preRegChannelFilter ===
						'kiosk'
							? 'border-amber-400 bg-amber-100/90 font-bold text-amber-900 shadow-2xs'
							: 'border-amber-200 bg-amber-50/60 text-amber-900 hover:bg-amber-100/60'}"
					>
						<CreditCard class="size-3.5 text-amber-700" />
						<span>ตู้ Kiosk ({kioskPreRegCount})</span>
					</button>
					<button
						type="button"
						onclick={() => (preRegChannelFilter = 'web')}
						class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors {preRegChannelFilter ===
						'web'
							? 'border-sky-400 bg-sky-100/90 font-bold text-sky-900 shadow-2xs'
							: 'border-sky-200 bg-sky-50/60 text-sky-900 hover:bg-sky-100/60'}"
					>
						<Globe class="size-3.5 text-sky-700" />
						<span>ออนไลน์ Web ({webPreRegCount})</span>
					</button>
					{#if otherPreRegCount > 0}
						<button
							type="button"
							onclick={() => (preRegChannelFilter = 'other')}
							class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {preRegChannelFilter ===
							'other'
								? 'border-primary bg-primary/10 font-bold text-primary'
								: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
						>
							ช่องทางอื่น ({otherPreRegCount})
						</button>
					{/if}
				</div>
				<span class="text-xs text-slate-500">
					แสดง {preRegisteredFiltered.length} จาก {preRegisteredEvacuees.length} รายการ
				</span>
			</div>

			{#if allEvacueesQuery.isPending}
				<div class="flex h-40 items-center justify-center text-sm text-slate-500">
					กำลังโหลดข้อมูล...
				</div>
			{:else if preRegisteredFiltered.length === 0}
				<div
					class="flex h-48 flex-col items-center justify-center gap-3 text-center text-sm text-slate-500"
				>
					<p class="font-medium text-slate-700">ไม่มีรายการผู้ลงทะเบียนล่วงหน้าค้างรายงานตัว</p>
					<p class="text-xs text-slate-500">
						{preRegChannelFilter !== 'all'
							? 'ไม่พบข้อมูลที่ตรงกับเงื่อนไขตัวกรอง'
							: 'หากมีผู้ประสบภัย Walk-in สามารถกดลงทะเบียนใหม่ได้ทันที'}
					</p>
					<Button
						variant="outline"
						href={resolve('/onsite/people/new')}
						class="gap-1.5 rounded-xl border-slate-200"
					>
						<UserPlus class="size-4" />
						<span>+ ลงทะเบียน Walk-in</span>
					</Button>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header class="border-b border-slate-200/90 bg-slate-50">
							<Table.Row class="border-b-0 hover:bg-transparent">
								<Table.Head class="h-11 pl-5 text-xs font-semibold text-slate-600"
									>ชื่อ-นามสกุล</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>เลขที่เอกสาร</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>ช่องทาง</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>เบอร์โทร</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>ครอบครัว</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>ความต้องการพิเศษ</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600">สถานะ</Table.Head
								>
								<Table.Head class="h-11 pr-5 text-right text-xs font-semibold text-slate-600"
									>การจัดการ</Table.Head
								>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each pagedRows.items as row (row._id)}
								{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
								<Table.Row
									class="cursor-pointer hover:bg-slate-50/80"
									onclick={() => onOpenRow(row)}
								>
									<Table.Cell class="py-3 pl-5 font-semibold text-slate-900">
										{formatPersonName(row)}
										{#if row.nickname}
											<span class="text-xs font-normal text-slate-500">({row.nickname})</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 font-mono text-xs text-slate-600">
										{maskNationalId(row.person_id?.number)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										<RegisteredViaBadge
											via={row.registered_via}
											hasCardSnapshot={!!row.card_snapshot}
											size="sm"
										/>
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs text-slate-600 tabular-nums">
										{row.phone || '—'}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs font-medium text-slate-700">
										{hh?.label ?? '—'}
									</Table.Cell>
									<Table.Cell class="max-w-[14rem] truncate px-3 py-3 text-xs text-slate-600">
										{specialNeedsShort(row.special_needs)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										<StayStatusBadge status="pre_registered" size="sm" />
									</Table.Cell>
									<Table.Cell class="py-3 pr-5 text-right">
										<div class="flex justify-end gap-1.5">
											<Button
												size="sm"
												variant="outline"
												class="gap-1.5 rounded-lg border-slate-200 px-3 font-semibold text-slate-700"
												onclick={(e) => {
													e.stopPropagation();
													onProfile(row);
												}}
											>
												<Eye class="size-3.5" />
												<span>ดูโปรไฟล์</span>
											</Button>
											<Button
												size="sm"
												class="gap-1.5 rounded-lg bg-blue-600 px-3 font-semibold text-white shadow-2xs hover:bg-blue-700"
												onclick={(e) => {
													e.stopPropagation();
													onReportIn(row);
												}}
											>
												<Zap class="size-3.5" />
												<span>รับรายงานตัว</span>
											</Button>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if pagedRows.totalPages > 1}
					<div class="border-t border-slate-200/80 px-5 py-3">
						<PaginationControls
							bind:page={currentPage}
							count={preRegisteredFiltered.length}
							perPage={PAGE_SIZE}
						/>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Tab 3: Arriving (รอส่งต่อเข้าพัก) -->
	{:else if activeTab === 'arriving'}
		<div class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<div
				class="flex flex-col gap-3 border-b border-slate-200/80 bg-white px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs font-semibold text-slate-700">กรองขั้นตอน:</span>
					<button
						type="button"
						onclick={() => (arrivingSubTab = 'all')}
						class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {arrivingSubTab ===
						'all'
							? 'border-amber-400 bg-amber-50 font-bold text-amber-900'
							: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					>
						ทั้งหมด ({arrivingEvacuees.length})
					</button>
					{#if enableMedical}
						<button
							type="button"
							onclick={() => (arrivingSubTab = 'medical')}
							class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {arrivingSubTab ===
							'medical'
								? 'border-destructive bg-destructive/10 font-bold text-destructive'
								: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
						>
							รอตรวจแพทย์ ({waitingMedicalCount})
						</button>
					{/if}
					<button
						type="button"
						onclick={() => (arrivingSubTab = 'zoning')}
						class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {arrivingSubTab ===
						'zoning'
							? 'border-primary bg-primary/10 font-bold text-primary'
							: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					>
						รอจัดโซนที่พัก ({waitingZoningCount})
					</button>
				</div>
				<span class="text-xs text-slate-500">
					แสดง {arrivingFiltered.length} จาก {arrivingEvacuees.length} รายการ
				</span>
			</div>

			{#if arrivingFiltered.length === 0}
				<div
					class="flex h-44 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500"
				>
					<p class="font-medium text-slate-700">ไม่มีรายการในหมวดนี้</p>
					<p class="text-xs text-slate-500">ผู้ประสบภัยได้รับการตรวจและจัดสรรที่พักเรียบร้อยแล้ว</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header class="border-b border-slate-200/90 bg-slate-50">
							<Table.Row class="border-b-0 hover:bg-transparent">
								<Table.Head class="h-11 pl-5 text-xs font-semibold text-slate-600"
									>ชื่อ-นามสกุล</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>เลขที่เอกสาร</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>ครอบครัว</Table.Head
								>
								{#if enableMedical}
									<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
										>การแพทย์</Table.Head
									>
								{/if}
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>คิวถัดไป</Table.Head
								>
								<Table.Head class="h-11 pr-5 text-right text-xs font-semibold text-slate-600"
									>ส่งต่อ</Table.Head
								>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each pagedRows.items as row (row._id)}
								{@const next = nextQueueLabel(row, {
									enableMedicalScreening: enableMedical,
									hasScreening: screenedIds.has(row._id)
								})}
								{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
								{@const screening = screeningByEvacuee.get(row._id)}
								<Table.Row
									class="cursor-pointer hover:bg-slate-50/80"
									onclick={() => onOpenRow(row)}
								>
									<Table.Cell class="py-3 pl-5 font-semibold text-slate-900">
										{formatPersonName(row)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 font-mono text-xs text-slate-600">
										{maskNationalId(row.person_id?.number)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs text-slate-700">
										{hh?.label ?? '—'}
									</Table.Cell>
									{#if enableMedical}
										<Table.Cell class="px-3 py-3 text-xs">
											{#if screening}
												<span class="inline-flex items-center gap-1 font-medium text-emerald-700">
													<CheckCircle2 class="size-3.5 text-emerald-600" />
													ตรวจแล้ว{#if screening.triage_level}
														({TRIAGE_LABELS[screening.triage_level] ?? screening.triage_level}){/if}
												</span>
											{:else}
												<span class="font-medium text-amber-700">รอตรวจคัดกรอง</span>
											{/if}
										</Table.Cell>
									{/if}
									<Table.Cell class="px-3 py-3">
										<Badge variant={nextQueueBadgeVariant(next)} class="font-semibold">
											{next}
										</Badge>
									</Table.Cell>
									<Table.Cell class="py-3 pr-5 text-right">
										<div class="flex justify-end gap-1.5">
											{#if canMedical && next === 'รอแพทย์' && onGoMedical}
												<Button
													size="sm"
													variant="outline"
													class="gap-1 border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
													onclick={(e) => {
														e.stopPropagation();
														onGoMedical(row);
													}}
												>
													<Stethoscope class="size-3.5" />
													<span>คัดกรอง (S2)</span>
												</Button>
											{/if}
											{#if canZoning && (next === 'รอโซน' || !enableMedical || screenedIds.has(row._id)) && onGoZoning}
												<Button
													size="sm"
													class="gap-1 bg-[#0A2647] text-white hover:bg-[#051930]"
													onclick={(e) => {
														e.stopPropagation();
														onGoZoning(row);
													}}
												>
													<MapPin class="size-3.5" />
													<span>จัดโซน (S3)</span>
												</Button>
											{/if}
											<Button
												size="sm"
												variant="outline"
												class="gap-1.5 rounded-lg border-slate-200 px-3 font-semibold text-slate-700"
												onclick={(e) => {
													e.stopPropagation();
													onProfile(row);
												}}
											>
												<Eye class="size-3.5" />
												<span>ดูโปรไฟล์</span>
											</Button>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if pagedRows.totalPages > 1}
					<div class="border-t border-slate-200/80 px-5 py-3">
						<PaginationControls
							bind:page={currentPage}
							count={arrivingFiltered.length}
							perPage={PAGE_SIZE}
						/>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</section>
