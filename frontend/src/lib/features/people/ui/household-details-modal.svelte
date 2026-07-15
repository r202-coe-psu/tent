<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { SearchSelect } from '$lib/components/ui/search-select/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		householdBasicInfoFormSchema,
		type Household,
		type HouseholdBasicInfoForm
	} from '../domain/people';

	let {
		show,
		household,
		municipalityZoneItems = [],
		communityItems = [],
		onClose,
		onSave
	}: {
		show: boolean;
		household: Household;
		municipalityZoneItems: { value: string; label: string }[];
		communityItems: { value: string; label: string }[];
		onClose: () => void;
		onSave: (data: HouseholdBasicInfoForm) => Promise<void>;
	} = $props();

	const form = superForm(defaults(zod4(householdBasicInfoFormSchema)), {
		SPA: true,
		validators: zod4(householdBasicInfoFormSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;
			await onSave(form.data);
		}
	});

	const { form: formData, submitting } = form;

	// SearchSelect binds a plain string; bridge to the schema's nullable field (mirrors
	// household-form-location-section.svelte).
	let mzVal = $state('');
	let commVal = $state('');

	let initialized = $state(false);
	$effect(() => {
		if (initialized) return;
		initialized = true;
		$formData = {
			...$formData,
			label: household.label,
			notes: household.notes ?? ''
		};
		mzVal = household.municipality_zone ?? '';
		commVal = household.community ?? '';
	});

	$effect(() => {
		$formData.municipality_zone = mzVal || null;
	});
	$effect(() => {
		$formData.community = commVal || null;
	});
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-lg animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					แก้ไขข้อมูลทั่วไปครัวเรือน (Basic Info)
				</h3>
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<form method="POST" use:form.enhance class="space-y-4">
				<Field.FieldGroup>
					<Form.Field {form} name="label">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชื่อเรียกครัวเรือน <span class="text-destructive">*</span></Form.Label>
								<Input {...props} bind:value={$formData.label} placeholder="เช่น ครอบครัวใจดี" />
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<div class="grid grid-cols-2 gap-4">
						<Form.Field {form} name="municipality_zone">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>เขตเทศบาล (Zone)</Form.Label>
									<SearchSelect
										items={municipalityZoneItems}
										bind:value={mzVal}
										placeholder="เลือกเขตเทศบาล..."
										emptyText="ไม่พบเขตเทศบาล"
										controlProps={props}
										class="h-9"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
						<Form.Field {form} name="community">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ชุมชนในศูนย์ (Community)</Form.Label>
									<SearchSelect
										items={communityItems}
										bind:value={commVal}
										placeholder="เลือกชุมชน..."
										emptyText="ไม่พบชุมชน"
										controlProps={props}
										class="h-9"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<Form.Field {form} name="notes">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>หมายเหตุเพิ่มเติม</Form.Label>
								<Textarea
									{...props}
									bind:value={$formData.notes}
									placeholder="ระบุรายละเอียดเพิ่มเติม..."
									rows={3}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</Field.FieldGroup>

				<div class="flex justify-end gap-2 border-t border-border pt-4">
					<Button type="button" variant="outline" onclick={onClose}>ยกเลิก</Button>
					<Form.Button disabled={$submitting}>บันทึกข้อมูล</Form.Button>
				</div>
			</form>
		</div>
	</div>
{/if}
