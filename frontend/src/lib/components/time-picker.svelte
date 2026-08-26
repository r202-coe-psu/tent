<script lang="ts">
	/**
	 * Time picker — hour + minute dropdowns in a Popover, bound to a plain
	 * `HH:mm` string.
	 *
	 * shadcn-svelte ships no time-picker primitive, so this composes the ones it
	 * does ship (`Popover`, `Select`, `Button`) rather than pulling in another
	 * dependency. 24-hour clock, since every timestamp in this project is stored
	 * and displayed that way.
	 */
	import ClockIcon from '@lucide/svelte/icons/clock';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils/shadcn.js';

	let {
		value = $bindable(''),
		placeholder = 'เลือกเวลา',
		/** Minute granularity offered in the dropdown. */
		minuteStep = 5,
		disabled = false,
		id,
		class: className = ''
	}: {
		/** `HH:mm`, or `''` when nothing is chosen. */
		value?: string;
		placeholder?: string;
		minuteStep?: number;
		disabled?: boolean;
		id?: string;
		class?: string;
	} = $props();

	let open = $state(false);

	const pad = (n: number) => String(n).padStart(2, '0');

	const hours = Array.from({ length: 24 }, (_, i) => pad(i));
	const minutes = $derived(
		Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => pad(i * minuteStep))
	);

	const parsed = $derived(/^(\d{2}):(\d{2})$/.exec(value));
	const hour = $derived(parsed ? parsed[1] : '');
	const minute = $derived(parsed ? parsed[2] : '');

	function setHour(next: string) {
		value = `${next}:${minute || '00'}`;
	}

	function setMinute(next: string) {
		value = `${hour || '00'}:${next}`;
	}

	const triggerClass =
		'flex !h-11 w-full items-center rounded-md border border-input bg-background px-3 text-sm font-medium';
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
					!parsed && 'text-muted-foreground',
					className
				)}
			>
				<ClockIcon class="mr-2 size-4 opacity-60" />
				{parsed ? value : placeholder}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-3">
		<div class="flex items-end gap-2">
			<label class="space-y-1">
				<span class="text-xs font-medium text-muted-foreground">ชั่วโมง</span>
				<Select.Root type="single" value={hour} onValueChange={setHour}>
					<Select.Trigger class={cn(triggerClass, 'w-20')}>{hour || '--'}</Select.Trigger>
					<Select.Content>
						{#each hours as h (h)}
							<Select.Item value={h} label={h} />
						{/each}
					</Select.Content>
				</Select.Root>
			</label>
			<span class="pb-3 text-sm font-semibold text-muted-foreground">:</span>
			<label class="space-y-1">
				<span class="text-xs font-medium text-muted-foreground">นาที</span>
				<Select.Root type="single" value={minute} onValueChange={setMinute}>
					<Select.Trigger class={cn(triggerClass, 'w-20')}>{minute || '--'}</Select.Trigger>
					<Select.Content>
						{#each minutes as m (m)}
							<Select.Item value={m} label={m} />
						{/each}
					</Select.Content>
				</Select.Root>
			</label>
		</div>
	</Popover.Content>
</Popover.Root>
