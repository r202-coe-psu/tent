<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';

	async function logout() {
		await authStore.logout();
		toast.success('Logged out successfully');
		await goto(resolve('/login'));
	}
</script>

<Button variant="destructive" onclick={logout}>Logout</Button>
