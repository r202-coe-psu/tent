<script lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatThaiShortDate } from '$lib/utils/date';
	import { languageStore } from '$lib/stores/language.svelte';
	import { accessStatusI18n } from '../i18n/access-status.i18n';
	import type { PortalAccessStatus } from '../domain/volunteer';

	/**
	 * "สิทธิ์ใช้งานระบบ" — per shelter where the volunteer has a profile, whether they may sign
	 * in to the staff system (CR-221 FR-26). Presentational: the portal owns the query.
	 */
	let {
		rows,
		loading = false,
		error = false
	}: { rows: readonly PortalAccessStatus[]; loading?: boolean; error?: boolean } = $props();

	const t = $derived(accessStatusI18n[languageStore.current]);

	function statusText(row: PortalAccessStatus): string {
		if (row.status === 'account_disabled') return t.disabled;
		if (row.status === 'active' && row.role_label) {
			return row.expires_at
				? t.activeUntil(row.role_label, formatThaiShortDate(row.expires_at))
				: t.activePermanent(row.role_label);
		}
		return t.none;
	}
</script>

{#if loading || error || rows.length > 0}
	<div
		class="rounded-3xl border border-border bg-card p-6 shadow-sm"
		data-testid="access-status-card"
	>
		<h4 class="flex items-center gap-2 text-sm font-bold text-foreground">
			<KeyRound class="size-4 text-primary" />
			{t.title}
		</h4>

		{#if loading}
			<p class="mt-3.5 text-xs text-muted-foreground">{t.loading}</p>
		{:else if error}
			<p class="mt-3.5 text-xs text-destructive" role="alert">{t.loadError}</p>
		{:else}
			<ul class="mt-3.5 space-y-3">
				{#each rows as row (row.shelter_code)}
					<li class="space-y-2 rounded-2xl border border-border bg-muted/30 p-3.5">
						<p class="text-xs font-bold text-foreground">{row.shelter_name}</p>
						<p class="text-xs leading-relaxed text-muted-foreground" data-status={row.status}>
							{statusText(row)}
						</p>
						{#if row.status === 'active'}
							<Button href={resolve('/login')} size="sm" class="min-h-11 w-full">
								{t.loginButton}
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
