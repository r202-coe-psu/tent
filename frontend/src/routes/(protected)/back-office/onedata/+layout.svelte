<script lang="ts">
	let { children } = $props();
</script>

<div class="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">
	{@render children()}
</div>
