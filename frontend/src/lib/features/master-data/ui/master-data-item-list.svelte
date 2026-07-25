<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type {
		MasterDataItem,
		MasterDataItemSource,
		MasterDataQueryContext,
		MasterDataType
	} from '$lib/features/master-data';
	import { Badge } from '$lib/components/ui/badge/index.js';

	let {
		type,
		items,
		context,
		itemSources,
		onAdd,
		onEdit,
		onToggleStatus,
		onSetGlobalDefault
	}: {
		type: MasterDataType;
		items: readonly MasterDataItem[];
		context?: MasterDataQueryContext;
		itemSources?: Record<string, MasterDataItemSource>;
		onAdd: () => void;
		onEdit: (item: MasterDataItem) => void;
		onToggleStatus: (item: MasterDataItem) => void;
		onSetGlobalDefault: (item: MasterDataItem) => void;
	} = $props();

	let search = $state('');

	const filtered = $derived(
		search.trim()
			? items.filter((i) => i.label.toLowerCase().includes(search.trim().toLowerCase()))
			: items
	);

	const isShelterScope = $derived(context?.scope === 'shelter');

	// Owned = editable + toggleable as an item of THIS doc: shelter-local items
	// (shelter scope), or every item (global scope, SA-managed).
	function isOwned(item: MasterDataItem): boolean {
		if (!isShelterScope) return true;
		return itemSources?.[item.code]?.scope === 'shelter';
	}

	// A global item under a shelter can be enabled/disabled per-shelter (writes
	// `disabled_global_codes`, not the global doc) — but only when it is active
	// globally. A globally-inactive (deprecated) item stays read-only here.
	// (CR-049 amendment)
	function canPerShelterToggle(item: MasterDataItem): boolean {
		if (!isShelterScope) return false;
		const source = itemSources?.[item.code];
		if (source?.scope !== 'global') return false;
		return source.shelter_disabled === true || item.status === 'active';
	}

	// A global item, active for this shelter, not already the effective
	// default → offer "ตั้งเป็นค่าเริ่มต้น" (stores `default_global_code` on the
	// shelter-local doc only; the global item's label is never touched).
	// (CR-049 amendment)
	function canSetGlobalDefault(item: MasterDataItem): boolean {
		if (!isShelterScope) return false;
		if (item.status !== 'active' || item.is_default) return false;
		return itemSources?.[item.code]?.scope === 'global';
	}
</script>

<section
	class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6"
	aria-label="รายการข้อมูล"
	data-master-type={type}
>
	<header class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<h1 class="text-xl font-semibold">รายการข้อมูล ({items.length})</h1>
		<div class="flex items-center gap-2">
			<div class="relative w-full sm:w-64">
				<Input
					bind:value={search}
					type="search"
					placeholder="ค้นหา..."
					class="pl-9"
					aria-label="ค้นหา"
				/>
				<svg
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.3-4.3" />
				</svg>
			</div>
			<Button type="button" onclick={onAdd} class="shrink-0">
				<svg
					class="mr-1 h-4 w-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M12 5v14M5 12h14" />
				</svg>
				เพิ่มข้อมูล
			</Button>
		</div>
	</header>

	<div class="overflow-x-auto rounded-lg border">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground">
				<tr>
					<th class="px-4 py-3 text-left font-semibold">ข้อมูลมาตรฐาน</th>
					<th class="px-4 py-3 text-left font-semibold">สถานะปัจจุบัน</th>
					<th class="px-4 py-3 text-right font-semibold">จัดการ</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as item (item.code)}
					{@const source = itemSources?.[item.code]}
					{@const owned = isOwned(item)}
					{@const perShelter = !owned && canPerShelterToggle(item)}
					{@const canSetDefault = !owned && canSetGlobalDefault(item)}
					<tr class="border-t hover:bg-muted/30" class:opacity-60={item.status === 'inactive'}>
						<td class="px-4 py-3">
							<div class="flex flex-wrap items-center gap-2">
								<div class="font-medium">{item.label}</div>
								<Badge variant={source?.scope === 'shelter' ? 'default' : 'secondary'}>
									{source?.scope === 'shelter'
										? `SHELTER · ${source.shelter_code ?? 'ไม่ระบุศูนย์'}`
										: 'GLOBAL · ทุกศูนย์'}
								</Badge>
							</div>
							{#if item.is_default}
								<span
									class="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
								>
									ค่าเริ่มต้น
								</span>
							{/if}
						</td>
						<td class="px-4 py-3">
							{#if item.status === 'active'}
								<Badge class="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
									ใช้งาน
								</Badge>
							{:else if source?.shelter_disabled}
								<Badge variant="outline" class="text-muted-foreground">ปิดใช้งาน (ศูนย์นี้)</Badge>
							{:else}
								<Badge variant="outline" class="text-muted-foreground">ปิดใช้งาน</Badge>
							{/if}
						</td>
						<td class="px-4 py-3">
							{#if owned}
								<div class="flex items-center justify-end gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										class="border-primary/20 text-primary hover:bg-primary/10"
										onclick={() => onEdit(item)}
										aria-label="จัดการ {item.label}"
									>
										<svg
											class="mr-1 h-3.5 w-3.5"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
										>
											<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
										</svg>
										จัดการ
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										class={item.status === 'active'
											? 'border-destructive/20 text-destructive hover:bg-destructive/10'
											: 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'}
										onclick={() => onToggleStatus(item)}
										aria-label="{item.status === 'active'
											? 'ปิดใช้งาน'
											: 'เปิดใช้งาน'} {item.label}"
									>
										{item.status === 'active' ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
									</Button>
								</div>
							{:else if perShelter}
								<!-- Global item: enable/disable for THIS shelter only (does not
								     touch the global doc); label editing stays central. -->
								<div class="flex items-center justify-end gap-2">
									{#if canSetDefault}
										<Button
											type="button"
											variant="outline"
											size="sm"
											class="border-primary/20 text-primary hover:bg-primary/10"
											onclick={() => onSetGlobalDefault(item)}
											aria-label="ตั้งเป็นค่าเริ่มต้น {item.label}"
										>
											ตั้งเป็นค่าเริ่มต้น
										</Button>
									{/if}
									<Button
										type="button"
										variant="outline"
										size="sm"
										class={source?.shelter_disabled
											? 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'
											: 'border-destructive/20 text-destructive hover:bg-destructive/10'}
										onclick={() => onToggleStatus(item)}
										aria-label="{source?.shelter_disabled
											? 'เปิดใช้งานสำหรับศูนย์นี้'
											: 'ปิดใช้งานสำหรับศูนย์นี้'} {item.label}"
									>
										{source?.shelter_disabled ? 'เปิดใช้งาน (ศูนย์นี้)' : 'ปิดใช้งาน (ศูนย์นี้)'}
									</Button>
								</div>
							{:else}
								<div class="text-right text-xs text-muted-foreground">จัดการที่ส่วนกลาง</div>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="3" class="px-4 py-8 text-center text-muted-foreground">
							{search.trim()
								? 'ไม่พบรายการที่ค้นหา'
								: 'ยังไม่มีข้อมูล — กดปุ่ม "เพิ่มข้อมูล" เพื่อเริ่ม'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
