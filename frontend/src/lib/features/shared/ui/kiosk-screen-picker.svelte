<script lang="ts" generics="T extends KioskScreenType = KioskScreenType">
	/**
	 * Kiosk screen picker (ตู้เล็ก 1024×600 / ตู้ใหญ่ 1080×1920 / จอ TV 1920×1080). Offers all three
	 * by default; kiosk device forms pass `types` to leave the TV out, since it is not a device.
	 */
	import type { HTMLAttributes } from 'svelte/elements';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { KIOSK_SCREENS, KIOSK_SCREEN_TYPES, type KioskScreenType } from '../domain/kiosk-screen';

	let {
		value = $bindable('compact' as T),
		types = KIOSK_SCREEN_TYPES as readonly T[],
		id = 'kiosk-screen',
		disabled = false,
		...rest
	}: {
		value?: T;
		/** Screen types to offer; defaults to all of `KIOSK_SCREEN_TYPES`. */
		types?: readonly T[];
		/** Prefix for the option ids (`{id}-{type}`). */
		id?: string;
		disabled?: boolean;
	} & Omit<HTMLAttributes<HTMLDivElement>, 'children'> = $props();
</script>

<RadioGroup.Root
	bind:value
	{disabled}
	{id}
	aria-label="ขนาดหน้าจอ"
	class="grid grid-cols-1 gap-3 sm:grid-cols-2"
	{...rest}
>
	{#each types as type (type)}
		<Label
			for="{id}-{type}"
			class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-2xs"
		>
			<RadioGroup.Item id="{id}-{type}" value={type} />
			<span>
				{KIOSK_SCREENS[type].label}
				<span class="text-xs font-normal text-slate-500 tabular-nums"
					>{KIOSK_SCREENS[type].size}</span
				>
			</span>
		</Label>
	{/each}
</RadioGroup.Root>
