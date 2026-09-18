<script lang="ts">
	import { onDestroy } from 'svelte';
	import { cn } from '$lib/utils/shadcn.js';
	import * as Popover from '$lib/components/ui/popover';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Input } from '$lib/components/ui/input';
	import Check from '@lucide/svelte/icons/check';
	import Search from '@lucide/svelte/icons/search';
	import Loader from '@lucide/svelte/icons/loader';
	import X from '@lucide/svelte/icons/x';
	import Users from '@lucide/svelte/icons/users';
	import { useOverviewHouseholds, type HouseholdOption } from '$lib/features/system-overview';

	interface Props {
		mode?: 'universal' | 'shelter';
		shelterCode?: string | null;
		value?: string;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		loadingText?: string;
		class?: string;
		disabled?: boolean;
		allowClear?: boolean;
		onSelect?: (item: HouseholdOption | null) => void;
	}

	let {
		mode = 'universal',
		shelterCode = null,
		value = $bindable(''),
		placeholder = 'เลือกหรือค้นหาครอบครัว...',
		searchPlaceholder = 'พิมพ์ชื่อครอบครัว สมาชิก หรือที่อยู่...',
		emptyText = 'ไม่พบข้อมูลครอบครัว',
		loadingText = 'กำลังค้นหา...',
		class: className = '',
		disabled = false,
		allowClear = true,
		onSelect
	}: Props = $props();

	let open = $state(false);
	let searchTerm = $state('');
	let debouncedSearch = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let userSelected = $state<HouseholdOption | null>(null);

	onDestroy(() => {
		if (debounceTimer) clearTimeout(debounceTimer);
	});

	function onInputSearch(e: Event) {
		const val = (e.currentTarget as HTMLInputElement).value;
		searchTerm = val;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debouncedSearch = val;
		}, 250);
	}

	const query = useOverviewHouseholds(() => ({
		scope: mode,
		shelterCode: mode === 'shelter' ? shelterCode : null,
		q: debouncedSearch || null,
		limit: 30
	}));

	const items = $derived(query.data ?? []);
	const isLoading = $derived(query.isPending);

	const selectedOption = $derived.by(() => {
		if (!value) return null;
		if (userSelected && userSelected.id === value) return userSelected;
		return items.find((i) => i.id === value) ?? null;
	});

	function handleSelect(item: HouseholdOption) {
		value = item.id;
		userSelected = item;
		open = false;
		searchTerm = '';
		debouncedSearch = '';
		onSelect?.(item);
	}

	function handleClear(e: MouseEvent) {
		e.stopPropagation();
		value = '';
		userSelected = null;
		searchTerm = '';
		debouncedSearch = '';
		onSelect?.(null);
	}

	function formatAddress(opt: HouseholdOption): string {
		return [opt.subdistrict ? `ต.${opt.subdistrict}` : '', opt.district ? `อ.${opt.district}` : '', opt.province ? `จ.${opt.province}` : '']
			.filter(Boolean)
			.join(' ');
	}

	const tooltipSummary = $derived.by(() => {
		if (selectedOption) {
			const parts: string[] = [selectedOption.label];
			if (selectedOption.statusLabel) parts.push(`(${selectedOption.statusLabel})`);
			const addr = formatAddress(selectedOption);
			if (addr) parts.push(addr);
			if (selectedOption.memberCount > 0) parts.push(`สมาชิก ${selectedOption.memberCount} คน`);
			if (selectedOption.memberNames && selectedOption.memberNames.length > 0) {
				parts.push(`(${selectedOption.memberNames.join(', ')})`);
			}
			return parts.join(' • ');
		}
		if (value) return `รหัสครอบครัว: ${value}`;
		return '';
	});
</script>

<Tooltip.Provider delayDuration={150}>
	<Popover.Root bind:open>
		<Tooltip.Root disabled={open || !tooltipSummary}>
			<Tooltip.Trigger>
				{#snippet child({ props: tooltipProps })}
					<Popover.Trigger
						{...tooltipProps}
						class={cn(
							'flex h-9 w-full min-w-0 max-w-full items-center justify-between overflow-hidden rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 text-left text-sm shadow-2xs transition-colors hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A2647]/20 disabled:cursor-not-allowed disabled:opacity-50',
							className
						)}
						disabled={disabled}
						aria-label="เลือกครอบครัว"
						title={tooltipSummary || undefined}
					>
						<div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
							<Users class="size-4 shrink-0 text-slate-400" />
							{#if selectedOption}
								<span class="min-w-0 flex-1 truncate font-medium text-slate-900">
									{selectedOption.label}
								</span>
								{#if selectedOption.statusLabel}
									<span
										class={cn(
											'shrink-0 max-w-[45%] truncate rounded-full px-2 py-0.5 text-2xs font-semibold',
											selectedOption.status === 'unassigned'
												? 'border border-amber-200 bg-amber-50 text-amber-800'
												: 'border border-sky-200 bg-sky-50 text-sky-800'
										)}
									>
										{selectedOption.statusLabel}
									</span>
								{/if}
							{:else if value}
								<span class="min-w-0 flex-1 truncate font-medium text-slate-900">{value}</span>
							{:else}
								<span class="min-w-0 flex-1 truncate text-slate-500">{placeholder}</span>
							{/if}
						</div>

						<div class="ml-2 flex shrink-0 items-center gap-1">
							{#if allowClear && (value || selectedOption)}
								<button
									type="button"
									onclick={handleClear}
									class="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none"
									title="ล้างการเลือก"
									aria-label="ล้างการเลือก"
								>
									<X class="size-3.5" />
								</button>
							{/if}
							<Search class="size-3.5 text-slate-400" />
						</div>
					</Popover.Trigger>
				{/snippet}
			</Tooltip.Trigger>
			{#if tooltipSummary}
				<Tooltip.Content
					side="top"
					align="start"
					sideOffset={6}
					class="z-50 max-w-xs rounded-xl bg-slate-900/95 px-3 py-2 text-xs font-normal text-white shadow-xl backdrop-blur-sm"
				>
					<div class="space-y-1">
						<div class="font-semibold text-white truncate">{selectedOption?.label ?? value}</div>
						{#if selectedOption?.statusLabel}
							<div class="text-sky-300 text-[11px] font-medium">{selectedOption.statusLabel}</div>
						{/if}
						{#if selectedOption && formatAddress(selectedOption)}
							<div class="text-slate-300 text-[11px]">{formatAddress(selectedOption)}</div>
						{/if}
						{#if selectedOption?.memberNames && selectedOption.memberNames.length > 0}
							<div class="text-slate-400 text-[10px] leading-tight">
								สมาชิก ({selectedOption.memberCount} คน): {selectedOption.memberNames.join(', ')}
							</div>
						{/if}
					</div>
				</Tooltip.Content>
			{/if}
		</Tooltip.Root>

		<Popover.Content
			class="w-80 min-w-[20rem] max-w-sm rounded-xl border border-slate-200/80 bg-white p-2 shadow-lg sm:w-96"
			align="start"
			sideOffset={4}
		>
			<div class="space-y-2">
				<div class="relative">
					<Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
					<Input
						type="search"
						placeholder={searchPlaceholder}
						value={searchTerm}
						oninput={onInputSearch}
						class="h-8 rounded-lg pl-8 text-xs"
						autofocus
					/>
				</div>

				<div class="max-h-60 overflow-y-auto space-y-1 pr-1">
					{#if isLoading && items.length === 0}
						<div class="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
							<Loader class="size-4 animate-spin" />
							{loadingText}
						</div>
					{:else if items.length === 0}
						<div class="py-6 text-center text-xs text-slate-500">
							{emptyText}
						</div>
					{:else}
						{#each items as item (item.id)}
							{@const isSelected = item.id === value}
							{@const addr = formatAddress(item)}
							{@const itemTooltip = [
								item.label,
								item.statusLabel ? `(${item.statusLabel})` : '',
								addr,
								item.memberNames?.length ? `สมาชิก: ${item.memberNames.join(', ')}` : ''
							]
								.filter(Boolean)
								.join(' • ')}
							<button
								type="button"
								class={cn(
									'flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-100 focus:outline-none focus:bg-slate-100',
									isSelected && 'bg-sky-50/80 hover:bg-sky-50'
								)}
								title={itemTooltip}
								onclick={() => handleSelect(item)}
							>
								<div class="flex min-w-0 w-full items-center justify-between gap-2">
									<span class="min-w-0 flex-1 truncate font-semibold text-xs text-slate-900">
										{item.label}
									</span>
									<div class="flex items-center gap-1.5 shrink-0">
										{#if item.statusLabel}
											<span
												class={cn(
													'max-w-[130px] truncate rounded-full px-1.5 py-0.2 text-[10px] font-semibold',
													item.status === 'unassigned'
														? 'border border-amber-200 bg-amber-50 text-amber-800'
														: 'border border-sky-200 bg-sky-50 text-sky-800'
												)}
											>
												{item.statusLabel}
											</span>
										{/if}
										{#if isSelected}
											<Check class="size-3.5 text-[#0284C7] shrink-0" />
										{/if}
									</div>
								</div>

								<div class="flex min-w-0 items-center gap-2 text-[11px] text-slate-500">
									{#if addr}
										<span class="min-w-0 truncate">{addr}</span>
									{/if}
									{#if item.memberCount > 0}
										<span class="shrink-0">· สมาชิก {item.memberCount} คน</span>
									{/if}
								</div>

								{#if item.memberNames && item.memberNames.length > 0}
									<p class="truncate text-[10px] text-slate-400">
										{item.memberNames.join(', ')}
									</p>
								{/if}
							</button>
						{/each}
					{/if}
				</div>
			</div>
		</Popover.Content>
	</Popover.Root>
</Tooltip.Provider>
