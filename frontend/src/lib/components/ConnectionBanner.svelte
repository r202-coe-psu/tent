<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { endpointStore } from '$lib/stores/endpoint.svelte';

	async function handleRetry() {
		await endpointStore.forceRetry();
	}
</script>

{#if endpointStore.status === 'disconnected'}
	<div
		class="text-destructive-foreground flex items-center justify-between gap-4 bg-destructive px-4 py-2 text-sm"
		role="alert"
	>
		<span>เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบเครือข่ายแล้วลองอีกครั้ง</span>
		<Button variant="secondary" size="sm" onclick={handleRetry}>ลองเชื่อมต่ออีกครั้ง</Button>
	</div>
{/if}
