<script lang="ts">
	// Test double for `QuickCreateItem`.
	let {
		initialName = '',
		onCreated,
		onUseExisting
	}: {
		initialName?: string;
		onCreated: (item: { _id: string }) => void;
		onUseExisting: (item: { _id: string }) => void;
	} = $props();
</script>

<div data-testid="qc-stub" data-name={initialName}>
	<button type="button" data-testid="qc-created" onclick={() => onCreated({ _id: 'item_master:x' })}
		>created</button
	>
	<button
		type="button"
		data-testid="qc-existing"
		onclick={() => onUseExisting({ _id: 'item_master:y' })}>existing</button
	>
</div>
