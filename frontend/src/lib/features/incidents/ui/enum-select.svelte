<script lang="ts" generics="T extends string">
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils/shadcn.js';

	let {
		value = $bindable(),
		options,
		labels,
		placeholder = '-- เลือก --',
		triggerProps = {},
		class: className = ''
	}: {
		value: T | undefined;
		options: readonly T[];
		labels: Record<T, string>;
		placeholder?: string;
		triggerProps?: Record<string, unknown>;
		class?: string;
	} = $props();
</script>

<Select.Root type="single" value={value ?? ''} onValueChange={(v) => (value = v as T)}>
	<Select.Trigger
		{...triggerProps}
		class={cn('h-11 w-full min-w-0 rounded-xl bg-background px-3 text-sm shadow-xs', className)}
	>
		<span class={cn('truncate', !value && 'text-muted-foreground')}>
			{value ? labels[value] : placeholder}
		</span>
	</Select.Trigger>
	<Select.Content>
		{#each options as option (option)}
			<Select.Item value={option} label={labels[option]}>{labels[option]}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
