<script lang="ts">
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Search from '@lucide/svelte/icons/search';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input';
	import { useFindTicketsMutation } from '../application/queries';
	import { resolvePortalAccess } from '../data/volunteer-api';
	import { ticketFindSchema, ticketStatusLabel, PORTAL_SESSION_KEY } from '../domain/volunteer';
	import { ticketI18n } from '../i18n/ticket.i18n';
	import { languageStore } from '$lib/stores/language.svelte';

	const t = $derived(ticketI18n[languageStore.current]);

	let phone = $state('');
	let error = $state('');
	let searched = $state(false);
	let isEnteringPortal = $state(false);

	const find = useFindTicketsMutation();
	const tickets = $derived(find.data?.tickets ?? []);

	async function search(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const parsed = ticketFindSchema.safeParse({ phone });
		if (!parsed.success) {
			error = t.finderInvalidPhone;
			return;
		}
		try {
			await find.mutateAsync(parsed.data.phone);
			searched = true;
		} catch (err) {
			error = err instanceof Error ? err.message : t.finderSearchFailed;
		}
	}

	async function signIntoPortal() {
		error = '';
		isEnteringPortal = true;
		try {
			const profile = await resolvePortalAccess({ phone });
			if (!profile?.portal_id) {
				error = t.finderPhoneNotFound;
				return;
			}
			try {
				sessionStorage.setItem(
					PORTAL_SESSION_KEY,
					JSON.stringify({ phone, portal_id: profile.portal_id })
				);
			} catch {
				// Private mode, or storage disabled — the portal opens signed out and the
				// volunteer can sign in again with the number they just typed.
			}
			await goto(resolve('/volunteers/portal'));
		} catch (err) {
			error = err instanceof Error ? err.message : t.finderSignInFailed;
		} finally {
			isEnteringPortal = false;
		}
	}
</script>

<div class="mx-auto max-w-xl space-y-4">
	<form onsubmit={search} class="flex flex-col gap-3 sm:flex-row">
		<Input
			bind:value={phone}
			inputmode="tel"
			placeholder={t.finderPhonePlaceholder}
			class="min-h-11 flex-1"
			aria-label={t.finderPhoneLabel}
		/>
		<Button type="submit" disabled={find.isPending} class="min-h-11 w-full sm:w-auto">
			{#if find.isPending}
				<Loader2 class="size-4 animate-spin" aria-hidden="true" />
			{:else}
				<Search class="size-4" aria-hidden="true" />
			{/if}
			<span class="ml-2">{t.finderSearch}</span>
		</Button>
	</form>

	{#if error}
		<p class="text-sm text-destructive" role="alert">{error}</p>
	{/if}

	{#if searched && tickets.length === 0}
		<Card.Root>
			<Card.Content class="py-8 text-center text-sm text-muted-foreground">
				{t.finderNoTickets}
			</Card.Content>
		</Card.Root>
	{/if}

	{#each tickets as ticket (`${ticket.job_id}:${ticket.shift_id ?? ticket.shift_date}`)}
		<Card.Root>
			<Card.Header>
				<div class="flex items-start justify-between gap-2">
					<Card.Title class="min-w-0 text-base break-words"
						>{ticket.job_title || t.defaultJobTitle}</Card.Title
					>
					<Badge class="shrink-0" variant={ticket.status === 'confirmed' ? 'default' : 'secondary'}>
						{ticketStatusLabel(ticket.status, languageStore.current)}
					</Badge>
				</div>
				<Card.Description>
					{ticket.shelter_code}{ticket.shift_date ? ` · ${ticket.shift_date}` : ''}
				</Card.Description>
			</Card.Header>
			<Card.Footer class="flex-col items-stretch gap-2">
				<Button
					onclick={signIntoPortal}
					disabled={isEnteringPortal}
					variant="outline"
					class="w-full"
				>
					{#if isEnteringPortal}
						<Loader2 class="size-4 animate-spin" aria-hidden="true" />
					{/if}
					{t.finderOpenPortal}
				</Button>
				<!--
					Reached by phone number, so this signs in read-only. Cancelling needs the
					ticket link the applicant was given when they applied — a phone number is
					guessable and a withdrawn shift cannot be taken back.
				-->
				<p class="text-xs text-muted-foreground">
					{t.finderReadOnlyNote}
				</p>
			</Card.Footer>
		</Card.Root>
	{/each}
</div>
