<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Eye from '@lucide/svelte/icons/eye';
	import Search from '@lucide/svelte/icons/search';
	import type { Referral, ReferralStatus } from '../domain/referral.schema';
	import { useEvacuees, type Evacuee } from '$lib/features/people';
	import { getShelterCode } from '$lib/db/shelter';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import {
		formatReferralDate,
		getStatusBadgeVariant,
		getStatusLabel,
		getUrgencyLabel,
		getUrgencyStyle,
		isIncomingListItem
	} from './referral.ui-helpers';

	let {
		referrals,
		onSelect,
		selectedId = null,
		evacuees = null
	}: {
		referrals: Referral[];
		onSelect?: (id: string) => void;
		selectedId?: string | null;
		evacuees?: Evacuee[] | null;
	} = $props();

	const actorShelter = $derived(getShelterCode());

	// Load evacuees client-side if not provided
	// Note: Client-side preloading is acceptable for active shelter scope (< 100 evacuees).
	// For large multi-shelter deployments (R4), consider server-side name join or lazy lookup.
	const evacueesQuery = useEvacuees();
	const resolvedEvacuees = $derived(
		evacuees !== null ? evacuees : (evacueesQuery.data ?? [])
	) as Evacuee[];

	function getEvacueeName(evacueeId: string): string {
		const evac = resolvedEvacuees.find((e) => e._id === evacueeId);
		return evac ? `${evac.first_name} ${evac.last_name}` : 'ไม่พบชื่อผู้ประสบภัย';
	}

	// Local state for filtering and pagination
	let activeTab = $state<'all' | ReferralStatus>('all');
	let searchQuery = $state('');
	let currentPage = $state(1);
	const PAGE_SIZE = 10;

	// Reset currentPage automatically when activeTab or searchQuery changes
	$effect(() => {
		void searchQuery;
		void activeTab;
		currentPage = 1;
	});

	// Filter pipeline
	const filteredReferrals = $derived.by(() => {
		let list = referrals;
		if (activeTab !== 'all') {
			list = list.filter((r) => r.status === activeTab);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase().trim();
			list = list.filter((r) => {
				const evacName = getEvacueeName(r.evacuee_id).toLowerCase();
				const orgName = r.to_org?.name?.toLowerCase() ?? r.to_shelter_code?.toLowerCase() ?? '';
				const evacId = r.evacuee_id.toLowerCase();
				return evacName.includes(query) || orgName.includes(query) || evacId.includes(query);
			});
		}

		return list;
	});

	// Paginate pipeline
	const paginatedReferrals = $derived(
		filteredReferrals.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
	);

	const tabs: { value: 'all' | ReferralStatus; label: string }[] = [
		{ value: 'all', label: 'ทั้งหมด' },
		{ value: 'draft', label: 'ฉบับร่าง (Draft)' },
		{ value: 'sent', label: 'ส่งแล้ว (Sent)' },
		{ value: 'accepted', label: 'ตอบรับแล้ว (Accepted)' },
		{ value: 'rejected', label: 'ปฏิเสธ (Rejected)' },
		{ value: 'closed', label: 'ปิดรายการ (Closed)' }
	];
</script>

<div class="space-y-4">
	<!-- Row 1: Top Search Bar (Full Width) -->
	<div class="relative mb-3 w-full">
		<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
			<Search class="h-4 w-4 text-muted-foreground" />
		</div>
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="ค้นหาชื่อผู้ประสบภัย หรือหน่วยงาน/ศูนย์พักพิงปลายทาง..."
			class="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 pl-9 text-base shadow-xs ring-offset-background transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40"
		/>
	</div>

	<!-- Row 2: Filter Tabs -->
	<div class="flex flex-wrap gap-1.5 border-b border-border pb-px">
		{#each tabs as tab (tab.value)}
			<button
				type="button"
				onclick={() => {
					activeTab = tab.value;
				}}
				class="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-all hover:text-foreground
				{activeTab === tab.value
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- List -->
	{#if paginatedReferrals.length === 0}
		<div
			class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground"
		>
			<AlertCircle class="mb-4 h-10 w-10 text-muted-foreground/60" />
			<h3 class="mb-1 font-semibold text-foreground">ไม่พบข้อมูลรายการส่งต่อ</h3>
			<p class="text-sm">ไม่มีข้อมูลการส่งต่อที่ตรงกับเงื่อนไขในขณะนี้</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each paginatedReferrals as referral (referral._id)}
				<button
					type="button"
					onclick={() => onSelect?.(referral._id)}
					class="group relative flex w-full cursor-pointer flex-col justify-between gap-1.5 rounded-lg border border-border/80 bg-card p-3 text-left shadow-xs transition-colors hover:border-primary/50 hover:bg-accent/50
					{selectedId === referral._id ? 'border-primary ring-2 ring-primary/10' : ''}"
				>
					<!-- Line 1: Primary Info -->
					<div class="flex flex-wrap items-center gap-2">
						{#if isIncomingListItem(referral, actorShelter)}
							<Badge
								class="h-5 bg-violet-100 px-1.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
							>
								ขาเข้า
							</Badge>
						{/if}
						<Badge class="{getUrgencyStyle(referral.urgency)} h-5 px-1.5 text-[10px] font-semibold">
							{getUrgencyLabel(referral.urgency)}
						</Badge>
						<span class="truncate text-sm font-bold text-foreground">
							{getEvacueeName(referral.evacuee_id)}
						</span>
						<span class="text-xs text-muted-foreground">→</span>
						<span class="truncate text-xs font-medium text-muted-foreground">
							{referral.to_shelter_code || referral.to_org?.name || '-'}
						</span>
						{#if referral.reason}
							<span class="hidden max-w-[200px] truncate text-xs text-muted-foreground sm:inline">
								| {referral.reason}
							</span>
						{/if}
					</div>

					<!-- Line 2: Meta Info + Action -->
					<div class="flex w-full items-center justify-between gap-2">
						<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<span>{formatReferralDate(referral.created_at)}</span>
							<Badge class="{getStatusBadgeVariant(referral.status)} h-4 px-1 text-[10px]">
								{getStatusLabel(referral.status)}
							</Badge>
							{#if referral.reason}
								<span class="inline truncate text-xs text-muted-foreground sm:hidden">
									| {referral.reason}
								</span>
							{/if}
						</div>
						<Button
							variant="ghost"
							size="sm"
							onclick={(e) => {
								e.stopPropagation();
								onSelect?.(referral._id);
							}}
							class="h-6 shrink-0 gap-1 px-2 text-xs text-muted-foreground group-hover:text-primary"
						>
							<Eye class="h-3.5 w-3.5" />
							รายละเอียด →
						</Button>
					</div>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Pagination Footer -->
	{#if filteredReferrals.length > 0}
		<div
			class="mt-4 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-4 sm:flex-row"
		>
			<!-- Stats text -->
			<div class="font-sans text-xs text-muted-foreground">
				แสดงรายการที่ {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(
					currentPage * PAGE_SIZE,
					filteredReferrals.length
				)} จากทั้งหมด {filteredReferrals.length} รายการ
			</div>

			<!-- Shadcn Pagination Root -->
			<Pagination.Root bind:page={currentPage} count={filteredReferrals.length} perPage={PAGE_SIZE}>
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
		</div>
	{/if}
</div>
