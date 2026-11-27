<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import LogOut from '@lucide/svelte/icons/log-out';
	import UserCircle from '@lucide/svelte/icons/user-circle';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { formatRoleList } from '$lib/auth/roles';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { LOGOUT_ROUTE } from '$lib/guards/auth';
	import { authStore } from '$lib/stores/auth.svelte';
	import { cn } from '$lib/utils/shadcn';
	import { STAFF_CHROME_I18N } from '$lib/constants/i18n/staff-chrome';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	let {
		class: className = '',
		compact = false,
		align = 'end',
		side = 'bottom',
		onNavigate
	}: {
		class?: string;
		compact?: boolean;
		align?: 'start' | 'center' | 'end';
		side?: 'top' | 'right' | 'bottom' | 'left';
		onNavigate?: () => void;
	} = $props();

	const t = $derived(getTranslation(STAFF_CHROME_I18N, langState.current).accountMenu);

	// Full name when the profile has one, else the login username.
	const displayName = $derived(authStore.user?.display_name?.trim() || authStore.user?.name || '');
	const roles = $derived(authStore.user?.roles ?? []);
	const roleLabel = $derived(formatRoleList(roles));

	async function goToProfile() {
		onNavigate?.();
		await goto(resolve('/me'));
	}

	async function logout() {
		onNavigate?.();
		await authStore.logout();
		toast.success(t.loggedOut);
		await goto(resolve(LOGOUT_ROUTE));
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		aria-label={displayName || t.account}
		class={cn(
			'inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
			// A collapsed rail is 4rem wide: the trigger must shrink to it and truncate the name.
			compact ? 'w-full max-w-full justify-center overflow-hidden px-1' : 'justify-start',
			className
		)}
		title={compact ? displayName : undefined}
	>
		<span class="max-w-[10rem] min-w-0 truncate">{displayName}</span>
		{#if !compact}
			<ChevronDown class="size-4 shrink-0 text-muted-foreground" />
		{/if}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content {align} {side} class="min-w-56">
		<DropdownMenu.Label class="font-normal">
			<div class="flex flex-col gap-0.5">
				<span class="truncate font-semibold text-foreground">{displayName || t.user}</span>
				<span class="truncate text-xs text-muted-foreground">{roleLabel}</span>
			</div>
		</DropdownMenu.Label>

		<DropdownMenu.Separator />

		<DropdownMenu.Item class="cursor-pointer gap-2" onSelect={() => void goToProfile()}>
			<UserCircle class="size-4" />
			{t.myAccount}
		</DropdownMenu.Item>

		<DropdownMenu.Separator />

		<DropdownMenu.Item
			variant="destructive"
			class="cursor-pointer gap-2"
			onSelect={() => void logout()}
		>
			<LogOut class="size-4" />
			{t.logout}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
