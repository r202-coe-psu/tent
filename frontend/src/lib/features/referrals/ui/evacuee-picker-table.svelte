<script lang="ts">
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Search from '@lucide/svelte/icons/search';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { matchesEvacueeSearch, useEvacuees, zoneLabel, type Evacuee } from '$lib/features/people';

	let {
		selectedIds = $bindable<string[]>([]),
		error
	}: {
		selectedIds?: string[];
		error?: string | string[];
	} = $props();

	const errorMessage = $derived(Array.isArray(error) ? error[0] : error);

	const evacueesQuery = useEvacuees();
	let searchTerm = $state('');

	const activeEvacuees = $derived(
		(evacueesQuery.data ?? []).filter((e) => e.current_stay?.status === 'active')
	);

	const filteredEvacuees = $derived(
		activeEvacuees.filter((e) => matchesEvacueeSearch(e, searchTerm))
	);

	const filteredIds = $derived(filteredEvacuees.map((e) => e._id));

	const allFilteredSelected = $derived(
		filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id))
	);

	const someFilteredSelected = $derived(
		filteredIds.some((id) => selectedIds.includes(id)) && !allFilteredSelected
	);

	function toggleId(id: string, checked: boolean | 'indeterminate') {
		if (checked === true) {
			if (!selectedIds.includes(id)) {
				selectedIds = [...selectedIds, id];
			}
			return;
		}
		selectedIds = selectedIds.filter((x) => x !== id);
	}

	function toggleSelectAll(checked: boolean | 'indeterminate') {
		if (checked === true) {
			const next = [...selectedIds];
			for (const id of filteredIds) {
				if (!next.includes(id)) next.push(id);
			}
			selectedIds = next;
			return;
		}
		selectedIds = selectedIds.filter((id) => !filteredIds.includes(id));
	}

	function isSelected(id: string): boolean {
		return selectedIds.includes(id);
	}

	function rowLabel(evacuee: Evacuee): string {
		return `${evacuee.first_name} ${evacuee.last_name}`;
	}
</script>

<div class="space-y-3">
	<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
		<div class="space-y-1">
			<span class="text-sm font-semibold text-foreground"
				>2. เลือกผู้ประสบภัยที่ต้องการส่งต่อ *</span
			>
			<p class="text-xs text-muted-foreground">แสดงเฉพาะผู้ที่พักพิงอยู่ในศูนย์ (active stay)</p>
		</div>
		<p class="text-sm font-medium text-foreground">
			เลือกแล้ว <span class="text-primary tabular-nums">{selectedIds.length}</span> คน
		</p>
	</div>

	<div class="relative">
		<Input
			type="search"
			placeholder="ค้นหาชื่อ หรือเบอร์โทร..."
			bind:value={searchTerm}
			class="pl-9 {errorMessage ? 'border-destructive' : ''}"
			aria-label="ค้นหาผู้ประสบภัย"
		/>
		<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
			<Search class="h-4 w-4" />
		</div>
	</div>

	{#if errorMessage}
		<p class="text-xs font-medium text-destructive">{errorMessage}</p>
	{/if}

	<div class="overflow-hidden rounded-lg border border-border/80">
		{#if evacueesQuery.isLoading}
			<div class="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
				<Loader2 class="h-6 w-6 animate-spin text-primary" />
				<span class="text-sm">กำลังโหลดรายชื่อผู้ประสบภัย...</span>
			</div>
		{:else if filteredEvacuees.length === 0}
			<div class="px-4 py-10 text-center text-sm text-muted-foreground">
				{#if activeEvacuees.length === 0}
					ไม่พบผู้ประสบภัยที่พักพิงอยู่ในศูนย์
				{:else}
					ไม่พบรายชื่อที่ตรงกับคำค้น «{searchTerm.trim()}»
				{/if}
			</div>
		{:else}
			<div class="max-h-72 overflow-auto">
				<Table.Root>
					<Table.Header class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
						<Table.Row>
							<Table.Head class="w-12">
								<Checkbox
									checked={allFilteredSelected}
									indeterminate={someFilteredSelected}
									onCheckedChange={toggleSelectAll}
									aria-label="เลือกทั้งหมดตามตัวกรอง"
								/>
							</Table.Head>
							<Table.Head>ชื่อ-นามสกุล</Table.Head>
							<Table.Head class="hidden sm:table-cell">เบอร์โทร</Table.Head>
							<Table.Head class="hidden md:table-cell">โซน</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filteredEvacuees as evacuee (evacuee._id)}
							<Table.Row
								class="cursor-pointer {isSelected(evacuee._id) ? 'bg-primary/5' : ''}"
								onclick={() => toggleId(evacuee._id, !isSelected(evacuee._id))}
							>
								<Table.Cell onclick={(e) => e.stopPropagation()}>
									<Checkbox
										checked={isSelected(evacuee._id)}
										onCheckedChange={(v) => toggleId(evacuee._id, v)}
										aria-label={`เลือก ${rowLabel(evacuee)}`}
									/>
								</Table.Cell>
								<Table.Cell class="font-medium">{rowLabel(evacuee)}</Table.Cell>
								<Table.Cell class="hidden text-muted-foreground sm:table-cell">
									{evacuee.phone ?? '—'}
								</Table.Cell>
								<Table.Cell class="hidden font-mono text-xs text-muted-foreground md:table-cell">
									{zoneLabel(evacuee.current_stay?.zone)}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</div>
</div>
