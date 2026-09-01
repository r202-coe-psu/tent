<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import Camera from '@lucide/svelte/icons/camera';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
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

	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import { qtyGt } from '$lib/utils/qty';
	import { onMount } from 'svelte';
	import {
		donationActionRef,
		donationRefLabel,
		linesMissingExpiry,
		type ScanDonationView,
		type PendingDonationRow
	} from '$lib/features/donations';
	import { useSupplyItems } from '$lib/features/supply';
	import { itemMasterUnit, useItemMasters, useCreateItemMaster } from '$lib/features/catalog';
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

	const catalogItems = $derived.by(() => {
		const supplyItems = (supplyItemsQuery.data ?? []).map((i) => ({
			_id: i._id,
			name: i.name,
			unit: i.unit || 'ชิ้น',
			category: i.category || 'other',
			perishable: i.perishable ?? false
		}));
		const itemMasters = (itemMastersQuery.data ?? [])
			.filter((im) => !im.deactivated)
			.map((im) => ({
				_id: im._id,
				name: im.name,
				unit: itemMasterUnit(im) || 'ชิ้น',
				category: im.category || 'other',
				perishable: false
			}));
		return [...supplyItems, ...itemMasters];
	});

	/** Is this catalog id a perishable item? Drives the expiry requirement below. */
	function isPerishable(itemId: string): boolean {
		return catalogItems.find((c) => c._id === itemId)?.perishable === true;
	}

	// Quick create item master dialog state
	let isQuickCreateOpen = $state(false);
	let quickCreateTargetIndex = $state<number | null>(null);
	let newItemName = $state('');
	let newItemCategory = $state('general');
	let newItemUnit = $state('ชิ้น');
	let creatingItem = $state(false);

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
			id: crypto.randomUUID(),
			itemId: '',
			name: '',
			qty: '1',
			unit: 'ชิ้น',
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
		newItemUnit = 'ชิ้น';
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
					base_unit: newItemUnit.trim() || 'ชิ้น',
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
			id: crypto.randomUUID(),
			itemId: '',
			name: '',
			qty: '1',
			unit: 'ชิ้น',
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
					id: crypto.randomUUID(),
					itemId: '',
					name: '',
					qty: '1',
					unit: 'ชิ้น',
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
			<!-- Verifying Drop-off View (Screenshots 2, 3, 4) -->
			<div>
				<!-- Top Dark Navy Banner -->
				<div class="bg-[#002D5B] p-6 text-white md:p-8 dark:bg-slate-900">
					<button
						type="button"
						onclick={handleCancel}
						class="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-blue-200 transition-colors hover:text-white"
					>
						<ArrowLeft class="h-3.5 w-3.5" />
						กลับหน้าตรวจรับบริจาค
					</button>

					<div class="flex items-center gap-2.5">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
							<PackageCheck class="h-5 w-5" />
						</div>
						<h2 class="text-base font-bold text-white md:text-lg">
							{donationRefLabel({ booking_ref: bookingRef })} - ตรวจรับพัสดุบริจาค (Verifying Drop-off)
						</h2>
					</div>
				</div>

				<!-- Content Body -->
				<div class="space-y-6 p-6 md:p-8">
					<!-- Top Notice Cards (Warning & Donor Contact) -->
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<!-- Warning card (Unsolicited Notice) -->
						<div
							class="rounded-2xl border border-rose-200 bg-rose-50/70 p-5 text-sm dark:border-rose-900/50 dark:bg-rose-950/20"
						>
							<div class="flex items-center gap-2 font-bold text-rose-700 dark:text-rose-400">
								<AlertTriangle class="h-4.5 w-4.5 shrink-0" />
								<span>คำชี้แจง / เงื่อนไขตรวจสอบพัสดุพิเศษระวัง</span>
							</div>
							<p class="mt-2 text-xs leading-relaxed text-rose-700 dark:text-rose-300">
								<strong class="font-bold">ประเภท:</strong> รายการไม่อยู่ในประกาศ (Unsolicited)<br />
								สิ่งของนอกเหนือรายการแจ้งความต้องการ (Unsolicited Donation)
							</p>
						</div>

						<!-- Donor Contact Card -->
						<div
							class="rounded-2xl border border-blue-200 bg-blue-50/70 p-5 text-sm dark:border-blue-900/50 dark:bg-blue-950/20"
						>
							<div class="flex items-center gap-2 font-bold text-blue-700 dark:text-blue-400">
								<User class="h-4.5 w-4.5 shrink-0" />
								<span>ข้อมูลผู้บริจาค / จุดประสานงาน</span>
							</div>
							<div class="mt-2 space-y-1 text-sm text-blue-950 dark:text-blue-200">
								<div class="font-bold text-foreground">{donorName || 'ไม่ระบุชื่อ'}</div>
								<div class="text-xs text-muted-foreground">
									โทร. {donorPhone || 'ไม่ระบุเบอร์โทร'}
								</div>
								{#if donorEmail}
									<div class="text-xs text-muted-foreground">{donorEmail}</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- Section: Item Mapping -->
					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
								<ClipboardCheck class="h-5 w-5 text-primary" />
								ตรวจสอบและจับคู่ข้อมูล (Item Mapping)
							</h3>
						</div>

						<div class="space-y-4">
							{#each scannedItems as item, idx (item.key)}
								<div
									class="rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all md:p-6 {item.verified
										? 'border-emerald-500/50 bg-emerald-50/15'
										: ''}"
								>
									<!-- Item Header & Verified Checkbox -->
									<div
										class="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4"
									>
										<div class="flex flex-wrap items-center gap-2.5">
											<div
												class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"
											>
												<Package class="h-5 w-5" />
											</div>
											<span class="text-base font-bold text-foreground">{item.name}</span>
											<Badge variant="secondary" class="h-6 px-2.5 text-xs font-semibold">
												แจ้งไว้: {item.declaredQty}
												{item.unit}
											</Badge>
											{#if item.qty === item.declaredQty}
												<Badge
													variant="outline"
													class="h-6 border-emerald-300/80 bg-emerald-50 px-2 text-xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
												>
													✓ ครบถ้วน
												</Badge>
											{:else}
												<Badge
													variant="outline"
													class="h-6 border-amber-300/80 bg-amber-50 px-2 text-xs font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
												>
													⚠ มีส่วนต่าง
												</Badge>
											{/if}
										</div>

										<label
											class="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/80 bg-background/80 px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60 {item.verified
												? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
												: ''}"
										>
											<Checkbox bind:checked={item.verified} />
											<span class="select-none">ผ่านการตรวจสอบแล้ว</span>
										</label>
									</div>

									<!-- Form Fields Grid -->
									<div class="space-y-4">
										<!-- Row 1: Map to Master & Storage Zone -->
										<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
											<!-- Map to master -->
											<div class="space-y-1.5">
												<div class="flex items-center justify-between">
													<Label
														for="map-master-{idx}"
														class="text-sm font-semibold text-foreground"
													>
														จับคู่ฐานข้อมูลหลัก (Map to Master) <span class="text-rose-500">*</span>
													</Label>
													<button
														type="button"
														onclick={() => openQuickCreate(idx)}
														class="cursor-pointer text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
													>
														+ สร้างรายการใหม่
													</button>
												</div>

												<div class="flex items-center gap-2">
													<select
														id="map-master-{idx}"
														bind:value={item.item_id}
														class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm text-foreground transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
													>
														<option value="">-- เลือกรายการสินค้าหลัก --</option>
														{#each catalogItems as c (c._id)}
															<option value={c._id}>
																{c.name} ({c.unit})
															</option>
														{/each}
													</select>

													<Button
														type="button"
														variant="outline"
														size="icon"
														onclick={() => openQuickCreate(idx)}
														class="h-10 w-10 shrink-0 rounded-xl border-blue-200 bg-blue-50/70 text-blue-600 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-400"
														title="สร้างสินค้าใหม่"
													>
														<PlusCircle class="h-4 w-4" />
													</Button>
												</div>
											</div>

											<!-- Storage Zone -->
											<div class="space-y-1.5">
												<Label
													for="storage-zone-{idx}"
													class="text-sm font-semibold text-foreground"
												>
													โซนจัดเก็บ <span class="text-rose-500">*</span>
												</Label>
												<select
													id="storage-zone-{idx}"
													bind:value={item.storage_zone}
													class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm text-foreground transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
												>
													<option value="">-- เลือกโซนจัดเก็บ * --</option>
													<option value="Zone A (อาหารแห้งและเครื่องดื่ม)"
														>Zone A (อาหารแห้งและเครื่องดื่ม)</option
													>
													<option value="Zone B (ยาและเวชภัณฑ์)">Zone B (ยาและเวชภัณฑ์)</option>
													<option value="Zone C (ของใช้ทั่วไปและสุขอนามัย)"
														>Zone C (ของใช้ทั่วไปและสุขอนามัย)</option
													>
													<option value="Zone D (เครื่องนุ่งห่มและที่นอน)"
														>Zone D (เครื่องนุ่งห่มและที่นอน)</option
													>
													<option value="Zone E (อุปกรณ์และเครื่องมือช่าง)"
														>Zone E (อุปกรณ์และเครื่องมือช่าง)</option
													>
													<option value="Zone F (ห้องควบคุมอุณหภูมิ/ตู้แช่)"
														>Zone F (ห้องควบคุมอุณหภูมิ/ตู้แช่)</option
													>
												</select>
											</div>
										</div>

										<!-- Row 2: Expiry date & Real quantity & Difference reason -->
										<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 md:grid-cols-12">
											<!-- Expiry date -->
											<div class="space-y-1.5 md:col-span-3">
												<Label
													for="item-expiry-{idx}"
													class="text-sm font-semibold text-foreground"
												>
													วันหมดอายุ
													{#if item.item_id && isPerishable(item.item_id)}
														<span class="text-rose-500">*</span>
														<span class="ml-1 text-xs font-normal text-rose-600 dark:text-rose-400">
															(ของเน่าเสียง่าย)
														</span>
													{:else}
														<span class="ml-1 text-xs font-normal text-muted-foreground">
															(ถ้ามี)
														</span>
													{/if}
												</Label>
												<Input
													id="item-expiry-{idx}"
													type="date"
													bind:value={item.expiry}
													class="h-10 rounded-xl text-sm {item.item_id &&
													isPerishable(item.item_id) &&
													!item.expiry
														? 'border-rose-300 dark:border-rose-900'
														: ''}"
												/>
											</div>

											<!-- Real Quantity -->
											<div class="space-y-1.5 md:col-span-4">
												<div class="flex items-center justify-between">
													<Label for="item-qty-{idx}" class="text-sm font-semibold text-foreground">
														จำนวนรับจริง <span class="text-rose-500">*</span>
													</Label>
													<span class="text-xs text-muted-foreground">
														แจ้งไว้: {item.declaredQty}
														{item.unit}
													</span>
												</div>
												<div class="relative flex items-center">
													<Input
														id="item-qty-{idx}"
														type="text"
														inputmode="decimal"
														bind:value={item.qty}
														class="h-10 rounded-xl pr-14 text-sm font-bold"
													/>
													<span
														class="pointer-events-none absolute right-3 text-sm font-medium text-muted-foreground"
													>
														{item.unit}
													</span>
												</div>
											</div>

											<!-- Difference remark -->
											<div class="space-y-1.5 md:col-span-5">
												<Label
													for="item-remark-{idx}"
													class="text-sm font-semibold text-foreground"
												>
													หมายเหตุ / เหตุผลส่วนต่าง
												</Label>
												<Input
													id="item-remark-{idx}"
													type="text"
													placeholder="ระบุข้อความสั้นๆ (ถ้ามี)"
													bind:value={item.diffReason}
													class="h-10 rounded-xl text-sm"
												/>
											</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>

					<!-- Additional Statement / Condition Details -->
					<div class="space-y-2">
						<div class="flex items-center gap-2 text-sm font-bold text-foreground">
							<PackageCheck class="h-4.5 w-4.5 text-muted-foreground" />
							<span>คำชี้แจงและกรณีศึกษาสภาพสิ่งของเพิ่มเติม</span>
						</div>
						<div
							class="rounded-2xl border border-border/80 bg-muted/15 p-4.5 text-sm leading-relaxed text-foreground"
						>
							{donorNote}
						</div>
					</div>

					<!-- Logistics Info (3 boxes) -->
					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div class="rounded-2xl border border-border/80 bg-card p-4.5 shadow-2xs">
							<div class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
								<Truck class="h-4 w-4 text-blue-600 dark:text-blue-400" />
								<span>ยานพาหนะจัดส่ง</span>
							</div>
							<p class="mt-2 text-sm font-bold text-foreground">
								{vehicleLabel}
							</p>
						</div>

						<div class="rounded-2xl border border-border/80 bg-card p-4.5 shadow-2xs">
							<div class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
								<MapPin class="h-4 w-4 text-blue-600 dark:text-blue-400" />
								<span>อาคาร/พิกัดเสนอรับเข้า</span>
							</div>
							<p class="mt-2 text-sm font-bold text-foreground">จุดรับบริจาคส่วนหน้า</p>
						</div>

						<div class="rounded-2xl border border-border/80 bg-card p-4.5 shadow-2xs">
							<div class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
								<Calendar class="h-4 w-4 text-blue-600 dark:text-blue-400" />
								<span>นัดหมายเสนอขอบริจาค</span>
							</div>
							<p class="mt-2 text-sm font-bold text-foreground">
								{appointmentLabel}
							</p>
						</div>
					</div>

					<!-- Staff Review Memo Textarea -->
					<div class="space-y-2">
						<Label for="review-memo-input" class="text-sm font-bold text-foreground">
							บันทึกความเห็นของเจ้าหน้าที่ประจำศูนย์ (Internal Review Memo)
						</Label>
						<textarea
							id="review-memo-input"
							rows="3"
							placeholder="เขียนวิเคราะห์ความจุคลัง หรือข้อตกลงพิเศษในการรับของ เช่น โซนตู้แช่สำรองไฟ ฯลฯ"
							bind:value={remarks}
							class="w-full rounded-2xl border border-border/80 bg-card p-3.5 text-sm text-foreground outline-hidden placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
						></textarea>
					</div>

					<!-- Bottom Validation Alert Box (Clean, above action buttons) -->
					{#if !canReceive}
						<div
							class="rounded-2xl border border-rose-200 bg-rose-50/80 p-4.5 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400"
						>
							<div class="font-bold">ไม่สามารถกด "ยืนยันรับเข้าคลัง" ได้เนื่องจาก:</div>
							<ul class="mt-1.5 list-inside list-disc space-y-1 text-xs">
								{#if scannedItems.some((it) => !it.item_id || !it.qty)}
									<li>ยังจับคู่ข้อมูลสินค้า หรือกรอกจำนวนรับไม่ครบถ้วน</li>
								{/if}
								{#if scannedItems.some((it) => !it.storage_zone)}
									<li>ยังไม่ได้เลือกโซนจัดเก็บครบทุกรายการ</li>
								{/if}
								{#if scannedItems.some((it) => !it.verified)}
									<li>ยังไม่ได้ติ๊ก "ผ่านการตรวจสอบแล้ว" ครบทุกรายการ</li>
								{/if}
								{#if scannedMissingExpiry.length > 0}
									<li>ของเน่าเสียง่ายยังไม่ได้ระบุวันหมดอายุ: {scannedMissingExpiry.join(', ')}</li>
								{/if}
							</ul>
						</div>
					{/if}

					<!-- Action Buttons Row (Professional, clean layout) -->
					<div
						class="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center"
					>
						<div class="flex flex-wrap items-center gap-2.5">
							<!-- Receive Into Stock Button -->
							<button
								type="button"
								onclick={handleSaveScan}
								disabled={saving || !canReceive}
								class="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 text-sm font-bold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<Check class="h-4.5 w-4.5" />
								{saving ? 'กำลังบันทึก…' : 'ยืนยันรับเข้าคลัง'}
							</button>

							<!-- Redirect Button -->
							<button
								type="button"
								onclick={() => (actionPanel = actionPanel === 'redirect' ? 'none' : 'redirect')}
								disabled={saving}
								class="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#002D5B] px-5 text-sm font-bold text-white shadow-xs transition-colors hover:bg-[#001f3f] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
							>
								<MapPin class="h-4 w-4" />
								ประสานงานส่งต่อ
							</button>
						</div>

						<!-- Reject Button -->
						<button
							type="button"
							onclick={() => (actionPanel = actionPanel === 'reject' ? 'none' : 'reject')}
							disabled={saving}
							class="inline-flex h-11 cursor-pointer items-center justify-center rounded-xl border border-rose-200 bg-rose-50/70 px-5 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/50 dark:bg-rose-950/20 dark:hover:bg-rose-900/40"
						>
							ปฏิเสธคำขอ
						</button>
					</div>

					<!-- Expandable Redirect Panel -->
					{#if actionPanel === 'redirect'}
						<div
							class="animate-in space-y-4 rounded-2xl border-2 border-blue-500 bg-card p-5 shadow-sm fade-in slide-in-from-top-2"
						>
							<div class="space-y-1.5">
								<Label for="target-shelter-select" class="text-sm font-bold text-foreground">
									เลือกศูนย์พักพิงปลายทางแห่งใหม่ (Target Shelter Reroute) <span
										class="text-rose-500">*</span
									>
								</Label>
								<select
									id="target-shelter-select"
									bind:value={selectedTargetShelter}
									class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:outline-none"
								>
									<option value="">-- เลือกศูนย์พักพิงปลายทาง --</option>
									{#each redirectTargets as s (s.code)}
										<option value={s.code}>{s.name} ({s.code})</option>
									{/each}
								</select>
							</div>

							<div class="space-y-1.5">
								<Label for="redirect-remark-input" class="text-sm font-bold text-foreground">
									หมายเหตุสำหรับการส่งต่อ (Remark)
								</Label>
								<textarea
									id="redirect-remark-input"
									rows="2"
									placeholder="ระบุเหตุผลการส่งต่อ เช่น คลังเต็ม หรือต้องการการดูแลเฉพาะทาง..."
									bind:value={redirectNote}
									class="w-full rounded-xl border border-border/80 bg-muted/10 p-3 text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
								></textarea>
							</div>

							<div class="flex items-center justify-between gap-3 pt-2">
								<Button
									type="button"
									onclick={handleConfirmRedirect}
									disabled={saving || !selectedTargetShelter}
									class="h-10 rounded-xl bg-[#002D5B] px-6 text-sm font-bold text-white hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
								>
									{saving ? 'กำลังดำเนินการ...' : 'ยืนยันการประสานงานส่งต่อ'}
								</Button>
								<Button
									variant="ghost"
									type="button"
									onclick={() => (actionPanel = 'none')}
									class="h-10 rounded-xl px-5 text-sm font-bold"
								>
									ยกเลิก
								</Button>
							</div>
						</div>
					{/if}

					<!-- Expandable Reject Panel -->
					{#if actionPanel === 'reject'}
						<div
							class="animate-in space-y-4 rounded-2xl border border-rose-200 bg-white p-5 shadow-2xs fade-in slide-in-from-top-2 dark:border-rose-900/50 dark:bg-card"
						>
							<div class="space-y-1.5">
								<Label for="reject-reason-input" class="text-sm font-bold text-foreground">
									ระบุเหตุผลในการปฏิเสธคำขอ (Reject Reason)
								</Label>
								<Input
									id="reject-reason-input"
									type="text"
									placeholder="เช่น พื้นที่จัดเก็บไม่เพียงพอ, งดรับเสื้อผ้าชั่วคราว..."
									bind:value={rejectReason}
									class="h-10 rounded-xl border border-border/80 bg-background text-sm text-foreground placeholder:text-muted-foreground focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
								/>
							</div>

							<div class="flex items-center gap-3 pt-1">
								<button
									type="button"
									onclick={handleConfirmReject}
									disabled={saving || !rejectReason.trim()}
									class="h-10 flex-1 cursor-pointer rounded-xl bg-[#E11D48] px-6 text-sm font-bold text-white shadow-xs transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{saving ? 'กำลังดำเนินการ...' : 'ยืนยันการปฏิเสธคำขอ'}
								</button>
								<button
									type="button"
									onclick={() => (actionPanel = 'none')}
									class="h-10 cursor-pointer rounded-xl bg-slate-100 px-6 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-muted dark:text-foreground dark:hover:bg-muted/80"
								>
									ยกเลิก
								</button>
							</div>
						</div>
					{/if}
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
					<p class="mt-1 text-2xs text-muted-foreground">
						สแกนคิวอาร์โค้ดใบจองจากมือถือผู้บริจาค เพื่อตรวจรับสินค้าและอัปเดตระบบคลังพัสดุแบบทันที
						(Real-time Sync)
					</p>
				</div>
			</div>

			<!-- Scan Body -->
			<div
				class="flex min-h-[440px] flex-col items-center justify-center gap-6 bg-slate-50/40 p-6 md:p-10 dark:bg-muted/10"
			>
				{#if cameraOpen}
					<!-- Live viewfinder. Same html5-qrcode wiring as the people check-in
					     scanner; closing the block stops the camera (see cameraAttachment). -->
					<div
						class="flex w-full max-w-md animate-in flex-col items-center gap-4 rounded-3xl border border-border/80 bg-card p-6 text-center shadow-xs duration-200 fade-in"
					>
						<h3 class="text-sm font-bold text-foreground">หันกล้องไปที่ QR Code บนใบจอง</h3>
						<div
							class="relative flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-slate-950"
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
						<p class="text-2xs text-muted-foreground">
							ระบบจะเปิดใบจองให้อัตโนมัติเมื่ออ่าน QR ได้
						</p>
						<Button
							variant="outline"
							size="sm"
							onclick={() => (cameraOpen = false)}
							class="h-9 rounded-xl px-4 text-xs font-bold"
						>
							ปิดกล้อง
						</Button>
					</div>
				{:else if scanState === 'idle'}
					<!-- Idle Station Card -->
					<div
						class="flex w-full max-w-md animate-in flex-col items-center justify-center rounded-3xl border border-dashed border-border/80 bg-card p-8 text-center shadow-xs duration-200 fade-in"
					>
						<div
							class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
						>
							<Camera class="h-8 w-8" />
						</div>

						<h3 class="mb-1 text-sm font-bold text-foreground">สแกน QR Code เพื่อตรวจรับพัสดุ</h3>
						<p class="mb-6 text-2xs text-muted-foreground">
							เปิดกล้องเพื่อสแกน QR Code ใบจองจากมือถือผู้บริจาค หรือค้นหาด้วยรหัสคำขอ
						</p>

						<!-- Primary Action buttons -->
						<div class="grid w-full grid-cols-2 gap-3">
							<button
								type="button"
								onclick={openCamera}
								class="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#002D5B] text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
							>
								<Camera class="h-4 w-4" />
								เปิดกล้องสแกน QR
							</button>

							<button
								type="button"
								onclick={() => (activeView = 'walkin')}
								class="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card text-xs font-bold text-foreground shadow-xs transition-colors hover:bg-muted"
							>
								<User class="h-4 w-4 text-blue-600 dark:text-blue-400" />
								ลงทะเบียน Walk-in
							</button>
						</div>

						<!-- Manual search input fallback -->
						<div class="mt-6 flex w-full items-center gap-2 border-t border-border/60 pt-4">
							<Input
								type="text"
								placeholder="หรือกรอกรหัสการจอง (เช่น DN-123456)"
								bind:value={searchQuery}
								onkeydown={(e) => e.key === 'Enter' && lookupTyped()}
								class="h-9 rounded-xl text-xs"
							/>
							<Button
								size="sm"
								onclick={lookupTyped}
								disabled={!searchQuery.trim()}
								class="h-9 shrink-0 rounded-xl px-3 text-xs font-bold"
							>
								ค้นหา
							</Button>
						</div>

						{#if cameraError}
							<div
								class="mt-4 flex w-full items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-left text-2xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300"
							>
								<CameraOff class="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>{cameraError}</span>
							</div>
						{/if}

						<!-- The queue the counter is actually holding. The camera button used to
						     open whatever sat at the top of this list, which looked like a scan
						     that had happened; picking a booking is now an explicit act. -->
						{#if awaitingBookings.length}
							<div class="mt-4 w-full border-t border-border/60 pt-4 text-left">
								<p
									class="mb-2 text-2xs font-extrabold tracking-wider text-muted-foreground uppercase"
								>
									รอตรวจรับที่ศูนย์ ({awaitingBookings.length})
								</p>
								<ul class="max-h-40 space-y-1.5 overflow-y-auto">
									{#each awaitingBookings as booking (donationActionRef(booking))}
										{@const ref = donationActionRef(booking)}
										<li>
											<button
												type="button"
												onclick={() => ref && performLookup(ref)}
												class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 text-left transition-colors hover:bg-muted"
											>
												<span class="min-w-0">
													<span class="block truncate text-2xs font-bold text-foreground">
														{donationRefLabel(booking)}
													</span>
													<span class="block truncate text-3xs text-muted-foreground">
														{booking.donor_name || 'ไม่ระบุชื่อ'} · {booking.item_count} รายการ
													</span>
												</span>
												<span
													class="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-3xs font-bold text-muted-foreground"
												>
													{booking.status}
												</span>
											</button>
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
				<button
					type="button"
					onclick={() => (activeView = 'scan')}
					class="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-blue-200 transition-colors hover:text-white"
				>
					<ArrowLeft class="h-3.5 w-3.5" />
					กลับหน้าสแกนรับของ
				</button>

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
								ชื่อผู้บริจาค/ผู้ติดต่อ <span class="text-rose-500">*</span>
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

						<button
							type="button"
							onclick={addWalkinItem}
							class="flex cursor-pointer items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/70 px-3.5 py-2 text-xs font-bold text-blue-600 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/60"
						>
							<PlusCircle class="h-4 w-4" />
							เพิ่มรายการสิ่งของ
						</button>
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
										<button
											type="button"
											onclick={() => openQuickCreate(idx)}
											class="cursor-pointer text-xs font-semibold text-blue-600 transition-colors hover:underline dark:text-blue-400"
										>
											+ สร้างรายการใหม่
										</button>
										{#if walkinItems.length > 1}
											<button
												type="button"
												onclick={() => removeWalkinItem(item.id)}
												class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
												title="ลบรายการนี้"
											>
												<Trash2 class="h-4 w-4" />
											</button>
										{/if}
									</div>
								</div>

								<div class="grid grid-cols-1 items-start gap-4 md:grid-cols-12">
									<!-- Item Select -->
									<div class="space-y-1.5 md:col-span-8">
										<Label class="text-sm font-semibold text-foreground">
											เลือกประเภทสิ่งของ / ค้นหาสินค้าหลัก <span class="text-rose-500">*</span>
										</Label>
										<select
											value={item.itemId}
											onchange={(e) =>
												handleWalkinItemSelect(idx, (e.target as HTMLSelectElement).value)}
											class="h-10 w-full rounded-xl border border-border/80 bg-card px-3 text-sm text-foreground transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
										>
											<option value="">-- ค้นหาและเลือก Item --</option>
											{#each catalogItems as c (c._id)}
												<option value={c._id}>
													{c.name} ({c.unit})
												</option>
											{/each}
										</select>
									</div>

									<!-- Qty Input -->
									<div class="space-y-1.5 md:col-span-2">
										<Label for="walkin-qty-{item.id}" class="text-sm font-semibold text-foreground">
											จำนวนที่รับจริง <span class="text-rose-500">*</span>
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
									<div class="space-y-1.5 md:col-span-2">
										<Label
											for="walkin-unit-{item.id}"
											class="text-sm font-semibold text-foreground"
										>
											หน่วย
										</Label>
										<Input
											id="walkin-unit-{item.id}"
											type="text"
											bind:value={item.unit}
											class="h-10 rounded-xl text-center text-sm"
										/>
									</div>
								</div>

								<!-- Lot details. Both reach `stock_ledger.lot` (CR-088); the expiry
								     is REQUIRED for a perishable item and the intake route refuses
								     the line without it — this row is where staff can actually
								     supply it. -->
								<div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-12">
									<div class="space-y-1.5 md:col-span-6">
										<Label
											for="walkin-expiry-{item.id}"
											class="text-sm font-semibold text-foreground"
										>
											วันหมดอายุ
											{#if isPerishable(item.itemId)}
												<span class="text-rose-500">*</span>
												<span class="ml-1 text-xs font-normal text-rose-600 dark:text-rose-400">
													(ของเน่าเสียง่าย — ต้องระบุ)
												</span>
											{:else}
												<span class="ml-1 text-xs font-normal text-muted-foreground">(ถ้ามี)</span>
											{/if}
										</Label>
										<Input
											id="walkin-expiry-{item.id}"
											type="date"
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
{#if isQuickCreateOpen}
	<div
		class="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/60 p-4 backdrop-blur-xs fade-in"
	>
		<div
			class="w-full max-w-md animate-in rounded-3xl border border-border bg-card p-6 shadow-2xl zoom-in-95"
		>
			<div class="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
				<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
					<PackagePlus class="h-5 w-5 text-primary" />
					สร้างรายการสินค้าใหม่ในคลัง
				</h3>
				<button
					type="button"
					onclick={() => (isQuickCreateOpen = false)}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="space-y-4">
				<div class="space-y-1.5">
					<Label for="new-item-name" class="text-sm font-semibold text-foreground">
						ชื่อสิ่งของ/รายการสินค้า <span class="text-rose-500">*</span>
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
						<select
							id="new-item-category"
							bind:value={newItemCategory}
							class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:outline-none"
						>
							<option value="food">อาหารและเครื่องดื่ม</option>
							<option value="medicine">ยารักษาโรค/เวชภัณฑ์</option>
							<option value="hygiene">ของใช้ส่วนตัว/สุขอนามัย</option>
							<option value="clothing">เครื่องนุ่งห่ม/ที่นอน</option>
							<option value="baby">แม่และเด็ก</option>
							<option value="tools">อุปกรณ์/เครื่องมือช่าง</option>
							<option value="general">ของใช้ทั่วไป</option>
						</select>
					</div>

					<div class="space-y-1.5">
						<Label for="new-item-unit" class="text-sm font-semibold text-foreground">
							หน่วยนับมาตรฐาน
						</Label>
						<Input
							id="new-item-unit"
							type="text"
							placeholder="เช่น กระป๋อง, ชิ้น"
							bind:value={newItemUnit}
							class="h-10 rounded-xl text-sm"
						/>
					</div>
				</div>

				<div class="flex items-center justify-end gap-2.5 pt-4">
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
						class="h-10 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"
					>
						{#if creatingItem}
							<Loader2 class="h-4 w-4 animate-spin" />
							กำลังสร้าง…
						{:else}
							บันทึกรายการใหม่
						{/if}
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}
