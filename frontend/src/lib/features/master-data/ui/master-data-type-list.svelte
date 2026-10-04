<script lang="ts">
	import { resolve } from '$app/paths';
	import StaffSideNav, { type StaffSideNavItem } from '$lib/components/staff-side-nav.svelte';
	import {
		MASTER_DATA_TYPES,
		MASTER_DATA_TYPE_META,
		type MasterDataType
	} from '$lib/features/master-data';

	let {
		activeType,
		counts,
		allowedTypes,
		basePath
	}: {
		activeType: MasterDataType;
		counts: Partial<Record<MasterDataType, number>>;
		allowedTypes?: readonly MasterDataType[];
		basePath?: string;
	} = $props();

	const resolvedBasePath = $derived(basePath ?? resolve('/back-office/master-data'));
	const visibleTypes = $derived(
		allowedTypes ? MASTER_DATA_TYPES.filter((t) => allowedTypes.includes(t)) : MASTER_DATA_TYPES
	);

	const items = $derived<StaffSideNavItem[]>(
		visibleTypes.map((type) => ({
			id: type,
			label: MASTER_DATA_TYPE_META[type].shortTitle,
			href: `${resolvedBasePath}?type=${encodeURIComponent(type)}`,
			count: counts[type] ?? 0
		}))
	);
</script>

<StaffSideNav {items} activeId={activeType} sectionLabel="ประเภท" ariaLabel="ประเภท Master Data" />
