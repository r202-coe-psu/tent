<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, ParkingPoint, VehicleType } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import { ulid } from '$lib/db/ulid';
	import { DEFAULT_MAP_CENTER } from '$lib/constants/maps';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Car from '@lucide/svelte/icons/car';
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

	const { errors } = form;

	/** Messages under one point's vehicles (e.g. a duplicated type), whatever the nesting. */
	function vehicleErrors(index: number): string[] {
		const walk = (node: unknown): string[] =>
			Array.isArray(node)
				? node.filter((x): x is string => typeof x === 'string')
				: node && typeof node === 'object'
					? Object.values(node).flatMap(walk)
					: [];
		const point = ($errors.parking_points as unknown as Record<number, { vehicles?: unknown }>)?.[
			index
		];
		return [...new Set(walk(point?.vehicles))];
	}

	let pinPointId = $state<string | null>(null);
	const pinDialogOpen = $derived(pinPointId !== null);
	const pinPoint = $derived(
		($formData.parking_points ?? []).find((p) => p.id === pinPointId) ?? null
	);

	/** Draft pin while the dialog is open — committed only on ยืนยัน. */
	let pinDraftLat = $state<number | null>(null);
	let pinDraftLng = $state<number | null>(null);
	let pinMapCenter = $state<[number, number]>(DEFAULT_MAP_CENTER);
	/** False until center (and optional geo draft) is resolved — avoids mounting map too early. */
	let pinMapReady = $state(false);

	function addPoint() {
		const points = $formData.parking_points ?? [];
		$formData.parking_points = [
			...points,
			{ id: ulid(), name: '', note: null, lat: null, lng: null, vehicles: [] }
		];
		toast.success('เพิ่มจุดจอดรถสำเร็จ');
	}

	const vehicleTypes: { value: VehicleType; label: string; unit: string }[] = [
		{ value: 'motorcycle', label: 'รถจักรยานยนต์', unit: 'คัน' },
		{ value: 'car', label: 'รถยนต์ / รถกระบะ', unit: 'คัน' },
		{ value: 'truck', label: 'รถบรรทุก / รถขนาดใหญ่', unit: 'คัน' },
		{ value: 'boat', label: 'เรือ', unit: 'ลำ' }
	];

	function vehicleEntry(p: ParkingPoint, type: VehicleType) {
		return (p.vehicles ?? []).find((v) => v.type === type);
	}

	/** Replace one point's vehicles through `$formData` so the store notifies (nested edits do not). */
	function setVehicles(
		id: string,
		next: (cur: ParkingPoint['vehicles']) => ParkingPoint['vehicles']
	) {
		$formData.parking_points = ($formData.parking_points ?? []).map((pt: ParkingPoint) =>
			pt.id === id ? { ...pt, vehicles: next(pt.vehicles ?? []) } : pt
		);
	}

	function toggleVehicle(p: ParkingPoint, type: VehicleType, checked: boolean) {
		setVehicles(p.id, (cur) =>
			checked
				? [...cur.filter((v) => v.type !== type), { type, max_capacity: null }]
				: cur.filter((v) => v.type !== type)
		);
	}

	function setVehicleCapacity(p: ParkingPoint, type: VehicleType, raw: string) {
		setVehicles(p.id, (cur) =>
			cur.map((v) =>
				v.type === type ? { ...v, max_capacity: raw === '' ? null : Number(raw) } : v
			)
		);
	}

	function removePoint(id: string) {
		$formData.parking_points = ($formData.parking_points ?? []).filter(
			(p: ParkingPoint) => p.id !== id
		);
		if (pinPointId === id) resetPinDialog();
		toast.success('ลบจุดจอดรถสำเร็จ');
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
		const point = ($formData.parking_points ?? []).find((p) => p.id === id) ?? null;

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
		$formData.parking_points = ($formData.parking_points ?? []).map((p: ParkingPoint) =>
			p.id === id ? { ...p, lat: pinDraftLat, lng: pinDraftLng } : p
		);
		resetPinDialog();
	}

	function cancelPin() {
		resetPinDialog();
	}
</script>

<section
	id="parking-points"
	class="shelter-form-scroll-mt mb-6 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs transition-shadow hover:shadow-sm sm:p-8"
>
	<div class="flex items-center gap-3 border-b border-slate-100 pb-4">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0A2647]/5 text-[#0A2647]"
		>
			<Car class="h-5 w-5" />
		</div>
		<div>
			<div class="flex items-center gap-2">
				<span class="text-xs font-bold tracking-wider text-[#0284C7] uppercase">ส่วนที่ 10</span>
			</div>
			<h2 class="text-base font-bold text-[#0A2647] sm:text-lg">จุดจอดรถ</h2>
		</div>
	</div>

	<p class="text-sm text-muted-foreground">
		ปักหมุดตำแหน่งที่จอดรถบนแผนที่ เพื่อให้เจ้าหน้าที่และผู้มาติดต่อหาที่จอดได้ง่าย
	</p>

	<div class="flex items-center justify-between gap-3">
		<h3 class="text-sm font-bold text-slate-800">รายการจุดจอดรถ</h3>
		<Button
			variant="outline"
			size="sm"
			onclick={addPoint}
			{disabled}
			class="rounded-full border-orange-200 bg-orange-50 text-orange-700 shadow-2xs hover:bg-orange-100 hover:text-orange-800"
		>
			<Plus class="mr-1 h-4 w-4" /> เพิ่มจุดจอดรถ
		</Button>
	</div>

	<div class="space-y-2">
		{#each $formData.parking_points ?? [] as p, i (p.id)}
			<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-start">
					<Form.Field {form} name={`parking_points[${i}].name`} class="min-w-0 flex-1">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชื่อจุดจอดรถ</Form.Label>
								<Input
									{...props}
									bind:value={p.name}
									placeholder="เช่น ลานจอดหน้าอาคารเรียน"
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
							title="ลบจุดจอดรถ"
						>
							<Trash2 class="h-4 w-4" />
						</Button>
					</div>
				</div>

				<Form.Field {form} name={`parking_points[${i}].note`}>
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>หมายเหตุ</Form.Label>
							<Input
								{...props}
								value={p.note ?? ''}
								oninput={(e) => (p.note = e.currentTarget.value || null)}
								placeholder="เช่น จอดได้เฉพาะรถยนต์"
								class="bg-white"
								{disabled}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<p class="-mt-2 text-xs text-muted-foreground">
					ข้อความนี้แสดงต่อสาธารณะ ห้ามใส่ข้อมูลส่วนบุคคล
				</p>

				<div class="space-y-2" data-testid={`parking-vehicles-${i}`}>
					<span class="text-xs font-medium text-muted-foreground">ประเภทรถที่จอดได้ในจุดนี้</span>
					{#each vehicleTypes as vt (vt.value)}
						{@const entry = vehicleEntry(p, vt.value)}
						<div class="flex flex-wrap items-center gap-3">
							<label class="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
								<Checkbox
									checked={!!entry}
									onCheckedChange={(v) => toggleVehicle(p, vt.value, v === true)}
									{disabled}
								/>
								<span>{vt.label}</span>
							</label>
							{#if entry}
								<span class="text-xs text-muted-foreground">รองรับสูงสุด:</span>
								<Input
									type="number"
									min="0"
									value={entry.max_capacity ?? ''}
									oninput={(e) => setVehicleCapacity(p, vt.value, e.currentTarget.value)}
									aria-label={`ความจุ${vt.label}`}
									placeholder="0"
									class="w-24 bg-white"
									{disabled}
								/>
								<span class="text-xs text-muted-foreground">{vt.unit}</span>
							{/if}
						</div>
					{/each}
					{#each vehicleErrors(i) as message (message)}
						<p role="alert" class="text-xs font-medium text-destructive">{message}</p>
					{/each}
				</div>

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
				ยังไม่มีจุดจอดรถ กรุณาเพิ่มรายการใหม่
			</p>
		{/each}
	</div>

	<Dialog.Root
		open={pinDialogOpen}
		onOpenChange={(open) => {
			if (!open) cancelPin();
		}}
	>
		<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
			<Dialog.Header>
				<Dialog.Title>ปักหมุดจุดจอดรถ</Dialog.Title>
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
