<script lang="ts">
	/**
	 * Date picker — Popover + shadcn `Calendar`, bound to a plain `YYYY-MM-DD`
	 * string so callers keep storing dates the way `schema.md` defines them
	 * (no `DateValue` leaking into domain code).
	 *
	 * Mirrors the picker already used in `components/form/donor-time-selection-form.svelte`;
	 * this is the reusable extraction of it.
	 */
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import { Calendar } from '$lib/components/ui/calendar/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils/shadcn.js';

	let {
		value = $bindable(''),
		placeholder = 'เลือกวันที่',
		disabled = false,
		id,
		class: className = ''
	}: {
		/** `YYYY-MM-DD`, or `''` when nothing is chosen. */
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		id?: string;
		class?: string;
	} = $props();

	let open = $state(false);

	/** `''` / malformed input must not throw — the field starts empty. */
	function toDateValue(iso: string): DateValue | undefined {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
		if (!match) return undefined;
		const [, y, m, d] = match;
		const parsed = new CalendarDate(Number(y), Number(m), Number(d));
		// Reject a non-existent day (CalendarDate would balance 2026-02-29).
		return parsed.toString() === iso ? parsed : undefined;
	}

	const selected = $derived(toDateValue(value));
</script>

<Popover.Root bind:open>
	<Popover.Trigger {disabled}>
		{#snippet child({ props })}
			<Button
				{...props}
				{id}
				type="button"
				variant="outline"
				{disabled}
				class={cn(
					'!h-11 w-full justify-start px-3 font-normal',
					!selected && 'text-muted-foreground',
					className
				)}
			>
				<CalendarIcon class="mr-2 size-4 opacity-60" />
				{selected ? value : placeholder}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-0">
		<Calendar
			type="single"
			value={selected}
			onValueChange={(next) => {
				value = next ? next.toString() : '';
				open = false;
			}}
		/>
	</Popover.Content>
</Popover.Root>
