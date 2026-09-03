<script lang="ts">
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		evacueeAssetsEditFormSchema,
		type Household,
		type PetGroup,
		type HouseholdVehicle
	} from '$lib/features/people';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import PetAssetVehicleFields from './forms/pet-asset-vehicle-fields.svelte';

	let {
		show,
		household,
		onClose,
		onSave
	}: {
		show: boolean;
		household: Household;
		onClose: () => void;
		onSave: (data: {
			vehicles: HouseholdVehicle[];
			valuables: string;
			pets: PetGroup[];
		}) => Promise<void>;
	} = $props();

	let vehicles = $state<HouseholdVehicle[]>(
		untrack(() =>
			(household.vehicles ?? []).map((v) => ({
				type: v.type,
				license_plate: v.license_plate ?? ''
			}))
		)
	);
	let valuables = $state(untrack(() => household.assets?.description ?? ''));
	let petsList = $state<PetGroup[]>(
		untrack(() => (household.pets ? JSON.parse(JSON.stringify(household.pets)) : []))
	);
	let saving = $state(false);

	const form = superForm(
		defaults(
			untrack(() => ({
				vehicles: vehicles.map((v) => ({
					type: v.type,
					license_plate: v.license_plate || null
				})),
				valuables,
				pets: petsList
			})),
			zod4(evacueeAssetsEditFormSchema)
		),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4(evacueeAssetsEditFormSchema),
			resetForm: false
		}
	);
	const { form: formData, validateForm } = form;

	$effect(() => {
		if (!show) return;
		vehicles = (household.vehicles ?? []).map((v) => ({
			type: v.type,
			license_plate: v.license_plate ?? ''
		}));
		valuables = household.assets?.description ?? '';
		petsList = household.pets ? JSON.parse(JSON.stringify(household.pets)) : [];
	});

	async function save() {
		$formData = {
			vehicles: vehicles.map((v) => ({
				type: v.type,
				license_plate: v.license_plate ? v.license_plate.trim() || null : null
			})),
			valuables,
			pets: petsList
		};
		const validation = await validateForm({ update: true, focusOnError: true });
		if (!validation.valid || saving) return;
		saving = true;
		try {
			await onSave(validation.data);
		} finally {
			saving = false;
		}
	}
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-xl animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					แก้ไขทรัพย์สินและสัตว์เลี้ยง (Assets &amp; Pets)
				</h3>
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="max-h-[460px] overflow-y-auto pr-1">
				<PetAssetVehicleFields
					bind:vehicles
					bind:valuables
					bind:pets={petsList}
					disabled={saving}
				/>
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-4">
				<Button variant="outline" onclick={onClose} disabled={saving}>ยกเลิก</Button>
				<Button type="button" disabled={saving} onclick={save}>
					{saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
				</Button>
			</div>
		</div>
	</div>
{/if}
