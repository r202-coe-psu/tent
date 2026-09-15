<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { DateFormatter, parseDate, type DateValue } from '@internationalized/date';
	import type { DateRange } from 'bits-ui';
	import { Button } from '$lib/components/ui/button/index.js';
	import { RangeCalendar } from '$lib/components/ui/range-calendar/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { cn } from '$lib/utils/shadcn.js';

	let {
		from = '',
		to = '',
		id,
		disabled = false,
		placeholder = 'เลือกช่วงวันที่',
		ariaLabel = 'ช่วงวันที่',
		maxValue,
		class: className,
		onRangeChange
	}: {
		from?: string;
		to?: string;
		id?: string;
		disabled?: boolean;
		placeholder?: string;
		ariaLabel?: string;
		/** Upper bound (inclusive). Dates after this cannot be selected. */
		maxValue?: DateValue;
		class?: string;
		onRangeChange?: (next: { from: string; to: string }) => void;
	} = $props();

	const df = new DateFormatter('th-TH', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	let open = $state(false);
	/** In-progress pick (start chosen, end pending). Cleared when props update or popover closes. */
	let draft = $state<DateRange | undefined>();

	function parseIso(iso: string): DateValue | undefined {
		if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
		try {
			return parseDate(iso);
		} catch {
			return undefined;
		}
	}

	const committed = $derived<DateRange>({
		start: parseIso(from),
		end: parseIso(to)
	});

	const range = $derived(draft ?? committed);

	const label = $derived.by(() => {
		if (range.start && range.end) {
			return `${df.format(range.start.toDate('Asia/Bangkok'))} – ${df.format(range.end.toDate('Asia/Bangkok'))}`;
		}
		if (range.start) {
			return `${df.format(range.start.toDate('Asia/Bangkok'))} – …`;
		}
		return placeholder;
	});

	function handleValueChange(next: DateRange | undefined) {
		if (!next?.start || !next?.end) {
			draft = next;
			return;
		}
		draft = undefined;
		onRangeChange?.({ from: next.start.toString(), to: next.end.toString() });
		open = false;
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) draft = undefined;
	}
</script>

<Popover.Root bind:open={() => open, handleOpenChange}>
	<Popover.Trigger {id} {disabled}>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				{disabled}
				aria-label={ariaLabel}
				class={cn(
					'h-9 w-full min-w-[16rem] justify-start gap-2 px-3 font-normal',
					!(range.start && range.end) && 'text-muted-foreground',
					className
				)}
			>
				<CalendarIcon class="size-4 shrink-0 opacity-70" />
				<span class="truncate">{label}</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto overflow-hidden p-0" align="start" sideOffset={4}>
		<RangeCalendar
			value={range}
			onValueChange={handleValueChange}
			{maxValue}
			locale="th-TH"
			numberOfMonths={1}
		/>
	</Popover.Content>
</Popover.Root>
