<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ShelterScopeSelect from '$lib/components/shelter-scope-select.svelte';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PrintApiError } from '../data/printers.api';
	import {
		printerCreateInputSchema,
		type PrintHostKind,
		type PrinterSecretResponse
	} from '../domain/print-device.schema';
	import { PRINTERS_I18N } from '../domain/printers.i18n';
	import { useCreatePrinterDevice } from '../application/queries';

	let {
		open = $bindable(false),
		fixedShelterCode,
		oncreated
	}: {
		open?: boolean;
		/** `null` = system admin picks any shelter; a code = locked to that shelter. */
		fixedShelterCode: string | null;
		/** The one-time secret leaves through here; the page must not keep it past the reveal dialog. */
		oncreated: (created: PrinterSecretResponse) => void;
	} = $props();

	const t = $derived(getTranslation(PRINTERS_I18N, languageStore.current).admin);
	const createMutation = useCreatePrinterDevice();

	let deviceId = $state('');
	let name = $state('');
	let station = $state('');
	let hostKind = $state<PrintHostKind>('standalone');
	let pickedShelterCode = $state<string | undefined>(undefined);

	const shelterCode = $derived(fixedShelterCode ?? pickedShelterCode);

	function resetForm() {
		deviceId = '';
		name = '';
		station = '';
		hostKind = 'standalone';
		pickedShelterCode = undefined;
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) resetForm();
	}

	async function handleCreate() {
		if (!shelterCode) {
			toast.error(t.create.chooseShelter);
			return;
		}
		const parsed = printerCreateInputSchema.safeParse({
			device_id: deviceId.trim(),
			name,
			shelter_code: shelterCode.toUpperCase(),
			station: station.trim() || null,
			host_kind: hostKind
		});
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? t.create.invalid);
			return;
		}
		try {
			const created = await createMutation.mutateAsync(parsed.data);
			toast.success(t.create.success);
			handleOpenChange(false);
			oncreated(created);
		} catch (err) {
			toast.error(
				err instanceof PrintApiError && err.status === 409
					? t.create.conflict
					: err instanceof Error
						? err.message
						: t.create.failed
			);
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-[500px]">
		<Dialog.Header>
			<Dialog.Title class="text-xl font-bold">{t.create.title}</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				{t.create.description}
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4 py-4">
			<div class="grid gap-2">
				<Label for="printer-device-id" class="text-sm font-semibold">
					{t.create.deviceId} <span class="text-destructive">*</span>
				</Label>
				<Input
					id="printer-device-id"
					bind:value={deviceId}
					placeholder={t.create.deviceIdPlaceholder}
					autocomplete="off"
				/>
				<p class="text-xs text-muted-foreground">{t.create.deviceIdHint}</p>
			</div>

			<div class="grid gap-2">
				<Label for="printer-name" class="text-sm font-semibold">
					{t.create.name} <span class="text-destructive">*</span>
				</Label>
				<Input
					id="printer-name"
					bind:value={name}
					placeholder={t.create.namePlaceholder}
					maxlength={80}
				/>
			</div>

			{#if fixedShelterCode === null}
				<div class="grid gap-2">
					<span class="text-sm font-semibold">
						ศูนย์พักพิง <span class="text-destructive">*</span>
					</span>
					<ShelterScopeSelect
						allowedCodes={null}
						bind:value={pickedShelterCode}
						ariaLabel="ศูนย์พักพิงประจำเครื่องพิมพ์"
					/>
				</div>
			{/if}

			<div class="grid gap-2">
				<Label for="printer-station" class="text-sm font-semibold">{t.create.station}</Label>
				<Input
					id="printer-station"
					bind:value={station}
					placeholder={t.create.stationPlaceholder}
				/>
			</div>

			<div class="grid gap-2">
				<Label for="printer-host-kind" class="text-sm font-semibold">{t.create.hostKind}</Label>
				<select
					id="printer-host-kind"
					class="h-11 rounded-md border border-input bg-background px-3 text-sm"
					bind:value={hostKind}
				>
					<option value="standalone">{t.create.hostKinds.standalone}</option>
					<option value="kiosk">{t.create.hostKinds.kiosk}</option>
				</select>
			</div>
		</div>

		<Dialog.Footer class="gap-2 sm:gap-0">
			<Button variant="outline" onclick={() => handleOpenChange(false)}>{t.create.cancel}</Button>
			<Button onclick={handleCreate} disabled={createMutation.isPending}>
				{createMutation.isPending ? t.create.submitting : t.create.submit}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
