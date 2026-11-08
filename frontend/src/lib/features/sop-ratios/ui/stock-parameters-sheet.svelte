<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import ReplenishmentPolicyTab from './replenishment-policy-tab.svelte';
	import RequirementGroupTab from './requirement-group-tab.svelte';
	import FoodSphereStandardTab from './food-sphere-standard-tab.svelte';

	let {
		open = $bindable(false),
		shelterCode,
		isSA = false,
		canEdit = false
	}: {
		open?: boolean;
		shelterCode: string;
		isSA?: boolean;
		canEdit?: boolean;
	} = $props();

	let activeTab = $state('replenishment_policy');
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="w-full gap-0 overflow-y-auto p-0 sm:max-w-5xl">
		<Sheet.Header class="border-b px-4 py-3 pr-12 text-left">
			<Sheet.Title class="text-base font-semibold">ตั้งค่าพารามิเตอร์สต็อกของศูนย์</Sheet.Title>
			<Sheet.Description class="text-xs">
				นโยบายการเติมสต็อก กลุ่มสำหรับการคำนวณ และพารามิเตอร์อ้างอิงอาหารของศูนย์นี้
			</Sheet.Description>
		</Sheet.Header>
		<div class="min-w-0 p-4">
			<Tabs.Root bind:value={activeTab}>
				<Tabs.List class="mb-4 flex h-auto w-full flex-wrap justify-start">
					<Tabs.Trigger value="replenishment_policy">นโยบายการเติมสต็อก</Tabs.Trigger>
					<Tabs.Trigger value="requirement_group">กลุ่มสำหรับการคำนวณ</Tabs.Trigger>
					<Tabs.Trigger value="food_sphere_standard">พารามิเตอร์อ้างอิงอาหาร</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="replenishment_policy">
					<ReplenishmentPolicyTab {shelterCode} {isSA} canEditOverride={canEdit} />
				</Tabs.Content>
				<Tabs.Content value="requirement_group">
					<RequirementGroupTab {shelterCode} {isSA} canEditOverride={canEdit} />
				</Tabs.Content>
				<Tabs.Content value="food_sphere_standard">
					<FoodSphereStandardTab {shelterCode} {isSA} canEditOverride={canEdit} />
				</Tabs.Content>
			</Tabs.Root>
		</div>
	</Sheet.Content>
</Sheet.Root>
