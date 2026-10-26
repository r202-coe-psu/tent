<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import Camera from '@lucide/svelte/icons/camera';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Check from '@lucide/svelte/icons/check';
	import User from '@lucide/svelte/icons/user';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Truck from '@lucide/svelte/icons/truck';
	import Package from '@lucide/svelte/icons/package';
	import CheckCircle2 from '@lucide/svelte/icons/circle-check';
	import Circle from '@lucide/svelte/icons/circle';

	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { DatePicker } from '$lib/components/ui/date-picker/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import { qtyGt } from '$lib/utils/qty';
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		donationRefLabel,
		linesMissingExpiry,
		receivedQtyDifference,
		rejectDonationInputSchema,
		RejectDonationDialog,
		RejectReasonFields,
		LineDecisionToggle,
		type DonationRejectReasonCode,
		type RejectDonationInput,
		type ScanDonationView
	} from '$lib/features/donations';
	import { useSupplyItems } from '$lib/features/supply';
	import {
		canonicalizeUnitCode,
		canWriteShelterCatalog,
		formatUnit,
		mergeCatalogGenerations,
		QuickCreateItem,
		useItemMasters,
		useUnitsOfMeasure,
		type ItemMaster
	} from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { ulid } from '$lib/db/ulid';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelters } from '$lib/features/shelters';
	import {
		isStoragePointChosen,
		ItemCombobox,
		storageLotFields,
		StoragePointSelect,
		toStockFormItems,
		useStoragePoints,
		type StockFormItem
	} from '$lib/features/operations';

	let {
		initialQuery = '',
		initialView = 'scan',
		onSaved,
		onClose
	}: {
		initialQuery?: string;
		/** Open straight on the walk-in form (the list's "ลงทะเบียน Walk-in" button). */
		initialView?: 'scan' | 'walkin';
		onSaved?: () => void;
		onClose?: () => void;
	} = $props();

	// The opening view only — staff switch between scan and walk-in from here on.
	let activeView = $state<'scan' | 'walkin'>(untrack(() => initialView));
	let scanState = $state<'idle' | 'scanning' | 'result'>('idle');
	let searchQuery = $state('');

	// Action panels for verifying view
	let actionPanel = $state<'none' | 'redirect'>('none');
	let selectedTargetShelter = $state('');
	let redirectNote = $state('');
	let rejectOpen = $state(false);
	const sheltersQuery = useShelters();
	// Everywhere but here: the shelter already holding the goods is not a destination
	// (the route answers `SAME_SHELTER`), so it never reaches the dropdown.
	const redirectTargets = $derived(
		(sheltersQuery.data ?? []).filter((s) => s.code !== donationDoc?.shelter_code)
	);

	// Catalog items query
	const supplyItemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());

	// De-duplicated across both catalog generations (schema.md §4.2) — the same goods
	// exist as `item:rice` and `item_master:rice`, and this list showed each twice.
	const catalogItems = $derived(
		mergeCatalogGenerations(supplyItemsQuery.data ?? [], itemMastersQuery.data ?? []).map((c) => ({
			...c,
			unit: c.unit || 'piece',
			category: c.category || 'other'
		}))
	);

	// The searchable picker (#638) takes the stock-form shape; keep it to the ids the
	// merged list above kept, so an item that exists in both generations shows once.
	const pickerItems = $derived.by(() => {
		const keep = new Set(catalogItems.map((c) => c._id));
		const listed = toStockFormItems(
			supplyItemsQuery.data ?? [],
			itemMastersQuery.data ?? []
		).filter((i) => keep.has(i._id));
		const listedIds = new Set(listed.map((i) => i._id));
		return [...listed, ...pickedOffList.filter((i) => !listedIds.has(i._id))];
	});

	// Items picked that the catalog query does not list yet — one just created from the
	// picker shows up there only after the refetch. Until then its name and expiry rule
	// come from here, so the lot panel does not print the raw id and the expiry check
	// does not let the line through.
	let pickedOffList = $state<StockFormItem[]>([]);

	function rememberPicked(picked: StockFormItem | null) {
		if (!picked || catalogItems.some((c) => c._id === picked._id)) return;
		pickedOffList = [...pickedOffList.filter((i) => i._id !== picked._id), picked];
	}

	// "เพิ่มสินค้าใหม่" sits beside the picker and opens a side sheet — the same shape as
	// the stock page's receive panel — instead of the picker's own create entry, which is
	// a centred dialog. Here the form is a full page, so the sheet has room and the
	// donor's lines stay in view while the item is filled in.
	const canCreateItem = $derived(canWriteShelterCatalog(authStore.user?.roles ?? []));
	const isMobileViewport = new IsMobile();
	let createOpen = $state(false);
	let createTarget = $state<
		| { kind: 'scan'; index: number; name: string }
		| { kind: 'walkin'; index: number; name: string }
		| null
	>(null);

	function openCreateItem(target: NonNullable<typeof createTarget>) {
		createTarget = target;
		createOpen = true;
	}

	/** A created item, or the existing one picked instead, lands on the line that asked. */
	function finishCreateItem(master: ItemMaster) {
		const target = createTarget;
		createOpen = false;
		createTarget = null;
		if (!target) return;
		const picked = toStockFormItems([], [master])[0] ?? null;
		if (target.kind === 'scan') {
			const line = scannedItems[target.index];
			if (line) mapScannedItem(line, picked);
		} else {
			handleWalkinItemSelect(target.index, picked);
		}
	}

	/** A picker row's unit in the staff's language (#636) — the option list showed raw codes. */
	function pickerUnitLabel(item: StockFormItem): string {
		return formatUnit(item.unit, unitsOfMeasure, langState.current) || item.unit;
	}

	// CR-139 FR-11: the shelter's own storage points ("จุดเก็บของ"), not a fixed Zone A–F
	// list. Required only when the shelter has set some up (N1); none → main store.
	const storagePoints = useStoragePoints(() => getShelterCode());
	const storagePointRequired = $derived(storagePoints.points.length > 0);

	/** The `lot` location fields for a line's chosen point ('' = main store). */
	function lotLocation(pointId: string) {
		return storageLotFields(storagePoints.points.find((p) => p.id === pointId) ?? null);
	}

	/** A stock item's name for the lot panel; the raw id only when it is no longer listed. */
	function catalogName(itemId: string): string {
		return (
			catalogItems.find((c) => c._id === itemId)?.name ??
			pickedOffList.find((i) => i._id === itemId)?.name ??
			itemId
		);
	}

	/** Does this catalog id require an expiry date (CR-143 FR-D1)? Drives the check below. */
	function isPerishable(itemId: string): boolean {
		const item =
			catalogItems.find((c) => c._id === itemId) ?? pickedOffList.find((i) => i._id === itemId);
		return item?.requiresExpiry === true;
	}

	const redirectTargetLabel = $derived.by(() => {
		const picked = redirectTargets.find((t) => t.code === selectedTargetShelter);
		return picked ? `${picked.name} (${picked.code})` : '-- เลือกศูนย์พักพิงปลายทาง --';
	});

	// Scanned booking data
	let donationDoc = $state<ScanDonationView | null>(null);

	// The goods are at the counter of the shelter staff are working in. A booking made
	// out to another shelter is not received or rejected here — staff switch shelter
	// first, or the stock would land in the other shelter's ledger. Only system admins
	// ever reach this: the route already refuses other staff a booking outside their own.
	const otherShelterCode = $derived(
		donationDoc && donationDoc.shelter_code !== getShelterCode() ? donationDoc.shelter_code : null
	);
	const otherShelterName = $derived(
		(sheltersQuery.data ?? []).find((s) => s.code === otherShelterCode)?.name ?? otherShelterCode
	);
	// What staff read off the ticket — display only; a walk-in has none.
	let bookingRef = $state('');
	/**
	 * The handle every action URL uses: the query that just resolved this donation
	 * (`booking_ref`, doc id, or tracking token — the server accepts all three).
	 * Actions used to key on `booking_ref` alone and return early when it was empty,
	 * so a counter-keyed donation could be opened but never received or rejected.
	 */
	let actionRef = $state('');
	let donorName = $state('');
	let donorPhone = $state('');
	let donorEmail = $state('');

	type ScannedItem = {
		key: string;
		name: string;
		declaredQty: string;
		/** The unit the donor declared — shown for reference, never sent (#623). */
		declaredUnit: string;
		qty: string;
		/** The unit staff count in: the mapped stock item's `base_unit`. */
		unit: string;
		item_id?: string;
		expiry: string;
		/** Chosen storage point id; '' = main store. */
		storage_point_id: string;
		diffReason: string;
		verified: boolean;
		/**
		 * Staff turn the whole line away (CR-172 FR-9): it needs a reason the donor will
		 * read, and none of the stock fields above.
		 */
		rejected: boolean;
		rejectCode?: DonationRejectReasonCode;
		rejectNote: string;
		/**
		 * Set when the line was refused at review (CR-174): it stays refused, with the
		 * reason the donor was already given — shown here, not asked for again.
		 */
		reviewReason?: string;
	};

	function hasRejectReason(it: ScannedItem): boolean {
		if (it.reviewReason !== undefined) return true;
		return rejectDonationInputSchema.safeParse({ reason_code: it.rejectCode, note: it.rejectNote })
			.success;
	}

	let scannedItems = $state<ScannedItem[]>([]);
	let remarks = $state('');
	let saving = $state(false);
	// UOM master data (CR-125): `base_unit` is stored as a canonical code, so every
	// place this file SHOWS a unit runs it back through `formatUnit`.
	const unitsOfMeasureQuery = useUnitsOfMeasure();
	const unitsOfMeasure = $derived(unitsOfMeasureQuery.data ?? []);
	let lastLots = $state<{ item_id: string; lot_no: string | null }[]>([]);

	const VEHICLE_LABELS: Record<string, string> = {
		motorcycle: 'รถจักรยานยนต์',
		car: 'รถยนต์ส่วนบุคคล',
		pickup: 'รถกระบะ',
		truck: 'รถบรรทุก'
	};

	/** What the donor booked, or how the goods are coming when no vehicle applies. */
	const vehicleLabel = $derived.by(() => {
		const logistics = donationDoc?.logistics;
		if (logistics?.vehicle) return VEHICLE_LABELS[logistics.vehicle] ?? logistics.vehicle;
		if (logistics?.delivery_method === 'parcel') return 'ส่งทางพัสดุ/ขนส่ง';
		if (logistics?.delivery_method === 'shelter_pickup') return 'รถของศูนย์ไปรับ';
		return 'ไม่ได้ระบุยานพาหนะ';
	});

	/**
	 * The donor's own words. They live on the item lines (`items[].note`) — the scan
	 * view has no note field of its own, so reading one off the doc always fell through
	 * to sample copy.
	 */
	// Empty when the donor wrote nothing — the section is then left out, not filled in.
	const donorNote = $derived(
		(donationDoc?.items ?? [])
			.map((it) => it.note?.trim())
			.filter((n): n is string => Boolean(n))
			.join('\n')
	);

	// QR camera. `html5-qrcode` is already a dependency and the people check-in
	// scanner uses the same shape (`cameraAttachment`), so the two behave alike.
	let cameraOpen = $state(false);
	let cameraError = $state('');
	let lastScannedCode = $state('');
	let lastScanTime = $state(0);

	function cameraAttachment(node: HTMLDivElement) {
		const reader = new Html5Qrcode(node.id);

		reader
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const size = Math.floor(Math.min(width, height) * 0.7);
						return { width: size, height: size };
					}
				},
				(decodedText) => {
					const value = decodedText.trim();
					if (!value) return;
					// The same ticket stays in frame for many frames; ignore repeats for a
					// moment so one presentation is one lookup.
					const now = Date.now();
					const cooldown = value === lastScannedCode ? 3000 : 1500;
					if (scanState === 'scanning' || now - lastScanTime < cooldown) return;
					lastScanTime = now;
					lastScannedCode = value;
					if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
					cameraOpen = false;
					// The ticket QR carries the tracking token (or the booking ref) —
					// `findDonationByQuery` resolves either, plus the doc id.
					searchQuery = value;
					performLookup(value);
				},
				() => {
					// Per-frame decode misses are normal; nothing to report.
				}
			)
			.catch(() => {
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้ — โปรดอนุญาตให้เบราว์เซอร์ใช้กล้อง แล้วลองอีกครั้ง';
				cameraOpen = false;
			});

		return () => {
			if (reader.isScanning) {
				reader.stop().catch(() => {
					// The view is unmounting anyway.
				});
			}
		};
	}

	function openCamera() {
		cameraError = '';
		cameraOpen = true;
	}

	/** Manual entry — the box next to the camera, not a stand-in for it. */
	function lookupTyped() {
		const ref = searchQuery.trim();
		if (!ref) {
			toast.info('กรุณากรอกรหัสการจอง หรือสแกน QR จากใบจองของผู้บริจาค');
			return;
		}
		performLookup(ref, true);
	}

	/**
	 * When the donor said they would arrive. Reads the booked slot, then the ETA —
	 * and says so plainly when the booking carries neither, instead of showing a date
	 * that was never agreed with anyone.
	 */
	const appointmentLabel = $derived.by(() => {
		const logistics = donationDoc?.logistics;
		const slot = logistics?.slot;
		if (slot?.date) {
			const time = slot.from && slot.to ? ` ${slot.from}-${slot.to} น.` : '';
			return `${slot.date}${time}`;
		}
		if (logistics?.eta) return logistics.eta;
		return 'ไม่ได้ระบุนัดหมาย';
	});

	/**
	 * Lines whose item is perishable but whose expiry is still blank. The intake route
	 * refuses these (`assertCountedAgainstCatalog`), so they have to block the button
	 * rather than surface as a raw English error after the whole form is filled.
	 */
	const keptItems = $derived(scannedItems.filter((it) => !it.rejected));
	const rejectedCount = $derived(scannedItems.length - keptItems.length);

	const scannedMissingExpiry = $derived(
		linesMissingExpiry(
			keptItems.map((it) => ({
				item_id: it.item_id,
				name: it.name,
				perishable: it.item_id ? isPerishable(it.item_id) : false,
				expiry: it.expiry
			}))
		)
	);

	// Validation check for receiving into stock
	const canReceive = $derived(
		!otherShelterCode &&
			scannedItems.length > 0 &&
			!storagePoints.isLoading &&
			scannedItems.every((it) =>
				it.rejected
					? hasRejectReason(it)
					: it.verified &&
						it.item_id &&
						it.qty &&
						isStoragePointChosen(it.storage_point_id, storagePoints.points)
			) &&
			scannedMissingExpiry.length === 0
	);

	// The receive checklist in the action panel — one line per condition `canReceive`
	// waits on, ticked as staff complete it (it used to be a red error box listing
	// what was still missing, which read as a failure before anything had been done).
	const checkMapped = $derived(
		scannedItems.length > 0 && keptItems.every((it) => it.item_id && it.qty)
	);
	const checkZoned = $derived(
		scannedItems.length > 0 &&
			keptItems.every((it) => isStoragePointChosen(it.storage_point_id, storagePoints.points))
	);
	const checkRejectReasons = $derived(
		scannedItems.filter((it) => it.rejected).every(hasRejectReason)
	);
	// A line turned away with its reason counts as checked too.
	const verifiedCount = $derived(
		scannedItems.filter((it) => (it.rejected ? hasRejectReason(it) : it.verified)).length
	);
	const hasPerishableLine = $derived(
		keptItems.some((it) => it.item_id && isPerishable(it.item_id))
	);
	const receiveLabel = $derived(
		rejectedCount === 0
			? 'ยืนยันรับเข้าคลัง'
			: keptItems.length === 0
				? 'ปฏิเสธทั้งใบ'
				: `รับ ${keptItems.length} รายการ · ไม่รับ ${rejectedCount} รายการ`
	);

	/**
	 * How the counted quantity differs from what the donor declared, or null when it
	 * does not (or the box is not a number yet). The field starts pre-filled with the
	 * declared amount, so a "matches" badge would show before anyone had counted —
	 * only a difference is worth flagging. Lines counted in another unit than the donor
	 * declared do not compare at all (#623).
	 */
	function qtyDifference(item: ScannedItem): { more: boolean; amount: string } | null {
		return receivedQtyDifference({
			declaredQty: item.declaredQty,
			declaredUnit: canonicalizeUnitCode(item.declaredUnit, unitsOfMeasure),
			qty: item.qty,
			unit: canonicalizeUnitCode(item.unit, unitsOfMeasure) ?? item.unit
		});
	}

	/**
	 * Map a line to a stock item. The line's unit becomes that item's `base_unit`: the
	 * ledger row is denominated in it (schema.md §2.1), and keeping the donor's unit is
	 * what failed every receipt with `CATALOG_MISMATCH` ("expected bottle, got box", #623).
	 */
	function mapScannedItem(item: ScannedItem, picked: StockFormItem | null) {
		rememberPicked(picked);
		item.item_id = picked?._id ?? '';
		if (picked) item.unit = picked.unit;
	}

	/** The one logistics detail staff act on at the counter, when the booking has one. */
	const logisticsDetail = $derived.by(() => {
		const logistics = donationDoc?.logistics;
		if (logistics?.delivery_method === 'shelter_pickup' && logistics.pickup_address) {
			return { label: 'ที่อยู่เข้ารับของ', value: logistics.pickup_address };
		}
		if (logistics?.delivery_method === 'parcel') {
			return { label: 'เลขพัสดุ', value: logistics.courier_tracking_no || 'ยังไม่ได้แจ้ง' };
		}
		return null;
	});

	// Walk-in form state
	let walkinDonorName = $state('');
	let walkinDonorPhone = $state('');
	let walkinDonorEmail = $state('');
	type WalkinItemState = {
		id: string;
		itemId: string;
		name: string;
		qty: string;
		unit: string;
		expiry: string;
		/** Chosen storage point id; '' = main store. */
		storagePointId: string;
	};
	let walkinItems = $state<WalkinItemState[]>([
		{
			id: ulid(),
			itemId: '',
			name: '',
			qty: '1',
			unit: 'piece',
			expiry: '',
			storagePointId: ''
		}
	]);
	let walkinSaving = $state(false);

	/**
	 * `fromList` — opened from a row of the booking list: a miss there sends staff back to
	 * the list. A typed or scanned code that misses keeps the scanner open to try again.
	 */
	async function performLookup(query: string, simulateScanEffect = false, fromList = false) {
		if (!query.trim()) return;
		lastLots = [];
		actionPanel = 'none';
		scanState = 'scanning';

		if (simulateScanEffect) {
			await new Promise((r) => setTimeout(r, 600));
		}

		try {
			const res = await fetch(`/api/back-office/donations/${encodeURIComponent(query.trim())}`);
			if (!res.ok) {
				const errorData = await res.json().catch(() => ({}));
				toast.error(errorData.error || 'ไม่พบข้อมูลการจองบริจาคนี้');
				scanState = 'idle';
				if (fromList) onClose?.();
				return;
			}
			const data = await res.json();
			if (data.success && data.donation) {
				donationDoc = data.donation as ScanDonationView;
				bookingRef = donationDoc?.booking_ref || '';
				actionRef = donationDoc?.booking_ref || query.trim();
				donorName = donationDoc?.donor?.name || 'ไม่ระบุชื่อ';
				donorPhone = donationDoc?.donor?.phone || '';
				donorEmail = donationDoc?.donor?.email ?? '';

				scannedItems = (donationDoc?.items || []).map((it, i) => {
					const declared = it.qty != null && it.qty !== '' ? String(it.qty) : '1';
					// Auto map item_id if matching catalog
					const matched = catalogItems.find(
						(c) =>
							c._id === it.item_id ||
							(it.free_text && c.name.toLowerCase() === it.free_text.toLowerCase())
					);

					return {
						key: `${it.item_id ?? it.free_text ?? 'line'}-${i}`,
						name: it.free_text || it.item_id || 'ไม่ระบุรายการ',
						declaredQty: declared,
						declaredUnit: it.unit || '',
						qty: declared,
						// Count in the matched item's own unit; the donor's stays for reference.
						unit: matched?.unit || it.unit || '',
						item_id: matched?._id || it.item_id || '',
						expiry: '',
						storage_point_id: '',
						diffReason: '',
						verified: false,
						// Refused at review (CR-174): it arrives turned away, with the same reason.
						rejected: it.review_status === 'rejected',
						rejectCode:
							it.review_status === 'rejected' ? (it.review_reason_code ?? 'other') : undefined,
						rejectNote: '',
						...(it.review_status === 'rejected' ? { reviewReason: it.review_reason ?? '' } : {})
					};
				});

				scanState = 'result';
			} else {
				toast.error('ไม่พบข้อมูลการจองบริจาคนี้');
				scanState = 'idle';
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการตรวจสอบข้อมูล');
			scanState = 'idle';
		}
	}

	function handleCancel() {
		scanState = 'idle';
		actionRef = '';
		selectedTargetShelter = '';
		redirectNote = '';
		rejectOpen = false;
		lastLots = [];
		searchQuery = '';
		donationDoc = null;
		scannedItems = [];
		remarks = '';
		actionPanel = 'none';
		onClose?.();
	}

	async function handleSaveScan() {
		if (!actionRef || saving || otherShelterCode) return;
		saving = true;
		try {
			const res = await fetch(`/api/back-office/donations/${encodeURIComponent(actionRef)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: 'received',
					expected_rev: donationDoc?.rev,
					...(remarks.trim() ? { remarks: remarks.trim() } : {}),
					items: scannedItems.map((it) => {
						if (it.rejected) {
							return {
								...(it.item_id ? { item_id: it.item_id } : { free_text: it.name }),
								qty: '0',
								unit: it.unit || it.declaredUnit,
								rejected: true,
								reject_reason_code: it.rejectCode,
								// A review refusal is re-read from the doc by the server; the note only
								// has to satisfy the request shape here.
								...(it.reviewReason !== undefined
									? { reject_note: (it.reviewReason || 'ไม่รับตั้งแต่ตอนประเมิน').slice(0, 400) }
									: it.rejectNote.trim()
										? { reject_note: it.rejectNote.trim() }
										: {})
							};
						}
						const location = lotLocation(it.storage_point_id);
						return {
							...(it.item_id ? { item_id: it.item_id } : { free_text: it.name }),
							qty: it.qty,
							unit: it.unit,
							...(it.item_id && (it.expiry || location.storage_point_id)
								? { lot: { ...(it.expiry ? { expiry: it.expiry } : {}), ...location } }
								: {})
						};
					})
				})
			});
			const data = await res.json();
			if (data.success) {
				lastLots = (data.lots ?? []) as { item_id: string; lot_no: string | null }[];
				const labels = lastLots.map((l) => l.lot_no).filter(Boolean);
				const ref = bookingRef || actionRef;
				// Every line turned away rejects the booking instead (CR-172 FR-12).
				const refused = data.donation?.status === 'rejected';
				toast.success(
					refused
						? `ปฏิเสธใบบริจาค ${ref} เรียบร้อยแล้ว (ไม่รับทุกรายการ)`
						: labels.length
							? `บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${ref}) · เลขล็อต ${labels.join(', ')}`
							: `บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${ref})`
				);
				scanState = 'idle';
				searchQuery = '';
				donationDoc = null;
				remarks = '';
				onSaved?.();
			} else if (data.error_code === 'DONATION_CHANGED') {
				toast.error('ผู้บริจาคแก้ใบนี้หลังจากเปิดหน้าตรวจรับ', {
					description: 'ค้นหาใบใหม่แล้วตรวจรายการอีกครั้ง — ยังไม่มีของเข้าคลัง',
					duration: 12_000
				});
			} else if (data.error_code === 'CATALOG_MISMATCH') {
				toast.error('หน่วยในใบจองไม่ตรงกับหน่วยมาตรฐานในคลัง — รับเข้าคลังไม่ได้', {
					description: `${data.error} · แก้ที่ต้นทางใบจอง หรือแจ้งผู้ดูแลระบบ`,
					duration: 12_000
				});
			} else {
				toast.error(data.error || 'บันทึกไม่สำเร็จ');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
		} finally {
			saving = false;
		}
	}

	async function handleConfirmRedirect() {
		if (!actionRef || !selectedTargetShelter || saving) return;
		saving = true;
		try {
			const res = await fetch(
				`/api/back-office/donations/${encodeURIComponent(actionRef)}/redirect`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						target_shelter_code: selectedTargetShelter,
						note: redirectNote.trim(),
						expected_rev: donationDoc?.rev
					})
				}
			);
			const data = await res.json();
			if (data.success) {
				toast.success(`ประสานงานส่งต่อไปยังศูนย์ ${selectedTargetShelter} สำเร็จ`);
				handleCancel();
				onSaved?.();
			} else {
				toast.error(data.error || 'ไม่สามารถส่งต่อคำขอได้');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการส่งต่อ');
		} finally {
			saving = false;
		}
	}

	async function handleConfirmReject(input: RejectDonationInput) {
		if (!actionRef || saving || otherShelterCode) return;
		saving = true;
		try {
			const res = await fetch(
				`/api/back-office/donations/${encodeURIComponent(actionRef)}/reject`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...input, expected_rev: donationDoc?.rev })
				}
			);
			const data = await res.json();
			if (data.success) {
				toast.success(`ปฏิเสธคำขอ ${bookingRef || actionRef} เรียบร้อยแล้ว`);
				handleCancel();
				onSaved?.();
			} else {
				toast.error(data.error || 'ไม่สามารถปฏิเสธคำขอได้');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาด');
		} finally {
			saving = false;
		}
	}

	// Walk-in form handlers
	function addWalkinItem() {
		walkinItems.push({
			id: ulid(),
			itemId: '',
			name: '',
			qty: '1',
			unit: 'piece',
			expiry: '',
			storagePointId: ''
		});
	}

	function removeWalkinItem(id: string) {
		walkinItems = walkinItems.filter((i) => i.id !== id);
	}

	function handleWalkinItemSelect(index: number, picked: StockFormItem | null) {
		const item = walkinItems[index];
		if (!item) return;
		rememberPicked(picked);
		item.itemId = picked?._id ?? '';
		if (picked) {
			item.name = picked.name;
			item.unit = picked.unit;
		}
	}

	async function handleSaveWalkin() {
		if (!walkinDonorName.trim()) {
			toast.error('กรุณาระบุชื่อผู้บริจาค');
			return;
		}
		const validItems = walkinItems.filter((it) => it.itemId && qtyGt(it.qty || '0', 0));
		if (validItems.length === 0) {
			toast.error('กรุณาเลือกรายการสิ่งของอย่างน้อย 1 รายการพร้อมระบุจำนวน');
			return;
		}

		// Same rule the intake route enforces (schema.md §2.1): a perishable lot with no
		// expiry cannot be rotated or discarded on time, and the ledger is append-only.
		const missingExpiry = linesMissingExpiry(
			validItems.map((it) => ({
				item_id: it.itemId,
				name: it.name,
				perishable: isPerishable(it.itemId),
				expiry: it.expiry
			}))
		);
		if (missingExpiry.length > 0) {
			toast.error(`ของเน่าเสียง่ายต้องระบุวันหมดอายุ: ${missingExpiry.join(', ')}`);
			return;
		}

		walkinSaving = true;
		try {
			// The counter does NOT write CouchDB directly: the server route mints the
			// lot numbers (CR-088), writes the audit trail (T-16) and checks every line
			// against the catalog — and receives the donation in the same step, so the
			// goods are never counted twice (once as an open booking, once as stock).
			const res = await fetch('/api/back-office/donations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					// The shelter this station is working in. A shelter-scoped caller has the
					// server ignore it (their own scope wins), but a system admin has no
					// shelter of their own — without it the route can only answer
					// SHELTER_REQUIRED, which is what the counter form used to hit.
					shelter_code: getShelterCode(),
					donor: {
						name: walkinDonorName.trim(),
						...(walkinDonorPhone.trim() ? { phone: walkinDonorPhone.trim() } : {}),
						...(walkinDonorEmail.trim() ? { email: walkinDonorEmail.trim() } : {})
					},
					items: validItems.map((it) => {
						const location = lotLocation(it.storagePointId);
						return {
							item_id: it.itemId,
							qty: it.qty,
							unit: it.unit,
							...(it.expiry.trim() || location.storage_point_id
								? {
										lot: {
											...(it.expiry.trim() ? { expiry: it.expiry.trim() } : {}),
											...location
										}
									}
								: {})
						};
					})
				})
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				toast.error(data.error || 'บันทึกบริจาค Walk-in ไม่สำเร็จ');
				return;
			}

			lastLots = data.lots ?? [];
			toast.success(
				`บันทึกบริจาค Walk-in สำเร็จ (${validItems.length} รายการ) — อ้างอิง ${data.booking_ref ?? data.donation_id}`
			);
			activeView = 'scan';
			walkinDonorName = '';
			walkinDonorPhone = '';
			walkinDonorEmail = '';
			walkinItems = [
				{
					id: ulid(),
					itemId: '',
					name: '',
					qty: '1',
					unit: 'piece',
					expiry: '',
					storagePointId: ''
				}
			];
			onSaved?.();
		} catch {
			toast.error('บันทึกไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง');
		} finally {
			walkinSaving = false;
		}
	}

	onMount(() => {
		// The list mounts a fresh station per row (it is behind an `{#if}`), so the ref is
		// looked up once here. It used to run in `onMount` AND an `$effect`, which fired
		// the same request twice on every open.
		if (initialQuery) {
			searchQuery = initialQuery;
			performLookup(initialQuery, false, true);
		}
	});
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	{#if activeView === 'scan'}
		{#if scanState === 'result'}
			<!-- Verifying drop-off: count the goods in (left), confirm or reject (right). -->
			<div>
				<!-- Header -->
				<div class="bg-[#002D5B] p-6 text-white md:p-8 dark:bg-slate-900">
					<Button
						variant="link"
						size="sm"
						type="button"
						onclick={handleCancel}
						class="mb-3 h-auto gap-1.5 p-0 text-sm font-medium text-blue-200 no-underline hover:text-white hover:no-underline"
					>
						<ArrowLeft class="size-4" />
						{onClose ? 'กลับไปที่รายการของบริจาค' : 'กลับหน้าสแกนรับของ'}
					</Button>
					<div class="flex flex-wrap items-center gap-3">
						<span
							class="hidden h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white sm:inline-flex"
						>
							<PackageCheck class="h-5 w-5" />
						</span>
						<div class="min-w-0 basis-full sm:flex-1 sm:basis-auto">
							<h2 class="text-base font-bold text-white md:text-lg">
								{donationRefLabel({ booking_ref: bookingRef })} - ตรวจรับพัสดุบริจาค
							</h2>
							<p class="text-sm text-blue-100">
								{donorName || 'ไม่ระบุชื่อ'}
								{#if donorPhone}· <span class="tabular-nums">{donorPhone}</span>{/if}
							</p>
						</div>
						<span
							class="order-first inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900 sm:order-last"
						>
							<ClipboardCheck class="h-3.5 w-3.5" />
							กำลังตรวจรับ
						</span>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-5 bg-[#F8FAFC] p-4 sm:p-6 lg:grid-cols-12">
					<!-- Left: items to count -->
					<div class="space-y-4 lg:col-span-7">
						<div class="flex items-baseline justify-between gap-2">
							<h3 class="text-base font-semibold text-slate-800">รายการที่ต้องตรวจรับ</h3>
							<span class="text-sm text-slate-500 tabular-nums">
								ตรวจแล้ว {verifiedCount} / {scannedItems.length} รายการ
							</span>
						</div>

						{#each scannedItems as item, idx (item.key)}
							{@const diff = qtyDifference(item)}
							<div
								class="rounded-xl border bg-white shadow-2xs {item.rejected
									? 'border-rose-200'
									: item.verified
										? 'border-emerald-200'
										: 'border-slate-200/80'}"
							>
								<!-- Item header -->
								<div
									class="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4 sm:px-5"
								>
									<Package class="h-5 w-5 shrink-0 text-slate-400" />
									<span class="text-base font-bold text-slate-900">{item.name}</span>
									<span class="text-sm text-slate-500">
										แจ้งไว้ <span class="tabular-nums">{item.declaredQty}</span>
										{formatUnit(item.declaredUnit, unitsOfMeasure, langState.current) ||
											item.declaredUnit}
									</span>
									{#if diff && !item.rejected}
										<span
											class="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
										>
											<AlertTriangle class="h-3.5 w-3.5" />
											{diff.more ? 'มากกว่า' : 'น้อยกว่า'}ที่แจ้ง
											<span class="tabular-nums">{diff.amount}</span>
											{formatUnit(item.unit, unitsOfMeasure, langState.current)}
										</span>
									{/if}
								</div>

								{#if item.reviewReason !== undefined}
									<!-- Refused at review: nothing to count and nothing to decide here. -->
									<div class="p-4 sm:px-5">
										<div class="rounded-xl border border-red-200 bg-white p-4">
											<p class="text-sm font-semibold text-red-900">ไม่รับตั้งแต่ตอนประเมิน</p>
											<p class="mt-1 text-base break-words text-slate-700">
												{item.reviewReason || 'ไม่ได้ระบุเหตุผล'}
											</p>
										</div>
									</div>
								{:else if item.rejected}
									<!-- Turned away (CR-172 FR-9): no stock fields, only why. -->
									<div class="p-4 sm:px-5">
										<RejectReasonFields
											bind:code={item.rejectCode}
											bind:note={item.rejectNote}
											idPrefix="line-{idx}-reject"
											disabled={saving || !!otherShelterCode}
										/>
									</div>
								{:else}
									<!-- Fields: what it is and how much, then where it goes -->
									<div class="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:px-5">
										<div class="space-y-1.5">
											<Label for="map-master-{idx}" class="text-sm font-semibold text-slate-700">
												รายการในคลัง <span class="text-red-500">*</span>
											</Label>
											<ItemCombobox
												id="map-master-{idx}"
												items={pickerItems}
												value={item.item_id}
												isLoading={supplyItemsQuery.isLoading || itemMastersQuery.isLoading}
												placeholder="ค้นหารายการในคลัง…"
												formatBalanceUnit={pickerUnitLabel}
												onSelect={(picked) => mapScannedItem(item, picked)}
											/>
											{#if canCreateItem && !otherShelterCode}
												<Button
													type="button"
													variant="ghost"
													class="min-h-9 gap-1 px-2 text-sm font-semibold text-sky-800"
													onclick={() =>
														openCreateItem({ kind: 'scan', index: idx, name: item.name })}
												>
													<Plus class="size-4" aria-hidden="true" />
													เพิ่มสินค้าใหม่
												</Button>
											{/if}
										</div>

										<div class="space-y-1.5">
											<Label for="item-qty-{idx}" class="text-sm font-semibold text-slate-700">
												จำนวนรับจริง <span class="text-red-500">*</span>
											</Label>
											<div class="relative flex items-center">
												<Input
													id="item-qty-{idx}"
													type="text"
													inputmode="decimal"
													bind:value={item.qty}
													class="h-11 pr-16 text-base font-bold tabular-nums"
												/>
												<span
													class="pointer-events-none absolute right-3 text-sm font-medium text-slate-500"
												>
													{formatUnit(item.unit, unitsOfMeasure, langState.current)}
												</span>
											</div>
										</div>

										<div class="space-y-1.5">
											<Label for="storage-zone-{idx}" class="text-sm font-semibold text-slate-700">
												สถานที่จัดเก็บ
												{#if storagePointRequired}<span class="text-red-500">*</span>{/if}
											</Label>
											<StoragePointSelect
												id="storage-zone-{idx}"
												points={storagePoints.points}
												bind:value={item.storage_point_id}
											/>
										</div>

										<div class="space-y-1.5">
											<Label for="item-expiry-{idx}" class="text-sm font-semibold text-slate-700">
												วันหมดอายุ
												{#if item.item_id && isPerishable(item.item_id)}
													<span class="text-red-500">*</span>
													<span class="text-xs font-normal text-red-700">(ของเน่าเสียง่าย)</span>
												{:else}
													<span class="text-xs font-normal text-slate-500">(ถ้ามี)</span>
												{/if}
											</Label>
											<DatePicker
												id="item-expiry-{idx}"
												ariaLabel="วันหมดอายุ"
												bind:value={item.expiry}
												class="h-11 text-sm {item.item_id &&
												isPerishable(item.item_id) &&
												!item.expiry
													? 'border-red-300'
													: ''}"
											/>
										</div>

										<div class="space-y-1.5 sm:col-span-2">
											<Label for="item-remark-{idx}" class="text-sm font-semibold text-slate-700">
												หมายเหตุ / เหตุผลที่จำนวนต่างจากที่แจ้ง
											</Label>
											<Input
												id="item-remark-{idx}"
												type="text"
												placeholder="เช่น แตกเสียหาย 2 ขวด (ถ้ามี)"
												bind:value={item.diffReason}
												class="h-11 text-sm"
											/>
										</div>
									</div>
								{/if}

								<!-- Decide the line right under what was counted: checked, or turned away. -->
								<div class="rounded-b-xl border-t border-slate-100 bg-slate-50/60 p-4 sm:px-5">
									<LineDecisionToggle
										bind:value={
											() => (item.rejected ? 'reject' : item.verified ? 'accept' : null),
											(next) => {
												item.verified = next === 'accept';
												item.rejected = next === 'reject';
											}
										}
										acceptLabel="ผ่านการตรวจสอบแล้ว"
										acceptHint="ของจริงตรงกับรายการ จำนวน และสภาพ"
										rejectHint="ไม่เข้าคลัง แจ้งเหตุผลให้ผู้บริจาค"
										groupLabel="ผลการตรวจรับ {item.name}"
										disabled={saving || !!otherShelterCode || item.reviewReason !== undefined}
									/>
								</div>
							</div>
						{/each}

						{#if donorNote}
							<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:px-5">
								<h4 class="text-base font-semibold text-slate-800">คำชี้แจงจากผู้บริจาค</h4>
								<p class="mt-1 text-base whitespace-pre-line text-slate-700">{donorNote}</p>
							</div>
						{/if}
					</div>

					<!-- Right: booking facts, memo, and the decision -->
					<div class="space-y-4 lg:sticky lg:top-4 lg:col-span-5 lg:self-start">
						<div class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
							<h4 class="text-sm font-semibold text-slate-700">ข้อมูลการจอง</h4>
							<dl class="space-y-2.5 text-sm">
								<div class="flex gap-2.5">
									<User class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
									<div>
										<dt class="sr-only">ผู้บริจาค</dt>
										<dd class="font-semibold text-slate-900">{donorName || 'ไม่ระบุชื่อ'}</dd>
										<dd class="text-slate-500 tabular-nums">
											{donorPhone || 'ไม่ระบุเบอร์โทร'}
										</dd>
										{#if donorEmail}<dd class="text-slate-500">{donorEmail}</dd>{/if}
									</div>
								</div>
								<div class="flex gap-2.5">
									<Truck class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
									<div>
										<dt class="text-xs text-slate-500">วิธีส่ง / ยานพาหนะ</dt>
										<dd class="font-semibold text-slate-900">{vehicleLabel}</dd>
									</div>
								</div>
								<div class="flex gap-2.5">
									<Calendar class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
									<div>
										<dt class="text-xs text-slate-500">นัดหมาย</dt>
										<dd class="font-semibold text-slate-900 tabular-nums">{appointmentLabel}</dd>
									</div>
								</div>
								{#if logisticsDetail}
									<div class="flex gap-2.5">
										<MapPin class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
										<div>
											<dt class="text-xs text-slate-500">{logisticsDetail.label}</dt>
											<dd class="font-semibold text-slate-900">{logisticsDetail.value}</dd>
										</div>
									</div>
								{/if}
							</dl>
						</div>

						<div class="space-y-1.5 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
							<Label for="review-memo-input" class="text-sm font-semibold text-slate-700">
								บันทึกของเจ้าหน้าที่
							</Label>
							<Textarea
								id="review-memo-input"
								rows={3}
								placeholder="เช่น เก็บตู้แช่สำรองไฟ, กล่องบุบ 1 ใบ"
								bind:value={remarks}
								class="text-sm"
							/>
						</div>

						{#if otherShelterCode}
							<div
								role="alert"
								class="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
							>
								<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
								<p>
									ใบนี้จองส่งไปศูนย์ <strong>{otherShelterName}</strong> แต่คุณกำลังทำงานที่ศูนย์
									<strong>{getShelterCode()}</strong> — สลับศูนย์ที่เมนูด้านซ้ายก่อนรับเข้าคลังหรือปฏิเสธ
								</p>
							</div>
						{/if}

						<div class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
							<h4 class="text-sm font-semibold text-slate-700">ก่อนรับเข้าคลัง</h4>
							<ul class="space-y-2 text-sm">
								{#snippet step(done: boolean, text: string)}
									<li class="flex items-start gap-2 {done ? 'text-emerald-900' : 'text-slate-600'}">
										{#if done}
											<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
										{:else}
											<Circle class="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
										{/if}
										<span>{text}</span>
									</li>
								{/snippet}
								{@render step(checkMapped, 'เลือกรายการในคลังและกรอกจำนวนรับจริงครบ')}
								{#if storagePointRequired}
									{@render step(checkZoned, 'เลือกสถานที่จัดเก็บครบทุกรายการ')}
								{/if}
								{#if hasPerishableLine}
									{@render step(
										scannedMissingExpiry.length === 0,
										'ใส่วันหมดอายุของเน่าเสียง่ายครบ'
									)}
								{/if}
								{#if rejectedCount > 0}
									{@render step(checkRejectReasons, 'ระบุเหตุผลของรายการที่ไม่รับครบ')}
								{/if}
								{@render step(
									scannedItems.length > 0 && verifiedCount === scannedItems.length,
									`ติ๊ก "ผ่านการตรวจสอบแล้ว" ครบ (${verifiedCount}/${scannedItems.length})`
								)}
							</ul>

							<div class="space-y-2">
								<Button
									type="button"
									onclick={handleSaveScan}
									disabled={saving || !canReceive}
									class="h-12 w-full gap-2 text-base font-bold text-white {keptItems.length === 0
										? 'bg-red-600 hover:bg-red-700'
										: 'bg-emerald-600 hover:bg-emerald-700'}"
								>
									<Check class="h-5 w-5" />
									{saving ? 'กำลังบันทึก…' : receiveLabel}
								</Button>

								<!--
								Redirect ("ประสานงานส่งต่อ") is hidden for now: the centre does not hand
								donations off to another shelter yet, so offering the action would promise
								a workflow that has no receiving end. The panel below,
								`handleConfirmRedirect` and the `/redirect` route all stay wired up —
								bringing the action back is uncommenting this button, not rebuilding the
								feature.

								<Button
									type="button"
									onclick={() => (actionPanel = actionPanel === 'redirect' ? 'none' : 'redirect')}
									disabled={saving}
									class="h-11 w-full gap-2"
								>
									<MapPin class="h-4 w-4" />
									ประสานงานส่งต่อ
								</Button>
								-->

								<Button
									variant="outline"
									type="button"
									onclick={() => (rejectOpen = true)}
									disabled={saving || !!otherShelterCode}
									class="h-11 w-full border-red-200 text-sm font-semibold text-red-700 hover:bg-red-50 hover:text-red-800"
								>
									ปฏิเสธคำขอ
								</Button>
							</div>

							{#if actionPanel === 'redirect'}
								<div class="space-y-3 rounded-xl border border-sky-200 bg-sky-50/40 p-4">
									<div class="space-y-1.5">
										<Label for="target-shelter-select" class="text-sm font-semibold text-slate-700">
											ศูนย์ปลายทาง <span class="text-red-500">*</span>
										</Label>
										<Select.Root type="single" bind:value={selectedTargetShelter}>
											<Select.Trigger
												id="target-shelter-select"
												class="h-11 w-full text-sm data-[size=default]:h-11"
											>
												{redirectTargetLabel}
											</Select.Trigger>
											<Select.Content>
												{#each redirectTargets as target (target.code)}
													<Select.Item value={target.code} label="{target.name} ({target.code})" />
												{/each}
											</Select.Content>
										</Select.Root>
									</div>
									<div class="space-y-1.5">
										<Label for="redirect-remark-input" class="text-sm font-semibold text-slate-700">
											หมายเหตุการส่งต่อ
										</Label>
										<Textarea
											id="redirect-remark-input"
											rows={2}
											placeholder="ระบุเหตุผลการส่งต่อ เช่น คลังเต็ม หรือต้องการการดูแลเฉพาะทาง..."
											bind:value={redirectNote}
											class="text-sm"
										/>
									</div>
									<div class="flex gap-2">
										<Button
											type="button"
											onclick={handleConfirmRedirect}
											disabled={saving || !selectedTargetShelter}
											class="h-11 flex-1"
										>
											{saving ? 'กำลังดำเนินการ...' : 'ยืนยันการประสานงานส่งต่อ'}
										</Button>
										<Button
											variant="ghost"
											type="button"
											onclick={() => (actionPanel = 'none')}
											class="h-11"
										>
											ยกเลิก
										</Button>
									</div>
								</div>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{:else}
			<!-- Idle & Scanning View -->
			<!-- Same navy banner and back link as the review and check-in screens. -->
			<div class="bg-[#002D5B] p-6 text-white md:p-8 dark:bg-slate-900">
				{#if onClose}
					<Button
						variant="link"
						size="sm"
						type="button"
						onclick={() => onClose?.()}
						class="mb-3 h-auto gap-1.5 p-0 text-sm font-medium text-blue-200 no-underline hover:text-white hover:no-underline"
					>
						<ArrowLeft class="size-4" />
						กลับไปที่รายการของบริจาค
					</Button>
				{/if}
				<div class="flex items-center gap-2.5">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
						<Scan class="h-5 w-5" />
					</div>
					<h2 class="text-base font-bold text-white md:text-lg">สแกนรับเข้าคลัง</h2>
				</div>
				<p class="mt-1 text-sm text-blue-100/80">
					สแกน QR Code ใบจองจากมือถือผู้บริจาค หรือค้นหาด้วยรหัสการจอง เพื่อเปิดหน้าตรวจรับ
				</p>
			</div>

			<!-- Scan Body -->
			<div
				class="flex min-h-[440px] flex-col items-center justify-center gap-6 bg-slate-50/40 p-4 sm:p-6 md:p-10 dark:bg-muted/10"
			>
				{#if cameraOpen}
					<!-- Live viewfinder. Same html5-qrcode wiring as the people check-in
					     scanner; closing the block stops the camera (see cameraAttachment). -->
					<div
						class="flex w-full max-w-xl animate-in flex-col items-center gap-5 rounded-2xl border border-border/80 bg-card p-5 text-center shadow-xs duration-200 fade-in sm:p-8"
					>
						<h3 class="text-lg font-bold text-foreground">หันกล้องไปที่ QR Code บนใบจอง</h3>
						<div
							class="relative flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-slate-950 sm:max-w-[340px]"
							style="isolation: isolate; transform: translateZ(0);"
						>
							<div
								id="donation-qr-reader"
								class="h-full w-full overflow-hidden rounded-2xl [&_video]:h-full! [&_video]:w-full! [&_video]:rounded-2xl! [&_video]:bg-transparent! [&_video]:object-cover!"
								style="isolation: isolate; transform: translateZ(0);"
								{@attach cameraAttachment}
							></div>
							<div class="pointer-events-none absolute inset-4">
								<div
									class="absolute top-0 left-0 h-6 w-6 rounded-tl-md border-t-4 border-l-4 border-white/80"
								></div>
								<div
									class="absolute top-0 right-0 h-6 w-6 rounded-tr-md border-t-4 border-r-4 border-white/80"
								></div>
								<div
									class="absolute bottom-0 left-0 h-6 w-6 rounded-bl-md border-b-4 border-l-4 border-white/80"
								></div>
								<div
									class="absolute right-0 bottom-0 h-6 w-6 rounded-br-md border-r-4 border-b-4 border-white/80"
								></div>
							</div>
						</div>
						<p class="text-sm text-muted-foreground">ระบบจะเปิดใบจองให้อัตโนมัติเมื่ออ่าน QR ได้</p>
						<Button
							variant="outline"
							onclick={() => (cameraOpen = false)}
							class="min-h-12 w-full rounded-xl px-6 text-sm font-bold sm:w-auto"
						>
							ปิดกล้อง
						</Button>
					</div>
				{:else if scanState === 'idle'}
					<!-- Idle Station Card -->
					<!--
						Counter screen, used on a tablet and often with gloves, so everything here is
						sized for a real finger: 48px minimum on every control (the design system's
						field-tablet target) and no type below `text-xs`. It used to be capped at
						`max-w-md` with `text-2xs`/`text-3xs` copy — 10px and 8px — which is what
						made it read as cramped and hard to hit.
					-->
					<div
						class="flex w-full max-w-xl animate-in flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card p-5 text-center shadow-xs duration-200 fade-in sm:p-8"
					>
						<div
							class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600 sm:h-20 sm:w-20 dark:bg-blue-950/40 dark:text-blue-400"
						>
							<Camera class="h-8 w-8 sm:h-10 sm:w-10" />
						</div>

						<h3 class="mb-2 text-lg font-bold text-foreground sm:text-xl">
							สแกน QR Code เพื่อตรวจรับพัสดุ
						</h3>
						<p class="mb-6 max-w-sm text-sm leading-relaxed text-muted-foreground">
							เปิดกล้องเพื่อสแกน QR Code ใบจองจากมือถือผู้บริจาค หรือค้นหาด้วยรหัสคำขอ
						</p>

						<!-- Primary actions. Stacked on a phone: side by side, the Thai labels wrap
						     to three lines inside a 44px-tall button and the tap area collapses. -->
						<div class="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
							<Button
								type="button"
								onclick={openCamera}
								class="min-h-12 gap-2 rounded-xl bg-[#002D5B] text-sm font-bold text-white shadow-xs hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
							>
								<Camera class="h-5 w-5" />
								เปิดกล้องสแกน QR
							</Button>

							<Button
								variant="outline"
								type="button"
								onclick={() => (activeView = 'walkin')}
								class="min-h-12 gap-2 rounded-xl bg-card text-sm font-bold shadow-xs"
							>
								<User class="h-5 w-5 text-blue-600 dark:text-blue-400" />
								ลงทะเบียน Walk-in
							</Button>
						</div>

						<!-- Manual fallback. Also stacked on a phone — a 3-character-wide "ค้นหา"
						     button next to an input is the smallest target on the screen. -->
						<div
							class="mt-6 flex w-full flex-col gap-2 border-t border-border/60 pt-5 sm:flex-row sm:items-center"
						>
							<Label for="scan-booking-ref" class="sr-only">รหัสการจอง</Label>
							<Input
								id="scan-booking-ref"
								type="text"
								placeholder="หรือกรอกรหัสการจอง (เช่น DN-123456)"
								bind:value={searchQuery}
								onkeydown={(e) => e.key === 'Enter' && lookupTyped()}
								class="min-h-12 rounded-xl text-sm"
							/>
							<Button
								onclick={lookupTyped}
								disabled={!searchQuery.trim()}
								class="min-h-12 shrink-0 rounded-xl px-6 text-sm font-bold"
							>
								ค้นหา
							</Button>
						</div>

						{#if cameraError}
							<div
								class="mt-4 flex w-full items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50/70 p-3.5 text-left text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300"
							>
								<CameraOff class="mt-0.5 h-4 w-4 shrink-0" />
								<span>{cameraError}</span>
							</div>
						{/if}

						{#if lastLots.length}
							<div
								class="mt-4 w-full rounded-xl border border-emerald-500/30 bg-emerald-50/60 p-3 text-left dark:bg-emerald-950/20"
							>
								<p
									class="text-2xs font-extrabold tracking-wider text-emerald-700 uppercase dark:text-emerald-400"
								>
									เลขล็อตที่ระบบออกให้ (เขียนติดกล่อง)
								</p>
								<ul class="mt-1.5 space-y-1">
									{#each lastLots as lot (lot.item_id + (lot.lot_no ?? ''))}
										<li class="flex flex-wrap items-center justify-between gap-2 text-sm">
											<span class="text-slate-700">{catalogName(lot.item_id)}</span>
											<span class="flex items-center gap-3">
												<span class="font-bold text-slate-900 tabular-nums"
													>{lot.lot_no ?? '—'}</span
												>
												{#if lot.lot_no}
													<a
														href={resolve(
															`/back-office/supply?tab=movements&lq=${encodeURIComponent(lot.lot_no)}` as '/back-office/supply'
														)}
														title="เปิดรายการเคลื่อนไหวของล็อตนี้ในคลัง"
														class="inline-flex min-h-11 items-center font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900"
													>
														ดูในคลัง
													</a>
												{/if}
											</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{:else if scanState === 'scanning'}
					<!-- Scanning State -->
					<div
						class="flex w-full max-w-md animate-in flex-col items-center justify-center rounded-3xl border border-dashed border-border/60 bg-card p-8 text-center shadow-xs duration-200 fade-in"
					>
						<div
							class="relative mb-6 flex h-32 w-32 items-center justify-center overflow-hidden rounded-2xl border border-blue-500/30 bg-slate-900 text-blue-500"
						>
							<QrCode class="h-16 w-16" />
							<div
								class="absolute inset-x-0 h-1 animate-pulse bg-blue-500/80 shadow-[0_0_8px_rgba(59,130,246,0.8)]"
								style="animation: scanEffect 1.5s infinite ease-in-out;"
							></div>
						</div>
						<span class="animate-pulse text-xs font-bold text-muted-foreground">กำลังสแกน...</span>
					</div>
				{/if}
			</div>
		{/if}
	{:else if activeView === 'walkin'}
		<!-- Walk-in View -->
		<div>
			<!-- Top Dark Banner -->
			<div class="bg-[#002D5B] p-6 text-white md:p-8 dark:bg-slate-900">
				<Button
					variant="link"
					size="sm"
					type="button"
					onclick={() => (initialView === 'walkin' && onClose ? onClose() : (activeView = 'scan'))}
					class="mb-3 h-auto gap-1.5 p-0 text-sm font-medium text-blue-200 no-underline hover:text-white hover:no-underline"
				>
					<ArrowLeft class="size-4" />
					{initialView === 'walkin' && onClose ? 'กลับไปที่รายการของบริจาค' : 'กลับหน้าสแกนรับของ'}
				</Button>

				<div class="flex items-center gap-2.5">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
						<ClipboardCheck class="h-5 w-5" />
					</div>
					<h2 class="text-base font-bold text-white md:text-lg">
						บันทึกข้อมูลบริจาคหน้าเคาน์เตอร์ (Walk-in Register)
					</h2>
				</div>
				<p class="mt-1 text-xs text-blue-100/80">
					กรอกข้อมูลรายละเอียดผู้บริจาคและรายการพัสดุสิ่งของที่นำส่งด้วยตนเอง
					เพื่อนำเข้าคลังและอัปเดตระบบทันที
				</p>
			</div>

			<!-- Walk-in Form Body -->
			<div class="space-y-8 bg-card p-6 md:p-8">
				<!-- Section 1: ข้อมูลผู้บริจาค (Donor Information) -->
				<div>
					<h3 class="mb-4 flex items-center gap-2 text-sm font-bold text-foreground md:text-base">
						<User class="h-4.5 w-4.5 text-muted-foreground" />
						<span>ข้อมูลผู้บริจาค (Donor Information)</span>
					</h3>

					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div class="space-y-1.5">
							<Label for="donor-name-input" class="text-sm font-semibold text-foreground">
								ชื่อผู้บริจาค/ผู้ติดต่อ <span class="text-destructive">*</span>
							</Label>
							<Input
								id="donor-name-input"
								type="text"
								placeholder="เช่น คุณสมศักดิ์ รักดี"
								bind:value={walkinDonorName}
								class="h-10 rounded-xl text-sm"
							/>
						</div>

						<div class="space-y-1.5">
							<Label for="donor-phone-input" class="text-sm font-semibold text-foreground">
								เบอร์โทรศัพท์ (ถ้ามี)
							</Label>
							<Input
								id="donor-phone-input"
								type="text"
								placeholder="เช่น 089-XXX-XXXX"
								bind:value={walkinDonorPhone}
								class="h-10 rounded-xl text-sm"
							/>
						</div>

						<div class="space-y-1.5">
							<Label for="donor-email-input" class="text-sm font-semibold text-foreground">
								อีเมล (ถ้ามี)
							</Label>
							<Input
								id="donor-email-input"
								type="email"
								placeholder="เช่น donor@example.com"
								bind:value={walkinDonorEmail}
								class="h-10 rounded-xl text-sm"
							/>
						</div>
					</div>
				</div>

				<!-- Section 2: รายการสิ่งของบริจาค (Items List) -->
				<div>
					<div class="mb-4 flex items-center justify-between">
						<h3 class="flex items-center gap-2 text-sm font-bold text-foreground md:text-base">
							<PlusCircle class="h-4.5 w-4.5 text-muted-foreground" />
							<span>รายการสิ่งของบริจาค (Items List)</span>
						</h3>

						<Button
							variant="outline"
							type="button"
							onclick={addWalkinItem}
							class="h-9 gap-1.5 rounded-xl border-blue-200 bg-blue-50/70 px-3.5 text-xs font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/60"
						>
							<PlusCircle class="h-4 w-4" />
							เพิ่มรายการสิ่งของ
						</Button>
					</div>

					<div class="space-y-4">
						{#each walkinItems as item, idx (item.id)}
							<div
								class="relative rounded-2xl border border-border/70 bg-muted/20 p-5 transition-all hover:border-border"
							>
								<div class="mb-3 flex items-center justify-between">
									<span class="text-sm font-semibold text-foreground">
										รายการที่ #{idx + 1}
									</span>
									<div class="flex items-center gap-3">
										{#if walkinItems.length > 1}
											<Button
												variant="ghost"
												size="icon-sm"
												type="button"
												onclick={() => removeWalkinItem(item.id)}
												class="text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
												title="ลบรายการนี้"
											>
												<Trash2 class="h-4 w-4" />
											</Button>
										{/if}
									</div>
								</div>

								<div class="grid grid-cols-1 items-start gap-4 md:grid-cols-12">
									<!-- Item Select -->
									<div class="space-y-1.5 md:col-span-8">
										<Label
											for="walkin-item-{item.id}"
											class="text-sm font-semibold text-foreground"
										>
											เลือกประเภทสิ่งของ / ค้นหาสินค้าหลัก <span class="text-destructive">*</span>
										</Label>
										<ItemCombobox
											id="walkin-item-{item.id}"
											items={pickerItems}
											value={item.itemId}
											isLoading={supplyItemsQuery.isLoading || itemMastersQuery.isLoading}
											placeholder="ค้นหาและเลือกสินค้า…"
											formatBalanceUnit={pickerUnitLabel}
											onSelect={(picked) => handleWalkinItemSelect(idx, picked)}
										/>
										{#if canCreateItem}
											<Button
												type="button"
												variant="ghost"
												class="min-h-9 gap-1 px-2 text-sm font-semibold text-sky-800"
												onclick={() =>
													openCreateItem({ kind: 'walkin', index: idx, name: item.name })}
											>
												<Plus class="size-4" aria-hidden="true" />
												เพิ่มสินค้าใหม่
											</Button>
										{/if}
									</div>

									<!-- Qty Input -->
									<div class="space-y-1.5 md:col-span-2">
										<Label for="walkin-qty-{item.id}" class="text-sm font-semibold text-foreground">
											จำนวนที่รับจริง <span class="text-destructive">*</span>
										</Label>
										<Input
											id="walkin-qty-{item.id}"
											type="text"
											inputmode="decimal"
											bind:value={item.qty}
											class="h-10 rounded-xl text-center text-sm font-bold"
										/>
									</div>

									<!-- Unit Display / Input -->
									<!-- Read-only: the unit comes from the chosen item's `base_unit`
									     (`handleWalkinItemSelect`), and the ledger row this intake
									     writes is denominated in it. Retyping it here would put the
									     receipt and the shelf balance in different units. -->
									<div class="space-y-1.5 md:col-span-2">
										<span class="block text-sm font-semibold text-foreground">หน่วย</span>
										<div
											class="flex h-10 items-center justify-center rounded-xl border border-border/60 bg-muted/40 px-3 text-sm font-medium text-muted-foreground"
											title="หน่วยฐานจากแคตตาล็อก — แก้ที่แคตตาล็อกถ้าไม่ถูกต้อง"
										>
											{formatUnit(item.unit, unitsOfMeasure, langState.current) || '—'}
										</div>
									</div>

									<!-- Lot details. Both reach `stock_ledger.lot` (CR-088); the expiry
									     is REQUIRED for a perishable item and the intake route refuses
									     the line without it — this row is where staff can actually
									     supply it. -->
									<div class="space-y-1.5 md:col-span-6">
										<Label
											for="walkin-expiry-{item.id}"
											class="text-sm font-semibold text-foreground"
										>
											วันหมดอายุ
											{#if isPerishable(item.itemId)}
												<span class="text-destructive">*</span>
												<span class="ml-1 text-xs font-normal text-rose-600 dark:text-rose-400">
													(ของเน่าเสียง่าย — ต้องระบุ)
												</span>
											{:else}
												<span class="ml-1 text-xs font-normal text-muted-foreground">(ถ้ามี)</span>
											{/if}
										</Label>
										<DatePicker
											id="walkin-expiry-{item.id}"
											ariaLabel="วันหมดอายุ"
											bind:value={item.expiry}
											class="h-10 rounded-xl text-sm {isPerishable(item.itemId) && !item.expiry
												? 'border-rose-300 dark:border-rose-900'
												: ''}"
										/>
									</div>

									<div class="space-y-1.5 md:col-span-6">
										<Label
											for="walkin-zone-{item.id}"
											class="text-sm font-semibold text-foreground"
										>
											สถานที่จัดเก็บ
											<span class="ml-1 text-xs font-normal text-muted-foreground">(ถ้ามี)</span>
										</Label>
										<StoragePointSelect
											id="walkin-zone-{item.id}"
											points={storagePoints.points}
											bind:value={item.storagePointId}
										/>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Footer Action Buttons -->
				<div class="flex items-center justify-end gap-3 border-t border-border/60 pt-6">
					<Button
						variant="ghost"
						type="button"
						onclick={() => (activeView = 'scan')}
						class="h-11 rounded-xl px-5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						ยกเลิก
					</Button>

					<Button
						type="button"
						onclick={handleSaveWalkin}
						disabled={walkinSaving}
						class="flex h-11 items-center gap-2 rounded-xl bg-[#002D5B] px-6 text-sm font-bold text-white shadow-sm hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
					>
						{#if walkinSaving}
							<Loader2 class="h-4 w-4 animate-spin" />
							กำลังบันทึก…
						{:else}
							<Check class="h-4 w-4" />
							บันทึกและตรวจรับพัสดุ
						{/if}
					</Button>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- Create a stock item for a line: a side sheet (bottom on mobile), like the stock page's
	receive panel. Mounted only while open so each opening starts from a clean form. -->
<Sheet.Root bind:open={createOpen} onOpenChange={(open) => !open && (createTarget = null)}>
	<Sheet.Content
		side={isMobileViewport.current ? 'bottom' : 'right'}
		class={[
			'flex flex-col gap-0 overflow-hidden border-0 p-0 pb-[env(safe-area-inset-bottom)]',
			isMobileViewport.current
				? 'h-[100dvh] max-h-[100dvh] rounded-none'
				: 'h-[100dvh] w-full sm:max-w-none md:w-[37.5rem] md:border-l'
		]}
	>
		<Sheet.Header class="shrink-0 border-b border-slate-200/80 px-4 py-4 pr-14 text-left sm:px-6">
			<Sheet.Title class="text-xl font-bold text-slate-900">สร้างสินค้าใหม่</Sheet.Title>
			<Sheet.Description class="text-sm text-slate-500">
				กรอกแค่ที่จำเป็นต่อการรับของ ข้อมูลอื่นเติมทีหลังได้
			</Sheet.Description>
		</Sheet.Header>
		<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
			{#if createOpen && createTarget}
				<QuickCreateItem
					shelterCode={getShelterCode()}
					initialName={createTarget.name}
					onCreated={finishCreateItem}
					onUseExisting={finishCreateItem}
					onCancel={() => (createOpen = false)}
				/>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

<RejectDonationDialog
	bind:open={rejectOpen}
	bookingRef={bookingRef || actionRef}
	pending={saving}
	onconfirm={handleConfirmReject}
/>
