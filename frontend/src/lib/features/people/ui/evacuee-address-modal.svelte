<script lang="ts">
	import { untrack } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import MapPinX from '@lucide/svelte/icons/map-pin-x';
	import X from '@lucide/svelte/icons/x';
	import { useDistricts, useProvinces, useSubdistricts } from '$lib/features/shelters';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import SearchSelect from '$lib/components/search-select.svelte';
	import { evacueeAddressEditFormSchema, type Household } from '$lib/features/people';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';

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
	const hasLocation = $derived(Boolean(province || district || subdistrict || postalCode));

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

	const provincesQuery = useProvinces();
	const districtsQuery = useDistricts(() => province || null);
	const subdistrictsQuery = useSubdistricts(
		() => province || null,
		() => district || null
	);

	const provinceItems = $derived(
		(provincesQuery.data ?? []).map((value) => ({ value, label: value }))
	);
	const districtItems = $derived(
		(districtsQuery.data ?? []).map((value) => ({ value, label: value }))
	);
	const subdistrictItems = $derived(
		(subdistrictsQuery.data ?? []).map((entry) => ({
			value: entry.subdistrict,
			label: entry.subdistrict
		}))
	);

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

	// The API is the source of truth for postal codes. This also repairs stale or
	// missing stored postal codes once the selected subdistrict has loaded.
	$effect(() => {
		if (!show || !subdistrict) return;
		const match = (subdistrictsQuery.data ?? []).find((entry) => entry.subdistrict === subdistrict);
		if (match) postalCode = String(match.zipcode);
	});

	function selectProvince(value: string) {
		province = value;
		district = '';
		subdistrict = '';
		postalCode = '';
	}

	function selectDistrict(value: string) {
		district = value;
		subdistrict = '';
		postalCode = '';
	}

	function selectSubdistrict(value: string) {
		subdistrict = value;
		const match = (subdistrictsQuery.data ?? []).find((entry) => entry.subdistrict === subdistrict);
		postalCode = match ? String(match.zipcode) : '';
	}

	function clearLocation() {
		province = '';
		district = '';
		subdistrict = '';
		postalCode = '';
	}
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
					<section class="space-y-4" aria-labelledby="address-details-heading">
						<div>
							<h3 id="address-details-heading" class="text-sm font-semibold text-foreground">
								รายละเอียดบ้าน
							</h3>
							<p class="mt-0.5 text-xs text-muted-foreground">ข้อมูลที่อยู่เพิ่มเติมของครอบครัว</p>
						</div>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<Form.Field {form} name="addressNo">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>บ้านเลขที่</Form.Label>
										<Input {...props} bind:value={addressNo} placeholder="เช่น 123/45" />
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
							<Form.Field {form} name="villageNo">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>หมู่ที่ / ตรอก / ซอย / ถนน</Form.Label>
										<Input {...props} bind:value={villageNo} placeholder="เช่น หมู่ 2" />
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</div>
					</section>

					<section
						class="space-y-4 border-t border-border/70 pt-5"
						aria-labelledby="location-heading"
					>
						<div class="flex items-center justify-between gap-3">
							<h3 id="location-heading" class="text-sm font-semibold text-foreground">
								พื้นที่และรหัสไปรษณีย์
							</h3>
							{#if province || district || subdistrict || postalCode}
								<button
									type="button"
									onclick={clearLocation}
									class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									<MapPinX class="size-3.5" /> ล้างพื้นที่
								</button>
							{/if}
						</div>

						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<Form.Field {form} name="province">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											>จังหวัด {#if hasLocation}<span class="text-destructive">*</span
												>{/if}</Form.Label
										>
										<SearchSelect
											name={props.name}
											bind:value={() => province, selectProvince}
											options={provinceItems}
											placeholder="เลือกจังหวัด"
											searchPlaceholder="ค้นหาจังหวัด..."
											emptyText={provincesQuery.isError ? 'โหลดจังหวัดไม่สำเร็จ' : 'ไม่พบจังหวัด'}
											loading={provincesQuery.isLoading}
											class="!h-9 rounded-md"
											controlProps={{ ...props, id: 'province' }}
										/>
									{/snippet}
								</Form.Control>
								{#if provincesQuery.isLoading}
									<p class="text-xs text-muted-foreground">กำลังโหลดรายการจังหวัด...</p>
								{:else if provincesQuery.isError}
									<p class="text-xs text-destructive">
										โหลดรายการจังหวัดไม่สำเร็จ ลองเปิดเมนูอีกครั้ง
									</p>
								{:else if $errors.province}
									<Form.FieldErrors />
								{/if}
							</Form.Field>

							<Form.Field {form} name="district">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											>อำเภอ / เขต {#if hasLocation}<span class="text-destructive">*</span
												>{/if}</Form.Label
										>
										<SearchSelect
											name={props.name}
											bind:value={() => district, selectDistrict}
											options={districtItems}
											placeholder={!province ? 'เลือกจังหวัดก่อน' : 'เลือกอำเภอ / เขต'}
											searchPlaceholder="ค้นหาอำเภอ / เขต..."
											emptyText={districtsQuery.isError ? 'โหลดอำเภอไม่สำเร็จ' : 'ไม่พบอำเภอ / เขต'}
											loading={districtsQuery.isLoading}
											disabled={!province}
											class="!h-9 rounded-md"
											controlProps={{ ...props, id: 'district' }}
										/>
									{/snippet}
								</Form.Control>
								{#if districtsQuery.isLoading && province}
									<p class="text-xs text-muted-foreground">กำลังโหลดรายการอำเภอ...</p>
								{:else if districtsQuery.isError && province}
									<p class="text-xs text-destructive">โหลดรายการอำเภอไม่สำเร็จ</p>
								{:else if $errors.district}
									<Form.FieldErrors />
								{/if}
							</Form.Field>

							<Form.Field {form} name="subdistrict">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											>ตำบล / แขวง {#if hasLocation}<span class="text-destructive">*</span
												>{/if}</Form.Label
										>
										<SearchSelect
											name={props.name}
											bind:value={() => subdistrict, selectSubdistrict}
											options={subdistrictItems}
											placeholder={!district ? 'เลือกอำเภอก่อน' : 'เลือกตำบล / แขวง'}
											searchPlaceholder="ค้นหาตำบล / แขวง..."
											emptyText={subdistrictsQuery.isError
												? 'โหลดตำบลไม่สำเร็จ'
												: 'ไม่พบตำบล / แขวง'}
											loading={subdistrictsQuery.isLoading}
											disabled={!district}
											class="!h-9 rounded-md"
											controlProps={{ ...props, id: 'subdistrict' }}
										/>
									{/snippet}
								</Form.Control>
								{#if subdistrictsQuery.isLoading && district}
									<p class="text-xs text-muted-foreground">กำลังโหลดรายการตำบล...</p>
								{:else if subdistrictsQuery.isError && district}
									<p class="text-xs text-destructive">โหลดรายการตำบลไม่สำเร็จ</p>
								{:else if $errors.subdistrict}
									<Form.FieldErrors />
								{/if}
							</Form.Field>

							<Form.Field {form} name="postalCode">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											>รหัสไปรษณีย์ {#if hasLocation}<span class="text-destructive">*</span
												>{/if}</Form.Label
										>
										<Input
											{...props}
											id="postal_code"
											value={postalCode}
											disabled
											placeholder={!subdistrict ? 'เลือกตำบลก่อน' : 'กำลังเติมรหัสไปรษณีย์...'}
											class="bg-muted/50"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</div>
					</section>

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
