<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import Camera from '@lucide/svelte/icons/camera';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Check from '@lucide/svelte/icons/check';
	import User from '@lucide/svelte/icons/user';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
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
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { DatePicker } from '$lib/components/ui/date-picker/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import { qtyAbs, qtyGt, qtyIsZero, subQty } from '$lib/utils/qty';
	import { onMount } from 'svelte';
	import {
		donationActionRef,
		donationRefLabel,
		linesMissingExpiry,
		type ScanDonationView,
		type PendingDonationRow
	} from '$lib/features/donations';
	import { useSupplyItems } from '$lib/features/supply';
	import {
		formatUnit,
		mergeCatalogGenerations,
		useItemMasters,
		useCreateItemMaster,
		useUnitsOfMeasure
	} from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { ulid } from '$lib/db/ulid';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useShelters } from '$lib/features/shelters';

	let {
		initialQuery = '',
		onSaved,
		onClose
	}: { initialQuery?: string; onSaved?: () => void; onClose?: () => void } = $props();

	let activeView = $state<'scan' | 'walkin'>('scan');
	let scanState = $state<'idle' | 'scanning' | 'result'>('idle');
	let searchQuery = $state('');

	// Action panels for verifying view
	let actionPanel = $state<'none' | 'redirect' | 'reject'>('none');
	let selectedTargetShelter = $state('');
	let redirectNote = $state('');
	let rejectReason = $state('');
	const sheltersQuery = useShelters();
	// Everywhere but here: the shelter already holding the goods is not a destination
	// (the route answers `SAME_SHELTER`), so it never reaches the dropdown.
	const redirectTargets = $derived(
		(sheltersQuery.data ?? []).filter((s) => s.code !== donationDoc?.shelter_code)
	);

	// Awaiting dropoff bookings for dropdown
	let awaitingBookings = $state<PendingDonationRow[]>([]);
	let loadingBookings = $state(false);

	// Catalog items query
	const supplyItemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const createItemMasterMutation = useCreateItemMaster();

	// De-duplicated across both catalog generations (schema.md §4.2) — the same goods
	// exist as `item:rice` and `item_master:rice`, and this list showed each twice.
	const catalogItems = $derived(
		mergeCatalogGenerations(supplyItemsQuery.data ?? [], itemMastersQuery.data ?? []).map((c) => ({
			...c,
			unit: c.unit || 'piece',
			category: c.category || 'other'
		}))
	);

	const STORAGE_ZONE_OPTIONS = [
		'Zone A (อาหารแห้งและเครื่องดื่ม)',
		'Zone B (ยาและเวชภัณฑ์)',
		'Zone C (ของใช้ทั่วไปและสุขอนามัย)',
		'Zone D (เครื่องนุ่งห่มและที่นอน)',
		'Zone E (อุปกรณ์และเครื่องมือช่าง)',
		'Zone F (ห้องควบคุมอุณหภูมิ/ตู้แช่)'
	];

	const ITEM_CATEGORY_OPTIONS = [
		{ value: 'food', label: 'อาหารและเครื่องดื่ม' },
		{ value: 'medicine', label: 'ยารักษาโรค/เวชภัณฑ์' },
		{ value: 'hygiene', label: 'ของใช้ส่วนตัว/สุขอนามัย' },
		{ value: 'clothing', label: 'เครื่องนุ่งห่ม/ที่นอน' },
		{ value: 'baby', label: 'แม่และเด็ก' },
		{ value: 'tools', label: 'อุปกรณ์/เครื่องมือช่าง' },
		{ value: 'general', label: 'ของใช้ทั่วไป' }
	];

	/** The catalog row's display label, or the dropdown placeholder when unmapped. */
	function catalogLabel(itemId: string | undefined, placeholder: string): string {
		const found = catalogItems.find((c) => c._id === itemId);
		return found
			? `${found.name} (${formatUnit(found.unit, unitsOfMeasure, langState.current)})`
			: placeholder;
	}

	/** Is this catalog id a perishable item? Drives the expiry requirement below. */
	function isPerishable(itemId: string): boolean {
		return catalogItems.find((c) => c._id === itemId)?.perishable === true;
	}

	// Quick create item master dialog state
	let isQuickCreateOpen = $state(false);
	let quickCreateTargetIndex = $state<number | null>(null);
	let newItemName = $state('');
	let newItemCategory = $state('general');
	let newItemUnit = $state('piece');
	let creatingItem = $state(false);

	const newItemCategoryLabel = $derived(
		ITEM_CATEGORY_OPTIONS.find((o) => o.value === newItemCategory)?.label ?? newItemCategory
	);
	const redirectTargetLabel = $derived.by(() => {
		const picked = redirectTargets.find((t) => t.code === selectedTargetShelter);
		return picked ? `${picked.name} (${picked.code})` : '-- เลือกศูนย์พักพิงปลายทาง --';
	});

	// Scanned booking data
	let donationDoc = $state<ScanDonationView | null>(null);
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
		qty: string;
		unit: string;
		item_id?: string;
		expiry: string;
		storage_zone: string;
		diffReason: string;
		verified: boolean;
	};

	let scannedItems = $state<ScannedItem[]>([]);
	let remarks = $state('');
	let saving = $state(false);
	// UOM master data (CR-125): `base_unit` is stored as a canonical code, so every
	// place this file SHOWS a unit runs it back through `formatUnit`.
	const unitsOfMeasureQuery = useUnitsOfMeasure();
	const unitsOfMeasure = $derived(unitsOfMeasureQuery.data ?? []);
	const availableUnits = $derived(unitsOfMeasure.filter((u) => !u.deactivated));
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
	const donorNote = $derived.by(() => {
		const notes = (donationDoc?.items ?? [])
			.map((it) => (it as { note?: string }).note?.trim())
			.filter((n): n is string => Boolean(n));
		return notes.length > 0 ? notes.join('\n') : 'ผู้บริจาคไม่ได้ระบุคำชี้แจงเพิ่มเติม';
	});

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
	const scannedMissingExpiry = $derived(
		linesMissingExpiry(
			scannedItems.map((it) => ({
				item_id: it.item_id,
				name: it.name,
				perishable: it.item_id ? isPerishable(it.item_id) : false,
				expiry: it.expiry
			}))
		)
	);

	// Validation check for receiving into stock
	const canReceive = $derived(
		scannedItems.length > 0 &&
			scannedItems.every((it) => it.verified && it.item_id && it.storage_zone && it.qty) &&
			scannedMissingExpiry.length === 0
	);

	// The receive checklist in the action panel — one line per condition `canReceive`
	// waits on, ticked as staff complete it (it used to be a red error box listing
	// what was still missing, which read as a failure before anything had been done).
	const checkMapped = $derived(
		scannedItems.length > 0 && scannedItems.every((it) => it.item_id && it.qty)
	);
	const checkZoned = $derived(
		scannedItems.length > 0 && scannedItems.every((it) => it.storage_zone)
	);
	const verifiedCount = $derived(scannedItems.filter((it) => it.verified).length);
	const hasPerishableLine = $derived(
		scannedItems.some((it) => it.item_id && isPerishable(it.item_id))
	);

	/**
	 * How the counted quantity differs from what the donor declared, or null when it
	 * does not (or the box is not a number yet). The field starts pre-filled with the
	 * declared amount, so a "matches" badge would show before anyone had counted —
	 * only a difference is worth flagging.
	 */
	function qtyDifference(item: ScannedItem): { more: boolean; amount: string } | null {
		try {
			const diff = subQty(item.qty, item.declaredQty);
			if (qtyIsZero(diff)) return null;
			return { more: qtyGt(diff, 0), amount: qtyAbs(diff) };
		} catch {
			return null;
		}
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
		storageZone: string;
	};
	let walkinItems = $state<WalkinItemState[]>([
		{
			id: ulid(),
			itemId: '',
			name: '',
			qty: '1',
			unit: 'piece',
			expiry: '',
			storageZone: ''
		}
	]);
	let walkinSaving = $state(false);

	async function loadAwaitingBookings() {
		loadingBookings = true;
		try {
			// One request per status the counter can act on. A failure is reported rather
			// than swallowed: an empty queue and a rejected request looked identical, so
			// "ยังไม่มีใบจองในคิว" was shown for permission and network errors too.
			const statuses = ['verifying', 'pending_review', 'declared'] as const;
			const responses = await Promise.all(
				statuses.map(async (status) => {
					const res = await fetch(`/api/back-office/donations?status=${status}`);
					const data = await res.json().catch(() => ({ success: false }));
					if (!res.ok || !data.success) {
						throw new Error(data.error || `โหลดคิวสถานะ ${status} ไม่สำเร็จ`);
					}
					return (data.donations ?? []) as PendingDonationRow[];
				})
			);

			// Keyed on whatever addresses the donation — a walk-in has no `booking_ref`,
			// and filtering on one dropped every counter-keyed booking from the queue.
			const all = responses.flat();
			awaitingBookings = all.filter((d, i) => {
				const ref = donationActionRef(d);
				return !!ref && all.findIndex((o) => donationActionRef(o) === ref) === i;
			});
		} catch (err) {
			awaitingBookings = [];
			toast.error(err instanceof Error ? err.message : 'โหลดคิวรอตรวจรับไม่สำเร็จ');
		} finally {
			loadingBookings = false;
		}
	}

	async function performLookup(query: string, simulateScanEffect = false) {
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
				onClose?.();
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
						qty: declared,
						unit: it.unit || '',
						item_id: matched?._id || it.item_id || '',
						expiry: '',
						storage_zone: '',
						diffReason: '',
						verified: false
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
		rejectReason = '';
		lastLots = [];
		searchQuery = '';
		donationDoc = null;
		scannedItems = [];
		remarks = '';
		actionPanel = 'none';
		onClose?.();
	}

	async function handleSaveScan() {
		if (!actionRef || saving) return;
		saving = true;
		try {
			const res = await fetch(`/api/back-office/donations/${encodeURIComponent(actionRef)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: 'received',
					...(remarks.trim() ? { remarks: remarks.trim() } : {}),
					items: scannedItems.map((it) => ({
						...(it.item_id ? { item_id: it.item_id } : { free_text: it.name }),
						qty: it.qty,
						unit: it.unit,
						...(it.item_id && (it.expiry || it.storage_zone.trim())
							? {
									lot: {
										...(it.expiry ? { expiry: it.expiry } : {}),
										...(it.storage_zone.trim() ? { storage_zone: it.storage_zone.trim() } : {})
									}
								}
							: {})
					}))
				})
			});
			const data = await res.json();
			if (data.success) {
				lastLots = (data.lots ?? []) as { item_id: string; lot_no: string | null }[];
				const labels = lastLots.map((l) => l.lot_no).filter(Boolean);
				toast.success(
					labels.length
						? `บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${bookingRef || actionRef}) · เลขล็อต ${labels.join(', ')}`
						: `บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${bookingRef || actionRef})`
				);
				scanState = 'idle';
				searchQuery = '';
				donationDoc = null;
				remarks = '';
				onSaved?.();
				loadAwaitingBookings();
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
						note: redirectNote.trim()
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

	async function handleConfirmReject() {
		if (!actionRef || saving) return;
		if (!rejectReason.trim()) {
			toast.error('กรุณาระบุเหตุผลในการปฏิเสธคำขอ');
			return;
		}
		saving = true;
		try {
			const res = await fetch(
				`/api/back-office/donations/${encodeURIComponent(actionRef)}/reject`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ reason: rejectReason.trim() })
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

	// Quick create item master
	function openQuickCreate(targetIdx: number) {
		quickCreateTargetIndex = targetIdx;
		newItemName = '';
		newItemCategory = 'general';
		newItemUnit = 'piece';
		isQuickCreateOpen = true;
	}

	async function handleCreateNewItemMaster() {
		if (!newItemName.trim()) {
			toast.error('กรุณาระบุชื่อรายการสินค้า');
			return;
		}
		creatingItem = true;
		try {
			const shelterCode = getShelterCode();
			const created = await createItemMasterMutation.mutateAsync({
				shelterCode,
				input: {
					name: newItemName.trim(),
					category: newItemCategory.trim() || 'general',
					base_unit: newItemUnit.trim() || 'piece',
					type_class: 'CONSUMABLE',
					distribution_type: 'one_time'
				},
				ctx: {
					shelterCode,
					createdBy: authStore.user?.name ?? 'staff'
				}
			});

			if (created && quickCreateTargetIndex !== null) {
				if (activeView === 'walkin' && walkinItems[quickCreateTargetIndex]) {
					walkinItems[quickCreateTargetIndex].itemId = created._id;
					walkinItems[quickCreateTargetIndex].name = created.name;
					walkinItems[quickCreateTargetIndex].unit = created.base_unit;
				} else if (scannedItems[quickCreateTargetIndex]) {
					scannedItems[quickCreateTargetIndex].item_id = created._id;
					scannedItems[quickCreateTargetIndex].unit = created.base_unit;
				}
				toast.success(`สร้างรายการสินค้า "${created.name}" เรียบร้อยแล้ว`);
			}
			isQuickCreateOpen = false;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'ข้อผิดพลาด';
			toast.error(`ไม่สามารถสร้างรายการสินค้าได้: ${message}`);
		} finally {
			creatingItem = false;
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
			storageZone: ''
		});
	}

	function removeWalkinItem(id: string) {
		walkinItems = walkinItems.filter((i) => i.id !== id);
	}

	function handleWalkinItemSelect(index: number, selectedId: string) {
		const item = walkinItems[index];
		if (!item) return;
		item.itemId = selectedId;
		const found = catalogItems.find((c) => c._id === selectedId);
		if (found) {
			item.name = found.name;
			item.unit = found.unit;
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
					items: validItems.map((it) => ({
						item_id: it.itemId,
						qty: it.qty,
						unit: it.unit,
						...(it.expiry.trim() || it.storageZone.trim()
							? {
									lot: {
										...(it.expiry.trim() ? { expiry: it.expiry.trim() } : {}),
										...(it.storageZone.trim() ? { storage_zone: it.storageZone.trim() } : {})
									}
								}
							: {})
					}))
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
					storageZone: ''
				}
			];
			onSaved?.();
			loadAwaitingBookings();
		} catch {
			toast.error('บันทึกไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง');
		} finally {
			walkinSaving = false;
		}
	}

	onMount(() => {
		loadAwaitingBookings();
		// The queue mounts a fresh station per row (the board is behind an `{#if}`), so
		// the ref is looked up once here. It used to run in `onMount` AND an `$effect`,
		// which fired the same request twice on every open.
		if (initialQuery) {
			searchQuery = initialQuery;
			performLookup(initialQuery);
		}
	});
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	{#if activeView === 'scan'}
		{#if scanState === 'result'}
			<!-- Verifying drop-off: count the goods in (left), confirm or reject (right). -->
			<div>
				<!-- Header -->
				<div class="border-b border-slate-200/80 bg-white px-4 py-4 sm:px-6 sm:py-5">
					<Button
						variant="link"
						size="sm"
						type="button"
						onclick={handleCancel}
						class="mb-2 h-auto gap-1.5 p-0 text-sm font-medium text-slate-500 no-underline hover:text-slate-900 hover:no-underline"
					>
						<ArrowLeft class="h-4 w-4" />
						กลับหน้าตรวจรับบริจาค
					</Button>
					<div class="flex flex-wrap items-center gap-3">
						<span
							class="hidden rounded-xl border border-sky-200 bg-sky-50 p-2 text-sky-700 sm:inline-flex"
						>
							<PackageCheck class="h-5 w-5" />
						</span>
						<div class="min-w-0 basis-full sm:flex-1 sm:basis-auto">
							<h2 class="text-lg font-bold text-slate-900 sm:text-xl">
								{donationRefLabel({ booking_ref: bookingRef })} - ตรวจรับพัสดุบริจาค
							</h2>
							<p class="text-sm text-slate-500">
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
								class="rounded-xl border bg-white shadow-2xs {item.verified
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
										{formatUnit(item.unit, unitsOfMeasure, langState.current)}
									</span>
									{#if diff}
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

								<!-- Fields: what it is and how much, then where it goes -->
								<div class="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:px-5">
									<div class="space-y-1.5">
										<Label for="map-master-{idx}" class="text-sm font-semibold text-slate-700">
											รายการในคลัง <span class="text-red-500">*</span>
										</Label>
										<Select.Root type="single" bind:value={item.item_id}>
											<Select.Trigger
												id="map-master-{idx}"
												class="h-11 w-full text-sm data-[size=default]:h-11 sm:h-10 sm:data-[size=default]:h-10"
											>
												{catalogLabel(item.item_id, '-- เลือกรายการในคลัง --')}
											</Select.Trigger>
											<Select.Content>
												{#each catalogItems as c (c._id)}
													<Select.Item value={c._id} label="{c.name} ({c.unit})" />
												{/each}
											</Select.Content>
										</Select.Root>
										<!--
										Creating an item master is not offered here: checking a booking in is
										confirming what arrived, so a line that does not match goes in the
										difference note, not into a new catalog entry. Walk-in intake keeps
										its quick-create (`openQuickCreate`), where new goods are recorded.
										-->
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
												class="h-11 pr-16 text-base font-bold tabular-nums sm:h-10"
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
											โซนจัดเก็บ <span class="text-red-500">*</span>
										</Label>
										<Select.Root type="single" bind:value={item.storage_zone}>
											<Select.Trigger
												id="storage-zone-{idx}"
												class="h-11 w-full text-sm data-[size=default]:h-11 sm:h-10 sm:data-[size=default]:h-10"
											>
												{item.storage_zone || '-- เลือกโซนจัดเก็บ --'}
											</Select.Trigger>
											<Select.Content>
												{#each STORAGE_ZONE_OPTIONS as zone (zone)}
													<Select.Item value={zone} label={zone} />
												{/each}
											</Select.Content>
										</Select.Root>
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
											class="h-11 text-sm sm:h-10 {item.item_id &&
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
											class="h-11 text-sm sm:h-10"
										/>
									</div>
								</div>

								<!-- Confirmation sits right under the fields it confirms -->
								<label
									class="flex min-h-12 cursor-pointer items-center gap-3 rounded-b-xl border-t px-4 py-3 text-sm font-semibold sm:px-5 {item.verified
										? 'border-emerald-200 bg-emerald-50 text-emerald-900'
										: 'border-slate-100 bg-slate-50 text-slate-700 hover:bg-slate-100'}"
								>
									<Checkbox bind:checked={item.verified} />
									<span class="flex flex-col">
										<span class="select-none">ผ่านการตรวจสอบแล้ว</span>
										<span class="text-xs font-normal text-slate-500">
											ของจริงตรงกับรายการ จำนวน และสภาพที่กรอกไว้
										</span>
									</span>
								</label>
							</div>
						{/each}

						<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:px-5">
							<h4 class="text-sm font-semibold text-slate-700">คำชี้แจงจากผู้บริจาค</h4>
							<p class="mt-1 text-sm whitespace-pre-line text-slate-700">{donorNote}</p>
						</div>
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
								{@render step(checkZoned, 'เลือกโซนจัดเก็บครบทุกรายการ')}
								{#if hasPerishableLine}
									{@render step(
										scannedMissingExpiry.length === 0,
										'ใส่วันหมดอายุของเน่าเสียง่ายครบ'
									)}
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
									class="h-12 w-full gap-2 bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700"
								>
									<Check class="h-5 w-5" />
									{saving ? 'กำลังบันทึก…' : 'ยืนยันรับเข้าคลัง'}
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
									onclick={() => (actionPanel = actionPanel === 'reject' ? 'none' : 'reject')}
									disabled={saving}
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
												class="h-11 w-full text-sm data-[size=default]:h-11 sm:h-10 sm:data-[size=default]:h-10"
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

							{#if actionPanel === 'reject'}
								<div class="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-4">
									<div class="space-y-1.5">
										<Label for="reject-reason-input" class="text-sm font-semibold text-slate-700">
											เหตุผลที่ปฏิเสธ <span class="text-red-500">*</span>
										</Label>
										<Input
											id="reject-reason-input"
											type="text"
											placeholder="เช่น พื้นที่จัดเก็บไม่เพียงพอ, งดรับเสื้อผ้าชั่วคราว..."
											bind:value={rejectReason}
											class="h-11 bg-white text-sm sm:h-10"
										/>
									</div>
									<div class="flex gap-2">
										<Button
											variant="destructive"
											type="button"
											onclick={handleConfirmReject}
											disabled={saving || !rejectReason.trim()}
											class="h-11 flex-1 font-semibold"
										>
											{saving ? 'กำลังดำเนินการ...' : 'ยืนยันการปฏิเสธคำขอ'}
										</Button>
										<Button
											variant="outline"
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
			<!-- Section Header -->
			<div
				class="flex flex-col justify-between gap-4 border-b border-border/60 bg-muted/5 p-6 md:flex-row md:items-center"
			>
				<div>
					<h2 class="flex items-center gap-2.5 text-base font-bold text-foreground">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
						>
							<Scan class="h-5 w-5" />
						</div>
						ระบบสแกนรับของเข้าคลัง (Ref. Scan Station)
					</h2>
					<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
						สแกนคิวอาร์โค้ดใบจองจากมือถือผู้บริจาค เพื่อตรวจรับสินค้าและอัปเดตระบบคลังพัสดุแบบทันที
						(Real-time Sync)
					</p>
				</div>
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

						<!-- The queue the counter is actually holding. The camera button used to
						     open whatever sat at the top of this list, which looked like a scan
						     that had happened; picking a booking is now an explicit act. -->
						{#if awaitingBookings.length}
							<div class="mt-5 w-full border-t border-border/60 pt-5 text-left">
								<p
									class="mb-3 text-xs font-extrabold tracking-wider text-muted-foreground uppercase"
								>
									รอตรวจรับที่ศูนย์ ({awaitingBookings.length})
								</p>
								<!-- Taller than it looks: each row is a tap target for someone holding a
								     parcel, so it gets the same 48px floor as the buttons above. -->
								<ul class="max-h-64 space-y-2 overflow-y-auto">
									{#each awaitingBookings as booking (donationActionRef(booking))}
										{@const ref = donationActionRef(booking)}
										<li>
											<Button
												variant="outline"
												type="button"
												onclick={() => ref && performLookup(ref)}
												class="h-auto min-h-12 w-full justify-between gap-3 rounded-xl border-border/70 bg-card px-4 py-3 text-left"
											>
												<span class="min-w-0">
													<span class="block truncate text-sm font-bold text-foreground">
														{donationRefLabel(booking)}
													</span>
													<span class="block truncate text-xs text-muted-foreground">
														{booking.donor_name || 'ไม่ระบุชื่อ'} · {booking.item_count} รายการ
													</span>
												</span>
												<Badge variant="secondary" class="shrink-0 text-xs font-bold">
													{booking.status}
												</Badge>
											</Button>
										</li>
									{/each}
								</ul>
							</div>
						{:else if loadingBookings}
							<p class="mt-4 w-full border-t border-border/60 pt-4 text-2xs text-muted-foreground">
								กำลังโหลดคิวรอตรวจรับ...
							</p>
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
										<li class="flex items-center justify-between gap-2 text-2xs">
											<span class="text-muted-foreground">{lot.item_id}</span>
											<span class="font-mono font-bold text-foreground">{lot.lot_no ?? '—'}</span>
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
					onclick={() => (activeView = 'scan')}
					class="mb-3 h-auto gap-1.5 p-0 text-xs font-medium text-blue-200 no-underline hover:text-white hover:no-underline"
				>
					<ArrowLeft class="h-3.5 w-3.5" />
					กลับหน้าสแกนรับของ
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
										<Button
											variant="link"
											size="sm"
											type="button"
											onclick={() => openQuickCreate(idx)}
											class="h-auto p-0 text-xs font-semibold text-blue-600 dark:text-blue-400"
										>
											+ สร้างรายการใหม่
										</Button>
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
										<Select.Root
											type="single"
											value={item.itemId}
											onValueChange={(v) => handleWalkinItemSelect(idx, v)}
										>
											<Select.Trigger
												id="walkin-item-{item.id}"
												class="h-10 w-full rounded-xl bg-card text-sm data-[size=default]:h-10"
											>
												{catalogLabel(item.itemId, '-- ค้นหาและเลือก Item --')}
											</Select.Trigger>
											<Select.Content>
												{#each catalogItems as c (c._id)}
													<Select.Item value={c._id} label="{c.name} ({c.unit})" />
												{/each}
											</Select.Content>
										</Select.Root>
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
											โซนจัดเก็บ
											<span class="ml-1 text-xs font-normal text-muted-foreground">(ถ้ามี)</span>
										</Label>
										<Input
											id="walkin-zone-{item.id}"
											type="text"
											placeholder="เช่น A-01, ตู้แช่ 2"
											bind:value={item.storageZone}
											class="h-10 rounded-xl text-sm"
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

<!-- Quick Create Item Dialog -->
<Dialog.Root bind:open={isQuickCreateOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base font-bold">
				<PackagePlus class="h-5 w-5 text-primary" />
				สร้างรายการสินค้าใหม่ในคลัง
			</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-4">
			<div class="space-y-1.5">
				<Label for="new-item-name" class="text-sm font-semibold text-foreground">
					ชื่อสิ่งของ/รายการสินค้า <span class="text-destructive">*</span>
				</Label>
				<Input
					id="new-item-name"
					type="text"
					placeholder="เช่น ปลากระป๋องตราสามแม่ครัว"
					bind:value={newItemName}
					class="h-10 rounded-xl text-sm"
				/>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<Label for="new-item-category" class="text-sm font-semibold text-foreground">
						หมวดหมู่
					</Label>
					<Select.Root type="single" bind:value={newItemCategory}>
						<Select.Trigger
							id="new-item-category"
							class="h-10 w-full rounded-xl text-sm data-[size=default]:h-10"
						>
							{newItemCategoryLabel}
						</Select.Trigger>
						<Select.Content>
							{#each ITEM_CATEGORY_OPTIONS as option (option.value)}
								<Select.Item value={option.value} label={option.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-1.5">
					<Label for="new-item-unit" class="text-sm font-semibold text-foreground">
						หน่วยนับมาตรฐาน
					</Label>
					<Select.Root
						type="single"
						value={newItemUnit}
						onValueChange={(value) => (newItemUnit = value)}
						disabled={unitsOfMeasureQuery.isPending || availableUnits.length === 0}
					>
						<Select.Trigger id="new-item-unit" class="h-10 w-full rounded-xl text-sm">
							{formatUnit(newItemUnit, unitsOfMeasure, langState.current) || '-- เลือกหน่วยนับ --'}
						</Select.Trigger>
						<Select.Content>
							{#each availableUnits as u (u.code)}
								<Select.Item value={u.code} label={`${u.label_th} (${u.code})`}>
									{u.label_th} ({u.code})
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
		</div>

		<Dialog.Footer class="gap-2.5">
			<Button
				variant="ghost"
				type="button"
				onclick={() => (isQuickCreateOpen = false)}
				class="h-10 rounded-xl px-4 text-sm font-semibold text-muted-foreground"
			>
				ยกเลิก
			</Button>
			<Button
				type="button"
				onclick={handleCreateNewItemMaster}
				disabled={creatingItem}
				class="h-10 rounded-xl px-5 text-sm font-bold"
			>
				{#if creatingItem}
					<Loader2 class="h-4 w-4 animate-spin" />
					กำลังสร้าง…
				{:else}
					บันทึกรายการใหม่
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
