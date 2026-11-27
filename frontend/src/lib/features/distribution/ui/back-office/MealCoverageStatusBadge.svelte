<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Clock from '@lucide/svelte/icons/clock';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { coverageStatusLabel } from '../model/meal-coverage-csv';
	import type { CoverageViewRow } from '../model/meal-coverage-view';

	interface Props {
		row: Pick<CoverageViewRow, 'counted' | 'complete' | 'judgedDays' | 'shortDays' | 'partialDays'>;
		/** The report covers several days: the label counts days instead of meals. */
		multiDay?: boolean;
	}

	let { row, multiDay = false }: Props = $props();

	const tone = $derived(
		row.judgedDays === 0
			? { icon: Clock, class: 'border-slate-300 bg-slate-50 text-slate-700' }
			: row.complete
				? { icon: CircleCheck, class: 'border-emerald-200 bg-emerald-50 text-emerald-900' }
				: row.counted === 0
					? { icon: CircleAlert, class: 'border-red-200 bg-red-50 text-red-900' }
					: { icon: TriangleAlert, class: 'border-amber-200 bg-amber-50 text-amber-900' }
	);
</script>

<Badge variant="outline" class="h-auto py-0.5 font-semibold {tone.class}">
	<tone.icon aria-hidden="true" />
	{coverageStatusLabel(row, multiDay)}
</Badge>
