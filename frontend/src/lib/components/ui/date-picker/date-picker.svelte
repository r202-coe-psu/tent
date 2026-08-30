<script lang="ts">
	import { cn } from '$lib/utils/shadcn.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Calendar } from '$lib/components/ui/calendar/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { parseDate, type DateValue } from '@internationalized/date';

	let {
		value = $bindable(''),
		id,
		name,
		placeholder = 'วว/ดด/ปปปป (เช่น 23/07/2026)',
		disabled = false,
		required = false,
		ariaLabel = 'วัน เดือน ปี',
		class: className,
		...restProps
	}: {
		value?: string;
		id?: string;
		name?: string;
		placeholder?: string;
		disabled?: boolean;
		required?: boolean;
		ariaLabel?: string;
		class?: string;
		[key: string]: unknown;
	} = $props();

	let open = $state(false);
	let displayValue = $state('');
	let calendarValue = $state<DateValue | undefined>(undefined);
	let isInternalUpdating = false;

	function toDisplayFormat(iso: string): string {
		if (!iso) return '';
		const match = iso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
		if (!match) return '';
		const [, y, m, d] = match;
		return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
	}

	function parseToIso(input: string): string | null {
		const trimmed = input.trim();
		if (!trimmed) return '';

		// Format 1: DD/MM/YYYY or DD-MM-YYYY
		const dmyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
		if (dmyMatch) {
			const [, d, m, y] = dmyMatch;
			const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
			try {
				parseDate(iso);
				return iso;
			} catch {
				return null;
			}
		}

		// Format 2: YYYY-MM-DD
		const ymdMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
		if (ymdMatch) {
			const [, y, m, d] = ymdMatch;
			const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
			try {
				parseDate(iso);
				return iso;
			} catch {
				return null;
			}
		}

		return null;
	}

	// Sync when external `value` changes
	$effect(() => {
		if (isInternalUpdating) return;
		if (value) {
			const formatted = toDisplayFormat(value);
			if (formatted) {
				displayValue = formatted;
				try {
					calendarValue = parseDate(value);
				} catch {
					calendarValue = undefined;
				}
			}
		} else {
			displayValue = '';
			calendarValue = undefined;
		}
	});

	// Sync when user picks a date from the calendar
	$effect(() => {
		if (!open) return;
		if (calendarValue) {
			const y = calendarValue.year;
			const m = String(calendarValue.month).padStart(2, '0');
			const d = String(calendarValue.day).padStart(2, '0');
			const iso = `${y}-${m}-${d}`;
			if (value !== iso) {
				isInternalUpdating = true;
				value = iso;
				displayValue = `${d}/${m}/${y}`;
				open = false;
				setTimeout(() => {
					isInternalUpdating = false;
				}, 50);
			}
		}
	});

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const raw = target.value;
		displayValue = raw;

		if (!raw.trim()) {
			isInternalUpdating = true;
			value = '';
			calendarValue = undefined;
			setTimeout(() => {
				isInternalUpdating = false;
			}, 50);
			return;
		}

		const parsedIso = parseToIso(raw);
		if (parsedIso) {
			isInternalUpdating = true;
			value = parsedIso;
			try {
				calendarValue = parseDate(parsedIso);
			} catch {
				calendarValue = undefined;
			}
			setTimeout(() => {
				isInternalUpdating = false;
			}, 50);
		}
	}

	function handleBlur() {
		if (!displayValue.trim()) {
			value = '';
			calendarValue = undefined;
			return;
		}
		const parsedIso = parseToIso(displayValue);
		if (parsedIso) {
			displayValue = toDisplayFormat(parsedIso);
		} else if (value) {
			// Revert to last valid value if input was invalid
			displayValue = toDisplayFormat(value);
		} else {
			displayValue = '';
		}
	}
</script>

<div class="relative flex w-full items-center">
	<Input
		{id}
		{name}
		{disabled}
		{required}
		aria-label={ariaLabel}
		type="text"
		inputmode="numeric"
		bind:value={displayValue}
		oninput={handleInput}
		onblur={handleBlur}
		onclick={() => {
			if (!disabled) open = true;
		}}
		{placeholder}
		class={cn('pr-10 font-mono text-sm tracking-wide', className)}
		{...restProps}
	/>

	<Popover.Root bind:open>
		<Popover.Trigger
			type="button"
			tabindex={-1}
			{disabled}
			class="absolute right-1.5 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
			aria-label="เปิดปฏิทินเลือกวันที่"
		>
			<CalendarIcon class="h-4 w-4" />
		</Popover.Trigger>
		<Popover.Content class="w-auto p-0" align="end" sideOffset={4}>
			<Calendar type="single" bind:value={calendarValue} initialFocus />
		</Popover.Content>
	</Popover.Root>
</div>
