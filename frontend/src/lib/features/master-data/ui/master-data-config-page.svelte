<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		applyItemOp,
		MASTER_DATA_TYPES,
		masterTypeSchema,
		type MasterDataItem,
		type MasterDataQueryContext,
		type MasterDataScope,
		type MasterDataType
	} from '$lib/features/master-data';
	import { useMasterData, useMasterDataList, usePutMaster } from '$lib/features/master-data';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import StaffHub from '$lib/components/staff-hub.svelte';
	import MasterDataTypeList from './master-data-type-list.svelte';
	import MasterDataItemList from './master-data-item-list.svelte';
	import MasterDataEditModal, { type MasterDataEditSubmit } from './master-data-edit-modal.svelte';

	let {
		allowedTypes,
		basePath,
		title = 'Master Data',
		description = 'จัดการรายการมาตรฐานที่ใช้ซ้ำในฟอร์ม · แก้ไขแล้วมีผลทันที',
		scope = 'global',
		shelterCode
	}: {
		allowedTypes?: readonly MasterDataType[];
		basePath?: string;
		title?: string;
		description?: string;
		scope?: MasterDataScope;
		shelterCode?: string | null;
	} = $props();

	const resolvedBasePath = $derived(basePath ?? resolve('/back-office/master-data'));
	const resolvedScope = $derived<MasterDataScope>(scope);
	const resolvedShelterCode = $derived(
		shelterCode ?? (resolvedScope === 'global' ? undefined : shelterStore.selectedShelterCode)
	);
	const readContext = $derived<MasterDataQueryContext>({
		scope: resolvedScope === 'shelter' ? 'effective' : resolvedScope,
		...(resolvedShelterCode ? { shelterCode: resolvedShelterCode } : {})
	});
	const writeContext = $derived<MasterDataQueryContext>({
		scope: resolvedScope === 'effective' ? 'global' : resolvedScope,
		...(resolvedScope !== 'effective' && resolvedShelterCode
			? { shelterCode: resolvedShelterCode }
			: {})
	});

	const visibleTypes = $derived(
		allowedTypes ? MASTER_DATA_TYPES.filter((t) => allowedTypes.includes(t)) : MASTER_DATA_TYPES
	);

	const activeType = $derived<MasterDataType>(parseActiveType());

	function parseActiveType(): MasterDataType {
		const raw = page.url.searchParams.get('type');
		const parsed = masterTypeSchema.safeParse(raw);
		if (parsed.success) {
			if (!allowedTypes || allowedTypes.includes(parsed.data)) return parsed.data;
		}
		return visibleTypes[0] ?? 'vulnerable_group';
	}

	const list = useMasterDataList(() => readContext);
	const detail = useMasterData(
		() => activeType,
		() => readContext
	);
	const putMutation = usePutMaster();

	let modalOpen = $state(false);
	let editingItem = $state<MasterDataItem | null>(null);

	const items = $derived(detail.data?.items ?? []);

	const counts = $derived(
		Object.fromEntries((list.data ?? []).map((m) => [m.master_type, m.items.length])) as Partial<
			Record<MasterDataType, number>
		>
	);

	function openAdd() {
		editingItem = null;
		modalOpen = true;
	}

	function openEdit(item: MasterDataItem) {
		editingItem = item;
		modalOpen = true;
	}

	function localOnly(candidateItems: readonly MasterDataItem[]): MasterDataItem[] {
		if (resolvedScope === 'global') return [...candidateItems];
		return candidateItems.filter((item) => {
			const source = detail.data?.item_sources?.[item.code];
			return !source || source.scope === 'shelter';
		});
	}

	function submitItems(nextItems: readonly MasterDataItem[]) {
		const local = localOnly(nextItems);
		const hasLocalDefault = local.some((i) => i.is_default);
		putMutation.mutate({
			type: activeType,
			items: local,
			context: writeContext,
			...(hasLocalDefault ? { defaultGlobalCode: null } : {})
		});
	}

	function handleSubmit(input: MasterDataEditSubmit) {
		const isEdit = items.some((i) => i.code === input.code);
		const op = isEdit
			? {
					kind: 'edit' as const,
					code: input.code,
					...(input.newCode ? { newCode: input.newCode } : {}),
					label_th: input.label_th,
					label_en: input.label_en,
					is_default: input.is_default,
					...(input.category ? { category: input.category } : {}),
					...(input.description !== undefined ? { description: input.description } : {})
				}
			: {
					kind: 'add' as const,
					code: input.code,
					label_th: input.label_th,
					label_en: input.label_en,
					is_default: input.is_default,
					...(input.category ? { category: input.category } : {}),
					...(input.description !== undefined ? { description: input.description } : {})
				};
		submitItems(applyItemOp(items, op));
	}

	const disabledGlobalCodes = $derived(
		Object.entries(detail.data?.item_sources ?? {})
			.filter(([, s]) => s.shelter_disabled)
			.map(([code]) => code)
	);

	function handleToggleStatus(item: MasterDataItem) {
		const source = detail.data?.item_sources?.[item.code];
		if (resolvedScope !== 'global' && source?.scope === 'global') {
			const next = source.shelter_disabled
				? disabledGlobalCodes.filter((c) => c !== item.code)
				: [...disabledGlobalCodes, item.code];
			putMutation.mutate({
				type: activeType,
				items: localOnly(items),
				context: writeContext,
				disabledGlobalCodes: next
			});
			return;
		}
		submitItems(
			applyItemOp(items, {
				kind: 'setStatus',
				code: item.code,
				status: item.status === 'active' ? 'inactive' : 'active'
			})
		);
	}

	function handleSetGlobalDefault(item: MasterDataItem) {
		const local = localOnly(items).map((i) => (i.is_default ? { ...i, is_default: false } : i));
		putMutation.mutate({
			type: activeType,
			items: local,
			context: writeContext,
			defaultGlobalCode: item.code
		});
	}
</script>

<StaffPageShell {title} {description}>
	{#snippet meta()}
		{#if resolvedScope === 'shelter'}
			<span
				class="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900"
			>
				ขอบเขต: ศูนย์นี้
			</span>
		{:else}
			<span
				class="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
			>
				ขอบเขต: ส่วนกลาง
			</span>
		{/if}
	{/snippet}

	<StaffHub>
		{#snippet nav()}
			<MasterDataTypeList {activeType} {counts} {allowedTypes} basePath={resolvedBasePath} />
		{/snippet}
		<MasterDataItemList
			type={activeType}
			{items}
			context={writeContext}
			itemSources={detail.data?.item_sources}
			onAdd={openAdd}
			onEdit={openEdit}
			onToggleStatus={handleToggleStatus}
			onSetGlobalDefault={handleSetGlobalDefault}
		/>
	</StaffHub>
</StaffPageShell>

<MasterDataEditModal
	bind:open={modalOpen}
	masterType={activeType}
	editing={editingItem}
	existingItems={items}
	existingItemsReady={detail.isSuccess}
	onSubmit={handleSubmit}
/>
