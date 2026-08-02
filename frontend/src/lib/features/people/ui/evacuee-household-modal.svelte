<script lang="ts">
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		evacueeHouseholdEditFormSchema,
		type Evacuee,
		type Household
	} from '$lib/features/people';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';

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
	const form = superForm(defaults(initial, zod4(evacueeHouseholdEditFormSchema)), {
		SPA: true,
		validators: zod4(evacueeHouseholdEditFormSchema),
		resetForm: false
	});
	const { form: formData, validateForm } = form;

	const householdOptions = $derived(
		households.filter(
			(household) =>
				household._id === evacuee.household_id ||
				['pre_registered', 'arriving', 'checked_in'].includes(household.status)
		)
	);
	const noHouseholdValue = '__no_household__';
	const selectedHouseholdValue = $derived(householdId || noHouseholdValue);

	function selectHousehold(value: string | undefined) {
		householdId = value === noHouseholdValue ? '' : (value ?? '');
		if (!householdId) setAsHead = false;
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
					แก้ไขสังกัดครัวเรือน
				</h3>
				<button
					type="button"
					aria-label="ปิด"
					title="ปิด"
					onclick={onClose}
					class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X class="size-4" />
				</button>
			</header>

			<div class="space-y-4 p-5">
				<Form.Field {form} name="householdId">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ครัวเรือน</Form.Label>
							<Select.Root
								type="single"
								value={selectedHouseholdValue}
								onValueChange={selectHousehold}
							>
								<Select.Trigger {...props} class="!h-9 w-full rounded-md">
									{householdOptions.find((household) => household._id === householdId)?.label ??
										'ไม่สังกัดครัวเรือน'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value={noHouseholdValue} label="ไม่สังกัดครัวเรือน" />
									{#each householdOptions as household (household._id)}
										<Select.Item value={household._id} label={household.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						{/snippet}
					</Form.Control>
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
								ตั้งเป็นหัวหน้าครัวเรือน
							</Form.Label>
						{/snippet}
					</Form.Control>
				</Form.Field>
			</div>

			<footer class="flex justify-end gap-2 border-t border-border px-5 py-4">
				<Button type="button" variant="outline" onclick={onClose}>ยกเลิก</Button>
				<Button type="button" disabled={saving} onclick={save}>
					{saving ? 'กำลังบันทึก...' : 'บันทึกสังกัดครัวเรือน'}
				</Button>
			</footer>
		</div>
	</div>
{/if}
