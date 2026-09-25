<script lang="ts">
	import StaffSideNav, { type StaffSideNavItem } from '$lib/components/staff-side-nav.svelte';

	export type SopTabType =
		| 'sphere_standard'
		| 'food_sphere_standard'
		| 'requirement_group'
		| 'replenishment_policy'
		| 'alert_threshold';

	let {
		activeTab = $bindable(),
		sphereCount = 20,
		alertCount = 8,
		reqGroupCount,
		foodSphereCount,
		replenishmentCount
	}: {
		activeTab: SopTabType;
		sphereCount?: number;
		alertCount?: number;
		reqGroupCount?: number;
		foodSphereCount?: number;
		replenishmentCount?: number;
	} = $props();

	const items = $derived<StaffSideNavItem[]>([
		{
			id: 'sphere_standard',
			label: 'ตัวคูณมาตรฐานดำรงชีพ',
			count: sphereCount,
			onclick: () => {
				activeTab = 'sphere_standard';
			}
		},
		{
			id: 'alert_threshold',
			label: 'เกณฑ์การแจ้งเตือน',
			count: alertCount,
			onclick: () => {
				activeTab = 'alert_threshold';
			}
		},
		{
			id: 'requirement_group',
			label: 'กลุ่มสำหรับการคำนวณ',
			count: reqGroupCount,
			onclick: () => {
				activeTab = 'requirement_group';
			}
		},
		{
			id: 'food_sphere_standard',
			label: 'พารามิเตอร์อ้างอิงอาหาร',
			count: foodSphereCount,
			onclick: () => {
				activeTab = 'food_sphere_standard';
			}
		},
		{
			id: 'replenishment_policy',
			label: 'นโยบายการเติมสต็อก',
			count: replenishmentCount,
			onclick: () => {
				activeTab = 'replenishment_policy';
			}
		}
	]);
</script>

<StaffSideNav
	{items}
	activeId={activeTab}
	sectionLabel="ประเภท"
	ariaLabel="ประเภทพารามิเตอร์มาสเตอร์"
/>
