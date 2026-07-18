<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import Eye from '@lucide/svelte/icons/eye';
	import Search from '@lucide/svelte/icons/search';
	import type { Referral, ReferralStatus } from '../domain/referral.schema';
	import { useEvacuees, type Evacuee } from '$lib/features/people';
	import * as Pagination from '$lib/components/ui/pagination/index.js';

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

	// Load evacuees client-side if not provided
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
	const PAGE_SIZE = 5;

	// Reset currentPage automatically when activeTab or searchQuery changes
	$effect(() => {
		// Read dependencies to register Svelte 5 reactivity
		if (searchQuery !== undefined || activeTab !== undefined) {
			currentPage = 1;
		}
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
				const orgName = r.to_org.name.toLowerCase();
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

	function getUrgencyStyle(urgency: string) {
		if (urgency === 'urgent') {
			return 'bg-red-500 hover:bg-red-600 text-white animate-pulse';
		}
		return 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
	}

	function getStatusBadgeVariant(status: ReferralStatus) {
		switch (status) {
			case 'draft':
				return 'bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-950/20 dark:text-orange-400';
			case 'sent':
				return 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-950/20 dark:text-blue-400';
			case 'accepted':
				return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400';
			case 'rejected':
				return 'bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-950/20 dark:text-rose-400';
			case 'closed':
				return 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800/40 dark:text-slate-400';
		}
	}

	function getStatusLabel(status: ReferralStatus) {
		switch (status) {
			case 'draft':
				return 'ฉบับร่าง';
			case 'sent':
				return 'ส่งตัวแล้ว';
			case 'accepted':
				return 'ตอบรับแล้ว';
			case 'rejected':
				return 'ปฏิเสธรับ';
			case 'closed':
				return 'ปิดการส่งตัว';
		}
	}

	function formatDate(isoString: string) {
		try {
			const d = new Date(isoString);
			return d.toLocaleString('th-TH', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return isoString;
		}
	}
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
			placeholder="ค้นหาชื่อผู้ประสบภัย หรือหน่วยงานปลายทาง..."
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
		<div class="grid gap-3">
			{#each paginatedReferrals as referral (referral._id)}
				<button
					type="button"
					onclick={() => onSelect?.(referral._id)}
					class="group relative flex w-full cursor-pointer flex-col justify-between gap-4 rounded-xl border border-border/80 bg-card p-4 text-left shadow-sm transition-all hover:border-primary/50 md:flex-row md:items-center
					{selectedId === referral._id ? 'border-primary ring-2 ring-primary/10' : ''}"
				>
					<!-- Block 1: Content Envelope (Left Side) -->
					<div class="flex flex-1 flex-col gap-1.5 font-sans">
						<div class="flex flex-wrap items-center gap-2">
							<Badge class={getUrgencyStyle(referral.urgency)}>
								{referral.urgency === 'urgent' ? 'ด่วนมาก' : 'ปกติ'}
							</Badge>
							<Badge class={getStatusBadgeVariant(referral.status)}>
								{getStatusLabel(referral.status)}
							</Badge>
							<span class="flex items-center gap-1 text-xs text-muted-foreground">
								<Clock class="h-3.5 w-3.5" />
								{formatDate(referral.created_at)}
							</span>
						</div>

						<div class="min-w-0">
							<!-- Heading -->
							<h4 class="text-base font-bold text-foreground">
								{getEvacueeName(referral.evacuee_id)}
							</h4>

							<!-- Subtext Block -->
							<div class="mt-1.5 space-y-1 text-xs font-semibold text-foreground/80">
								<p>
									ส่งตัวไปยัง: {referral.to_org.name} ({referral.to_org.kind === 'hospital'
										? 'โรงพยาบาล'
										: referral.to_org.kind === 'social_services'
											? 'สังคมสงเคราะห์'
											: 'อื่น ๆ'})
								</p>
								<p>เหตุผล: {referral.reason}</p>
							</div>
						</div>
					</div>

					<!-- Block 2: Action Button Envelope (Right Side) -->
					<div class="flex shrink-0 items-center justify-end md:justify-center">
						<Button
							variant="ghost"
							size="sm"
							onclick={(e) => {
								e.stopPropagation();
								onSelect?.(referral._id);
							}}
							class="group/button inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[min(var(--radius-md),12px)] border border-transparent bg-clip-padding px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-all outline-none select-none group-hover:text-primary hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-expanded:bg-muted aria-expanded:text-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:hover:bg-muted/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
						>
							<Eye class="h-4 w-4" />
							รายละเอียด
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
