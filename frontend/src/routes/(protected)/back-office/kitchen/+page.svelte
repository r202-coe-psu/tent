<script lang="ts">
	import { MealSessionList } from '$lib/features/kitchen';

	// Live query subscribers (kitchen + operations) are already registered globally
	// via STAFF_LIVE_QUERY_STARTERS in the (protected) layout — no per-page subscription needed.
</script>

<svelte:head>
	<title>ครัวกลางและอาหาร · SmartShelter</title>
</svelte:head>

<div class="flex-1">
	<MealSessionList />
</div>
