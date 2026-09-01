import { toast } from 'svelte-sonner';
import { getShelterCode } from '$lib/db/shelter';
import { authStore } from '$lib/stores/auth.svelte';
import { supplyRepository } from '$lib/features/supply';
import { useQueryClient } from '@tanstack/svelte-query';
import {
	operationsKeys,
	useCampaigns,
	useStockLedgers,
	useDonations,
	useCreateCampaign,
	useUpdateCampaign
} from './queries';
import {
	buildCampaignNotes,
	deriveNeedAvailability,
	editNeed,
	forceCutOffNeed,
	mapNeedItemHeuristic,
	reopenNeed,
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
	const queryClient = useQueryClient();

	/**
	 * The board's three inputs all move without this page doing anything: a donor books
	 * or edits from the public plane, another shelter's staff receive stock. With the
	 * app's 60s `staleTime` and no focus event to trigger a refetch, staff watching the
	 * board saw figures frozen at page load and reported the edit "not updating".
	 *
	 * Revalidate when the tab comes back and on a slow tick — the numbers are what the
	 * cut-off decision is read from, so being a minute behind is a wrong answer, not a
	 * stale detail.
	 */
	function refreshBoard() {
		void queryClient.invalidateQueries({ queryKey: operationsKeys.campaigns() });
		void queryClient.invalidateQueries({ queryKey: operationsKeys.donations() });
		void queryClient.invalidateQueries({ queryKey: operationsKeys.stockLedgers() });
	}

	$effect(() => {
		if (typeof document === 'undefined') return;
		const onVisible = () => {
			if (document.visibilityState === 'visible') refreshBoard();
		};
		document.addEventListener('visibilitychange', onVisible);
		const tick = setInterval(refreshBoard, 60_000);
		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			clearInterval(tick);
		};
	});
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

	/**
	 * Force cut-off / restore for one need (T-22, CR-052 §1.6).
	 *
	 * `reason` is required when closing and is what lands in the audit entry — the
	 * domain refuses a blank one, so the board must collect it before calling.
	 */
	function toggleCutOff(compoundId: string, itemId: string, reason?: string) {
		const targetItem = derivedItems.find((i) => i.id === compoundId);
		if (!targetItem) return;

		const campaign = targetItem.campaignDoc;
		const isClosing = campaign.needs.find((n) => n.item_id === itemId)?.status !== 'closed';
		const name = itemDisplayName(itemId);

		let updatedCampaign;
		try {
			updatedCampaign = isClosing
				? forceCutOffNeed(campaign, itemId, reason ?? '')
				: reopenNeed(campaign, itemId);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ไม่สามารถบันทึกสถานะได้');
			return;
		}

		updateCampaignMutation.mutate(
			{
				campaign: updatedCampaign,
				auditInput: {
					action: 'manual_adjust',
					reason: isClosing
						? `เจ้าหน้าที่บังคับปิดรับบริจาคสำหรับพัสดุ: ${name} ในแคมเปญ ${targetItem.title} — เหตุผล: ${reason?.trim()}`
						: `เจ้าหน้าที่เปิดรับบริจาคพัสดุอีกครั้ง: ${name} ในแคมเปญ ${targetItem.title}`,
					ctx: ctx
				}
			},
			{
				onSuccess: () => {
					toast.success(
						isClosing
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
		target: string;
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

	/**
	 * Save an edit from the needs-board row (T-22 edit).
	 *
	 * Takes `itemId` because the board renders ONE ROW PER NEED: editing
	 * `campaign.needs[0]` would rewrite a different item than the row the user
	 * clicked whenever a campaign carries more than one need.
	 *
	 * `notes` is rebuilt through `buildCampaignNotes` — the same encoder the create
	 * form uses — so an edit cannot drop the urgency/category the campaign was
	 * created with (§2.4 has no field for either; the notes string is where they live).
	 */
	function handleEditRequest(
		compoundId: string,
		itemId: string,
		updated: {
			title: string;
			target: string;
			unit?: string;
			category?: string;
			urgency?: 'critical' | 'important' | 'normal';
			description?: string;
		}
	) {
		const targetItem = derivedItems.find((i) => i.id === compoundId);
		if (!targetItem) return;
		const camp = targetItem.campaignDoc;

		let updatedCampaign;
		try {
			updatedCampaign = editNeed(camp, itemId, {
				qty_target: updated.target,
				unit: updated.unit
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ไม่สามารถบันทึกการแก้ไขได้');
			return;
		}

		const title = updated.title.trim() || camp.title;
		const notes = buildCampaignNotes({
			urgency: updated.urgency,
			category: updated.category,
			description: updated.description
		});

		updateCampaignMutation.mutate(
			{
				campaign: {
					...updatedCampaign,
					title,
					...(notes ? { notes } : {})
				},
				auditInput: {
					action: 'manual_adjust',
					reason:
						`แก้ไขประกาศ "${title}" — ${itemDisplayName(itemId)}: เป้าหมาย ${updated.target} ${updated.unit ?? ''}`.trim(),
					ctx: ctx
				}
			},
			{
				onSuccess: () => {
					toast.success(`แก้ไขประกาศ "${title}" สำเร็จ`);
				},
				onError: (err) => {
					toast.error(`ไม่สามารถแก้ไขประกาศได้: ${err.message}`);
				}
			}
		);
	}

	return {
		get derivedItems() {
			return derivedItems;
		},
		toggleShowOnHome,
		toggleCutOff,
		handleAddRequest,
		handleAddRequestFromForm,
		handleEditRequest
	};
}
