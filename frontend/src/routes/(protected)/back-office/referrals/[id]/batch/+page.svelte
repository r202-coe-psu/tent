<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	import {
		ReferralBackLink,
		ReferralBatchCards,
		referralDetailPath,
		useReferralBatch
	} from '$lib/features/referrals';

	const id = $derived(page.params.id ?? '');
	const batchQuery = useReferralBatch(() => id);
	const members = $derived(batchQuery.data ?? []);
	// Only present right after a create; gone on refresh.
	const failed = $derived(page.state.failed ?? []);
</script>

<div class="flex flex-wrap items-center gap-3">
	<ReferralBackLink />
</div>

{#if batchQuery.isError}
	<Card.Root role="alert" class="border border-red-200 bg-white shadow-2xs">
		<Card.Content class="flex flex-col items-center justify-center gap-3 py-16 text-center">
			<TriangleAlert class="h-8 w-8 text-red-600" />
			<h3 class="font-semibold text-foreground">โหลดชุดส่งต่อไม่สำเร็จ</h3>
			<Button variant="outline" onclick={() => batchQuery.refetch()} class="h-11 gap-2">
				<RotateCw class="h-4 w-4" />
				ลองใหม่
			</Button>
		</Card.Content>
	</Card.Root>
{:else if batchQuery.isPending}
	<Card.Root class="border border-border/80 shadow-sm">
		<Card.Content
			class="flex flex-col items-center justify-center gap-2 py-24 text-muted-foreground"
		>
			<Loader2 class="h-8 w-8 animate-spin text-primary" />
			<span class="text-sm font-medium">กำลังโหลดชุดส่งต่อ...</span>
		</Card.Content>
	</Card.Root>
{:else if members.length === 0 && failed.length === 0}
	<Card.Root class="border border-border/80 shadow-sm">
		<Card.Content class="flex flex-col items-center justify-center gap-3 py-16 text-center">
			<h3 class="font-semibold text-foreground">ไม่พบรายการส่งต่อนี้</h3>
			<p class="text-sm text-muted-foreground">รายการอาจถูกลบหรือไม่มีในศูนย์นี้แล้ว</p>
		</Card.Content>
	</Card.Root>
{:else}
	<div class="mx-auto w-full max-w-5xl pb-6">
		<ReferralBatchCards
			referrals={members}
			{failed}
			mode="view"
			onSelectReferral={(memberId) => goto(referralDetailPath(memberId))}
		/>
	</div>
{/if}
