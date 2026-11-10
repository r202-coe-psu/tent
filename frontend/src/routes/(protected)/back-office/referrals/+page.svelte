<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';

	import {
		useReferralPages,
		ReferralList,
		buildReferralListHref,
		parseReferralListParams,
		type ReferralDirectionFilter,
		type ReferralStatus
	} from '$lib/features/referrals';

	// Tab, status, search and page live in the URL so back, refresh and share keep them.
	const params = $derived(parseReferralListParams(page.url.searchParams));

	function updateParams(next: Partial<typeof params>) {
		void goto(buildReferralListHref({ ...params, ...next }), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	const listQuery = useReferralPages(() => ({
		direction: params.direction,
		status: params.status === 'all' ? undefined : params.status
	}));
	// One API page per screen; pages already fetched stay cached so "previous" needs no refetch.
	const pages = $derived(listQuery.data?.pages ?? []);
	// A cold load (refresh) has no bookmarks yet, so `?page=N` clamps to the last fetched page.
	const pageIndex = $derived(Math.max(0, Math.min(params.page, pages.length) - 1));
	const referrals = $derived(pages[pageIndex]?.items ?? []);
	const hasNext = $derived(pageIndex < pages.length - 1 || listQuery.hasNextPage);

	async function goNext() {
		// Snapshot before the await: if the tab, status or page changed mid-fetch, stay where the user is.
		const from = params;
		const nextPage = pageIndex + 2; // 0-based index → 1-based number of the following page
		if (pageIndex >= pages.length - 1) {
			const res = await listQuery.fetchNextPage();
			if (res.isFetchNextPageError) return;
		}
		if (
			params.direction !== from.direction ||
			params.status !== from.status ||
			params.page !== from.page
		) {
			return;
		}
		updateParams({ page: nextPage });
	}
</script>

<div
	class="flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center"
>
	<div class="min-w-0 flex-1 space-y-1">
		<h1 class="text-2xl leading-snug font-bold tracking-tight text-slate-900 md:text-3xl">
			ระบบส่งต่อผู้เข้าพัก
		</h1>
		<p class="text-sm text-muted-foreground">
			สร้างคำขอส่งต่อที่ศูนย์ต้นทาง — คำขอย้ายศูนย์ (capacity) จะปรากฏที่ศูนย์ปลายทางหลังกดส่ง
			และย้ายผู้เข้าพักเมื่อปลายทางตอบรับเท่านั้น
		</p>
	</div>

	<a
		href="/back-office/referrals/new"
		class={buttonVariants({ class: 'h-11 shrink-0 gap-2 font-semibold shadow-sm' })}
	>
		<Plus class="h-4.5 w-4.5" aria-hidden="true" />
		สร้างรายการส่งต่อ
	</a>
</div>

<section aria-label="รายการส่งตัวทั้งหมด" class="space-y-3">
	<ReferralList
		{referrals}
		direction={params.direction}
		onDirectionChange={(next: ReferralDirectionFilter) =>
			updateParams({ direction: next, page: 1 })}
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
		onPrev={() => updateParams({ page: pageIndex })}
		onNext={goNext}
	/>
</section>
