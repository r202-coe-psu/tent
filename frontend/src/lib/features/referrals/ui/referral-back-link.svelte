<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { REFERRALS_PATH } from './referral.ui-helpers';

	let { href = REFERRALS_PATH, label = 'รายการส่งต่อ' }: { href?: string; label?: string } =
		$props();

	let cameFromList = $state(false);
	afterNavigate(({ from }) => {
		cameFromList = from?.url?.pathname === REFERRALS_PATH;
	});

	/** Coming from the list: go back in history so its tab, filters and loaded pages survive. */
	function onclick(event: MouseEvent) {
		if (!cameFromList || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
			return;
		}
		event.preventDefault();
		history.back();
	}
</script>

<a
	{href}
	{onclick}
	class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-2xs transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
>
	<ArrowLeft class="h-4 w-4" aria-hidden="true" />
	{label}
</a>
