<script lang="ts">
	import type { LedgerGroup } from './ledger-view';

	let { group, label }: { group: LedgerGroup; label: string } = $props();

	const TONE: Record<LedgerGroup, string> = {
		in: 'bg-emerald-50 text-emerald-800',
		out: 'bg-orange-50 text-orange-800',
		adjust: 'bg-blue-50 text-blue-800',
		transfer: 'bg-violet-50 text-violet-800'
	};
</script>

<span
	class="inline-block rounded-lg px-2.5 py-0.5 text-xs font-bold whitespace-nowrap {TONE[group]}"
>
	{label}
</span>
