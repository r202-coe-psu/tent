<script lang="ts">
	import { tick } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { useShelters, type ShelterSummary } from '$lib/features/shelters';

	let {
		value = $bindable(''),
		error,
		onSelect,
		validate,
		id,
		excludeCode
	}: {
		value?: string;
		error?: string | string[];
		onSelect?: (code: string) => void;
		validate?: () => void;
		id?: string;
		excludeCode?: string;
	} = $props();

	const errorMessage = $derived(Array.isArray(error) ? error[0] : error);

	const sheltersQuery = useShelters();
	const allShelters = $derived(sheltersQuery.data ?? []);

	const availableShelters = $derived(
		allShelters
			.filter((s) => s.operation_status !== 'closed')
			.filter((s) => !excludeCode || s.code.toUpperCase() !== excludeCode.toUpperCase())
			.sort((a, b) => a.name.localeCompare(b.name, 'th'))
	);

	let searchTerm = $state('');
	let isOpen = $state(false);
	let highlightedIndex = $state(-1);
	let inputRef = $state<HTMLInputElement | null>(null);
	let listboxRef = $state<HTMLUListElement | null>(null);
	let itemRefs = $state<(HTMLButtonElement | null)[]>([]);

	const filteredShelters = $derived(() => {
		if (!searchTerm.trim()) {
			return availableShelters.slice(0, 10);
		}
		const q = searchTerm.toLowerCase();
		return availableShelters
			.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
			.slice(0, 20);
	});

	const displayValue = $derived(() => {
		if (!value) return '';
		const found = allShelters.find((s) => s.code === value);
		return found ? `${found.name} (${found.code})` : value;
	});

	function selectShelter(shelter: ShelterSummary) {
		value = shelter.code;
		onSelect?.(shelter.code);
		validate?.();
		isOpen = false;
		searchTerm = '';
		highlightedIndex = -1;
		tick().then(() => inputRef?.focus());
	}

	function clearSelection(e: MouseEvent) {
		e.stopPropagation();
		value = '';
		onSelect?.('');
		validate?.();
		searchTerm = '';
		highlightedIndex = -1;
		tick().then(() => inputRef?.focus());
	}

	function scrollToHighlighted(index: number) {
		const el = itemRefs[index];
		if (el) {
			el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		const currentList = filteredShelters();
		if (!isOpen) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
				e.preventDefault();
				isOpen = true;
				searchTerm = '';
				highlightedIndex = 0;
			}
			return;
		}

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				if (currentList.length > 0) {
					highlightedIndex = (highlightedIndex + 1) % currentList.length;
					scrollToHighlighted(highlightedIndex);
				}
				break;
			case 'ArrowUp':
				e.preventDefault();
				if (currentList.length > 0) {
					highlightedIndex = (highlightedIndex - 1 + currentList.length) % currentList.length;
					scrollToHighlighted(highlightedIndex);
				}
				break;
			case 'Enter':
				e.preventDefault();
				if (highlightedIndex >= 0 && highlightedIndex < currentList.length) {
					selectShelter(currentList[highlightedIndex]);
				}
				break;
			case 'Escape':
				e.preventDefault();
				isOpen = false;
				highlightedIndex = -1;
				break;
			case 'Tab':
				isOpen = false;
				highlightedIndex = -1;
				break;
		}
	}

	$effect(() => {
		if (!isOpen) return;
		const handler = (e: MouseEvent) => {
			if (!inputRef?.closest('.shelter-combobox')?.contains(e.target as Node)) {
				isOpen = false;
				highlightedIndex = -1;
			}
		};
		document.addEventListener('click', handler);
		return () => document.removeEventListener('click', handler);
	});
</script>

<div class="shelter-combobox relative w-full">
	<div class="relative">
		<input
			bind:this={inputRef}
			{id}
			type="text"
			role="combobox"
			aria-expanded={isOpen}
			aria-controls="shelter-listbox"
			aria-autocomplete="list"
			aria-invalid={!!errorMessage || sheltersQuery.isError}
			disabled={sheltersQuery.isPending}
			value={isOpen ? searchTerm : displayValue()}
			onfocus={() => {
				if (!sheltersQuery.isPending) {
					isOpen = true;
					searchTerm = '';
					highlightedIndex = -1;
				}
			}}
			oninput={(e) => {
				searchTerm = e.currentTarget.value;
				isOpen = true;
				highlightedIndex = 0;
			}}
			onkeydown={handleKeyDown}
			placeholder={sheltersQuery.isPending
				? 'กำลังโหลดรายชื่อศูนย์พักพิง...'
				: sheltersQuery.isError
					? 'เกิดข้อผิดพลาดในการโหลดรายชื่อศูนย์พักพิง'
					: 'เลือกศูนย์พักพิงปลายทาง...'}
			class="flex h-10 w-full rounded-md border bg-background px-3 py-2 pr-8 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50
			{errorMessage || sheltersQuery.isError
				? 'border-destructive focus-visible:ring-destructive'
				: 'border-input focus-visible:ring-ring'}"
		/>
		{#if value && !isOpen}
			<button
				type="button"
				onclick={clearSelection}
				aria-label="ลบการเลือกศูนย์พักพิง"
				class="absolute top-1/2 right-1 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
			>
				<X class="h-4 w-4" />
			</button>
		{/if}
	</div>

	{#if isOpen}
		<div
			class="absolute z-50 mt-1 max-h-[60vh] w-full overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg transition-all"
		>
			{#if sheltersQuery.isPending}
				<div class="p-4 text-center text-sm text-muted-foreground">
					กำลังโหลดรายชื่อศูนย์พักพิง...
				</div>
			{:else if sheltersQuery.isError}
				<div
					class="flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-destructive"
				>
					<div class="flex items-center gap-1.5 font-medium">
						<AlertCircle class="h-4 w-4 shrink-0" />
						<span>ไม่สามารถโหลดรายชื่อศูนย์พักพิงได้</span>
					</div>
					<p class="text-xs text-muted-foreground">
						{sheltersQuery.error?.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ'}
					</p>
					<button
						type="button"
						onclick={() => sheltersQuery.refetch()}
						class="mt-1 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 focus:outline-none"
					>
						<RefreshCw class="h-3.5 w-3.5" />
						ลองอีกครั้ง
					</button>
				</div>
			{:else if availableShelters.length === 0}
				<div class="p-4 text-center text-sm text-muted-foreground">
					ไม่มีศูนย์พักพิงที่เปิดให้บริการ
				</div>
			{:else if filteredShelters().length === 0}
				<div class="p-4 text-center text-sm text-muted-foreground">
					ไม่พบศูนย์พักพิงที่ตรงกับ "{searchTerm}"
				</div>
			{:else}
				<ul
					id="shelter-listbox"
					role="listbox"
					bind:this={listboxRef}
					class="max-h-60 overflow-y-auto py-1"
				>
					{#each filteredShelters() as shelter, index (shelter.code)}
						{@const isSelected = value === shelter.code}
						{@const isHighlighted = highlightedIndex === index}
						<li role="presentation">
							<button
								type="button"
								role="option"
								aria-selected={isSelected}
								tabindex="-1"
								bind:this={itemRefs[index]}
								onclick={() => selectShelter(shelter)}
								onmouseenter={() => (highlightedIndex = index)}
								class="flex min-h-[44px] w-full cursor-pointer flex-col justify-center px-4 py-2 text-left transition-colors
								{isSelected ? 'bg-accent font-semibold text-accent-foreground' : ''}
								{isHighlighted && !isSelected ? 'bg-muted/80' : ''}
								hover:bg-accent/80"
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										{#if isSelected}
											<Check class="h-4 w-4 shrink-0 text-primary" />
										{/if}
										<span class="text-sm font-medium">{shelter.name}</span>
									</div>
									<span class="font-mono text-xs text-muted-foreground">({shelter.code})</span>
								</div>
								<div class="mt-0.5 flex items-center gap-2 pl-6 text-xs text-muted-foreground">
									{#if shelter.province}
										<span>จ.{shelter.province}</span>
									{/if}
									{#if shelter.capacity}
										<span>· ความจุ: {shelter.capacity} คน</span>
									{/if}
									{#if shelter.operation_status === 'full_capacity'}
										<span class="font-semibold text-amber-600 dark:text-amber-500">(เต็ม)</span>
									{/if}
								</div>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if sheltersQuery.isError && !isOpen}
		<div class="mt-1 flex items-center justify-between text-xs text-destructive">
			<span class="flex items-center gap-1">
				<AlertCircle class="h-3.5 w-3.5" />
				โหลดรายชื่อศูนย์พักพิงไม่สำเร็จ
			</span>
			<button
				type="button"
				onclick={() => sheltersQuery.refetch()}
				class="font-medium underline hover:text-destructive/80"
			>
				ลองอีกครั้ง
			</button>
		</div>
	{:else if errorMessage}
		<p class="mt-1 text-sm text-destructive">{errorMessage}</p>
	{/if}
</div>
