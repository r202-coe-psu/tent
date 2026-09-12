import type { EndpointStatus } from '$lib/stores/endpoint.svelte';

export function shouldShowDailySopReconnect(status: EndpointStatus): boolean {
	return status === 'disconnected';
}
