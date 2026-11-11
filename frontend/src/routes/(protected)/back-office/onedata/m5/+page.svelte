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

	// Status and search live in the URL so back, refresh and share keep them.
	const params = $derived(parseReferralListParams(page.url.searchParams));

	function updateParams(next: Partial<typeof params>) {
		void goto(
			buildReferralListHref({ ...params, ...next, direction: 'outgoing' }, ONEDATA_M5_PATH),
			{
				replaceState: true,
				keepFocus: true,
				noScroll: true
			}
		);
	}

	const listQuery = useReferralPages(() => ({
		direction: 'outgoing',
		status: params.status === 'all' ? undefined : params.status,
		dispatchMode: 'm5'
	}));
	const referrals = $derived(listQuery.data?.pages.flatMap((p) => p.items) ?? []);

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

<section aria-label="ชุดส่งต่อผ่าน OneData" class="space-y-3">
	<ReferralList
		{referrals}
		showDirection={false}
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
