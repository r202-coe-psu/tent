<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { discardReturnPath, stashReturnPath } from '$lib/auth/session-expiry';
	import { LOGIN_ROUTE, LANDING_ROUTE, type PostLoginDestination } from '$lib/guards/auth';
	import { authStore } from '$lib/stores/auth.svelte';
	import { toast } from 'svelte-sonner';
	import LoginForm from './login-form.svelte';

	/**
	 * Global, non-dismissable "session expired" modal (CONTRIBUTING.md §4).
	 * Mount once in the protected shell. Opens whenever `authStore.needsReauth`; the only
	 * ways out are a successful login or "log in with another account".
	 */
	const open = $derived(authStore.needsReauth && authStore.isAuthenticated);
	const username = $derived(authStore.user?.name ?? '');

	let contentEl = $state<HTMLElement | null>(null);
	let switching = $state(false);

	// Remember where the user was so MFA / force-setup / OAuth detours can return here.
	$effect(() => {
		if (!open || !username) return;
		stashReturnPath(`${page.url.pathname}${page.url.search}${page.url.hash}`, username);
	});

	function handleSuccess({ destination }: { destination: PostLoginDestination }) {
		// Re-authenticated in place: nothing to return to. For force-setup / MFA the stash
		// stays so the protected shell sends the user back once they reach /portal.
		if (destination === LANDING_ROUTE) discardReturnPath();
	}

	async function useAnotherAccount() {
		switching = true;
		try {
			discardReturnPath();
			await authStore.logout();
			await goto(resolve(LOGIN_ROUTE));
		} catch {
			toast.error('ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง');
		} finally {
			switching = false;
		}
	}
</script>

<AlertDialog.Root bind:open={() => open, () => {}}>
	<AlertDialog.Content
		bind:ref={contentEl}
		class="z-[100] gap-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-md sm:max-w-sm"
		onEscapeKeydown={(e) => e.preventDefault()}
		onOpenAutoFocus={(e) => {
			e.preventDefault();
			// The form mounts with the content; focus once it is in the DOM.
			setTimeout(
				() => contentEl?.querySelector<HTMLInputElement>('input[type="password"]')?.focus(),
				0
			);
		}}
	>
		<AlertDialog.Header class="gap-1.5 text-left">
			<AlertDialog.Title class="text-lg leading-snug font-bold text-slate-900"
				>เซสชันหมดอายุ</AlertDialog.Title
			>
			<AlertDialog.Description class="text-base text-slate-700">
				กรุณาเข้าสู่ระบบอีกครั้งเพื่อทำงานต่อ
			</AlertDialog.Description>
		</AlertDialog.Header>

		<LoginForm
			navigateOnSuccess={false}
			showCard={false}
			passwordMode="always"
			defaultUsername={username}
			lockUsername
			submitLabel="เข้าสู่ระบบ"
			onSuccess={handleSuccess}
		/>

		<Button
			type="button"
			variant="link"
			class="min-h-11 w-full text-sm font-semibold text-slate-600"
			disabled={switching}
			onclick={useAnotherAccount}
		>
			เข้าสู่ระบบด้วยบัญชีอื่น
		</Button>
	</AlertDialog.Content>
</AlertDialog.Root>
