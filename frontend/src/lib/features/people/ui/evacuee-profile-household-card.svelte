<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Home from '@lucide/svelte/icons/home';
	import type { Evacuee, Household } from '$lib/features/people';

	let {
		evacuee,
		household,
		familyMembers,
		readonly,
		onOpenAddressModal
	}: {
		evacuee: Evacuee;
		household: Household | null;
		familyMembers: Evacuee[];
		readonly: boolean;
		onOpenAddressModal: () => void;
	} = $props();
</script>

<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
	<div class="flex items-center justify-between border-b border-border pb-2">
		<div class="flex items-center gap-2.5">
			<Home class="size-4.5 text-primary" />
			<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
				หัวหน้าครอบครัว (Head of Household)
			</h3>
		</div>
	</div>

	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<span class="text-xs font-medium text-muted-foreground">สถานะในครอบครัว:</span>
			{#if household && household.head_evacuee_id === evacuee._id}
				<span
					class="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
				>
					⭐ หัวหน้าครอบครัว
				</span>
			{:else}
				<span
					class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400"
				>
					สมาชิกครอบครัว
				</span>
			{/if}
		</div>

		<div>
			<span class="block text-xs font-medium text-muted-foreground">รายชื่อสมาชิกร่วมทาง:</span>
			<div
				class="mt-1.5 rounded-2xl border border-dashed border-slate-200 p-3 text-center dark:border-slate-800"
			>
				{#if familyMembers.length > 0}
					<div class="flex flex-wrap justify-center gap-1.5">
						{#each familyMembers as m (m._id)}
							<button
								onclick={() =>
									goto(resolve(`/back-office/evacuee-management/edit/-evacuee/${m._id}`))}
								class="cursor-pointer rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
							>
								{m.first_name}
								{m.last_name}
							</button>
						{/each}
					</div>
				{:else}
					<span class="text-xs text-muted-foreground italic">
						เดินทางคนเดียว / ไม่ได้ระบุสมาชิกในกลุ่ม
					</span>
				{/if}
			</div>
		</div>

		<div class="space-y-2 border-t border-border/40 pt-3">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-muted-foreground">ที่อยู่ครอบครัว:</span>
				{#if household && !readonly}
					<button
						onclick={onOpenAddressModal}
						class="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
					>
						✏️ แก้ไขที่อยู่ครอบครัว
					</button>
				{/if}
			</div>
			<div
				class="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
			>
				{#if household && (household.address_no || household.subdistrict || household.district || household.province)}
					{household.address_no || ''}
					{household.village_no ? `หมู่ที่ ${household.village_no}` : ''}
					{household.subdistrict ? `ต.${household.subdistrict}` : ''}
					{household.district ? `อ.${household.district}` : ''}
					{household.province ? `จ.${household.province}` : ''}
					{household.postal_code || ''}
				{:else}
					<span class="text-muted-foreground italic">ไม่มีที่อยู่จัดเก็บ</span>
				{/if}
			</div>
		</div>
	</div>
</div>
