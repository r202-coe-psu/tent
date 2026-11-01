<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import Layers from '@lucide/svelte/icons/layers';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	import {
		ReferralBackLink,
		ReferralDetail,
		referralBatchPath,
		useReferral,
		useReferralBatch
	} from '$lib/features/referrals';

	const id = $derived(page.params.id ?? '');

	const detailQuery = useReferral(() => id);
	const referral = $derived(detailQuery.data);

	const batchQuery = useReferralBatch(
		() => id,
		() => !!referral
	);
	const batchSize = $derived(batchQuery.data?.length ?? 0);
</script>

<div class="flex flex-wrap items-center gap-3">
	<ReferralBackLink />
	{#if batchSize > 1}
		<a
			href={referralBatchPath(id)}
			class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
		>
			<Layers class="h-4 w-4" aria-hidden="true" />
			ดูชุดส่งต่อ ({batchSize} คน)
		</a>
	{/if}
</div>

{#if referral}
	<div class="pb-6">
		<ReferralDetail {referral} />
	</div>
{:else if detailQuery.isError}
	<Card.Root role="alert" class="border border-red-200 bg-white shadow-2xs">
		<Card.Content class="flex flex-col items-center justify-center gap-3 py-16 text-center">
			<TriangleAlert class="h-8 w-8 text-red-600" />
			<h3 class="font-semibold text-foreground">โหลดประวัติการส่งต่อไม่สำเร็จ</h3>
			<p class="text-sm text-muted-foreground">กรุณาลองใหม่อีกครั้ง หรือกลับไปเลือกรายการอื่น</p>
			<Button variant="outline" onclick={() => detailQuery.refetch()} class="h-11 gap-2">
				<RotateCw class="h-4 w-4" />
				ลองใหม่
			</Button>
		</Card.Content>
	</Card.Root>
{:else if detailQuery.isSuccess}
	<Card.Root class="border border-border/80 shadow-sm">
		<Card.Content class="flex flex-col items-center justify-center gap-3 py-16 text-center">
			<h3 class="font-semibold text-foreground">ไม่พบรายการส่งต่อนี้</h3>
			<p class="text-sm text-muted-foreground">รายการอาจถูกลบหรือไม่มีในศูนย์นี้แล้ว</p>
		</Card.Content>
	</Card.Root>
{:else}
	<Card.Root class="border border-border/80 shadow-sm">
		<Card.Content
			class="flex flex-col items-center justify-center gap-2 py-24 text-muted-foreground"
		>
			<Loader2 class="h-8 w-8 animate-spin text-primary" />
			<span class="text-sm font-medium">กำลังเปิดประวัติ...</span>
		</Card.Content>
	</Card.Root>
{/if}
