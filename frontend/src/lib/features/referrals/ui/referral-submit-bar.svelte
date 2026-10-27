<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ReferralSubmitIntent } from '../data/referral.repository';

	let {
		submitting = false,
		onIntent
	}: {
		submitting?: boolean;
		/** Called on press, before the form's own submit handler runs. */
		onIntent: (intent: ReferralSubmitIntent) => void;
	} = $props();
</script>

<!-- Pinned to the viewport bottom on phones so submit stays reachable on long forms. -->
<div
	class="sticky bottom-[var(--testing-banner-height)] z-20 -mx-4 flex gap-2 border-t border-border/60 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-wrap sm:items-center sm:justify-end md:static md:mx-0 md:gap-3 md:px-0 md:pt-4 md:pb-0"
>
	<Button
		type="submit"
		variant="outline"
		disabled={submitting}
		class="h-11 min-w-28 flex-1 sm:flex-none md:h-8"
		onclick={() => onIntent('draft')}
	>
		บันทึกร่าง
	</Button>
	<Button
		type="submit"
		disabled={submitting}
		class="h-11 min-w-28 flex-1 bg-primary text-primary-foreground hover:bg-primary/95 sm:flex-none md:h-8"
		onclick={() => onIntent('send')}
	>
		ส่งข้อมูล
	</Button>
</div>
