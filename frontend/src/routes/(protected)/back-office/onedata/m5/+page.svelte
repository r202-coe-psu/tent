<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';

	import {
		M5GateAlert,
		ONEDATA_M5_PATH,
		ReferralList,
		buildReferralListHref,
		parseReferralListParams,
		useIntegrationStatus,
		useReferralPages,
		type ReferralStatus
	} from '$lib/features/referrals';

	// Status, search and page live in the URL so back, refresh and share keep them.
	const params = $derived(parseReferralListParams(page.url.searchParams));

	let listSection = $state<HTMLElement>();

	// Filters replace the history entry; page turns push one so browser back steps to the previous
	// page, scroll to the top and focus the list (same pattern as the referrals list page).
	async function updateParams(next: Partial<typeof params>, { pageTurn = false } = {}) {
		await goto(
			buildReferralListHref({ ...params, ...next, direction: 'outgoing' }, ONEDATA_M5_PATH),
			{
				replaceState: !pageTurn,
				keepFocus: true,
				noScroll: !pageTurn
			}
		);
		if (pageTurn) listSection?.focus({ preventScroll: true });
	}

	const listQuery = useReferralPages(() => ({
		direction: 'outgoing',
		status: params.status === 'all' ? undefined : params.status,
		dispatchMode: 'm5'
	}));
	// One API page per screen; pages already fetched stay cached so "previous" needs no refetch.
	const pages = $derived(listQuery.data?.pages ?? []);
	// A cold load (refresh) has no bookmarks yet, so `?page=N` clamps to the last fetched page.
	const pageIndex = $derived(Math.max(0, Math.min(params.page, pages.length) - 1));
	const referrals = $derived(pages[pageIndex]?.items ?? []);
	const hasNext = $derived(pageIndex < pages.length - 1 || listQuery.hasNextPage);

	// Cursor paging cannot jump to page N, so a stale `?page=` is rewritten to the page shown.
	$effect(() => {
		if (listQuery.isSuccess && !listQuery.isFetching && params.page > pages.length) {
			void updateParams({ page: pages.length });
		}
	});

	async function goNext() {
		// Snapshot before the await: if the status or page changed mid-fetch, stay where the user is.
		const from = params;
		const nextPage = pageIndex + 2; // 0-based index → 1-based number of the following page
		if (pageIndex >= pages.length - 1) {
			const res = await listQuery.fetchNextPage();
			if (res.isFetchNextPageError) return;
		}
		if (params.status !== from.status || params.page !== from.page) return;
		void updateParams({ page: nextPage }, { pageTurn: true });
	}

	const statusQuery = useIntegrationStatus();
	const gateState = $derived(statusQuery.data?.m5.state);
</script>

<div
	class="flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center"
>
	<div class="min-w-0 flex-1 space-y-1">
		<p class="text-sm font-semibold text-muted-foreground">OneData Platform</p>
		<h1 class="text-2xl leading-snug font-bold tracking-tight text-slate-900 md:text-3xl">
			OneData ระบบส่งต่อผู้ป่วย (M5)
		</h1>
		<p class="text-sm text-muted-foreground">
			ส่งผู้ป่วยไปโรงพยาบาล ให้ สธ. พิจารณาและโรงพยาบาลปลายทางรับเรื่องผ่านระบบ
			สถานะจะอัปเดตเองเมื่อ สธ. หรือโรงพยาบาลดำเนินการ ถ้าประสานโรงพยาบาลเองให้บันทึกที่
			<a
				href={resolve('/back-office/referrals')}
				class="font-semibold text-primary underline underline-offset-2">การส่งต่อผู้เข้าพัก</a
			>
		</p>
	</div>

	<a
		href={resolve('/back-office/onedata/m5/new')}
		class={buttonVariants({ class: 'h-11 shrink-0 gap-2 font-semibold shadow-sm' })}
	>
		<Plus class="h-4.5 w-4.5" aria-hidden="true" />
		ส่งต่อผู้ป่วย
	</a>
</div>

{#if gateState && gateState !== 'ready'}
	<M5GateAlert
		state={gateState}
		checking={statusQuery.isFetching}
		onRetry={() => statusQuery.refetch()}
	/>
{/if}

<section
	bind:this={listSection}
	tabindex="-1"
	aria-label="ชุดส่งต่อผ่าน OneData"
	class="space-y-3 outline-none"
>
	<ReferralList
		{referrals}
		showDirection={false}
		status={params.status}
		onStatusChange={(next: 'all' | ReferralStatus) => updateParams({ status: next, page: 1 })}
		search={params.q}
		onSearchChange={(next) => updateParams({ q: next })}
		isLoading={listQuery.isPending}
		isError={listQuery.isError && referrals.length === 0}
		onRetry={() => listQuery.refetch()}
		page={pageIndex + 1}
		hasPrev={pageIndex > 0}
		{hasNext}
		isFetchingNext={listQuery.isFetchingNextPage}
		isNextError={listQuery.isFetchNextPageError && pageIndex === pages.length - 1}
		onPrev={() => updateParams({ page: pageIndex }, { pageTurn: true })}
		onNext={goNext}
	/>
</section>
