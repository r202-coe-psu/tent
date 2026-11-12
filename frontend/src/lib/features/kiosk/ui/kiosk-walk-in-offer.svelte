<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_WALK_IN_I18N } from './_constants/kiosk-walk-in.i18n';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';
	import KioskNoticePanel from './kiosk-notice-panel.svelte';

	interface Props {
		/** What the details come from: the card in the reader, or the ThaiD scan. */
		source?: 'smart-card' | 'thaid';
		isLookingUp: boolean;
		retryAfterSeconds: number;
		onregister: () => void;
		onretry: () => void;
	}

	let {
		source = 'smart-card',
		isLookingUp,
		retryAfterSeconds,
		onregister,
		onretry
	}: Props = $props();

	const t = $derived(getTranslation(KIOSK_WALK_IN_I18N, languageStore.current).offer);
</script>

<!--
	A card with no pre-registration is not an error: this is the way in for people who walked in.
	Registering here is the one obvious next step; searching again stays available but quiet.
-->
<KioskNoticePanel tone="info" icon={UserPlus} title={t.title} data-testid="kiosk-walk-in-offer">
	<p>
		{#if source === 'thaid'}
			{t.fromThaid}
		{:else}
			{t.fromCard}
		{/if}
		{t.afterwards}
	</p>
	{#snippet actions()}
		<Button type="button" onclick={onregister} class={KIOSK_NOTICE_PRIMARY_ACTION}>
			<UserPlus aria-hidden="true" />{t.register}<ChevronRight aria-hidden="true" />
		</Button>
		<Button
			type="button"
			variant="outline"
			disabled={isLookingUp || retryAfterSeconds > 0}
			onclick={onretry}
			class={KIOSK_NOTICE_SECONDARY_ACTION}
		>
			{#if retryAfterSeconds > 0}
				{t.retryInBefore} <span class="tabular-nums">{retryAfterSeconds}</span> {t.retryInAfter}
			{:else if isLookingUp}
				{t.searching}
			{:else}
				{t.retry}
			{/if}
		</Button>
	{/snippet}
</KioskNoticePanel>
