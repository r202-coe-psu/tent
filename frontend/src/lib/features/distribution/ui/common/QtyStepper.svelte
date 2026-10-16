<script lang="ts">
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { stepQuantity } from '../model/ticket-quantity';

	interface Props {
		/** Whole-number quantity as typed; validated by the parent before submit. */
		value: string;
		/** Upper bound for the − / + buttons (the in-hand balance). */
		max: string;
		id: string;
		label: string;
		/** Unit shown after the field, e.g. `ชุด`. */
		unit?: string;
		disabled?: boolean;
	}

	let { value = $bindable(), max, id, label, unit, disabled = false }: Props = $props();
</script>

<div class="space-y-1.5">
	<Label for={id} class="text-sm font-semibold text-slate-700">{label}</Label>
	<div class="flex items-center gap-2">
		<Button
			type="button"
			variant="outline"
			class="size-12 shrink-0 rounded-lg"
			onclick={() => (value = stepQuantity(value, -1, max))}
			{disabled}
		>
			<Minus class="size-5" aria-hidden="true" />
			<span class="sr-only">ลดจำนวน</span>
		</Button>
		<Input
			{id}
			type="text"
			inputmode="numeric"
			autocomplete="off"
			bind:value
			class="h-12 w-24 text-center text-lg font-bold tabular-nums"
			{disabled}
		/>
		<Button
			type="button"
			variant="outline"
			class="size-12 shrink-0 rounded-lg"
			onclick={() => (value = stepQuantity(value, 1, max))}
			{disabled}
		>
			<Plus class="size-5" aria-hidden="true" />
			<span class="sr-only">เพิ่มจำนวน</span>
		</Button>
		<span class="text-sm text-slate-500">
			{#if unit}{unit} ·
			{/if}เหลือ <span class="font-semibold text-slate-700 tabular-nums">{max}</span>
		</span>
	</div>
</div>
