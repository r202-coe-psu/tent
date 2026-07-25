<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Car from '@lucide/svelte/icons/car';
	import Dog from '@lucide/svelte/icons/dog';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { Household } from '../domain/people';

	let {
		household,
		onOpenAssetsModal
	}: {
		household: Household;
		onOpenAssetsModal: () => void;
	} = $props();
</script>

<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
	<div class="flex items-center justify-between border-b border-border pb-3">
		<h3 class="flex items-center gap-2 text-base font-black text-slate-800 dark:text-slate-200">
			<Sparkles class="size-5 text-primary" />
			ทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง
		</h3>
		<Button variant="outline" size="sm" onclick={onOpenAssetsModal}>
			<Pencil class="mr-1.5 size-3.5" /> แก้ไขข้อมูล
		</Button>
	</div>

	<div class="space-y-4">
		<!-- Vehicles -->
		<div class="space-y-2">
			<h4 class="flex items-center gap-1.5 text-xs font-bold text-slate-700">
				<Car class="size-4 text-slate-500" />
				ข้อมูลยานพาหนะ
			</h4>
			{#if (household.vehicles ?? []).length === 0}
				<p class="text-xs text-muted-foreground italic">ไม่มียานพาหนะที่ลงทะเบียน</p>
			{:else}
				<div class="flex flex-wrap gap-2">
					{#each household.vehicles as v, i (i)}
						<Badge variant="outline" class="px-2.5 py-1 text-xs">
							{{ car: '🚗 รถยนต์', motorcycle: '🏍️ รถจักรยานยนต์', other: '🚲 อื่นๆ' }[v.type]}
							{#if v.license_plate}· {v.license_plate}{/if}
						</Badge>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Pets -->
		<div class="space-y-2">
			<h4 class="flex items-center gap-1.5 text-xs font-bold text-slate-700">
				<Dog class="size-4 text-slate-500" />
				สัตว์เลี้ยงที่นำมาด้วย
			</h4>
			{#if (household.pets ?? []).length === 0}
				<p class="text-xs text-muted-foreground italic">ไม่มีสัตว์เลี้ยงที่นำมาด้วย</p>
			{:else}
				<div class="flex flex-wrap gap-2">
					{#each household.pets as p, i (i)}
						<Badge variant="outline" class="px-2.5 py-1 text-xs">
							{{ dog: '🐶 สุนัข', cat: '🐱 แมว', bird: '🐦 นก', other: '🐾 อื่นๆ' }[p.species]}
							({p.count} ตัว)
							{#if p.has_cage}· มีกรง{/if}
						</Badge>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Valuables -->
		<div class="space-y-1.5">
			<Label class="text-xs text-muted-foreground">สัมภาระและสิ่งของมีค่า</Label>
			<p class="text-sm text-slate-800">
				{household.assets?.description || 'ไม่มีการลงทะเบียนสิ่งของมีค่า'}
			</p>
		</div>
	</div>
</div>
