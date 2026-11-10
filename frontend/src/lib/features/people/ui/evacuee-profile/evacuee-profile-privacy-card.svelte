<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Search from '@lucide/svelte/icons/search';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { CONSENT_BLOCK_I18N } from '$lib/features/consent';
	import type { AuthorContext } from '$lib/db/model';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { EVACUEE_PROFILE_I18N } from '../_constants/evacuee-profile.i18n';
	import type { Evacuee } from '../../domain/people';
	import { showingNeedsFullNotice } from '../../domain/search-visibility';
	import { useSetSearchVisibility } from '../../application/queries';

	let {
		evacuee,
		readonly,
		getAuthorContext
	}: {
		evacuee: Evacuee;
		readonly: boolean;
		getAuthorContext: () => AuthorContext;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_PROFILE_I18N, langState.current).privacyCard);
	const consent = $derived(getTranslation(CONSENT_BLOCK_I18N, langState.current));
	const mutation = useSetSearchVisibility();

	const visible = $derived(!evacuee.privacy?.search_excluded);
	let pending = $state<boolean | null>(null);
	const dialogOpen = $derived(pending !== null);
	const needsNotice = $derived(pending !== null && showingNeedsFullNotice(evacuee, pending));

	function confirm() {
		if (pending === null) return;
		const next = pending;
		let ctx: AuthorContext;
		try {
			ctx = getAuthorContext();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t.noCurrentUser);
			return;
		}
		mutation.mutate(
			{ evacueeId: evacuee._id, visible: next, ctx },
			{
				onSuccess: () => {
					toast.success(next ? t.shownToast : t.hiddenToast);
					pending = null;
				},
				onError: (err) => {
					toast.error(err instanceof Error ? err.message : t.saveFailed);
				}
			}
		);
	}
</script>

<section class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
	<div class="flex items-center gap-2.5 border-b border-slate-200/80 pb-2">
		<Search class="size-4.5 text-[#0A2647]" />
		<h3 class="text-base font-bold text-slate-900">{t.title}</h3>
	</div>
	<div class="flex items-center justify-between gap-4">
		<div class="min-w-0 space-y-0.5">
			<Label for="search-visibility" class="text-sm font-semibold text-slate-700">
				{t.searchLabel}
			</Label>
			<p class="text-sm text-slate-500">
				{visible ? t.visibleHint : t.hiddenHint}
			</p>
		</div>
		<Switch
			id="search-visibility"
			disabled={readonly || mutation.isPending}
			bind:checked={() => visible, (next) => (pending = next)}
		/>
	</div>
</section>

<AlertDialog.Root
	bind:open={() => dialogOpen, (open) => !open && !mutation.isPending && (pending = null)}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{pending ? t.showTitle : t.hideTitle}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{t.confirmDescription}
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if needsNotice}
			<div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
				<p class="font-semibold text-slate-900">{consent.heading}</p>
				<p class="text-slate-700">{consent.main.full}</p>
				<p class="text-slate-700">{consent.search.full}</p>
				<p class="text-slate-500">
					{t.consentChange(consent.summary.modeFull)}
				</p>
			</div>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={mutation.isPending}>{t.cancel}</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={(e) => {
					e.preventDefault();
					confirm();
				}}
				disabled={mutation.isPending}
			>
				{mutation.isPending ? t.saving : needsNotice ? t.acknowledgeAndConfirm : t.confirm}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
