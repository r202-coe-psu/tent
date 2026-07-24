<script lang="ts">
	/* eslint-disable no-useless-assignment */
	import { Input } from '$lib/components/ui/input/index.js';
	import Search from '@lucide/svelte/icons/search';
	import Loader from '@lucide/svelte/icons/loader';
	import User from '@lucide/svelte/icons/user';
	import X from '@lucide/svelte/icons/x';
	import { useSearchEvacuees, type Evacuee } from '$lib/features/people';

	let {
		value = $bindable(''),
		error,
		onSelect,
		onClear,
		placeholder = 'พิมพ์ ชื่อ-นามสกุล, บัตรประชาชน หรือเบอร์โทร (อย่างน้อย 2 ตัวอักษร)...'
	}: {
		value?: string;
		error?: string | string[];
		onSelect?: (evacuee: Evacuee) => void;
		onClear?: () => void;
		placeholder?: string;
	} = $props();

	const errorMessage = $derived(Array.isArray(error) ? error[0] : error);

	let searchTerm = $state('');
	let debouncedTerm = $state('');
	let searchTimeout: ReturnType<typeof setTimeout>;
	let selectedEvacuee: Evacuee | null = $state(null);
	let showDropdown: boolean = $state(false);
	let searchInputRef: HTMLInputElement | null = $state(null);

	$effect(() => {
		const q = searchTerm.trim();
		clearTimeout(searchTimeout);
		if (!q) {
			debouncedTerm = '';
			return;
		}
		searchTimeout = setTimeout(() => {
			debouncedTerm = q;
		}, 300);
		return () => clearTimeout(searchTimeout);
	});

	// Lazy search query: only executes when user types at least 2 characters
	const searchResults = useSearchEvacuees(
		() => debouncedTerm,
		() => debouncedTerm.trim().length >= 2
	);

	const foundEvacuees = $derived<Evacuee[]>(searchResults.data ?? []);
	const isSearching = $derived(searchResults.isFetching && debouncedTerm.trim().length >= 2);

	function selectEvacuee(evacuee: Evacuee) {
		selectedEvacuee = evacuee;
		searchTerm = `${evacuee.first_name} ${evacuee.last_name}`;
		value = evacuee._id;
		showDropdown = false;
		onSelect?.(evacuee);
	}

	function clearSelection() {
		selectedEvacuee = null;
		searchTerm = '';
		value = '';
		showDropdown = true;
		onClear?.();
		setTimeout(() => searchInputRef?.focus(), 0);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			showDropdown = false;
		}
	}

	// Click outside handler to dismiss dropdown
	$effect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('.evacuee-search-container')) {
				showDropdown = false;
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});

	function isSelected(evacueeId: string): boolean {
		return selectedEvacuee ? selectedEvacuee._id === evacueeId : false;
	}
</script>

<div class="evacuee-search-container relative space-y-2">
	<label
		for="evacuee-search"
		class="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
		>2. ค้นหาและเลือกผู้ประสบภัย *</label
	>
	<div class="relative">
		<Input
			id="evacuee-search"
			type="text"
			{placeholder}
			bind:value={searchTerm}
			bind:ref={searchInputRef}
			onfocus={() => {
				showDropdown = true;
			}}
			onkeydown={handleKeyDown}
			disabled={!!selectedEvacuee}
			class="pr-9 pl-9 {errorMessage ? 'border-destructive' : ''}"
		/>
		<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
			{#if isSearching}
				<Loader class="h-4 w-4 animate-spin" />
			{:else}
				<Search class="h-4 w-4" />
			{/if}
		</div>
		{#if selectedEvacuee}
			<button
				type="button"
				class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
				onclick={clearSelection}
			>
				<X class="h-4 w-4" />
			</button>
		{/if}
	</div>

	{#if errorMessage}
		<p class="text-xs font-medium text-destructive">{errorMessage}</p>
	{/if}

	<!-- Selected state chip -->
	{#if selectedEvacuee}
		<div
			class="mt-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary"
		>
			<User class="h-3.5 w-3.5" />
			{selectedEvacuee.first_name}
			{selectedEvacuee.last_name}
			{#if selectedEvacuee.phone}
				<span class="text-xs opacity-80">({selectedEvacuee.phone})</span>
			{/if}
		</div>
	{/if}

	<!-- Autocomplete dropdown -->
	{#if showDropdown && !selectedEvacuee && debouncedTerm.trim().length >= 2}
		<div
			class="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg"
			role="listbox"
		>
			{#if searchResults.isLoading}
				<div class="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
					<Loader class="h-3.5 w-3.5 animate-spin" />
					กำลังค้นหา...
				</div>
			{:else if foundEvacuees.length > 0}
				{#each foundEvacuees as evacuee (evacuee._id)}
					<button
						type="button"
						role="option"
						aria-selected={isSelected(evacuee._id)}
						class="w-full border-b border-border/40 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent hover:text-accent-foreground"
						onclick={() => selectEvacuee(evacuee)}
					>
						<div class="font-medium text-foreground">
							{evacuee.first_name}
							{evacuee.last_name}
						</div>
						<div class="mt-0.5 text-xs text-muted-foreground">
							{#if evacuee.phone}เบอร์โทร: {evacuee.phone} ·
							{/if}
							ID: {evacuee._id}
						</div>
					</button>
				{/each}
			{:else}
				<div class="px-3 py-2 text-sm text-muted-foreground">
					ไม่พบผู้ประสบภัย "{debouncedTerm}"
				</div>
			{/if}
		</div>
	{:else if searchTerm.trim().length > 0 && searchTerm.trim().length < 2}
		<p class="px-2 py-1 text-xs text-muted-foreground">
			พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาผู้ประสบภัย
		</p>
	{/if}
</div>
