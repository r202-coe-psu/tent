import { toast } from 'svelte-sonner';
import { getShelterCode } from '$lib/db/shelter';
import { authStore } from '$lib/stores/auth.svelte';
import { supplyRepository } from '$lib/features/supply';
import {
	useCampaigns,
	useStockLedgers,
	useDonations,
	useCreateCampaign,
	useUpdateCampaign
} from './queries';
import {
	deriveNeedAvailability,
	mapNeedItemHeuristic,
	type SpecialRequestInput
} from '../domain/operations';
import type { NeedItem } from './need-item.types';

const ITEM_NAMES: Record<string, string> = {
	'item:rice': 'ข้าวสาร (ข้าวหอมมะลิ 100%)',
	'item:water': 'น้ำดื่มบรรจุขวด 1.5L',
	'item:paracetamol': 'ยาพาราเซตามอล',
	'item:soap': 'สบู่ก้อน',
	'item:blanket': 'ผ้าห่มกันหนาว',
	'item:egg': 'ไข่ไก่สด'
};

function itemDisplayName(itemId: string): string {
	return ITEM_NAMES[itemId] ?? (itemId.startsWith('item:') ? itemId.slice(5) : itemId);
}

function buildCampaignNotes(input: {
	location: string;
	category?: string;
	urgency?: 'critical' | 'important' | 'normal';
	description?: string;
}): string {
	const parts: string[] = [];
	if (input.urgency === 'critical') parts.push('[ด่วน]');
	else if (input.urgency === 'important') parts.push('[สำคัญ]');
	if (input.category && input.category !== 'ถูกกำหนดอัตโนมัติ') {
		parts.push(`หมวด: ${input.category}`);
	}
	if (input.description?.trim()) {
		parts.push(input.description.trim());
	} else {
		parts.push(`ประกาศสำหรับคลัง: ${input.location}`);
	}
	return parts.join(' ');
}

async function warnIfItemNotInCatalog(itemId: string, displayName: string): Promise<void> {
	const catalogItem = await supplyRepository().getItem(itemId);
	if (!catalogItem) {
		toast.warning(
			`"${displayName}" ไม่พบในแคตตาล็อก — ระบบจะใช้รหัส ${itemId} ชั่วคราว กรุณาตรวจสอบก่อนเปิดรับบริจาค`
		);
	}
}

export function useDonationNeedsBoard(options?: {
	onRequestCreated?: () => void;
	onFormCreated?: () => void;
}) {
	const campaignsQuery = useCampaigns();
	const stockLedgersQuery = useStockLedgers();
	const donationsQuery = useDonations();
	const createCampaignMutation = useCreateCampaign();
	const updateCampaignMutation = useUpdateCampaign();

	const ctx = $derived({
		shelterCode: getShelterCode(),
		createdBy: authStore.user?.name ?? 'system'
	});

	const derivedItems = $derived.by(() => {
		const campaigns = campaignsQuery.data ?? [];
		const donations = donationsQuery.data ?? [];
		const stockLedgers = stockLedgersQuery.data ?? [];

		const list: NeedItem[] = [];
		for (const camp of campaigns) {
			const availabilities = deriveNeedAvailability(camp, donations, stockLedgers);
			const needs: NeedItem['needs'] = [];
			let allNeedsCutOff = true;

			for (const avail of availabilities) {
				if (!avail.is_cut_off) {
					allNeedsCutOff = false;
				}

				needs.push({
					itemId: avail.item_id,
					name: itemDisplayName(avail.item_id),
					reserved: avail.qty_reserved,
					onHand: avail.qty_on_hand,
					target: avail.qty_target,
					unit: avail.unit,
					isCutOff: avail.is_cut_off,
					isManualClosed: avail.status === 'closed'
				});
			}

			const isManualClosed = camp.status === 'closed';
			const isCutOff = allNeedsCutOff || isManualClosed;

			list.push({
				id: camp._id,
				title: camp.title || 'ประกาศช่วยเหลือภัยพิบัติ EOC',
				location: camp.notes || 'คลังช่วยเหลือภัยพิบัติ EOC',
				needs: needs,
				showOnHome: camp.visible_on_home !== false,
				isCutOff: isCutOff,
				isManualClosed: isManualClosed,
				campaignDoc: camp
			});
		}
		return list;
	});

	function toggleShowOnHome(compoundId: string) {
		const targetItem = derivedItems.find((i) => i.id === compoundId);
		if (targetItem) {
			const campaign = targetItem.campaignDoc;
			const nextVisible = campaign.visible_on_home === false ? true : false;
			updateCampaignMutation.mutate(
				{
					campaign: {
						...campaign,
						visible_on_home: nextVisible
					},
					auditInput: {
						action: 'manual_adjust',
						reason: nextVisible
							? `เจ้าหน้าที่เปิดแสดงแคมเปญบนหน้าแรก: ${targetItem.title}`
							: `เจ้าหน้าที่ซ่อนแคมเปญจากหน้าแรก: ${targetItem.title}`,
						ctx: ctx
					}
				},
				{
					onSuccess: () => {
						toast.success(
							nextVisible
								? `กำลังโปรโมต "${targetItem.title}" บนหน้าแรก`
								: `ซ่อน "${targetItem.title}" จากหน้าแรก`
						);
					},
					onError: (err) => {
						toast.error(`ไม่สามารถแก้ไขการโปรโมตได้: ${err.message}`);
					}
				}
			);
		}
	}

	function toggleCutOff(compoundId: string, itemId: string) {
		const targetItem = derivedItems.find((i) => i.id === compoundId);
		if (targetItem) {
			const campaign = targetItem.campaignDoc;

			const targetNeed = campaign.needs.find((n) => n.item_id === itemId);
			const toggledStatus: 'open' | 'closed' = targetNeed?.status === 'closed' ? 'open' : 'closed';
			const updatedNeeds = campaign.needs.map((need) => {
				if (need.item_id === itemId) {
					return {
						...need,
						status: toggledStatus
					};
				}
				return need;
			});

			const name = itemDisplayName(itemId);

			updateCampaignMutation.mutate(
				{
					campaign: {
						...campaign,
						needs: updatedNeeds
					},
					auditInput: {
						action: 'manual_adjust',
						reason:
							toggledStatus === 'closed'
								? `เจ้าหน้าที่บังคับปิดรับบริจาคสำหรับพัสดุ: ${name} ในแคมเปญ ${targetItem.title}`
								: `เจ้าหน้าที่เปิดรับบริจาคพัสดุอีกครั้ง: ${name} ในแคมเปญ ${targetItem.title}`,
						ctx: ctx
					}
				},
				{
					onSuccess: () => {
						toast.success(
							toggledStatus === 'closed'
								? `ปิดรับบริจาคสำหรับ "${name}" แล้ว`
								: `เปิดรับบริจาคสำหรับ "${name}" อีกครั้ง`
						);
					},
					onError: (err) => {
						toast.error(`ไม่สามารถบันทึกสถานะได้: ${err.message}`);
					}
				}
			);
		}
	}

	function handleAddRequest(input: SpecialRequestInput) {
		const itemId = mapNeedItemHeuristic(input.name);
		void warnIfItemNotInCatalog(itemId, input.name);

		const newCampaignInput = {
			title: input.name,
			needs: [
				{
					item_id: itemId,
					qty_target: input.target,
					unit: 'ชิ้น'
				}
			],
			notes: `ประกาศพิเศษสำหรับคลัง: ${input.location}`
		};

		createCampaignMutation.mutate(
			{
				input: newCampaignInput,
				ctx: ctx
			},
			{
				onSuccess: () => {
					toast.success(`เพิ่มประกาศความต้องการ "${input.name}" สำเร็จ`);
					options?.onRequestCreated?.();
				},
				onError: (err) => {
					toast.error(`ไม่สามารถสร้างประกาศได้: ${err.message}`);
				}
			}
		);
	}

	function handleAddRequestFromForm(input: {
		name: string;
		target: number;
		location: string;
		category?: string;
		unit?: string;
		urgency?: 'critical' | 'important' | 'normal';
		description?: string;
	}) {
		const itemId = mapNeedItemHeuristic(input.name);
		void warnIfItemNotInCatalog(itemId, input.name);

		const newCampaignInput = {
			title: input.name,
			needs: [
				{
					item_id: itemId,
					qty_target: input.target,
					unit: input.unit || 'ชิ้น',
					status: 'open' as const
				}
			],
			notes: buildCampaignNotes(input),
			visible_on_home: true
		};

		createCampaignMutation.mutate(
			{
				input: newCampaignInput,
				ctx: ctx
			},
			{
				onSuccess: () => {
					toast.success(`เพิ่มประกาศความต้องการ "${input.name}" สำเร็จ`);
					options?.onFormCreated?.();
				},
				onError: (err) => {
					toast.error(`ไม่สามารถสร้างประกาศได้: ${err.message}`);
				}
			}
		);
	}

	return {
		derivedItems,
		toggleShowOnHome,
		toggleCutOff,
		handleAddRequest,
		handleAddRequestFromForm
	};
}
