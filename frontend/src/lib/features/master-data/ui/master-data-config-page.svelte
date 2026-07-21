<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		applyItemOp,
		masterTypeSchema,
		type MasterDataItem,
		type MasterDataQueryContext,
		type MasterDataScope,
		type MasterDataType
	} from '$lib/features/master-data';
	import { useMasterData, useMasterDataList, usePutMaster } from '$lib/features/master-data';
	import MasterDataTypeList from './master-data-type-list.svelte';
	import MasterDataItemList from './master-data-item-list.svelte';
	import MasterDataEditModal from './master-data-edit-modal.svelte';
	import ConsoleBanner from '$lib/components/console-banner.svelte';

	let {
		allowedTypes,
		basePath,
		title,
		description,
		scope = 'global',
		shelterCode
	}: {
		allowedTypes?: readonly MasterDataType[];
		basePath?: string;
		title: string;
		description?: string;
		scope?: MasterDataScope;
		shelterCode?: string | null;
	} = $props();

	const resolvedBasePath = $derived(basePath ?? resolve('/back-office/registration-config'));
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
		...(resolvedShelterCode ? { shelterCode: resolvedShelterCode } : {})
	});

	// Active type lives in the URL (`?type=...`) — single source of truth so
	// the left-column tabs act as deep links, browser back/forward work, and
	// `MasterDataTypeList` can render real `<a href>` anchors.
	const activeType = $derived<MasterDataType>(parseActiveType());

	function parseActiveType(): MasterDataType {
		const raw = page.url.searchParams.get('type');
		const parsed = masterTypeSchema.safeParse(raw);
		if (parsed.success) {
			// If allowedTypes is set, ensure the parsed type is in the allowed set
			if (!allowedTypes || allowedTypes.includes(parsed.data)) return parsed.data;
		}
		// Default to first allowed type, or 'vulnerable_group' if no filter
		return allowedTypes?.[0] ?? 'vulnerable_group';
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

	function handleSubmit(input: { code?: string; label: string; is_default: boolean }) {
		const op = input.code
			? ({
					kind: 'edit',
					code: input.code,
					label: input.label,
					is_default: input.is_default
				} as const)
			: ({ kind: 'add', label: input.label, is_default: input.is_default } as const);
		putMutation.mutate({ type: activeType, items: applyItemOp(items, op), context: writeContext });
	}
</script>

<div class="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
	<ConsoleBanner {title} {description} />

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr] lg:gap-6">
		<MasterDataTypeList {activeType} {counts} {allowedTypes} basePath={resolvedBasePath} />
		<MasterDataItemList
			type={activeType}
			{items}
			context={writeContext}
			onAdd={openAdd}
			onEdit={openEdit}
		/>
	</div>
</div>

<MasterDataEditModal
	bind:open={modalOpen}
	masterType={activeType}
	editing={editingItem}
	onSubmit={handleSubmit}
/>
