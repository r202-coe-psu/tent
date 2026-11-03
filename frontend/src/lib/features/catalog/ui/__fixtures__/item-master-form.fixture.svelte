<script lang="ts">
	// Test double for `ItemMasterForm`.
	let {
		initialValues
	}: {
		initialValues?: { name?: string; category?: string };
	} = $props();
</script>

<div
	data-testid="full-form-stub"
	data-name={initialValues?.name}
	data-category={initialValues?.category}
></div>
