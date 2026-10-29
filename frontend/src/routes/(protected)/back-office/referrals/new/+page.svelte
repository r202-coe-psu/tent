<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		ReferralBackLink,
		ReferralBatchCards,
		ReferralCreateForm,
		referralBatchPath,
		type Referral,
		type ReferralBatchFailure
	} from '$lib/features/referrals';

	// Nothing created: stay here and show every failure.
	let failedOnly = $state.raw<ReferralBatchFailure[]>([]);

	function handleBatchDone(result: { created: Referral[]; failed: ReferralBatchFailure[] }) {
		const first = result.created[0];
		if (!first) {
			failedOnly = result.failed;
			return;
		}
		void goto(referralBatchPath(first._id), {
			replaceState: true,
			state: { failed: result.failed }
		});
	}
</script>

<div
	class="flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center"
>
	<h1 class="text-2xl leading-snug font-bold tracking-tight text-slate-900 md:text-3xl">
		สร้างรายการส่งต่อ
	</h1>
	<div class="shrink-0"><ReferralBackLink /></div>
</div>

<div class="mx-auto w-full max-w-4xl space-y-6 pb-6">
	{#if failedOnly.length > 0}
		<ReferralBatchCards referrals={[]} failed={failedOnly} />
	{/if}
	<ReferralCreateForm onBatchDone={handleBatchDone} />
</div>
