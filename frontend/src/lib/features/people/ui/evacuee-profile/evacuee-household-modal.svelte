<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import X from '@lucide/svelte/icons/x';
	import Search from '@lucide/svelte/icons/search';
	import Scan from '@lucide/svelte/icons/scan';
	import Loader from '@lucide/svelte/icons/loader';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import {
		evacueeHouseholdEditFormSchema,
		formatPersonName,
		isActiveHouseholdStatus,
		peopleRepository,
		useSearchEvacuees,
		type Evacuee,
		type Household
	} from '$lib/features/people';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { EVACUEE_PROFILE_MODALS_I18N } from '../_constants/evacuee-profile-modals.i18n';
	import ModalEscapeListener from '../shared/modal-escape-listener.svelte';
	import EvacueeQrSearchModal from '../search-scan/evacuee-qr-search-modal.svelte';

	export type EvacueeHouseholdEditData = {
		householdId: string | null;
		setAsHead: boolean;
	};

	let {
		show,
		evacuee,
		households,
		onClose,
		onSave
	}: {
		show: boolean;
		evacuee: Evacuee;
		households: Household[];
		onClose: () => void;
		onSave: (data: EvacueeHouseholdEditData) => Promise<void>;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_PROFILE_MODALS_I18N, langState.current).household);

	const initial = untrack(() => ({
		householdId: evacuee.household_id ?? '',
		setAsHead: evacuee.household_id
			? households.find((household) => household._id === evacuee.household_id)?.head_evacuee_id ===
				evacuee._id
			: false
	}));

	let householdId = $state(initial.householdId);
	let setAsHead = $state(initial.setAsHead);
	let saving = $state(false);
	let lastOpenedEvacueeId = $state<string | null>(null);
	let showQrModal = $state(false);
	let searchQueryText = $state('');
	let debouncedSearchQuery = $state('');
	let debounceTimer: ReturnType<typeof setTimeout>;

	const form = superForm(defaults(initial, zod4(evacueeHouseholdEditFormSchema)), {
		SPA: true,
		validators: zod4(evacueeHouseholdEditFormSchema),
		resetForm: false
	});
	const { form: formData, validateForm } = form;

	$effect(() => {
		if (!show) {
			lastOpenedEvacueeId = null;
			searchQueryText = '';
			debouncedSearchQuery = '';
			showQrModal = false;
			return;
		}
		if (lastOpenedEvacueeId === evacuee._id) return;

		const nextHouseholdId = evacuee.household_id ?? '';
		householdId = nextHouseholdId;
		setAsHead = nextHouseholdId
			? households.find((household) => household._id === nextHouseholdId)?.head_evacuee_id ===
				evacuee._id
			: false;
		$formData = { householdId, setAsHead };
		lastOpenedEvacueeId = evacuee._id;
		searchQueryText = '';
		debouncedSearchQuery = '';
	});

	$effect(() => {
		const q = searchQueryText.trim();
		clearTimeout(debounceTimer);
		if (!q) {
			debouncedSearchQuery = '';
			return;
		}
		debounceTimer = setTimeout(() => {
			debouncedSearchQuery = q;
		}, 300);
		return () => clearTimeout(debounceTimer);
	});

	const searchEvacueesQuery = useSearchEvacuees(
		() => debouncedSearchQuery,
		() => !!debouncedSearchQuery
	);
	const searchResults = $derived(searchEvacueesQuery.data ?? []);
	const isSearching = $derived(searchEvacueesQuery.isFetching && !!debouncedSearchQuery);

	function isJoinableHousehold(household: Household | undefined): household is Household {
		if (!household) return false;
		return household._id === evacuee.household_id || isActiveHouseholdStatus(household.status);
	}

	const joinableHouseholdIds = $derived(
		new Set(households.filter(isJoinableHousehold).map((household) => household._id))
	);

	const householdHits = $derived(
		searchResults.filter((hit) => !!hit.household_id && joinableHouseholdIds.has(hit.household_id))
	);

	const selectedHousehold = $derived(
		householdId ? (households.find((household) => household._id === householdId) ?? null) : null
	);
	const selectedHouseholdLabel = $derived(
		selectedHousehold?.label ?? (householdId ? householdId : t.noHousehold)
	);

	function householdLabelFor(id: string): string {
		return households.find((household) => household._id === id)?.label ?? id;
	}

	function selectHouseholdId(nextId: string) {
		householdId = nextId;
		if (!householdId) setAsHead = false;
	}

	function clearAffiliation() {
		selectHouseholdId('');
		searchQueryText = '';
		debouncedSearchQuery = '';
	}

	function selectHit(hit: Evacuee) {
		if (!hit.household_id) return;
		selectHouseholdId(hit.household_id);
		searchQueryText = '';
		debouncedSearchQuery = '';
	}

	async function handleQrFound(foundEvacueeId: string) {
		showQrModal = false;
		try {
			const found = await peopleRepository().getEvacuee(foundEvacueeId);
			if (!found) {
				toast.error(t.qrNotFound);
				return;
			}
			if (!found.household_id) {
				toast.error(t.noHouseholdFor(formatPersonName(found)));
				return;
			}
			let household = households.find((h) => h._id === found.household_id);
			if (!household) {
				household = (await peopleRepository().getHousehold(found.household_id)) ?? undefined;
			}
			if (!isJoinableHousehold(household)) {
				toast.error(t.cannotJoin);
				return;
			}
			selectHouseholdId(found.household_id);
			toast.success(t.selectedHousehold(household.label));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t.qrReadError);
		}
	}

	async function save() {
		$formData = { householdId, setAsHead };
		const validation = await validateForm({ update: true, focusOnError: true });
		if (!validation.valid) return;
		saving = true;
		try {
			await onSave({
				householdId: validation.data.householdId || null,
				setAsHead: !!validation.data.householdId && validation.data.setAsHead
			});
		} finally {
			saving = false;
		}
	}
</script>

{#if show}
	<ModalEscapeListener open={show} disabled={saving || showQrModal} onEscape={onClose} />
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="household-modal-title"
			class="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
		>
			<header class="flex items-start justify-between border-b border-border px-5 py-4">
				<h3 id="household-modal-title" class="text-base font-bold text-foreground">
					{t.title}
				</h3>
				<button
					type="button"
					aria-label={t.close}
					title={t.close}
					onclick={onClose}
					class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X class="size-4" />
				</button>
			</header>

			<div class="space-y-4 p-5">
				<Form.Field {form} name="householdId">
					<Form.Label>{t.household}</Form.Label>

					<div
						class="rounded-md border px-3 py-2.5 text-sm {householdId
							? 'border-primary/40 bg-primary-muted/40 text-foreground'
							: 'border-border bg-muted/30 text-muted-foreground'}"
					>
						<p class="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
							{t.selectedAffiliation}
						</p>
						<p class="mt-0.5 font-semibold">{selectedHouseholdLabel}</p>
					</div>

					<div class="mt-3 flex gap-2">
						<div class="relative flex-1">
							{#if isSearching}
								<Loader
									class="absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
								/>
							{:else}
								<Search
									class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
								/>
							{/if}
							<Input
								type="text"
								placeholder={t.searchPlaceholder}
								bind:value={searchQueryText}
								class="h-9 pl-9"
								disabled={saving}
							/>
						</div>
						<Button
							type="button"
							variant="outline"
							class="h-9 shrink-0 px-3 text-xs font-semibold"
							disabled={saving}
							onclick={() => (showQrModal = true)}
						>
							<Scan class="mr-1.5 size-4" />
							{t.scanQr}
						</Button>
					</div>

					<div class="mt-2 space-y-2">
						{#if isSearching}
							<p class="py-3 text-center text-xs text-muted-foreground">{t.searching}</p>
						{:else if debouncedSearchQuery && householdHits.length === 0}
							<p class="py-3 text-center text-xs text-muted-foreground">
								{t.noJoinableMembers}
							</p>
						{:else if householdHits.length > 0}
							<ul class="max-h-48 space-y-1.5 overflow-y-auto pr-1">
								{#each householdHits as hit (hit._id)}
									{@const hitHouseholdId = hit.household_id}
									{#if hitHouseholdId}
										<li>
											<button
												type="button"
												class="w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 {householdId ===
												hitHouseholdId
													? 'border-primary bg-primary-muted/50'
													: 'border-border'}"
												onclick={() => selectHit(hit)}
											>
												<span class="font-semibold text-foreground">{formatPersonName(hit)}</span>
												{#if hit.phone}
													<span class="text-muted-foreground"> · {hit.phone}</span>
												{/if}
												<p class="mt-0.5 text-2xs text-muted-foreground">
													{t.hitHousehold(householdLabelFor(hitHouseholdId))}
												</p>
											</button>
										</li>
									{/if}
								{/each}
							</ul>
						{/if}
					</div>

					<Button
						type="button"
						variant="outline"
						size="sm"
						class="mt-2 h-8 w-full text-xs {!householdId
							? 'border-primary bg-primary-muted/40 font-semibold'
							: ''}"
						disabled={saving}
						onclick={clearAffiliation}
					>
						{t.noHousehold}
					</Button>

					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="setAsHead">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label
								class="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-3 text-sm {householdId
									? 'text-foreground'
									: 'cursor-not-allowed text-muted-foreground'}"
							>
								<Checkbox {...props} bind:checked={setAsHead} disabled={!householdId} />
								{t.setAsHead}
							</Form.Label>
						{/snippet}
					</Form.Control>
				</Form.Field>
			</div>

			<footer class="flex justify-end gap-2 border-t border-border px-5 py-4">
				<Button type="button" variant="outline" onclick={onClose}>{t.cancel}</Button>
				<Button type="button" disabled={saving} onclick={save}>
					{saving ? t.saving : t.save}
				</Button>
			</footer>
		</div>
	</div>
{/if}

<EvacueeQrSearchModal
	show={showQrModal}
	onClose={() => (showQrModal = false)}
	onFound={handleQrFound}
/>
