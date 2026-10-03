<script lang="ts">
	import TransferForm from './transfer-form.svelte';
	import TransferList from './transfer-list.svelte';
</script>

<div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
	<div class="min-w-0">
		<TransferList />
	</div>
	<div class="min-w-0 lg:sticky lg:top-4 lg:self-start">
		<TransferForm />
	</div>
</div>
