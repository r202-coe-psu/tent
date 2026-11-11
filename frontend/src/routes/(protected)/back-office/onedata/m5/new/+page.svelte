<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		M5ReferralCreate,
		ONEDATA_M5_PATH,
		ReferralBackLink,
		ReferralBatchCards,
		oneDataM5BatchPath,
		type Referral,
		type ReferralBatchFailure
	} from '$lib/features/referrals';

	// Nothing created: stay here and show every failure.
	let failedOnly = $state.raw<ReferralBatchFailure[]>([]);

	function handleDone(result: { created: Referral[]; failed: ReferralBatchFailure[] }) {
		const first = result.created[0];
		if (!first) {
			failedOnly = result.failed;
			return;
		}
		void goto(oneDataM5BatchPath(first._id), {
			replaceState: true,
			state: { failed: result.failed }
		});
	}
</script>

<div
	class="flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center"
>
	<h1 class="text-2xl leading-snug font-bold tracking-tight text-slate-900 md:text-3xl">
		ส่งต่อผู้ป่วยผ่าน OneData (M5)
	</h1>
	<div class="shrink-0">
		<ReferralBackLink href={ONEDATA_M5_PATH} label="OneData (M5)" />
	</div>
</div>

<div class="mx-auto w-full max-w-4xl space-y-6 pb-6">
	{#if failedOnly.length > 0}
		<ReferralBatchCards referrals={[]} failed={failedOnly} />
	{/if}
	<M5ReferralCreate onDone={handleDone} />
</div>
