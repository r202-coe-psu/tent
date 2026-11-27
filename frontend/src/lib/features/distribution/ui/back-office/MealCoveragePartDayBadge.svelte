<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import { Badge } from '$lib/components/ui/badge/index.js';

	interface Props {
		/** Days of the report on which the person was in the shelter only part of the day. */
		days: number;
		/** The report covers several days: the badge says how many. */
		multiDay?: boolean;
	}

	let { days, multiDay = false }: Props = $props();
</script>

<Badge variant="outline" class="h-auto border-sky-200 bg-sky-50 py-0.5 font-semibold text-sky-900">
	<Clock aria-hidden="true" />
	อยู่ในศูนย์ไม่เต็มวัน{multiDay ? ` ${days} วัน` : ''}
</Badge>
