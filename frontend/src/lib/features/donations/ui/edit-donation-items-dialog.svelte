<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { usePublicShelterNeeds, useUpdateDonationItems } from '../application/queries';
	import type { DonationItemEdit } from '../data/public-tracking';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

	let {
		open = $bindable(false),
		token,
		shelterCode,
		items,
		onSaved
	}: {
		open?: boolean;
		token: string;
		/** Which shelter's published needs the donor may add from. */
		shelterCode: string;
		items: Array<{
			item_id?: string | null;
			item_name?: string;
			qty: unknown;
			unit?: string | null;
		}>;
		onSaved?: () => void;
	} = $props();

	type Row = { item_id?: string; free_text: string; qty: string; unit: string };

	/**
	 * What the donor may ADD. Typing a name by hand produced a line with no `item_id`,
	 * and such a line holds no quota and is dropped at intake (`toCountedItems` keeps
	 * only catalog lines) — so the goods could arrive with nothing to receive them
	 * against. Picking from the shelter's own board carries the id and the unit.
	 */
	const needsQuery = usePublicShelterNeeds(() => shelterCode);
	const shelterNeeds = $derived(needsQuery.data ?? []);
	/** Needs not already on this booking — the same item twice is not an edit. */
	const availableNeeds = $derived(
		shelterNeeds.filter((need) => !rows.some((row) => row.item_id === need.item_id))
	);

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));

	// A draft the donor edits, seeded once at mount. The caller renders this component
	// only while the dialog is open, so every open starts from the current booking and
	// an abandoned edit cannot linger into the next one — no $effect syncing props into
	// state, which would fight the user's own typing.
	// untrack because reading `items` once is the point: this is a draft, not a mirror.
	// Tracking it would overwrite whatever the donor has typed the moment a refetch lands.
	let rows = $state<Row[]>(
		untrack(() =>
			items.map((item) => ({
				item_id: item.item_id ?? undefined,
				free_text: item.item_name ?? '',
				qty: item.qty != null ? String(item.qty) : '',
				unit: item.unit ?? ''
			}))
		)
	);

	const mutation = useUpdateDonationItems();

	const canSave = $derived(
		rows.length > 0 &&
			rows.every((row) => row.free_text.trim() && Number(row.qty) > 0 && row.unit.trim())
	);

	function addRow() {
		rows = [...rows, { free_text: '', qty: '', unit: '' }];
	}

	/** Bind a blank row to a catalog item: name and unit come from the board, not typing. */
	function pickNeed(index: number, itemId: string) {
		const need = shelterNeeds.find((n) => n.item_id === itemId);
		const row = rows[index];
		if (!need || !row) return;
		row.item_id = need.item_id;
		row.free_text = need.name;
		row.unit = need.unit;
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}

	function save() {
		const payload: DonationItemEdit[] = rows.map((row) => ({
			...(row.item_id ? { item_id: row.item_id } : {}),
			free_text: row.free_text.trim(),
			qty: String(Number(row.qty)),
			unit: row.unit.trim()
		}));

		mutation.mutate(
			{ token, items: payload },
			{
				onSuccess: () => {
					toast.success(t.editSuccessToast);
					open = false;
					onSaved?.();
				},
				onError: (err) => toast.error(err instanceof Error ? err.message : t.editFailToast)
			}
		);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{t.editDialogTitle}</Dialog.Title>
			<Dialog.Description>
				{t.editDialogDesc}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3">
			{#each rows as row, index (index)}
				<div class="flex items-end gap-2 rounded-2xl border border-border bg-card p-3">
					<div class="min-w-0 flex-1 space-y-1">
						<label class="text-2xs font-bold text-muted-foreground uppercase" for="name-{index}">
							{row.item_id || shelterNeeds.length > 0 ? t.editPickItemLabel : t.editItemLabel}
						</label>
						{#if row.item_id}
							<!-- Bound to a catalog item: the name and unit are the shelter's, not
							     free text, so they are shown rather than edited. Swap the item by
							     removing the line and adding it again. -->
							<div
								class="flex h-9 items-center rounded-xl border border-border/60 bg-muted/40 px-3 text-xs font-medium text-foreground"
							>
								{row.free_text}
							</div>
						{:else if shelterNeeds.length > 0}
							<select
								id="name-{index}"
								value={row.item_id ?? ''}
								onchange={(e) => pickNeed(index, e.currentTarget.value)}
								class="h-9 w-full rounded-xl border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
							>
								<option value="">{t.editPickItemPlaceholder}</option>
								{#each availableNeeds as need (need.item_id)}
									<option value={need.item_id}>{need.name} ({need.unit})</option>
								{/each}
							</select>
						{:else}
							<!-- No published needs to pick from — let the donor describe the item
							     rather than block the edit; staff review it at intake. -->
							<Input
								id="name-{index}"
								bind:value={row.free_text}
								placeholder={t.editItemPlaceholder}
								class="h-9 rounded-xl text-xs"
							/>
						{/if}
					</div>
					<div class="w-20 space-y-1">
						<label class="text-2xs font-bold text-muted-foreground uppercase" for="qty-{index}">
							{t.editQtyLabel}
						</label>
						<Input
							id="qty-{index}"
							type="number"
							min="0"
							step="any"
							bind:value={row.qty}
							class="h-9 rounded-xl text-xs"
						/>
					</div>
					<div class="w-20 space-y-1">
						<label class="text-2xs font-bold text-muted-foreground uppercase" for="unit-{index}">
							{t.editUnitLabel}
						</label>
						{#if row.item_id}
							<!-- schema.md §2.1: a line carrying an `item_id` must use that item's
							     base unit, or the intake counter refuses it (CATALOG_MISMATCH). -->
							<div
								class="flex h-9 items-center justify-center rounded-xl border border-border/60 bg-muted/40 px-2 text-xs font-medium text-muted-foreground"
							>
								{row.unit || '—'}
							</div>
						{:else}
							<Input
								id="unit-{index}"
								bind:value={row.unit}
								placeholder={t.editUnitPlaceholder}
								class="h-9 rounded-xl text-xs"
							/>
						{/if}
					</div>
					<Button
						variant="ghost"
						size="icon"
						class="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
						aria-label={t.editDeleteItemAria.replace('{name}', row.free_text || String(index + 1))}
						disabled={rows.length === 1}
						onclick={() => removeRow(index)}
					>
						<Trash2 class="h-4 w-4" />
					</Button>
				</div>
			{/each}

			<Button
				variant="outline"
				class="h-9 w-full rounded-xl text-xs font-bold"
				disabled={shelterNeeds.length > 0 &&
					availableNeeds.length === 0 &&
					rows.every((row) => row.item_id)}
				onclick={addRow}
			>
				<Plus class="h-4 w-4" />
				{t.editAddItemBtn}
			</Button>

			<p class="text-2xs leading-relaxed text-muted-foreground">
				{#if shelterNeeds.length === 0}
					{t.editNoNeedsHint}
				{:else if availableNeeds.length === 0}
					{t.editAllNeedsChosenHint}
				{:else}
					{t.editPickItemHint}
				{/if}
			</p>
		</div>

		<Dialog.Footer>
			<Button
				variant="outline"
				class="rounded-xl text-xs font-bold"
				disabled={mutation.isPending}
				onclick={() => (open = false)}
			>
				{t.editCancelBtn}
			</Button>
			<Button
				class="rounded-xl text-xs font-bold"
				disabled={!canSave || mutation.isPending}
				onclick={save}
			>
				{mutation.isPending ? t.editSaving : t.editSaveBtn}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
