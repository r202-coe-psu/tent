<script lang="ts">
	import TransferForm from './transfer-form.svelte';
	import TransferList from './transfer-list.svelte';
</script>

<!-- Split on the content width, not the viewport: the app sidebar eats ~320px from lg up, so a
     viewport breakpoint leaves the list too narrow for the history table. -->
<div class="@container">
	<div class="grid grid-cols-1 gap-6 @min-[56rem]:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
		<div class="min-w-0">
			<TransferList />
		</div>
		<div
			class="order-first min-w-0 @min-[56rem]:sticky @min-[56rem]:top-4 @min-[56rem]:order-none @min-[56rem]:self-start"
		>
			<TransferForm />
		</div>
	</div>
</div>
