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
		// Never pair shelter_code with a global write — the server rejects it (422).
		...(resolvedScope !== 'effective' && resolvedShelterCode
			? { shelterCode: resolvedShelterCode }
			: {})
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

	// For shelter scope, the PUT body must contain ONLY shelter-local items —
	// global items are read-only and live in their own doc, never copied into
	// the shelter doc. Newly added items have no source entry yet, so they are
	// treated as shelter-local. Global scope sends everything (all items are
	// global there).
	function localOnly(candidateItems: readonly MasterDataItem[]): MasterDataItem[] {
		if (resolvedScope === 'global') return [...candidateItems];
		return candidateItems.filter((item) => {
			const source = detail.data?.item_sources?.[item.code];
			return !source || source.scope === 'shelter';
		});
	}

	function submitItems(nextItems: readonly MasterDataItem[]) {
		const local = localOnly(nextItems);
		// A shelter-local default is the most specific choice — when one is set,
		// clear any global-default pointer so the two never compete (last choice
		// wins). (CR-049 amendment)
		const hasLocalDefault = local.some((i) => i.is_default);
		putMutation.mutate({
			type: activeType,
			items: local,
			context: writeContext,
			...(hasLocalDefault ? { defaultGlobalCode: null } : {})
		});
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
		submitItems(applyItemOp(items, op));
	}

	// Codes of global items this shelter has disabled (from the merged sources).
	const disabledGlobalCodes = $derived(
		Object.entries(detail.data?.item_sources ?? {})
			.filter(([, s]) => s.shelter_disabled)
			.map(([code]) => code)
	);

	function handleToggleStatus(item: MasterDataItem) {
		const source = detail.data?.item_sources?.[item.code];
		// Global item under a shelter → per-shelter enable/disable via
		// `disabled_global_codes` (CR-049 amendment). Never mutates the global doc;
		// shelter-local items are sent unchanged.
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
		// Shelter-local item → flip its own status.
		submitItems(
			applyItemOp(items, {
				kind: 'setStatus',
				code: item.code,
				status: item.status === 'active' ? 'inactive' : 'active'
			})
		);
	}

	// Shelter picks a non-default GLOBAL item as its own default (CR-049
	// amendment): stores `default_global_code` on the shelter-local doc only —
	// the global item's label/is_default are never mutated. Shelter-local
	// items are sent unchanged.
	function handleSetGlobalDefault(item: MasterDataItem) {
		// Choosing a global item as the default must win even when a shelter-local
		// item is currently the default — clear the shelter-local `is_default`
		// flags so the pointer isn't shadowed (merge: local default > pointed
		// global). (CR-049 amendment)
		const local = localOnly(items).map((i) => (i.is_default ? { ...i, is_default: false } : i));
		putMutation.mutate({
			type: activeType,
			items: local,
			context: writeContext,
			defaultGlobalCode: item.code
		});
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
			itemSources={detail.data?.item_sources}
			onAdd={openAdd}
			onEdit={openEdit}
			onToggleStatus={handleToggleStatus}
			onSetGlobalDefault={handleSetGlobalDefault}
		/>
	</div>
</div>

<MasterDataEditModal
	bind:open={modalOpen}
	masterType={activeType}
	editing={editingItem}
	onSubmit={handleSubmit}
/>
