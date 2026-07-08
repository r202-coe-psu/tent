<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import { SearchSelect } from '$lib/components/ui/search-select/index.js';
	import X from '@lucide/svelte/icons/x';
	import type { Evacuee, Household } from '../domain/people';

	let {
		memberItems,
		memberSearchValue = $bindable(),
		selectedMemberIds,
		allEvacuees,
		initialData,
		households,
		headEvacueeId,
		onRemove
	}: {
		memberItems: {
			value: string;
			label: string;
			evacuee: Evacuee;
			hasOther: boolean;
			otherLabel: string;
		}[];
		memberSearchValue: string;
		selectedMemberIds: string[];
		allEvacuees: Evacuee[];
		initialData: Household | null;
		households: Household[];
		headEvacueeId: string | null;
		onRemove: (id: string) => void;
	} = $props();
</script>

<div class="space-y-2">
	<Label class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
		สมาชิกในครัวเรือน
	</Label>

	<SearchSelect
		items={memberItems}
		bind:value={memberSearchValue}
		placeholder="พิมพ์ชื่อเพื่อค้นหา..."
		emptyText="ไม่พบผู้ประสบภัยที่ตรงกับการค้นหา"
		class="h-9 w-full"
	/>

	{#if selectedMemberIds.length > 0}
		<div class="flex flex-wrap gap-2 rounded-md border border-border/50 bg-muted/10 p-2">
			{#each selectedMemberIds as memberId (memberId)}
				{@const member = allEvacuees.find((e) => e._id === memberId)}
				{#if member}
					{@const hasOther = member.household_id && member.household_id !== initialData?._id}
					{@const otherLabel =
						households.find((h) => h._id === member.household_id)?.label ?? 'ครัวเรือนอื่น'}
					<div
						class="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
					>
						<span>{member.first_name} {member.last_name}</span>
						{#if hasOther}
							<span
								class="rounded border border-amber-200 bg-amber-50 px-1 text-[9px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400"
							>
								ย้ายจาก: {otherLabel}
							</span>
						{/if}
						{#if headEvacueeId === memberId}
							<span
								class="rounded border border-primary/20 bg-primary/10 px-1 text-[9px] font-semibold text-primary"
							>
								หัวหน้า
							</span>
						{/if}
						<button
							type="button"
							class="cursor-pointer rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
							aria-label="ลบสมาชิก"
							onclick={() => onRemove(memberId)}
						>
							<X class="size-3" />
						</button>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
