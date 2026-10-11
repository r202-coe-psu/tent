import { toast } from 'svelte-sonner';
import { createAppQueryClient } from '$lib/db/query-client';
import { authStore } from '$lib/stores/auth.svelte';

export const prerender = false;
export const ssr = false;
export const trailingSlash = 'never';

/** Fixed ids so a burst of failed writes shows one toast, not a stack. */
const MUTATION_EXPIRED_TOAST_ID = 'mutation-session-expired';
const MUTATION_DENIED_TOAST_ID = 'mutation-permission-denied';

export async function load() {
	const queryClient = createAppQueryClient({
		onAuthFailure: (err) => authStore.handleAuthFailure(err),
		onMutationExpired: () =>
			toast.error('บันทึกไม่สำเร็จ เข้าสู่ระบบแล้วทำรายการอีกครั้ง', {
				id: MUTATION_EXPIRED_TOAST_ID
			}),
		onMutationPermissionDenied: () =>
			toast.error('คุณไม่มีสิทธิ์ในการทำรายการนี้', { id: MUTATION_DENIED_TOAST_ID })
	});
	return { queryClient };
}
