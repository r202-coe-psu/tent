<script lang="ts">
	/** Shows a printer's Device Secret ONCE (after create / rotate); the page drops it on close. */
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import Key from '@lucide/svelte/icons/key';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import type { PrinterAdminSummary } from '../domain/print-device.schema';
	import { PRINTERS_I18N } from '../domain/printers.i18n';

	let {
		open = $bindable(false),
		device = null,
		secret = null,
		reason = 'created',
		onclose
	}: {
		open?: boolean;
		device?: PrinterAdminSummary | null;
		secret?: string | null;
		reason?: 'created' | 'rotated';
		/** The dialog closed: the page should drop the plaintext secret it handed in. */
		onclose?: () => void;
	} = $props();

	const t = $derived(getTranslation(PRINTERS_I18N, languageStore.current).admin.reveal);

	let copied = $state(false);
	let copiedEnv = $state(false);

	const deploymentBaseUrl = $derived(
		typeof window === 'undefined' ? 'https://<deployment-host>' : window.location.origin
	);
	const envSnippet = $derived(
		device && secret
			? `TENT_BASE_URL=${deploymentBaseUrl}\nDEVICE_ID=${device.device_id}\nDEVICE_SECRET=${secret}\nPRINTER_NAME=tent_xprinter`
			: ''
	);

	function handleOpenChange(next: boolean) {
		open = next;
		if (next) return;
		copied = false;
		copiedEnv = false;
		onclose?.();
	}

	async function copy(text: string, done: string, mark: () => void) {
		try {
			await navigator.clipboard.writeText(text);
			mark();
			toast.success(done);
		} catch {
			toast.error(t.copyFailed);
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-h-[90dvh] gap-3 overflow-y-auto sm:max-w-[560px]">
		<Dialog.Header>
			<Dialog.Title
				class="flex items-center gap-2 text-xl font-bold {reason === 'created'
					? 'text-emerald-600'
					: 'text-foreground'}"
			>
				<Key class="h-5 w-5 text-primary" />
				<span>{reason === 'created' ? t.createdTitle : t.rotatedTitle}</span>
			</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">{t.description}</Dialog.Description>
		</Dialog.Header>

		{#if device && secret}
			<div class="min-w-0 space-y-4 py-2">
				<div class="rounded-xl border border-sky-200 bg-sky-50 p-3.5 text-sm text-sky-900">
					<div class="flex items-start gap-2">
						<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
						<div>
							<p class="font-semibold">{t.warningTitle}</p>
							<p class="mt-0.5 leading-relaxed">{t.warning}</p>
						</div>
					</div>
				</div>

				<div class="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
					<p class="font-mono font-semibold break-all text-foreground">{device.device_id}</p>
					<p class="text-xs text-muted-foreground">{device.name} · {device.shelter_code}</p>
				</div>

				<div class="space-y-1.5">
					<label for="printer-device-secret" class="text-sm font-semibold text-slate-700">
						{t.secretLabel}
					</label>
					<div class="flex flex-col gap-2 sm:flex-row">
						<Input
							id="printer-device-secret"
							readonly
							value={secret}
							class="min-w-0 flex-1 bg-slate-50 font-mono text-xs select-all"
						/>
						<Button
							variant="outline"
							size="sm"
							class="min-h-11 shrink-0 gap-1.5 sm:min-h-9"
							onclick={() =>
								copy(secret, t.copySecretDone, () => {
									copied = true;
									setTimeout(() => (copied = false), 2000);
								})}
						>
							{#if copied}
								<Check class="h-4 w-4 text-emerald-500" />
							{:else}
								<Copy class="h-4 w-4" />
							{/if}
							<span>{t.copy}</span>
						</Button>
					</div>
				</div>

				<div class="space-y-1.5">
					<div class="flex flex-wrap items-center justify-between gap-1">
						<span class="text-xs font-semibold text-muted-foreground">{t.envLabel}</span>
						<Button
							variant="ghost"
							size="sm"
							class="min-h-11 gap-1 text-xs"
							onclick={() =>
								copy(envSnippet, t.copyEnvDone, () => {
									copiedEnv = true;
									setTimeout(() => (copiedEnv = false), 2000);
								})}
						>
							{#if copiedEnv}
								<Check class="h-3.5 w-3.5 text-emerald-500" />
							{:else}
								<Copy class="h-3.5 w-3.5" />
							{/if}
							<span>{t.copyEnv}</span>
						</Button>
					</div>
					<pre
						class="max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs break-all whitespace-pre-wrap text-slate-800">{envSnippet}</pre>
				</div>
			</div>
		{/if}

		<Dialog.Footer>
			<Button class="w-full sm:w-auto" onclick={() => handleOpenChange(false)}>{t.close}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
