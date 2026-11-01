<script lang="ts">
	// Test double for `QuickCreateItemSheet`: renders the props it was given and lets a
	// test fire the two outcomes without the real catalog queries.
	let {
		open = $bindable(false),
		initialName = '',
		onCreated,
		onUseExisting
	}: {
		open?: boolean;
		initialName?: string;
		onCreated: (item: { _id: string; name: string }) => void;
		onUseExisting: (item: { _id: string; name: string }) => void;
	} = $props();
</script>

{#if open}
	<div data-testid="sheet-stub" data-initial-name={initialName}>
		<button
			type="button"
			data-testid="stub-created"
			onclick={() => {
				open = false;
				onCreated({ _id: 'item_master:new', name: 'น้ำปลา' });
			}}>created</button
		>
		<button
			type="button"
			data-testid="stub-existing"
			onclick={() => {
				open = false;
				onUseExisting({ _id: 'item_master:rice', name: 'ข้าวสาร' });
			}}>existing</button
		>
	</div>
{/if}
