<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import { useReplenishmentPolicies } from '../application/replenishment-queries';
	import RequirementGroupForm from './requirement-group-form.svelte';
	import ReplenishmentPolicyForm from './replenishment-policy-form.svelte';

	let {
		open = $bindable(false),
		shelterCode,
		groupId
	}: {
		open?: boolean;
		shelterCode: string;
		/** Clean requirement group id (no `requirement_group:` prefix). */
		groupId: string;
	} = $props();

	const groupsQuery = useRequirementGroups(() => shelterCode);
	const policiesQuery = useReplenishmentPolicies(() => shelterCode);

	const group = $derived(
		(groupsQuery.data ?? []).find((g) => g._id === `requirement_group:${groupId}`) ?? null
	);
	const policy = $derived(
		(policiesQuery.data ?? []).find(
			(p) => p.scope_type === 'REQUIREMENT_GROUP' && p.target_id === groupId
		) ?? null
	);

	function close() {
		open = false;
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="w-full gap-0 overflow-y-auto p-0 sm:max-w-3xl">
		<Sheet.Header class="border-b px-4 py-3 pr-12 text-left">
			<Sheet.Title class="text-base font-semibold">
				แก้ไขกลุ่ม{group ? ` ${group.name}` : ''}
			</Sheet.Title>
			<Sheet.Description class="text-xs">
				กลุ่มสำหรับการคำนวณและนโยบายการเติมสต็อกของกลุ่มนี้
			</Sheet.Description>
		</Sheet.Header>
		<div class="min-w-0 space-y-6 p-4">
			{#if group}
				<section class="space-y-3">
					<h3 class="text-sm font-bold">กลุ่มสำหรับการคำนวณ</h3>
					<RequirementGroupForm {group} isEdit {shelterCode} oncancel={close} />
				</section>
				<Separator />
				<section class="space-y-3">
					<h3 class="text-sm font-bold">นโยบายการเติมสต็อก</h3>
					<ReplenishmentPolicyForm
						{policy}
						isEdit={policy !== null}
						{shelterCode}
						presetTargetId={groupId}
						oncancel={close}
					/>
				</section>
			{:else}
				<p class="py-8 text-center text-sm text-muted-foreground">ไม่พบกลุ่มที่เลือก</p>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
