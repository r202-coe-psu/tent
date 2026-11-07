<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatSaveFailureReport, type SaveFailureReport } from '$lib/utils/errors';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Copy from '@lucide/svelte/icons/copy';
	import X from '@lucide/svelte/icons/x';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { STATION1_REGISTRATION_I18N } from '../_constants/station1-registration.i18n';

	let {
		report,
		ondismiss
	}: {
		report: SaveFailureReport;
		ondismiss?: () => void;
	} = $props();

	const t = $derived(getTranslation(STATION1_REGISTRATION_I18N, langState.current).saveError);
	const detailText = $derived(formatSaveFailureReport(report));

	async function copyReport() {
		try {
			await navigator.clipboard.writeText(detailText);
			toast.success(t.copied);
		} catch {
			toast.error(t.copyFailed);
		}
	}
</script>

<Alert.Root variant="destructive" class="mb-6 border-destructive/40 bg-destructive/5">
	<CircleAlert class="size-4" />
	<Alert.Title class="flex items-start justify-between gap-3 font-semibold">
		<span>{report.summaryTh}</span>
		{#if ondismiss}
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="size-7 shrink-0 text-destructive hover:bg-destructive/10"
				onclick={ondismiss}
				aria-label={t.dismissAria}
			>
				<X class="size-4" />
			</Button>
		{/if}
	</Alert.Title>
	<Alert.Description class="space-y-3 text-destructive/90">
		<p class="text-sm">
			{t.note}
		</p>
		<pre
			class="max-h-48 overflow-auto rounded-md border border-destructive/20 bg-background/80 p-3 font-mono text-xs break-all whitespace-pre-wrap text-foreground">{detailText}</pre>
		<Button type="button" variant="outline" size="sm" class="gap-1.5" onclick={copyReport}>
			<Copy class="size-3.5" />
			{t.copy}
		</Button>
	</Alert.Description>
</Alert.Root>
