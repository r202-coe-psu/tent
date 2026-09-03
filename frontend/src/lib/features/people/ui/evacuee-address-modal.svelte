<script lang="ts">
	import { untrack } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { evacueeAddressEditFormSchema, type Household } from '$lib/features/people';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import HouseholdAddressFields from './forms/household-address-fields.svelte';

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
			addressNo: string;
			villageNo: string;
			subdistrict: string;
			district: string;
			province: string;
			postalCode: string;
		}) => Promise<void>;
	} = $props();

	let addressNo = $state(untrack(() => household.address_no ?? ''));
	let villageNo = $state(untrack(() => household.village_no ?? ''));
	let subdistrict = $state(untrack(() => household.subdistrict ?? ''));
	let district = $state(untrack(() => household.district ?? ''));
	let province = $state(untrack(() => household.province ?? ''));
	let postalCode = $state(untrack(() => household.postal_code ?? ''));
	let formError = $state('');
	let saving = $state(false);

	const form = superForm(
		defaults(
			untrack(() => ({ addressNo, villageNo, province, district, subdistrict, postalCode })),
			zod4(evacueeAddressEditFormSchema)
		),
		{
			SPA: true,
			validators: zod4(evacueeAddressEditFormSchema),
			resetForm: false,
			onSubmit: () => {
				$formData = { addressNo, villageNo, province, district, subdistrict, postalCode };
			},
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid || saving) return;
				saving = true;
				formError = '';
				try {
					await onSave({ ...validated.data });
				} catch (error) {
					formError = error instanceof Error ? error.message : 'บันทึกข้อมูลไม่สำเร็จ';
				} finally {
					saving = false;
				}
			}
		}
	);
	const { form: formData, errors } = form;

	// Rehydrate when the modal opens or the parent switches to another household.
	$effect(() => {
		if (!show) return;
		addressNo = household.address_no ?? '';
		villageNo = household.village_no ?? '';
		subdistrict = household.subdistrict ?? '';
		district = household.district ?? '';
		province = household.province ?? '';
		postalCode = household.postal_code ?? '';
		formError = '';
	});
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-2xl animate-in overflow-hidden rounded-lg border border-border bg-card shadow-xl duration-150 zoom-in-95 fade-in"
			aria-label="แก้ไขที่อยู่ครอบครัว"
			aria-modal="true"
			role="dialog"
		>
			<form method="POST" use:form.enhance>
				<header
					class="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6"
				>
					<div class="min-w-0">
						<h2 class="text-lg font-bold text-foreground">แก้ไขที่อยู่ครอบครัว</h2>
					</div>
					<button
						type="button"
						class="-mt-1 -mr-2 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
						onclick={onClose}
						disabled={saving}
						aria-label="ปิด"
					>
						<X class="size-5" />
					</button>
				</header>

				<div class="max-h-[min(68vh,560px)] space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
					<HouseholdAddressFields
						bind:address_no={addressNo}
						bind:village_no={villageNo}
						bind:province
						bind:district
						bind:subdistrict
						bind:postal_code={postalCode}
						disabled={saving}
						errors={{
							address_no: $errors.addressNo?.[0],
							village_no: $errors.villageNo?.[0],
							province: $errors.province?.[0],
							district: $errors.district?.[0],
							subdistrict: $errors.subdistrict?.[0],
							postal_code: $errors.postalCode?.[0]
						}}
					/>

					{#if formError}
						<p
							class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{formError}
						</p>
					{/if}
				</div>

				<footer class="flex justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
					<Button type="button" variant="outline" onclick={onClose} disabled={saving}>ยกเลิก</Button
					>
					<Button type="submit" disabled={saving}>
						{#if saving}
							<LoaderCircle class="size-4 animate-spin" />
							กำลังบันทึก...
						{:else}
							บันทึกข้อมูล
						{/if}
					</Button>
				</footer>
			</form>
		</div>
	</div>
{/if}
