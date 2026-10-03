<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Search from '@lucide/svelte/icons/search';
	import User from '@lucide/svelte/icons/user';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input';
	import { PUBLIC_FAMILY_SEARCH_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { formatDate, getTranslation } from '$lib/utils/i18n';
	import { familySearch } from '../data/public-api';
	import { searchResultKey } from '../domain/mappers';
	import StayStatusChip from './stay-status-chip.svelte';
	import type { FamilySearchResult } from '../domain/types';

	interface Props {
		open?: boolean;
	}

	let { open = $bindable(false) }: Props = $props();

	const t = $derived(getTranslation(PUBLIC_FAMILY_SEARCH_I18N, langState.current));

	let query = $state('');
	let isLoading = $state(false);
	let results = $state<FamilySearchResult[] | null>(null);
	/** A server message when there is one; otherwise a copy key so it follows the language toggle. */
	let error = $state<{ message: string } | 'tooShort' | 'networkError' | null>(null);
	const errorText = $derived(
		error === null ? '' : typeof error === 'string' ? t[error] : error.message
	);

	async function performSearch() {
		if (query.trim().length < 3) {
			error = 'tooShort';
			return;
		}
		isLoading = true;
		error = null;
		results = null;

		try {
			const data = await familySearch(query.trim());
			results = data.results;
		} catch (e) {
			error = e instanceof Error && e.message ? { message: e.message } : 'networkError';
		} finally {
			isLoading = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void performSearch();
		}
	}

	function genderLabel(gender: string | null | undefined) {
		if (gender === 'male') return t.genderMale;
		if (gender === 'female') return t.genderFemale;
		return t.genderOther;
	}

	function formatDateTime(iso: string | null | undefined) {
		const formatted = formatDate(iso, langState.current, {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
		return formatted ? `${formatted}${t.timeSuffix}` : t.noTime;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-lg">
				<Search class="h-5 w-5 text-primary" />
				{t.title}
			</Dialog.Title>
			<Dialog.Description>
				{t.description}
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex gap-2">
			<Input
				bind:value={query}
				onkeydown={onKeydown}
				placeholder={t.placeholder}
				aria-label={t.queryAria}
			/>
			<Button type="button" onclick={performSearch} disabled={isLoading}>
				{isLoading ? t.searching : t.search}
			</Button>
		</div>

		{#if errorText}
			<p
				class="rounded-xl border border-danger/30 bg-danger-muted/40 p-3 text-sm text-danger"
				role="alert"
			>
				{errorText}
			</p>
		{/if}

		{#if results}
			{#if results.length === 0}
				<p class="rounded-xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">
					{t.noResults}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each results as result, index (searchResultKey(result, index))}
						<li class="rounded-xl border border-border p-4">
							<p class="flex items-center gap-2 text-sm font-bold text-foreground">
								<User class="h-4 w-4 text-muted-foreground" />
								{result.name}
								<span class="text-xs font-normal text-muted-foreground">
									({genderLabel(result.gender)})
								</span>
							</p>
							<p class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
								<MapPin class="h-3 w-3" />
								{result.shelter_name ?? t.noShelter}
							</p>
							<p class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
								<Clock class="h-3 w-3" />
								{formatDateTime(result.checked_in_at)}
							</p>
							{#if result.status}
								<p class="mt-2">
									<StayStatusChip status={result.status} size="sm" />
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
