<script lang="ts">
	/**
	 * What a volunteer's system account may do in this shelter (#1044): no account, its roles here
	 * (a coordinator grant shows its last day, a manager's role shows as permanent), an account
	 * whose role here ended, or a closed account. Shared by the people tab and a job's applicants.
	 */
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatThaiShortDate } from '$lib/utils/date';
	import type { VolunteerAccessStatus } from '../domain/volunteer-access-status';

	let {
		status,
		showLogin = true
	}: {
		status: VolunteerAccessStatus;
		/** Print the login username under the badges. */
		showLogin?: boolean;
	} = $props();

	// Badge is a fixed-height, overflow-hidden pill: these may wrap, so they take h-auto.
	const wrap = 'h-auto max-w-full justify-start gap-1 text-left whitespace-normal';
</script>

<div class="flex flex-wrap items-center gap-1.5" data-testid="volunteer-account-status">
	{#if status.kind === 'none'}
		<Badge variant="outline" class="{wrap} text-muted-foreground">
			<KeyRound class="h-3 w-3 shrink-0" />
			ยังไม่มีบัญชีระบบ
		</Badge>
	{:else if status.kind === 'deactivated'}
		<Badge variant="outline" class="{wrap} border-rose-200 bg-rose-50 text-rose-700">
			<KeyRound class="h-3 w-3 shrink-0" />
			บัญชีถูกปิดใช้งาน
		</Badge>
	{:else if status.kind === 'lapsed'}
		<Badge variant="outline" class="{wrap} border-amber-300 bg-amber-50 text-amber-800">
			<KeyRound class="h-3 w-3 shrink-0" />
			มีบัญชี · สิทธิ์ในศูนย์นี้สิ้นสุดแล้ว
		</Badge>
	{:else}
		<Badge variant="outline" class="{wrap} border-emerald-300 bg-emerald-50 text-emerald-700">
			<KeyRound class="h-3 w-3 shrink-0" />
			มีบัญชีแล้ว
		</Badge>
		{#each status.roles ?? [] as access (access.role)}
			<Badge variant="outline" class="{wrap} border-emerald-300 bg-background text-emerald-800">
				{access.label}
				<span class="font-normal text-muted-foreground">
					{access.expiresAt ? `· ถึง ${formatThaiShortDate(access.expiresAt)}` : '· ถาวร'}
				</span>
			</Badge>
		{/each}
	{/if}
</div>
{#if showLogin && status.kind !== 'none'}
	<p class="text-xs break-all text-muted-foreground">{status.loginName}</p>
{/if}
