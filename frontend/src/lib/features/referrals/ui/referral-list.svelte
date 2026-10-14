<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Check from '@lucide/svelte/icons/check';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Eye from '@lucide/svelte/icons/eye';
	import Search from '@lucide/svelte/icons/search';
	import Users from '@lucide/svelte/icons/users';
	import type {
		Referral,
		ReferralDirectionFilter,
		ReferralStatus
	} from '../domain/referral.schema';
	import { groupReferralsForList, type ReferralListGroup } from '../domain/referral.batch-group';
	import { useEvacuees, type Evacuee } from '$lib/features/people';
	import { getShelterCode } from '$lib/db/shelter';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		formatReferralDate,
		getStatusBadgeVariant,
		getStatusLabel,
		getUrgencyLabel,
		getUrgencyStyle,
		isIncomingListItem,
		getReferralDirection,
		getDirectionLabel,
		getDirectionBadgeVariant,
		resolveEvacueeName
	} from './referral.ui-helpers';

	type StatusTab = 'all' | ReferralStatus;

	let {
		referrals,
		onSelect,
		selectedKey = null,
		evacuees = null,
		direction = 'outgoing',
		onDirectionChange,
		status = 'all',
		onStatusChange,
		isLoading = false,
		isError = false,
		onRetry,
		hasMore = false,
		isFetchingMore = false,
		isLoadMoreError = false,
		onLoadMore
	}: {
		referrals: Referral[];
		onSelect?: (group: ReferralListGroup) => void;
		selectedKey?: string | null;
		evacuees?: Evacuee[] | null;
		/** Server query inputs — the parent owns them and refetches on change. */
		direction?: ReferralDirectionFilter;
		onDirectionChange?: (next: ReferralDirectionFilter) => void;
		status?: StatusTab;
		onStatusChange?: (next: StatusTab) => void;
		isLoading?: boolean;
		isError?: boolean;
		onRetry?: () => void;
		hasMore?: boolean;
		isFetchingMore?: boolean;
		isLoadMoreError?: boolean;
		onLoadMore?: () => void;
	} = $props();

	const actorShelter = $derived(getShelterCode());

	// Load evacuees client-side if not provided
	// Note: Client-side preloading is acceptable for active shelter scope (< 100 evacuees).
	// For large multi-shelter deployments (R4), consider server-side name join or lazy lookup.
	const evacueesQuery = useEvacuees();
	const resolvedEvacuees = $derived(
		evacuees !== null ? evacuees : (evacueesQuery.data ?? [])
	) as Evacuee[];

	function getEvacueeName(evacueeId: string, referral?: Referral): string {
		return resolveEvacueeName(
			resolvedEvacuees.find((e) => e._id === evacueeId),
			referral?.evacuee_summary
		);
	}

	// Search filters the already-loaded rows only; direction/status are server-side.
	let searchQuery = $state('');

	const filteredGroups = $derived.by(() => {
		let list = referrals;
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase().trim();
			list = list.filter((r) => {
				const evacName = getEvacueeName(r.evacuee_id, r).toLowerCase();
				const orgName = r.to_org?.name?.toLowerCase() ?? r.to_shelter_code?.toLowerCase() ?? '';
				const evacId = r.evacuee_id.toLowerCase();
				return evacName.includes(query) || orgName.includes(query) || evacId.includes(query);
			});
		}
		return groupReferralsForList(list);
	});

	const shownCount = $derived(filteredGroups.reduce((n, g) => n + g.count, 0));

	const tabs: { value: StatusTab; label: string }[] = [
		{ value: 'all', label: 'ทั้งหมด' },
		{ value: 'draft', label: 'ฉบับร่าง (Draft)' },
		{ value: 'sent', label: 'ส่งแล้ว (Sent)' },
		{ value: 'accepted', label: 'ตอบรับแล้ว (Accepted)' },
		{ value: 'rejected', label: 'ปฏิเสธ (Rejected)' },
		{ value: 'closed', label: 'ปิดรายการ (Closed)' }
	];

	const directions: { value: ReferralDirectionFilter; label: string }[] = [
		{ value: 'outgoing', label: 'ขาออก' },
		{ value: 'incoming', label: 'ขาเข้า' }
	];

	function primaryLabel(group: ReferralListGroup): string {
		if (group.count > 1) {
			return `ชุดส่งต่อ ${group.count} คน`;
		}
		return getEvacueeName(group.sample.evacuee_id, group.sample);
	}

	function destinationLabel(referral: Referral): string {
		return referral.to_shelter_code || referral.to_org?.name || '-';
	}
</script>

<div class="space-y-4">
	<!-- Row 1: Top Search Bar (Full Width) -->
	<div class="relative mb-3 w-full">
		<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
			<Search class="h-4 w-4 text-muted-foreground" />
		</div>
		<Input
			type="text"
			bind:value={searchQuery}
			aria-label="ค้นหารายการส่งต่อ"
			placeholder="ค้นหาชื่อผู้ประสบภัย หรือหน่วยงาน/ศูนย์พักพิงปลายทาง..."
			class="bg-background pl-9 placeholder:text-base md:placeholder:text-sm"
		/>
	</div>

	<!-- Row 2: Direction (server query) -->
	<div
		role="tablist"
		aria-label="ทิศทางการส่งต่อ"
		class="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
	>
		{#each directions as d (d.value)}
			{@const isActive = direction === d.value}
			<button
				type="button"
				role="tab"
				aria-selected={isActive}
				onclick={() => {
					if (!isActive) onDirectionChange?.(d.value);
				}}
				class="rounded-md px-4 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
				{isActive
					? 'bg-card font-semibold text-primary shadow-xs'
					: 'font-medium text-muted-foreground hover:text-foreground'}"
			>
				{d.label}
			</button>
		{/each}
	</div>

	<!-- Row 3: Status tabs (server query) -->
	<div
		role="group"
		aria-label="กรองตามสถานะ"
		class="flex flex-wrap gap-1.5 border-b border-border pb-px"
	>
		{#each tabs as tab (tab.value)}
			{@const isActive = status === tab.value}
			<button
				type="button"
				aria-pressed={isActive}
				onclick={() => {
					if (status !== tab.value) onStatusChange?.(tab.value);
				}}
				class="-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm transition-all hover:text-foreground focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
				{isActive
					? 'border-primary font-semibold text-primary'
					: 'border-transparent font-medium text-muted-foreground hover:border-border'}"
			>
				{#if isActive}
					<Check class="h-3.5 w-3.5" aria-hidden="true" />
				{/if}
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- List -->
	{#if isLoading}
		<div class="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
			<Loader2 class="h-8 w-8 animate-spin text-primary" />
			<span class="text-sm">กำลังโหลดข้อมูล...</span>
		</div>
	{:else if isError}
		<div
			role="alert"
			class="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-white py-12 text-center"
		>
			<TriangleAlert class="h-8 w-8 text-red-600" />
			<h3 class="font-semibold text-foreground">โหลดรายการส่งต่อไม่สำเร็จ</h3>
			<p class="text-sm text-muted-foreground">กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
			<Button variant="outline" onclick={() => onRetry?.()} class="gap-2">
				<RotateCw class="h-4 w-4" />
				ลองใหม่
			</Button>
		</div>
	{:else if filteredGroups.length === 0}
		<div
			class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground"
		>
			<AlertCircle class="mb-4 h-10 w-10 text-muted-foreground/60" />
			<h3 class="mb-1 font-semibold text-foreground">ไม่พบข้อมูลรายการส่งต่อ</h3>
			<p class="text-sm">ไม่มีข้อมูลการส่งต่อที่ตรงกับเงื่อนไขในขณะนี้</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each filteredGroups as group (group.key)}
				<button
					type="button"
					onclick={() => onSelect?.(group)}
					aria-current={selectedKey === group.key ? 'true' : undefined}
					class="group relative flex w-full cursor-pointer flex-col justify-between gap-1.5 rounded-lg border border-border/80 bg-card p-3 text-left shadow-xs transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
					{selectedKey === group.key ? 'border-primary ring-2 ring-primary/10' : ''}"
				>
					<!-- Line 1: Primary Info -->
					<div class="flex flex-wrap items-center gap-2">
						{#if isIncomingListItem(group.sample, actorShelter)}
							<Badge
								class="h-5 bg-violet-100 px-1.5 text-2xs font-semibold text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
							>
								ขาเข้า
							</Badge>
						{/if}
						{#if group.count > 1}
							<Badge
								class="h-5 gap-1 bg-sky-100 px-1.5 text-2xs font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
							>
								<Users class="h-3 w-3" />
								{group.count} คน
							</Badge>
						{/if}
						<Badge
							class="{getUrgencyStyle(group.sample.urgency)} h-5 px-1.5 text-2xs font-semibold"
						>
							{getUrgencyLabel(group.sample.urgency)}
						</Badge>
						<span class="truncate text-sm font-bold text-foreground">
							{primaryLabel(group)}
						</span>
						<span class="text-xs text-muted-foreground">→</span>
						<span class="truncate text-xs font-medium text-muted-foreground">
							{destinationLabel(group.sample)}
						</span>
						{#if group.sample.reason}
							<span class="hidden max-w-[200px] truncate text-xs text-muted-foreground sm:inline">
								| {group.sample.reason}
							</span>
						{/if}
					</div>

					<!-- Line 2: Meta Info + Action -->
					<div class="flex w-full items-center justify-between gap-2">
						<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<span>{formatReferralDate(group.createdAt)}</span>
							{#if group.sharedStatus}
								<Badge class="{getStatusBadgeVariant(group.sharedStatus)} h-4 px-1 text-2xs">
									{getStatusLabel(group.sharedStatus)}
								</Badge>
							{:else}
								<Badge
									class="h-4 bg-amber-100 px-1 text-2xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
								>
									หลายสถานะ
								</Badge>
							{/if}
							{#if group.sample.referral_type === 'capacity'}
								{@const direction = getReferralDirection(group.sample)}
								{#if direction !== 'internal'}
									<Badge class="{getDirectionBadgeVariant(direction)} h-4 px-1 text-2xs">
										{getDirectionLabel(direction)}
										{#if direction === 'outgoing'}
											→ {group.sample.to_shelter_code}
										{:else if direction === 'incoming'}
											← {group.sample.shelter_code}
										{/if}
									</Badge>
								{/if}
							{/if}
							{#if group.sample.reason}
								<span class="inline truncate text-xs text-muted-foreground sm:hidden">
									| {group.sample.reason}
								</span>
							{/if}
						</div>
						<span
							class="inline-flex h-6 shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground group-hover:text-primary group-focus-visible:text-primary"
						>
							<Eye class="h-3.5 w-3.5" aria-hidden="true" />
							รายละเอียด →
						</span>
					</div>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Footer: load more -->
	{#if !isLoading && !isError && referrals.length > 0}
		<div
			class="mt-4 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-4 sm:flex-row"
		>
			<div class="space-y-0.5 text-center font-sans text-xs text-muted-foreground sm:text-left">
				<div>แสดง {shownCount} รายการ</div>
				{#if isLoadMoreError}
					<div role="alert" class="font-medium text-red-700">โหลดรายการเพิ่มไม่สำเร็จ</div>
				{/if}
				{#if hasMore && searchQuery.trim()}
					<div role="status">ค้นหาเฉพาะรายการที่โหลดแล้ว</div>
				{/if}
			</div>

			{#if hasMore}
				<Button
					variant="outline"
					onclick={() => onLoadMore?.()}
					disabled={isFetchingMore}
					class="gap-2"
				>
					{#if isFetchingMore}
						<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
					{/if}
					โหลดเพิ่ม
				</Button>
			{:else}
				<span class="text-xs text-muted-foreground">ไม่มีรายการเพิ่มเติม</span>
			{/if}
		</div>
	{/if}
</div>
