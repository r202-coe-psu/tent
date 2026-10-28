<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import { Badge } from '$lib/components/ui/badge';
	import { PUBLIC_SEARCH_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { isShelterClosed } from '../domain/mappers';
	import type { FamilySearchResult } from '../domain/types';

	interface Props {
		shelterStatus: FamilySearchResult['shelter_status'];
	}

	const { shelterStatus }: Props = $props();

	const t = $derived(getTranslation(PUBLIC_SEARCH_I18N, langState.current));
</script>

{#if isShelterClosed({ shelter_status: shelterStatus })}
	<Badge variant="outline" class="border-slate-300 bg-slate-100 font-semibold text-slate-700">
		<Lock aria-hidden="true" />
		{t.shelterClosed}
	</Badge>
{/if}
