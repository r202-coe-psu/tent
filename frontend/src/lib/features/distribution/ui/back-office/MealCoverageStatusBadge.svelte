<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { coverageStatusLabel } from '../model/meal-coverage-csv';
	import type { CoverageViewRow } from '../model/meal-coverage-view';

	interface Props {
		row: Pick<CoverageViewRow, 'counted' | 'complete'>;
		/** Records a person needs: the target in "N/T". */
		threshold: number;
	}

	let { row, threshold }: Props = $props();

	const tone = $derived(
		row.complete
			? {
					icon: CircleCheck,
					class: 'border-emerald-200 bg-emerald-50 text-emerald-900'
				}
			: row.counted === 0
				? { icon: CircleAlert, class: 'border-red-200 bg-red-50 text-red-900' }
				: { icon: TriangleAlert, class: 'border-amber-200 bg-amber-50 text-amber-900' }
	);
</script>

<Badge variant="outline" class="h-auto py-0.5 font-semibold {tone.class}">
	<tone.icon aria-hidden="true" />
	{coverageStatusLabel(row, threshold)}
</Badge>
