<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils/shadcn.js';

	let {
		ref = $bindable(null),
		value,
		class: className,
		...restProps
	}: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<RadioGroupPrimitive.Item
	bind:ref
	{value}
	data-slot="radio-group-item"
	class={cn(
		'aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:aria-invalid:ring-destructive/40',
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		{#if checked}
			<CircleIcon class="size-2 fill-current" />
		{/if}
	{/snippet}
</RadioGroupPrimitive.Item>
