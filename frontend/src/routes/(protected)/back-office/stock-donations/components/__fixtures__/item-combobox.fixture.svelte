<script lang="ts">
	// Test double for `ItemCombobox`: picks a fixed count item or a fixed mass item.
	let {
		id,
		onSelect
	}: {
		id?: string;
		onSelect: (item: { _id: string; name: string; unit: string }) => void;
	} = $props();
</script>

<div {id}>
	<button
		type="button"
		data-testid="{id}-pick-bottle"
		onclick={() => onSelect({ _id: 'item:water', name: 'น้ำดื่ม', unit: 'bottle' })}>bottle</button
	>
	<button
		type="button"
		data-testid="{id}-pick-kg"
		onclick={() => onSelect({ _id: 'item:rice', name: 'ข้าวสาร', unit: 'kg' })}>kg</button
	>
</div>
