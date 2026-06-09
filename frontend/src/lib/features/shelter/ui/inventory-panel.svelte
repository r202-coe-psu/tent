<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { authStore } from '$lib/stores/auth.svelte';
	import type { InventoryRow } from '../application/queries';
	import { useAddItem, useDispense, useInventory, useRestock } from '../application/queries';
	import type { ShelterId, ShelterRole } from '../domain/shelter';

	interface Props {
		id: ShelterId;
		role: ShelterRole;
	}
	let { id, role }: Props = $props();

	const inventoryQuery = useInventory(id);
	const dispense = useDispense(id);
	const restock = useRestock(id);
	const addItem = useAddItem(id);

	const byUser = $derived(authStore.user?.name ?? 'unknown');
	const isManager = $derived(role === 'manager');

	// per-row dispense/restock input
	let qtyById = $state<Record<string, number>>({});
	let reasonById = $state<Record<string, string>>({});

	function move(row: InventoryRow, direction: 'dispense' | 'restock') {
		const quantity = Number(qtyById[row.item._id] ?? 0);
		if (!Number.isInteger(quantity) || quantity <= 0) {
			toast.error('Enter a positive whole number');
			return;
		}
		if (direction === 'dispense' && quantity > row.quantity) {
			toast.error(`Only ${row.quantity} ${row.item.unit} in stock`);
			return;
		}
		const input = {
			itemId: row.item._id,
			quantity,
			reason: reasonById[row.item._id]?.trim() ?? '',
			byUser
		};
		const mutation = direction === 'dispense' ? dispense : restock;
		mutation.mutate(input, {
			onSuccess: () => {
				toast.success(
					`${direction === 'dispense' ? 'Dispensed' : 'Restocked'} ${quantity} ${row.item.unit}`
				);
				qtyById[row.item._id] = 0;
				reasonById[row.item._id] = '';
			},
			onError: (err: Error) => toast.error(err.message)
		});
	}

	// add-item form (manager only)
	let newName = $state('');
	let newUnit = $state('');
	function handleAddItem(e: SubmitEvent) {
		e.preventDefault();
		if (!newName.trim() || !newUnit.trim()) return;
		addItem.mutate(
			{ name: newName.trim(), unit: newUnit.trim() },
			{
				onSuccess: () => {
					toast.success(`Added ${newName.trim()}`);
					newName = '';
					newUnit = '';
				},
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>Inventory</CardTitle>
	</CardHeader>
	<CardContent class="flex flex-col gap-4">
		{#if inventoryQuery.isLoading}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if (inventoryQuery.data ?? []).length === 0}
			<p class="text-sm text-muted-foreground">No items yet.</p>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each inventoryQuery.data ?? [] as row (row.item._id)}
					<li class="rounded-md border p-3">
						<div class="flex items-baseline justify-between">
							<span class="font-medium">{row.item.name}</span>
							<span class="text-sm" class:text-destructive={row.quantity <= 0}>
								{row.quantity}
								{row.item.unit}
							</span>
						</div>
						<div class="mt-2 flex flex-wrap items-end gap-2">
							<div class="flex flex-col gap-1">
								<Label class="text-xs" for="qty-{row.item._id}">Qty</Label>
								<Input
									id="qty-{row.item._id}"
									type="number"
									min="1"
									class="w-20"
									bind:value={qtyById[row.item._id]}
								/>
							</div>
							<div class="flex flex-1 flex-col gap-1">
								<Label class="text-xs" for="reason-{row.item._id}">Reason</Label>
								<Input
									id="reason-{row.item._id}"
									placeholder="optional"
									bind:value={reasonById[row.item._id]}
								/>
							</div>
							<Button size="sm" variant="outline" onclick={() => move(row, 'dispense')}>
								Dispense
							</Button>
							{#if isManager}
								<Button size="sm" variant="secondary" onclick={() => move(row, 'restock')}>
									Restock
								</Button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if isManager}
			<form onsubmit={handleAddItem} class="flex flex-wrap items-end gap-2 border-t pt-4">
				<div class="flex flex-1 flex-col gap-1">
					<Label class="text-xs" for="new-item-name">New item</Label>
					<Input id="new-item-name" bind:value={newName} placeholder="e.g. Water bottle" />
				</div>
				<div class="flex flex-col gap-1">
					<Label class="text-xs" for="new-item-unit">Unit</Label>
					<Input id="new-item-unit" class="w-24" bind:value={newUnit} placeholder="pcs" />
				</div>
				<Button type="submit" size="sm" disabled={addItem.isPending}>Add item</Button>
			</form>
		{/if}
	</CardContent>
</Card>
