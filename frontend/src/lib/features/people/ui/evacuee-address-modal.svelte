<script lang="ts">
	import { untrack } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import MapPinX from '@lucide/svelte/icons/map-pin-x';
	import X from '@lucide/svelte/icons/x';
	import { useDistricts, useProvinces, useSubdistricts } from '$lib/features/shelters';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { Household } from '$lib/features/people';

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

	type FieldName =
		'addressNo' | 'villageNo' | 'province' | 'district' | 'subdistrict' | 'postalCode';
	type FieldErrors = Partial<Record<FieldName, string>>;

	let addressNo = $state(untrack(() => household.address_no ?? ''));
	let villageNo = $state(untrack(() => household.village_no ?? ''));
	let subdistrict = $state(untrack(() => household.subdistrict ?? ''));
	let district = $state(untrack(() => household.district ?? ''));
	let province = $state(untrack(() => household.province ?? ''));
	let postalCode = $state(untrack(() => household.postal_code ?? ''));
	let errors = $state<FieldErrors>({});
	let formError = $state('');
	let saving = $state(false);

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
		errors = {};
		formError = '';
	});

	// The API is the source of truth for postal codes. This also repairs stale or
	// missing stored postal codes once the selected subdistrict has loaded.
	$effect(() => {
		if (!show || !subdistrict) return;
		const match = (subdistrictsQuery.data ?? []).find((entry) => entry.subdistrict === subdistrict);
		if (match) postalCode = String(match.zipcode);
	});

	function clearError(field: FieldName) {
		if (!errors[field]) return;
		const next = { ...errors };
		delete next[field];
		errors = next;
	}

	function selectProvince(value: string | undefined) {
		province = value ?? '';
		district = '';
		subdistrict = '';
		postalCode = '';
		clearError('province');
		clearError('district');
		clearError('subdistrict');
		clearError('postalCode');
	}

	function selectDistrict(value: string | undefined) {
		district = value ?? '';
		subdistrict = '';
		postalCode = '';
		clearError('district');
		clearError('subdistrict');
		clearError('postalCode');
	}

	function selectSubdistrict(value: string | undefined) {
		subdistrict = value ?? '';
		const match = (subdistrictsQuery.data ?? []).find((entry) => entry.subdistrict === subdistrict);
		postalCode = match ? String(match.zipcode) : '';
		clearError('subdistrict');
		clearError('postalCode');
	}

	function clearLocation() {
		province = '';
		district = '';
		subdistrict = '';
		postalCode = '';
		errors = {};
	}

	function validate(): boolean {
		const next: FieldErrors = {};
		const hasLocation = Boolean(province || district || subdistrict || postalCode);
		if (hasLocation && !province) next.province = 'กรุณาเลือกจังหวัด';
		if (hasLocation && !district) next.district = 'กรุณาเลือกอำเภอ / เขต';
		if (hasLocation && !subdistrict) next.subdistrict = 'กรุณาเลือกตำบล / แขวง';
		if (hasLocation && !/^\d{5}$/.test(postalCode)) {
			next.postalCode = 'ไม่พบรหัสไปรษณีย์ของตำบลที่เลือก';
		}
		errors = next;
		return Object.keys(next).length === 0;
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		formError = '';
		if (!validate() || saving) return;

		saving = true;
		try {
			await onSave({
				addressNo: addressNo.trim(),
				villageNo: villageNo.trim(),
				subdistrict,
				district,
				province,
				postalCode
			});
		} catch (error) {
			formError = error instanceof Error ? error.message : 'บันทึกข้อมูลไม่สำเร็จ';
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
			class="w-full max-w-2xl animate-in overflow-hidden rounded-lg border border-border bg-card shadow-xl duration-150 zoom-in-95 fade-in"
			aria-label="แก้ไขที่อยู่ครอบครัว"
			aria-modal="true"
			role="dialog"
		>
			<form onsubmit={handleSubmit}>
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
							<div class="space-y-1.5">
								<Label for="address_no">บ้านเลขที่</Label>
								<Input
									id="address_no"
									bind:value={addressNo}
									oninput={() => clearError('addressNo')}
									aria-invalid={errors.addressNo ? 'true' : undefined}
									placeholder="เช่น 123/45"
								/>
								{#if errors.addressNo}<p class="text-xs text-destructive">
										{errors.addressNo}
									</p>{/if}
							</div>
							<div class="space-y-1.5">
								<Label for="village_no">หมู่ที่ / ตรอก / ซอย / ถนน</Label>
								<Input id="village_no" bind:value={villageNo} placeholder="เช่น หมู่ 2" />
							</div>
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
							<div class="space-y-1.5">
								<Label for="province">จังหวัด</Label>
								<Select.Root type="single" value={province} onValueChange={selectProvince}>
									<Select.Trigger
										id="province"
										class="h-9 w-full bg-background"
										aria-invalid={errors.province ? 'true' : undefined}
									>
										{province || 'เลือกจังหวัด'}
									</Select.Trigger>
									<Select.Content>
										{#if provincesQuery.isLoading}
											<Select.Item
												value="__loading_provinces"
												label="กำลังโหลดจังหวัด..."
												disabled
											/>
										{:else if provincesQuery.isError}
											<Select.Item
												value="__error_provinces"
												label="โหลดจังหวัดไม่สำเร็จ"
												disabled
											/>
										{:else if provinceItems.length === 0}
											<Select.Item value="__empty_provinces" label="ไม่พบข้อมูลจังหวัด" disabled />
										{:else}
											{#each provinceItems as item (item.value)}
												<Select.Item value={item.value} label={item.label} />
											{/each}
										{/if}
									</Select.Content>
								</Select.Root>
								{#if provincesQuery.isLoading}
									<p class="text-xs text-muted-foreground">กำลังโหลดรายการจังหวัด...</p>
								{:else if provincesQuery.isError}
									<p class="text-xs text-destructive">
										โหลดรายการจังหวัดไม่สำเร็จ ลองเปิดเมนูอีกครั้ง
									</p>
								{:else if errors.province}
									<p class="text-xs text-destructive">{errors.province}</p>
								{/if}
							</div>

							<div class="space-y-1.5">
								<Label for="district">อำเภอ / เขต</Label>
								<Select.Root
									type="single"
									value={district}
									onValueChange={selectDistrict}
									disabled={!province}
								>
									<Select.Trigger
										id="district"
										class="h-9 w-full bg-background"
										aria-invalid={errors.district ? 'true' : undefined}
									>
										{district || (!province ? 'เลือกจังหวัดก่อน' : 'เลือกอำเภอ / เขต')}
									</Select.Trigger>
									<Select.Content>
										{#if districtsQuery.isLoading}
											<Select.Item value="__loading_districts" label="กำลังโหลดอำเภอ..." disabled />
										{:else if districtsQuery.isError}
											<Select.Item value="__error_districts" label="โหลดอำเภอไม่สำเร็จ" disabled />
										{:else if districtItems.length === 0}
											<Select.Item value="__empty_districts" label="ไม่พบข้อมูลอำเภอ" disabled />
										{:else}
											{#each districtItems as item (item.value)}
												<Select.Item value={item.value} label={item.label} />
											{/each}
										{/if}
									</Select.Content>
								</Select.Root>
								{#if districtsQuery.isLoading && province}
									<p class="text-xs text-muted-foreground">กำลังโหลดรายการอำเภอ...</p>
								{:else if districtsQuery.isError && province}
									<p class="text-xs text-destructive">โหลดรายการอำเภอไม่สำเร็จ</p>
								{:else if errors.district}
									<p class="text-xs text-destructive">{errors.district}</p>
								{/if}
							</div>

							<div class="space-y-1.5">
								<Label for="subdistrict">ตำบล / แขวง</Label>
								<Select.Root
									type="single"
									value={subdistrict}
									onValueChange={selectSubdistrict}
									disabled={!district}
								>
									<Select.Trigger
										id="subdistrict"
										class="h-9 w-full bg-background"
										aria-invalid={errors.subdistrict ? 'true' : undefined}
									>
										{subdistrict || (!district ? 'เลือกอำเภอก่อน' : 'เลือกตำบล / แขวง')}
									</Select.Trigger>
									<Select.Content>
										{#if subdistrictsQuery.isLoading}
											<Select.Item
												value="__loading_subdistricts"
												label="กำลังโหลดตำบล..."
												disabled
											/>
										{:else if subdistrictsQuery.isError}
											<Select.Item
												value="__error_subdistricts"
												label="โหลดตำบลไม่สำเร็จ"
												disabled
											/>
										{:else if subdistrictItems.length === 0}
											<Select.Item value="__empty_subdistricts" label="ไม่พบข้อมูลตำบล" disabled />
										{:else}
											{#each subdistrictItems as item (item.value)}
												<Select.Item value={item.value} label={item.label} />
											{/each}
										{/if}
									</Select.Content>
								</Select.Root>
								{#if subdistrictsQuery.isLoading && district}
									<p class="text-xs text-muted-foreground">กำลังโหลดรายการตำบล...</p>
								{:else if subdistrictsQuery.isError && district}
									<p class="text-xs text-destructive">โหลดรายการตำบลไม่สำเร็จ</p>
								{:else if errors.subdistrict}
									<p class="text-xs text-destructive">{errors.subdistrict}</p>
								{/if}
							</div>

							<div class="space-y-1.5">
								<Label for="postal_code">รหัสไปรษณีย์</Label>
								<Input
									id="postal_code"
									value={postalCode}
									disabled
									aria-invalid={errors.postalCode ? 'true' : undefined}
									placeholder={!subdistrict ? 'เลือกตำบลก่อน' : 'กำลังเติมรหัสไปรษณีย์...'}
									class="bg-muted/50"
								/>
								{#if errors.postalCode}
									<p class="text-xs text-destructive">{errors.postalCode}</p>
								{/if}
							</div>
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
