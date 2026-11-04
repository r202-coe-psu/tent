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

	// Tab, status and search live in the URL so back, refresh and share keep them.
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
	const referrals = $derived(listQuery.data?.pages.flatMap((p) => p.items) ?? []);
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
		onDirectionChange={(next: ReferralDirectionFilter) => updateParams({ direction: next })}
		status={params.status}
		onStatusChange={(next: 'all' | ReferralStatus) => updateParams({ status: next })}
		search={params.q}
		onSearchChange={(next) => updateParams({ q: next })}
		isLoading={listQuery.isPending}
		isError={listQuery.isError && referrals.length === 0}
		onRetry={() => listQuery.refetch()}
		hasMore={listQuery.hasNextPage}
		isFetchingMore={listQuery.isFetchingNextPage}
		isLoadMoreError={listQuery.isFetchNextPageError}
		onLoadMore={() => listQuery.fetchNextPage()}
	/>
</section>
