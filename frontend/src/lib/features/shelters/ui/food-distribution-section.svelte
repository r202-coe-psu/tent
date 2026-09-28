<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, FoodDistributionPoint } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import { ulid } from '$lib/db/ulid';
	import { DEFAULT_MAP_CENTER } from '$lib/constants/maps';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import LocationMapPicker from './location-map-picker.svelte';

	/** Street-level zoom for the pin dialog (easy fine placement). */
	const PIN_MAP_ZOOM = 18;
	const GEO_TIMEOUT_MS = 8_000;

	let {
		form,
		formData,
		disabled = false
	}: {
		form: SuperForm<Shelter>;
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();

	let pinPointId = $state<string | null>(null);
	const pinDialogOpen = $derived(pinPointId !== null);
	const pinPoint = $derived(
		($formData.food_distribution_points ?? []).find((p) => p.id === pinPointId) ?? null
	);

	/** Draft pin while the dialog is open — committed only on ยืนยัน. */
	let pinDraftLat = $state<number | null>(null);
	let pinDraftLng = $state<number | null>(null);
	let pinMapCenter = $state<[number, number]>(DEFAULT_MAP_CENTER);
	/** False until center (and optional geo draft) is resolved — avoids mounting map too early. */
	let pinMapReady = $state(false);

	function addPoint() {
		const points = $formData.food_distribution_points ?? [];
		$formData.food_distribution_points = [
			...points,
			{ id: ulid(), name: '', note: null, lat: null, lng: null }
		];
		toast.success('เพิ่มจุดแจกอาหารสำเร็จ');
	}

	function removePoint(id: string) {
		$formData.food_distribution_points = ($formData.food_distribution_points ?? []).filter(
			(p: FoodDistributionPoint) => p.id !== id
		);
		if (pinPointId === id) resetPinDialog();
		toast.success('ลบจุดแจกอาหารสำเร็จ');
	}

	function shelterLocationCenter(): [number, number] | null {
		const lat = $formData.location?.lat;
		const lng = $formData.location?.lng;
		if (lat != null && lng != null) return [Number(lng), Number(lat)];
		return null;
	}

	function fallbackCenter(): [number, number] {
		return shelterLocationCenter() ?? DEFAULT_MAP_CENTER;
	}

	function resolvePinCenter(): Promise<{ center: [number, number]; fromGeo: boolean }> {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			return Promise.resolve({ center: fallbackCenter(), fromGeo: false });
		}
		return new Promise((resolve) => {
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					resolve({
						center: [pos.coords.longitude, pos.coords.latitude],
						fromGeo: true
					});
				},
				() => {
					toast.message('ใช้ตำแหน่งศูนย์พักพิงแทน', {
						description: 'ไม่สามารถอ่านตำแหน่งปัจจุบันได้'
					});
					resolve({ center: fallbackCenter(), fromGeo: false });
				},
				{ enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 }
			);
		});
	}

	function resetPinDialog() {
		pinPointId = null;
		pinDraftLat = null;
		pinDraftLng = null;
		pinMapCenter = DEFAULT_MAP_CENTER;
		pinMapReady = false;
	}

	async function openPinDialog(id: string) {
		pinPointId = id;
		pinMapReady = false;
		const point = ($formData.food_distribution_points ?? []).find((p) => p.id === id) ?? null;

		if (point?.lat != null && point?.lng != null) {
			pinDraftLat = point.lat;
			pinDraftLng = point.lng;
			pinMapCenter = [Number(point.lng), Number(point.lat)];
			pinMapReady = true;
			return;
		}

		pinDraftLat = null;
		pinDraftLng = null;
		const { center, fromGeo } = await resolvePinCenter();
		if (pinPointId !== id) return;
		pinMapCenter = center;
		if (fromGeo) {
			// Prefill draft marker for easy pinning — not written to the form until ยืนยัน.
			pinDraftLat = Number(center[1].toFixed(6));
			pinDraftLng = Number(center[0].toFixed(6));
		}
		pinMapReady = true;
	}

	function onPinDraftChange(lat: number | null, lng: number | null) {
		pinDraftLat = lat;
		pinDraftLng = lng;
	}

	function confirmPin() {
		if (!pinPointId) return;
		const id = pinPointId;
		$formData.food_distribution_points = ($formData.food_distribution_points ?? []).map(
			(p: FoodDistributionPoint) => (p.id === id ? { ...p, lat: pinDraftLat, lng: pinDraftLng } : p)
		);
		resetPinDialog();
	}

	function cancelPin() {
		resetPinDialog();
	}
</script>

<section
	id="food-distribution"
	class="shelter-form-scroll-mt mb-6 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs transition-shadow hover:shadow-sm sm:p-8"
>
	<div class="flex items-center gap-3 border-b border-slate-100 pb-4">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0A2647]/5 text-[#0A2647]"
		>
			<UtensilsCrossed class="h-5 w-5" />
		</div>
		<div>
			<div class="flex items-center gap-2">
				<span class="text-xs font-bold tracking-wider text-[#0284C7] uppercase">ส่วนที่ 4</span>
			</div>
			<h2 class="text-base font-bold text-[#0A2647] sm:text-lg">จุดแจกอาหาร</h2>
		</div>
	</div>

	<div class="flex items-center justify-between gap-3">
		<h3 class="text-sm font-bold text-slate-800">รายการจุดแจกอาหาร</h3>
		<Button
			variant="outline"
			size="sm"
			onclick={addPoint}
			{disabled}
			class="rounded-full border-orange-200 bg-orange-50 text-orange-700 shadow-2xs hover:bg-orange-100 hover:text-orange-800"
		>
			<Plus class="mr-1 h-4 w-4" /> เพิ่มจุดแจกอาหาร
		</Button>
	</div>

	<div class="space-y-2">
		{#each $formData.food_distribution_points ?? [] as p, i (p.id)}
			<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-start">
					<Form.Field {form} name={`food_distribution_points[${i}].name`} class="min-w-0 flex-1">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชื่อจุดแจกอาหาร</Form.Label>
								<Input
									{...props}
									bind:value={p.name}
									placeholder="เช่น จุดแจกหน้าโรงครัว"
									class="bg-white"
									{disabled}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<div class="flex shrink-0 items-end gap-1 self-end sm:self-auto sm:pt-6">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={() => openPinDialog(p.id)}
							{disabled}
							class="border-orange-200 text-orange-700 hover:bg-orange-50"
						>
							<MapPin class="mr-1 h-4 w-4" />
							ปักหมุด
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="text-destructive hover:bg-destructive/10 hover:text-destructive"
							onclick={() => removePoint(p.id)}
							{disabled}
							title="ลบจุดแจกอาหาร"
						>
							<Trash2 class="h-4 w-4" />
						</Button>
					</div>
				</div>

				<Form.Field {form} name={`food_distribution_points[${i}].note`}>
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>หมายเหตุ</Form.Label>
							<Input
								{...props}
								value={p.note ?? ''}
								oninput={(e) => (p.note = e.currentTarget.value || null)}
								placeholder="เช่น แจกช่วงเช้า–เที่ยง"
								class="bg-white"
								{disabled}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1">
						<span class="text-xs font-medium text-muted-foreground">ละติจูด (Lat)</span>
						<Input
							type="number"
							step="any"
							min="-90"
							max="90"
							value={p.lat ?? ''}
							oninput={(e) =>
								(p.lat = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
							placeholder="—"
							class="bg-white"
							{disabled}
						/>
					</div>
					<div class="space-y-1">
						<span class="text-xs font-medium text-muted-foreground">ลองจิจูด (Lng)</span>
						<Input
							type="number"
							step="any"
							min="-180"
							max="180"
							value={p.lng ?? ''}
							oninput={(e) =>
								(p.lng = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
							placeholder="—"
							class="bg-white"
							{disabled}
						/>
					</div>
				</div>

				{#if p.lat != null && p.lng != null}
					<p class="text-xs text-muted-foreground">
						พิกัดปัจจุบัน: {p.lat}, {p.lng}
					</p>
				{:else}
					<p class="text-xs text-muted-foreground">ยังไม่ได้ปักหมุด</p>
				{/if}
			</div>
		{:else}
			<p class="py-4 text-center text-sm text-muted-foreground">
				ยังไม่มีจุดแจกอาหาร กรุณาเพิ่มรายการใหม่
			</p>
		{/each}
	</div>

	<Dialog.Root
		open={pinDialogOpen}
		onOpenChange={(open) => {
			if (!open) cancelPin();
		}}
	>
		<Dialog.Content class="sm:max-w-2xl">
			<Dialog.Header>
				<Dialog.Title>ปักหมุดจุดแจกอาหาร</Dialog.Title>
				<Dialog.Description>
					{pinPoint?.name?.trim() ? pinPoint.name : 'เลือกตำแหน่งบนแผนที่ หรือกรอกพิกัด'}
				</Dialog.Description>
			</Dialog.Header>

			{#if pinMapReady && pinPoint}
				{#key pinPoint.id}
					<LocationMapPicker
						lat={pinDraftLat}
						lng={pinDraftLng}
						center={pinMapCenter}
						zoom={PIN_MAP_ZOOM}
						{disabled}
						onchange={onPinDraftChange}
					/>
				{/key}
			{:else if pinDialogOpen}
				<p class="py-8 text-center text-sm text-muted-foreground">กำลังค้นหาตำแหน่ง…</p>
			{/if}

			<Dialog.Footer class="gap-2">
				<Button type="button" variant="outline" onclick={cancelPin}>ยกเลิก</Button>
				<Button type="button" onclick={confirmPin} disabled={!pinMapReady}>ยืนยันปักหมุด</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</section>
