<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import LogOut from '@lucide/svelte/icons/log-out';
	import UserCircle from '@lucide/svelte/icons/user-circle';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { formatRoleList } from '$lib/auth/roles';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { LOGOUT_ROUTE } from '$lib/guards/auth';
	import { authStore } from '$lib/stores/auth.svelte';
	import { cn } from '$lib/utils/shadcn';

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

	const displayName = $derived(authStore.user?.name ?? '');
	const initials = $derived(displayName.substring(0, 2).toUpperCase() || 'US');
	const roles = $derived(authStore.user?.roles ?? []);
	const roleLabel = $derived(formatRoleList(roles));

	async function goToProfile() {
		onNavigate?.();
		await goto(resolve('/me'));
	}

	async function logout() {
		onNavigate?.();
		await authStore.logout();
		toast.success('Logged out successfully');
		await goto(resolve(LOGOUT_ROUTE));
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		aria-label={displayName || 'บัญชีผู้ใช้'}
		class={cn(
			'inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
			compact ? 'justify-center' : 'justify-start',
			className
		)}
	>
		<span
			class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
			aria-hidden="true"
		>
			{initials}
		</span>
		{#if !compact}
			<span class="hidden max-w-[10rem] min-w-0 truncate sm:inline">{displayName}</span>
			<ChevronDown class="hidden size-4 shrink-0 text-muted-foreground sm:block" />
		{/if}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content {align} {side} class="min-w-56">
		<DropdownMenu.Label class="font-normal">
			<div class="flex flex-col gap-0.5">
				<span class="truncate font-semibold text-foreground">{displayName || 'ผู้ใช้'}</span>
				<span class="truncate text-xs text-muted-foreground">{roleLabel}</span>
			</div>
		</DropdownMenu.Label>

		<DropdownMenu.Separator />

		<DropdownMenu.Item class="cursor-pointer gap-2" onSelect={() => void goToProfile()}>
			<UserCircle class="size-4" />
			บัญชีของฉัน
		</DropdownMenu.Item>

		<DropdownMenu.Item
			class="cursor-default p-0 focus:bg-transparent data-highlighted:bg-transparent"
			onSelect={(e) => e.preventDefault()}
		>
			<div class="w-full px-2 py-2">
				<LanguageSwitcher class="w-full justify-center" />
			</div>
		</DropdownMenu.Item>

		<DropdownMenu.Separator />

		<DropdownMenu.Item
			variant="destructive"
			class="cursor-pointer gap-2"
			onSelect={() => void logout()}
		>
			<LogOut class="size-4" />
			ออกจากระบบ
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
