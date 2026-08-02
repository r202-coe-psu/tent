<script lang="ts">
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { Evacuee, Household } from '$lib/features/people';

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
		saving = true;
		try {
			await onSave({ householdId: householdId || null, setAsHead: !!householdId && setAsHead });
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
				<label class="block space-y-1.5 text-xs font-semibold text-foreground">
					ครัวเรือน
					<Select.Root type="single" value={selectedHouseholdValue} onValueChange={selectHousehold}>
						<Select.Trigger class="h-9 w-full">
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
				</label>

				<label
					class="flex items-center gap-3 rounded-md border border-border px-3 py-3 text-sm {householdId
						? 'cursor-pointer text-foreground'
						: 'cursor-not-allowed text-muted-foreground'}"
				>
					<input
						type="checkbox"
						bind:checked={setAsHead}
						disabled={!householdId}
						class="size-4 rounded border-input"
					/>
					ตั้งเป็นหัวหน้าครัวเรือน
				</label>
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
