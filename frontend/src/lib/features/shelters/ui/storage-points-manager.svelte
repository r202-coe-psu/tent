<script lang="ts">
	import {
		SUB_STORAGE_NOTE_MAX,
		subStorageItemSchema,
		type SubStorageItem
	} from '../domain/schema';
	import type { SubStorageType } from '../domain/schema';
	import {
		SUB_STORAGE_TYPE_LABELS,
		sortSubStorageTypes,
		subStorageTypeLabels
	} from '../domain/storage-points';
	import {
		useDeleteStoragePoint,
		useSaveStoragePoint,
		useShelter,
		useStoragePointsAdmin
	} from '../application/queries';
	import type { StoragePointInput } from '../data/shelters.api';
	import LocationMapPicker from './location-map-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { DEFAULT_MAP_CENTER } from '$lib/constants/maps';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Warehouse from '@lucide/svelte/icons/warehouse';

	let {
		shelterCode,
		stockedLotCount,
		stockReady
	}: {
		shelterCode: string;
		/** Lots at a point that still hold stock (qty > 0) — a point with any cannot be deleted. */
		stockedLotCount: (pointId: string) => number;
		/** False until the ledger behind `stockedLotCount` has loaded; delete stays off meanwhile. */
		stockReady: boolean;
	} = $props();

	const typeOptions = Object.entries(SUB_STORAGE_TYPE_LABELS) as [SubStorageType, string][];

	const snapshotQuery = useStoragePointsAdmin(() => shelterCode);
	const shelterQuery = useShelter(() => shelterCode);
	const saveMutation = useSaveStoragePoint();
	const deleteMutation = useDeleteStoragePoint();

	const points = $derived(snapshotQuery.data?.points ?? []);
	const rev = $derived(snapshotQuery.data?.rev ?? '');
	const busy = $derived(saveMutation.isPending || deleteMutation.isPending);
	const mapCenter = $derived.by((): [number, number] => {
		const loc = shelterQuery.data?.location;
		return loc?.lat != null && loc?.lng != null
			? [Number(loc.lng), Number(loc.lat)]
			: DEFAULT_MAP_CENTER;
	});

	type Draft = {
		name: string;
		types: SubStorageType[];
		area_m2: number | null;
		accepts_donations: boolean;
		lat: number | null;
		lng: number | null;
		location_note: string;
	};

	const emptyDraft = (): Draft => ({
		name: '',
		types: [],
		area_m2: null,
		accepts_donations: false,
		lat: null,
		lng: null,
		location_note: ''
	});

	let dialogOpen = $state(false);
	let editingId = $state<string | null>(null);
	let draft = $state<Draft>(emptyDraft());
	let formError = $state<string | null>(null);

	function openAdd() {
		editingId = null;
		draft = emptyDraft();
		formError = null;
		dialogOpen = true;
	}

	function openEdit(point: SubStorageItem) {
		editingId = point.id;
		draft = {
			name: point.name,
			types: sortSubStorageTypes(point.types ?? []),
			area_m2: point.area_m2 ?? null,
			accepts_donations: point.accepts_donations,
			lat: point.lat ?? null,
			lng: point.lng ?? null,
			location_note: point.location_note ?? ''
		};
		formError = null;
		dialogOpen = true;
	}

	function setTypes(next: string[]) {
		draft.types = sortSubStorageTypes(next as SubStorageType[]);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		// The shelter form's own schema validates the point; the server issues the real `id`.
		const parsed = subStorageItemSchema.safeParse({ ...draft, id: editingId ?? 'new' });
		if (!parsed.success) {
			formError = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
			return;
		}
		formError = null;
		const point: Partial<SubStorageItem> = { ...(parsed.data as SubStorageItem) };
		delete point.id;
		try {
			await saveMutation.mutateAsync({
				code: shelterCode,
				rev,
				pointId: editingId ?? undefined,
				point: point as StoragePointInput
			});
			dialogOpen = false;
		} catch {
			// The hook toasts the reason; the dialog stays open for another try.
		}
	}

	let deleteTarget = $state<SubStorageItem | null>(null);

	async function confirmDelete() {
		const target = deleteTarget;
		if (!target) return;
		try {
			await deleteMutation.mutateAsync({ code: shelterCode, rev, pointId: target.id });
		} catch {
			// The hook toasts the reason (e.g. stock appeared, or the shelter was saved meanwhile).
		}
		deleteTarget = null;
	}
</script>

<section class="space-y-4" aria-labelledby="storage-points-heading">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 id="storage-points-heading" class="text-lg font-bold text-[#0A2647]">จัดการคลัง</h2>
			<p class="text-sm text-slate-600">
				จุดเก็บของของศูนย์นี้ ใช้เป็นตัวเลือก "สถานที่จัดเก็บ" ตอนรับเข้า ปรับยอด และตรวจนับ
			</p>
		</div>
		<Button type="button" onclick={openAdd} disabled={busy || !rev} class="min-h-11">
			<Plus class="mr-1 h-4 w-4" /> เพิ่มจุดเก็บของ
		</Button>
	</div>

	{#if snapshotQuery.isError}
		<p role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
			โหลดรายการจุดเก็บของไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
		</p>
	{/if}

	<ul class="space-y-2">
		<li
			class="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
			data-testid="main-store-row"
		>
			<Warehouse class="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
			<div class="min-w-0 flex-1">
				<p class="font-semibold text-slate-900">คลังหลัก</p>
				<p class="text-xs text-slate-600">ใช้เมื่อไม่ระบุสถานที่จัดเก็บ — แก้หรือลบไม่ได้</p>
			</div>
		</li>

		{#each points as point (point.id)}
			{@const stocked = stockedLotCount(point.id)}
			<li
				class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center"
			>
				<div class="min-w-0 flex-1 space-y-1">
					<p class="font-semibold text-slate-900">{point.name}</p>
					<p class="text-xs text-slate-600">
						{subStorageTypeLabels(point.types ?? []).join(' · ') || '—'}
						{#if point.area_m2 != null}
							· {point.area_m2} ตร.ม.
						{/if}
						{#if point.accepts_donations}
							· จุดรับบริจาค
						{/if}
					</p>
					{#if stocked > 0}
						<p class="text-xs font-semibold text-amber-800">
							ยังมีของ {stocked} ล็อต — ต้องย้ายของออกก่อนจึงจะลบได้
						</p>
					{/if}
				</div>
				<div class="flex shrink-0 gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="min-h-11"
						onclick={() => openEdit(point)}
						disabled={busy}
						aria-label={`แก้ไขจุดเก็บของ ${point.name}`}
					>
						<Pencil class="mr-1 h-4 w-4" /> แก้ไข
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="min-h-11 text-destructive"
						onclick={() => (deleteTarget = point)}
						disabled={busy || !stockReady || stocked > 0}
						aria-label={`ลบจุดเก็บของ ${point.name}`}
					>
						<Trash2 class="mr-1 h-4 w-4" /> ลบ
					</Button>
				</div>
			</li>
		{/each}
	</ul>
</section>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
		<form onsubmit={submit} class="space-y-4">
			<Dialog.Header>
				<Dialog.Title>{editingId ? 'แก้ไขจุดเก็บของ' : 'เพิ่มจุดเก็บของ'}</Dialog.Title>
				<Dialog.Description>ข้อมูลนี้ใช้ร่วมกับฟอร์มศูนย์พักพิง</Dialog.Description>
			</Dialog.Header>

			<div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
				<div class="space-y-1.5">
					<Label for="sp-name">ชื่อจุดเก็บของ</Label>
					<Input id="sp-name" bind:value={draft.name} placeholder="เช่น สนามปิงปอง, ห้องเรียน 3" />
				</div>
				<div class="space-y-1.5">
					<Label for="sp-area">พื้นที่ (ตร.ม.)</Label>
					<Input
						id="sp-area"
						type="number"
						min="0"
						step="any"
						class="tabular-nums"
						value={draft.area_m2 ?? ''}
						oninput={(e) =>
							(draft.area_m2 = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
					/>
				</div>
			</div>

			<fieldset class="space-y-1.5">
				<legend class="text-sm font-medium">ประเภทของที่เก็บได้ (เลือกได้หลายประเภท)</legend>
				<ToggleGroup.Root
					type="multiple"
					bind:value={() => draft.types, setTypes}
					spacing={2}
					class="w-full flex-wrap"
				>
					{#each typeOptions as [value, label] (value)}
						<ToggleGroup.Item
							{value}
							class="h-auto min-h-11 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 data-[state=on]:border-domain-facility-strong data-[state=on]:bg-domain-facility-strong data-[state=on]:text-white"
						>
							{label}
						</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
			</fieldset>

			<label class="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-900">
				<Checkbox
					checked={draft.accepts_donations}
					onCheckedChange={(v) => (draft.accepts_donations = v === true)}
					aria-label="ใช้เป็นจุดรับบริจาค"
				/>
				ใช้เป็นจุดรับบริจาค
			</label>

			{#if draft.accepts_donations}
				<div class="space-y-3">
					<LocationMapPicker
						lat={draft.lat}
						lng={draft.lng}
						center={mapCenter}
						zoom={18}
						onchange={(lat, lng) => {
							draft.lat = lat;
							draft.lng = lng;
						}}
					/>
					<div class="space-y-1.5">
						<Label for="sp-note">คำอธิบายตำแหน่งสำหรับผู้มาส่ง</Label>
						<Input
							id="sp-note"
							bind:value={draft.location_note}
							maxlength={SUB_STORAGE_NOTE_MAX}
							placeholder="เช่น ประตู 2 ข้างโรงยิม"
						/>
						<p class="text-xs text-muted-foreground">
							ข้อความนี้แสดงต่อสาธารณะ ทั้งหน้าบริจาคและระบบของหน่วยงานภายนอก
						</p>
					</div>
				</div>
			{/if}

			{#if formError}
				<p role="alert" class="text-sm font-semibold text-destructive">{formError}</p>
			{/if}

			<Dialog.Footer class="gap-2">
				<Button type="button" variant="outline" onclick={() => (dialogOpen = false)}>ยกเลิก</Button>
				<Button type="submit" disabled={saveMutation.isPending}>บันทึก</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
	open={deleteTarget !== null}
	onOpenChange={(open) => {
		if (!open && !deleteMutation.isPending) deleteTarget = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ลบจุดเก็บของ</AlertDialog.Title>
			<AlertDialog.Description>
				ลบ "{deleteTarget?.name}" ออกจากศูนย์นี้ ประวัติสต็อกเดิมยังแสดงชื่อที่บันทึกไว้
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleteMutation.isPending}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmDelete} disabled={deleteMutation.isPending}>
				ลบจุดเก็บของ
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
