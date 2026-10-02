<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		useMealSession,
		useMealPlans,
		useCreateMealPlan,
		useStartMealPlanCooking,
		useUpdateConfirmedMealPlan,
		useMealServices,
		useRecordMealService,
		useMealServiceReceipts,
		mealServiceReceiptOutcome,
		sumHeadcountByTags,
		getActiveTagsFromSession,
		TARGET_GROUP_LABELS,
		MEAL_PERIOD_LABELS,
		type TargetGroupTag
	} from '$lib/features/kitchen';
	import {
		useTickets,
		useCreateTicket,
		useUpdateTicketItems,
		useReceiveTicket,
		TICKET_STATUS_LABELS
	} from '$lib/features/tickets';
	import { useRecipes, useItemMasters, getItemDisplayName } from '$lib/features/catalog';
	import { useSupplyItems } from '$lib/features/supply';
	import { useStockBalance } from '$lib/features/operations';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { qtyGt } from '$lib/utils/qty';
	import { formatThaiDateTime, formatThaiShortDate } from '$lib/utils/date';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Flame from '@lucide/svelte/icons/flame';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Check from '@lucide/svelte/icons/check';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Lock from '@lucide/svelte/icons/lock';

	const sessionId = $derived(page.params.session_id);
	const planIdParam = $derived(page.url.searchParams.get('plan_id'));
	const stageParam = $derived(page.url.searchParams.get('stage'));

	const sessionQuery = useMealSession(() => sessionId);
	const plans = useMealPlans();
	const services = useMealServices();
	const serviceReceipts = useMealServiceReceipts();
	const tickets = useTickets();
	const recipes = useRecipes(() => getShelterCode());
	const itemMasters = useItemMasters(() => getShelterCode());
	const supplyItems = useSupplyItems();
	const stock = useStockBalance();

	const getItemName = (id: string) => getItemDisplayName(id, itemMasters.data, supplyItems.data);

	const createMealPlanMutation = useCreateMealPlan();
	const startCookingMutation = useStartMealPlanCooking();
	const updateConfirmedMealPlanMutation = useUpdateConfirmedMealPlan();
	const createTicketMutation = useCreateTicket();
	const updateTicketItemsMutation = useUpdateTicketItems();
	const receiveTicketMutation = useReceiveTicket();
	const recordServiceMutation = useRecordMealService();

	const session = $derived(sessionQuery.data);

	// Current Active Batch State
	let currentStage = $state<'A' | 'B' | 'C'>('A');

	// Plan & ticket currently tracked in the wizard
	let activePlanId = $state<string | null>(null);
	let activeTicketId = $state<string | null>(null);

	// Sync activePlanId from query parameter
	$effect(() => {
		if (planIdParam) {
			activePlanId = planIdParam;
		}
	});

	// Sync stage from query parameter
	$effect(() => {
		if (stageParam) {
			const s = stageParam.toUpperCase();
			if (s === 'A' || s === '1') currentStage = 'A';
			else if (s === 'B' || s === '2') currentStage = 'B';
			else if (s === 'C' || s === '3') currentStage = 'C';
		}
	});

	const activePlan = $derived.by(() => {
		if (!activePlanId) return null;
		return (plans.data ?? []).find((p) => p._id === activePlanId) ?? null;
	});

	const activeTicket = $derived.by(() => {
		if (activeTicketId) {
			return (tickets.data ?? []).find((t) => t._id === activeTicketId) ?? null;
		}
		if (activePlanId) {
			return (
				(tickets.data ?? []).find(
					(t) => t.meal_plan_id === activePlanId && t.status !== 'CANCELLED'
				) ?? null
			);
		}
		return null;
	});

	// Latest service for the plan (ulid order) — a plan may have more than one
	// after a reject-and-redo cycle (CR-145).
	const activeService = $derived.by(() => {
		if (!activePlanId) return null;
		const matches = (services.data ?? []).filter((s) => s.meal_plan_id === activePlanId);
		return matches.length > 0 ? matches[matches.length - 1] : null;
	});

	// CR-144/CR-145: warehouse must decide (confirm/reject) before this batch
	// counts as delivered; a rejected service can be superseded by re-recording.
	const activeServiceReceipt = $derived.by(() => {
		if (!activeService) return null;
		return (
			(serviceReceipts.data ?? []).find((r) => r.meal_service_id === activeService._id) ?? null
		);
	});
	const activeServiceOutcome = $derived(
		activeServiceReceipt ? mealServiceReceiptOutcome(activeServiceReceipt) : undefined
	);
	const serviceReceiptConfirmed = $derived(activeServiceOutcome === 'confirmed');
	const serviceRejected = $derived(activeServiceOutcome === 'rejected');
	// A rejected service doesn't lock the form — kitchen can record a fresh one (CR-145).
	const isServiceFinalized = $derived(!!activeService && !serviceRejected);

	// --- Stage A: Form States ---
	let selectedRecipeId = $state<string>('');
	let recipeMode = $state<'bom' | 'custom'>('bom');

	function setRecipeMode(mode: 'bom' | 'custom') {
		recipeMode = mode;
		if (mode === 'custom' && selectedRecipeId) {
			selectedRecipeId = '';
			isIngredientsManuallyEdited = false;
			ingredientsList = calculateRecipeIngredients('', allocatedTarget);
		}
	}
	let menuLabel = $state('');
	let allocatedTarget = $state(50);
	let targetTags = $state<TargetGroupTag[]>(['regular']);
	let isEveryone = $state(false);

	function getHeadcountForTag(tag: TargetGroupTag): number {
		return sumHeadcountByTags(session?.target_headcount, [tag]);
	}

	function calculateTargetFromTags(tags: TargetGroupTag[]): number {
		return sumHeadcountByTags(session?.target_headcount, tags);
	}

	function getActiveSessionTags(): TargetGroupTag[] {
		return getActiveTagsFromSession(session);
	}

	// Auto-populate headcount from session when entering Stage A for a new batch
	// Only auto-select groups that have > 0 people in this session
	let hasInitializedNewBatch = $state(false);

	$effect(() => {
		if (!activePlanId && session && !hasInitializedNewBatch) {
			hasInitializedNewBatch = true;
			targetTags = getActiveSessionTags();
			isEveryone = targetTags.length === 5;
			const count = calculateTargetFromTags(targetTags);
			allocatedTarget = count > 0 ? count : session.target_headcount?.total || 50;
		}
	});

	// Pre-fill form when activePlan changes
	let lastLoadedPlanId = $state<string | null>(null);

	$effect(() => {
		if (activePlan && activePlan._id !== lastLoadedPlanId) {
			lastLoadedPlanId = activePlan._id;
			menuLabel = activePlan.label ?? '';
			allocatedTarget = activePlan.allocated_target ?? activePlan.headcount?.total ?? 50;
			const tags = (
				activePlan.target_tags && activePlan.target_tags.length > 0
					? activePlan.target_tags
					: ['regular']
			) as TargetGroupTag[];
			targetTags = tags;
			isEveryone = (tags as string[]).includes('everyone') || tags.length === 5;
			const planRecipeId = activePlan.recipes?.[0]?.recipe_id;
			selectedRecipeId = planRecipeId && planRecipeId !== 'recipe:custom' ? planRecipeId : '';
			recipeMode = selectedRecipeId ? 'bom' : 'custom';
			cookingStarted = !!activePlan.cooking_started_at;
			const ticketForPlan = (tickets.data ?? []).find(
				(t) => t.meal_plan_id === activePlan._id && t.status !== 'CANCELLED'
			);
			if (ticketForPlan?.items && ticketForPlan.items.length > 0) {
				ingredientsList = ticketForPlan.items.map((it) => {
					const master = (itemMasters.data ?? []).find((m) => m._id === it.item_id);
					return {
						item_id: it.item_id,
						name: master?.name || it.item_id,
						needed: String(it.requested_qty),
						unit: it.unit
					};
				});
				isIngredientsManuallyEdited = true;
			} else {
				isIngredientsManuallyEdited = false;
				ingredientsList = calculateRecipeIngredients(selectedRecipeId, allocatedTarget);
			}
		} else if (!activePlanId && lastLoadedPlanId !== null) {
			lastLoadedPlanId = null;
			menuLabel = '';
			targetTags = getActiveSessionTags();
			isEveryone = targetTags.length === 5;
			const count = calculateTargetFromTags(targetTags);
			allocatedTarget = count > 0 ? count : session?.target_headcount?.total || 50;
			selectedRecipeId = '';
			recipeMode = 'bom';
			isIngredientsManuallyEdited = false;
			ingredientsList = calculateRecipeIngredients('', allocatedTarget);
			showAddIngredient = false;
		}
	});

	function toggleTag(tag: TargetGroupTag) {
		let next: TargetGroupTag[];
		if (targetTags.includes(tag)) {
			next = targetTags.filter((t) => t !== tag);
		} else {
			next = [...targetTags, tag];
		}
		targetTags = next;
		isEveryone = next.length === 5;
		if (session?.target_headcount) {
			const count = calculateTargetFromTags(next);
			if (count > 0) {
				allocatedTarget = count;
			}
		}
	}

	function handleEveryoneToggle() {
		isEveryone = !isEveryone;
		if (isEveryone) {
			targetTags = ['halal', 'infant', 'soft_food', 'regular', 'volunteer'];
			if (session?.target_headcount) {
				const count = session.target_headcount.total || calculateTargetFromTags(targetTags);
				if (count > 0) allocatedTarget = count;
			}
		} else {
			targetTags = getActiveSessionTags();
			const count = calculateTargetFromTags(targetTags);
			if (count > 0) allocatedTarget = count;
		}
	}

	function handleRecipeChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		selectedRecipeId = target.value;
		const chosen = (recipes.data ?? []).find((r) => r._id === target.value);
		if (chosen?.label) {
			menuLabel = chosen.label;
		}
		isIngredientsManuallyEdited = false;
		ingredientsList = calculateRecipeIngredients(target.value, allocatedTarget);
	}

	interface IngredientRow {
		item_id: string;
		name: string;
		needed: string;
		unit: string;
	}

	let ingredientsList = $state<IngredientRow[]>([]);
	let isIngredientsManuallyEdited = $state(false);

	let showAddIngredient = $state(false);
	let newItemId = $state('');
	let newQty = $state('1');
	let newUnit = $state('');

	function calculateRecipeIngredients(recipeId: string, portions: number): IngredientRow[] {
		const recipe = (recipes.data ?? []).find((r) => r._id === recipeId);
		if (!recipe) {
			return [];
		}

		// Scale ingredients
		const baseServings = Math.max(parseFloat(recipe.standard_portions) || 1, 1);
		const factor = portions / baseServings;

		return (recipe.ingredients ?? []).map((ing) => {
			const itemMaster = (itemMasters.data ?? []).find((m) => m._id === ing.item_master_id);
			const scaledQty = Math.round(Number(ing.quantity || 0) * factor * 100) / 100;
			return {
				item_id: ing.item_master_id,
				name: itemMaster?.name || ing.item_master_id,
				needed: String(scaledQty),
				unit: ing.uom || itemMaster?.base_unit || 'kg'
			};
		});
	}

	// Synchronize ingredients with recipe & portions when not manually customized
	$effect(() => {
		const recId = selectedRecipeId;
		const target = allocatedTarget;
		void recipes.data;
		if (!isIngredientsManuallyEdited && target > 0) {
			ingredientsList = calculateRecipeIngredients(recId, target);
		}
	});

	function resetIngredientsToRecipe() {
		isIngredientsManuallyEdited = false;
		ingredientsList = calculateRecipeIngredients(selectedRecipeId, allocatedTarget);
		showAddIngredient = false;
		toast.info('คืนค่าวัตถุดิบตามสูตรและจำนวนจานเรียบร้อยแล้ว');
	}

	function removeIngredient(index: number) {
		isIngredientsManuallyEdited = true;
		ingredientsList = ingredientsList.filter((_, i) => i !== index);
	}

	const ingredientComboItems = $derived(
		(itemMasters.data ?? []).map((item) => ({
			value: item._id,
			label: `${item.name} (${item.base_unit})`,
			keywords: [item.name]
		}))
	);

	function handleNewItemSelect(id: string) {
		newItemId = id;
		const master = (itemMasters.data ?? []).find((m) => m._id === id);
		if (master) {
			newUnit = master.base_unit || 'kg';
		}
	}

	function confirmAddIngredient() {
		if (!newItemId || !newQty || Number(newQty) <= 0) {
			toast.error('กรุณาระบุวัตถุดิบและจำนวนที่ถูกต้อง');
			return;
		}
		const master = (itemMasters.data ?? []).find((m) => m._id === newItemId);
		const existingIndex = ingredientsList.findIndex((it) => it.item_id === newItemId);
		if (existingIndex >= 0) {
			const current = Number(ingredientsList[existingIndex].needed) || 0;
			ingredientsList[existingIndex].needed = String(
				Math.round((current + Number(newQty)) * 100) / 100
			);
		} else {
			ingredientsList = [
				...ingredientsList,
				{
					item_id: newItemId,
					name: master?.name || newItemId,
					needed: String(newQty),
					unit: newUnit || master?.base_unit || 'kg'
				}
			];
		}
		isIngredientsManuallyEdited = true;
		newItemId = '';
		newQty = '1';
		newUnit = '';
		showAddIngredient = false;
		toast.success(`เพิ่ม ${master?.name || 'วัตถุดิบ'} เรียบร้อยแล้ว`);
	}

	// Submit Stage A ➔ Create Requisition
	async function handleCreateRequisition() {
		if (!session) return;
		if (allocatedTarget <= 0) {
			toast.error('กรุณาระบุจำนวนจานเป้าหมาย');
			return;
		}
		if (targetTags.length === 0) {
			toast.error('กรุณาเลือกกลุ่มเป้าหมายอย่างน้อย 1 กลุ่ม');
			return;
		}
		if (ingredientsList.length === 0) {
			toast.error('กรุณาระบุวัตถุดิบอย่างน้อย 1 รายการ');
			return;
		}
		const hasInvalidQty = ingredientsList.some((ing) => Number(ing.needed) <= 0);
		if (hasInvalidQty) {
			toast.error('กรุณาระบุจำนวนวัตถุดิบให้มากกว่า 0 ทุกรายการ');
			return;
		}

		const chosenRecipe = (recipes.data ?? []).find((r) => r._id === selectedRecipeId);
		const finalLabel = menuLabel.trim() || chosenRecipe?.label || 'เมนูประกอบอาหาร';

		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'kitchen_staff'
		};

		try {
			// Plan and ticket are separate features now (CR-121/CR-141) — created
			// sequentially rather than one atomic bulkDocs. If ticket creation
			// fails after the plan is written, the plan is just an unticketed
			// draft/confirmed plan — recoverable by re-opening a ticket for it,
			// not a correctness bug.
			const planDoc = await createMealPlanMutation.mutateAsync({
				input: {
					date: session.date,
					meal: session.meal,
					meal_session_id: session._id,
					label: finalLabel,
					target_tags: isEveryone ? ['everyone'] : targetTags,
					allocated_target: allocatedTarget,
					headcount: {
						total: allocatedTarget,
						halal: targetTags.includes('halal') ? allocatedTarget : 0,
						soft_food: targetTags.includes('soft_food') ? allocatedTarget : 0,
						infant: targetTags.includes('infant') ? allocatedTarget : 0
					},
					recipes: chosenRecipe
						? [{ recipe_id: chosenRecipe._id, planned_qty: allocatedTarget }]
						: [{ recipe_id: 'recipe:custom', planned_qty: allocatedTarget }]
				},
				ctx
			});

			const ticket = await createTicketMutation.mutateAsync({
				input: {
					meal_plan_id: planDoc._id,
					items: ingredientsList.map((ing) => ({
						item_id: ing.item_id,
						item_name: getItemName(ing.item_id),
						unit: ing.unit,
						requested_qty: ing.needed
					}))
				},
				ctx
			});

			activePlanId = planDoc._id;
			activeTicketId = ticket._id;
			currentStage = 'B';
			toast.success(`เปิดตั๋วเบิกวัตถุดิบ ${ticket.ticket_no} แล้ว — รอคลังจัดของและอนุมัติ`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'ไม่สามารถเปิดตั๋วเบิกได้';
			toast.error(msg);
		}
	}

	// Edit an already-created plan/ticket while the ticket is still
	// PENDING_PICK (CR-142) — kitchen correcting its own request, not
	// self-approving. Ticket updates first: if the warehouse already moved
	// past PENDING_PICK, updateTicketItems throws before the plan is touched.
	async function handleSaveEdits() {
		if (!session || !activePlan || !activeTicket) return;
		if (activeTicket.status !== 'PENDING_PICK') {
			toast.error('แก้ไขไม่ได้ — คลังเริ่มดำเนินการกับตั๋วนี้แล้ว');
			return;
		}
		if (allocatedTarget <= 0) {
			toast.error('กรุณาระบุจำนวนจานเป้าหมาย');
			return;
		}
		if (targetTags.length === 0) {
			toast.error('กรุณาเลือกกลุ่มเป้าหมายอย่างน้อย 1 กลุ่ม');
			return;
		}
		if (ingredientsList.length === 0) {
			toast.error('กรุณาระบุวัตถุดิบอย่างน้อย 1 รายการ');
			return;
		}
		const hasInvalidQty = ingredientsList.some((ing) => Number(ing.needed) <= 0);
		if (hasInvalidQty) {
			toast.error('กรุณาระบุจำนวนวัตถุดิบให้มากกว่า 0 ทุกรายการ');
			return;
		}

		const chosenRecipe = (recipes.data ?? []).find((r) => r._id === selectedRecipeId);
		const finalLabel = menuLabel.trim() || chosenRecipe?.label || 'เมนูประกอบอาหาร';

		try {
			await updateTicketItemsMutation.mutateAsync({
				ticket: activeTicket,
				items: ingredientsList.map((ing) => ({
					item_id: ing.item_id,
					item_name: getItemName(ing.item_id),
					unit: ing.unit,
					requested_qty: ing.needed
				}))
			});

			await updateConfirmedMealPlanMutation.mutateAsync({
				plan: activePlan,
				patch: {
					label: finalLabel,
					target_tags: isEveryone ? ['everyone'] : targetTags,
					allocated_target: allocatedTarget,
					headcount: {
						total: allocatedTarget,
						halal: targetTags.includes('halal') ? allocatedTarget : 0,
						soft_food: targetTags.includes('soft_food') ? allocatedTarget : 0,
						infant: targetTags.includes('infant') ? allocatedTarget : 0
					},
					recipes: chosenRecipe
						? [{ recipe_id: chosenRecipe._id, planned_qty: allocatedTarget }]
						: [{ recipe_id: 'recipe:custom', planned_qty: allocatedTarget }]
				}
			});

			toast.success('บันทึกการแก้ไขแล้ว');
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'ไม่สามารถบันทึกการแก้ไขได้';
			toast.error(msg);
		}
	}

	// IN_TRANSIT → COMPLETED — kitchen confirms it physically received the
	// dispatched ingredients (CR-141 — replaces the old self-approve/bypass step).
	async function handleReceiveTicket() {
		if (!activeTicket) return;
		try {
			await receiveTicketMutation.mutateAsync({
				ticket: activeTicket,
				ctx: { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'kitchen_staff' }
			});
			currentStage = 'C';
			toast.success('ยืนยันรับวัตถุดิบแล้ว — เข้าสู่ขั้นตอนเริ่มปรุงอาหาร');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยืนยันรับวัตถุดิบไม่สำเร็จ');
		}
	}

	// --- Stage C: Service & Actual Yield Form States ---
	let yieldActualPortions = $state(50);
	let servedInShelter = $state(48);
	let wastePortions = $state(2);
	let extVolunteers = $state(0);
	let extOutside = $state(0);
	let serviceNotes = $state('');
	let cookingStarted = $state(false);

	// Init stage C defaults from activeService or allocatedTarget
	$effect(() => {
		if (currentStage === 'C') {
			if (activeService && !serviceRejected) {
				yieldActualPortions = activeService.actual_yield ?? activePlan?.allocated_target ?? 50;
				servedInShelter = activeService.served;
				wastePortions = activeService.waste;
				extVolunteers = activeService.external?.volunteers ?? 0;
				extOutside = activeService.external?.outside_evacuees ?? 0;
			} else {
				yieldActualPortions = activePlan?.allocated_target ?? allocatedTarget;
				servedInShelter = activePlan?.allocated_target ?? allocatedTarget;
				wastePortions = 0;
			}
		}
	});

	// Stage C header content — one of 3 cooking sub-phases (CR-142 follow-up UI).
	const stageCInfo = $derived.by(() => {
		if (serviceRejected) {
			return {
				icon: XCircle,
				badgeClass: 'bg-red-100 text-red-800',
				dotClass: 'bg-red-100 text-red-600',
				badgeLabel: 'ถูกตีกลับจากคลัง',
				title: 'คลังปฏิเสธการรับมอบ ต้องบันทึกผลผลิตใหม่',
				description: `เหตุผล: ${activeServiceReceipt?.reason ?? '-'}`
			};
		}
		if (serviceReceiptConfirmed) {
			return {
				icon: CheckCircle2,
				badgeClass: 'bg-emerald-100 text-emerald-800',
				dotClass: 'bg-emerald-100 text-emerald-600',
				badgeLabel: 'รับเข้าคลังแล้ว',
				title: 'คลังตรวจรับเข้าสต็อกเรียบร้อยแล้ว',
				description: 'ผลผลิตถูกนำเข้ารายการคลังสินค้าแล้ว — จบขั้นตอนการส่งมอบ'
			};
		}
		if (activeService) {
			return {
				icon: CheckCircle2,
				badgeClass: 'bg-amber-100 text-amber-800',
				dotClass: 'bg-amber-100 text-amber-600',
				badgeLabel: 'รอคลังตรวจรับเข้าสต็อก',
				title: 'บันทึกผลผลิตแล้ว รอคลังตรวจรับเข้าสต็อก',
				description:
					'บันทึกจำนวนที่ปรุงได้จริงและแจกจ่ายเรียบร้อยแล้ว ระบบตัดสต็อกวัตถุดิบและเพิ่มผลผลิตเข้าสต็อกให้อัตโนมัติ'
			};
		}
		if (cookingStarted) {
			return {
				icon: Flame,
				badgeClass: 'bg-orange-100 text-orange-800',
				dotClass: 'bg-orange-100 text-orange-600',
				badgeLabel: 'กำลังปรุงอาหาร',
				title: 'กำลังปรุงอาหารอยู่',
				description: 'ระบุจำนวนผลผลิตจริง แล้วกดบันทึกผลผลิตด้านล่าง'
			};
		}
		return {
			icon: CheckCircle2,
			badgeClass: 'bg-sky-100 text-sky-800',
			dotClass: 'bg-sky-100 text-sky-600',
			badgeLabel: 'วัตถุดิบพร้อมปรุง',
			title: 'วัตถุดิบพร้อมประกอบอาหารเรียบร้อยแล้ว',
			description:
				'วัตถุดิบตรวจรับเข้าโรงครัวเรียบร้อยแล้ว กดปุ่ม "เริ่มปรุงอาหาร" ด้านล่างเพื่อเปลี่ยนสถานะเป็นกำลังผลิตจริง หรือระบุจำนวนผลผลิตจริงเมื่อประกอบอาหารเสร็จ'
		};
	});

	async function handleRecordService() {
		if (!session || !activePlanId) return;
		if (yieldActualPortions < 0) {
			toast.error('กรุณาระบุจำนวนจานที่ปรุงได้จริง');
			return;
		}

		if (isServiceFinalized) {
			toast.info('ชุดการผลิตนี้ได้บันทึกผลผลิตเรียบร้อยแล้ว');
			return;
		}

		try {
			await recordServiceMutation.mutateAsync({
				input: {
					date: session.date,
					meal: session.meal,
					meal_plan_id: activePlanId,
					meal_session_id: session._id,
					actual_yield: Number(yieldActualPortions),
					served: Number(servedInShelter),
					waste: Number(wastePortions),
					external: {
						volunteers: Number(extVolunteers || 0),
						outside_evacuees: Number(extOutside || 0)
					}
				},
				ctx: {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'kitchen_staff'
				}
			});
			toast.success('บันทึกผลการผลิตและแจกจ่ายสำเร็จแล้ว!');
			goto(resolve('/back-office/kitchen'));
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'ไม่สามารถบันทึกผลการผลิตได้';
			toast.error(msg);
		}
	}

	async function handleStartCooking() {
		if (!activePlan) return;
		try {
			await startCookingMutation.mutateAsync({
				plan: activePlan,
				cookingStartedAt: new Date().toISOString()
			});
			cookingStarted = true;
			toast.success('เริ่มปรุงอาหารแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เริ่มปรุงอาหารไม่สำเร็จ');
		}
	}
</script>

<svelte:head>
	<title>กระดานการผลิตอาหาร · SmartShelter</title>
</svelte:head>

<div class="flex-1 space-y-4 overflow-auto p-4">
	<!-- Header Banner -->
	<div class="rounded-2xl bg-[#0A2647] p-5 text-white shadow-sm">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<a
					href={resolve('/back-office/kitchen')}
					class="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80 transition-colors hover:text-white"
				>
					<ArrowLeft class="h-3.5 w-3.5" />
					ย้อนกลับหน้าสรุปมื้อ
				</a>
				<h1 class="mt-2 text-xl font-extrabold tracking-tight sm:text-2xl">
					แผงควบคุมและจัดสรรเครื่องครัวภัยพิบัติ
				</h1>
				<p class="mt-1 text-xs text-white/70">
					บริหารสายการผลิต คำนวณวัตถุดิบและเบิกพัสดุสำหรับมื้ออาหาร
				</p>
				{#if session}
					<p class="mt-1 text-2xs text-white/60">
						{session.name} · {formatThaiShortDate(session.date)} · {MEAL_PERIOD_LABELS[
							session.meal
						] ?? session.meal}
					</p>
				{/if}
			</div>
			<div class="flex shrink-0 gap-2">
				<div class="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-center">
					<p class="text-2xs font-semibold whitespace-nowrap text-white/70">ผู้อพยพรวม</p>
					<p class="text-lg font-bold tabular-nums">{session?.target_headcount.total ?? 0} คน</p>
				</div>
				<div class="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-center">
					<p class="text-2xs font-semibold whitespace-nowrap text-white/70">เป้าจัดสรร</p>
					<p class="text-lg font-bold tabular-nums">{allocatedTarget} จาน</p>
				</div>
			</div>
		</div>
	</div>

	<!-- 3-Stage Progress Stepper -->
	<Tabs.Root
		value={currentStage}
		onValueChange={(v) => (currentStage = v as 'A' | 'B' | 'C')}
		class="gap-0 rounded-xl border bg-white p-1.5 shadow-2xs"
	>
		<Tabs.List class="h-auto w-full gap-2 bg-transparent p-0">
			<Tabs.Trigger
				value="A"
				class="flex-1 gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:bg-[#0A2647] data-[state=active]:text-white data-[state=active]:shadow-sm"
			>
				<span class="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-2xs"
					>A</span
				>
				1. วางแผนเมนู (BOM)
			</Tabs.Trigger>
			<Tabs.Trigger
				value="B"
				disabled={!activeTicket}
				class="flex-1 gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground disabled:text-muted-foreground/50 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white data-[state=active]:shadow-sm"
			>
				{#if currentStage !== 'B' && !activeTicket}
					<Lock class="h-3.5 w-3.5" />
				{:else}
					<span class="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-2xs"
						>B</span
					>
				{/if}
				2. รอคลังอนุมัติ
			</Tabs.Trigger>
			<Tabs.Trigger
				value="C"
				disabled={!activePlanId ||
					(!activeService && activeTicket && activeTicket.status !== 'COMPLETED')}
				class="flex-1 gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground disabled:text-muted-foreground/50 data-[state=active]:bg-[#0A2647] data-[state=active]:text-white data-[state=active]:shadow-sm"
			>
				{#if currentStage !== 'C' && (!activePlanId || (!activeService && activeTicket && activeTicket.status !== 'COMPLETED'))}
					<Lock class="h-3.5 w-3.5" />
				{:else}
					<span class="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-2xs"
						>C</span
					>
				{/if}
				3. รายงานผลจริง
			</Tabs.Trigger>
		</Tabs.List>
	</Tabs.Root>

	<!-- Stage Content -->
	{#if currentStage === 'A'}
		<!-- STAGE A: Plan, BOM & Requisition Creation -->
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<!-- Column 1: Menu & Target Groups -->
			<Card.Root class="border shadow-sm">
				<Card.Header class="pb-3">
					<Card.Title class="flex items-center gap-2 text-sm font-bold">
						<ChefHat class="h-4 w-4 text-primary" />
						{#if activePlan}
							1. เมนูและกลุ่มเป้าหมาย (แก้ไขชุดการผลิต)
						{:else}
							1. เมนูและกลุ่มเป้าหมาย
						{/if}
					</Card.Title>
					<Card.Description class="text-xs">
						{#if activePlan}
							กำลังแก้ไขชุดการผลิต: <span class="font-bold text-foreground">{activePlan.label}</span
							>
							(เป้า {activePlan.allocated_target ?? activePlan.headcount.total} จาน)
						{:else}
							เลือกสูตรอาหารมาตรฐานจากฐานข้อมูล หรือระบุชื่อเมนูผลิต
						{/if}
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3 text-xs">
					<div>
						<Label class="text-xs">สูตรอาหาร</Label>
						<Tabs.Root
							value={recipeMode}
							onValueChange={(v) => setRecipeMode(v as 'bom' | 'custom')}
							class="mt-1 gap-0 rounded-md border bg-muted/20 p-1"
						>
							<Tabs.List class="h-auto w-full gap-1 bg-transparent p-0">
								<Tabs.Trigger
									value="bom"
									class="rounded px-2 py-1 text-xs font-semibold text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
								>
									เลือกจากฐานสูตร (BOM)
								</Tabs.Trigger>
								<Tabs.Trigger
									value="custom"
									class="rounded px-2 py-1 text-xs font-semibold text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
								>
									สร้างสูตรเอง
								</Tabs.Trigger>
							</Tabs.List>
						</Tabs.Root>

						{#if recipeMode === 'bom'}
							<select
								bind:value={selectedRecipeId}
								onchange={handleRecipeChange}
								class="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
							>
								<option value="">-- เลือกสูตรอาหาร (BOM) --</option>
								{#each recipes.data ?? [] as rec (rec._id)}
									<option value={rec._id}>{rec.label} (สูตรฐาน {rec.standard_portions} จาน)</option>
								{/each}
							</select>
						{:else}
							<p class="mt-2 text-2xs text-muted-foreground">
								กำหนดวัตถุดิบเองในตารางด้านขวา ไม่อ้างอิงสูตรจากฐานข้อมูล
							</p>
						{/if}
					</div>

					<div>
						<Label class="text-xs">ชื่อเมนูที่แสดง</Label>
						<Input
							bind:value={menuLabel}
							placeholder="เช่น ข้าวต้มไก่ฮาลาล, ข้าวผัดไข่..."
							class="mt-1 text-xs"
						/>
					</div>

					<div>
						<div class="flex items-center justify-between">
							<Label class="text-xs">จำนวนจานที่ต้องการผลิต</Label>
							{#if session?.target_headcount}
								{@const suggested = calculateTargetFromTags(targetTags)}
								{#if suggested > 0 && allocatedTarget !== suggested}
									<Button
										variant="link"
										size="sm"
										class="h-auto p-0 text-2xs font-medium"
										onclick={() => (allocatedTarget = suggested)}
									>
										ใช้ยอดตามกลุ่ม ({suggested} จาน)
									</Button>
								{/if}
							{/if}
						</div>
						<Input
							type="number"
							min="1"
							bind:value={allocatedTarget}
							class="mt-1 text-xs font-bold"
						/>
					</div>

					<!-- Target Group Selection -->
					<div class="rounded-lg border bg-muted/20 p-3">
						<div class="mb-2 flex items-center justify-between">
							<div>
								<Label class="text-xs font-semibold">กลุ่มความต้องการที่ครอบคลุม</Label>
								{#if session?.target_headcount}
									<p class="text-2xs text-muted-foreground">
										รอบมื้อนี้มีคนรวม {session.target_headcount.total} คน
									</p>
								{/if}
							</div>
							<Button
								variant="link"
								size="sm"
								class="h-auto p-0 text-2xs font-semibold"
								onclick={handleEveryoneToggle}
							>
								{isEveryone ? 'ยกเลิกครอบคลุมทุกคน' : 'ครอบคลุมทุกคน'}
							</Button>
						</div>

						<div class="space-y-1.5">
							{#each ['halal', 'infant', 'soft_food', 'regular', 'volunteer'] as Tag (Tag)}
								{@const tagKey = Tag as TargetGroupTag}
								{@const count = getHeadcountForTag(tagKey)}
								<label
									class="flex cursor-pointer items-center justify-between rounded p-1 hover:bg-muted/40"
								>
									<div class="flex items-center gap-2">
										<input
											type="checkbox"
											checked={targetTags.includes(tagKey)}
											onchange={() => toggleTag(tagKey)}
											class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
										/>
										<span class="text-xs">{TARGET_GROUP_LABELS[tagKey]}</span>
									</div>
									<span
										class="text-xs font-medium {count > 0
											? 'font-semibold text-foreground'
											: 'text-muted-foreground'}"
									>
										{count} คน
									</span>
								</label>
							{/each}
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Column 2: BOM Ingredients Calculation & Warehouse On-Hand -->
			<Card.Root class="border shadow-sm">
				<Card.Header class="pb-3">
					<div class="flex items-center justify-between">
						<Card.Title class="flex items-center gap-2 text-sm font-bold">
							<PackageCheck class="h-4 w-4 text-emerald-600" />
							2. คำนวณวัตถุดิบ & สต็อกในคลัง
						</Card.Title>
						{#if isIngredientsManuallyEdited}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="h-6 gap-1 px-1.5 text-2xs text-muted-foreground hover:text-foreground"
								onclick={resetIngredientsToRecipe}
								title="คำนวณใหม่ตามสัดส่วนสูตรและจำนวนจาน"
							>
								<RotateCcw class="h-3 w-3" />
								คืนค่าตามสูตร
							</Button>
						{/if}
					</div>
					<Card.Description class="text-xs">
						ปรับเปลี่ยนจำนวน เพิ่ม หรือลบวัตถุดิบที่ต้องการเบิกได้ตามความเหมาะสม
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3 text-xs">
					<div class="overflow-hidden rounded-lg border">
						<Table.Root>
							<Table.Header class="bg-muted/40 text-2xs">
								<Table.Row>
									<Table.Head>วัตถุดิบ</Table.Head>
									<Table.Head class="w-28 text-right">ต้องใช้</Table.Head>
									<Table.Head class="text-right">ในคลัง</Table.Head>
									<Table.Head class="w-16 text-center">สถานะ</Table.Head>
									<Table.Head class="w-8"></Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body class="text-xs">
								{#if ingredientsList.length === 0}
									<Table.Row>
										<Table.Cell colspan={5} class="py-4 text-center text-muted-foreground">
											ยังไม่มีวัตถุดิบ (คลิก "+ เพิ่มวัตถุดิบ" ด้านล่างเพื่อเพิ่ม)
										</Table.Cell>
									</Table.Row>
								{/if}
								{#each ingredientsList as ing, idx (ing.item_id + '_' + idx)}
									{@const onHand = stock.data?.get(ing.item_id) ?? '0'}
									{@const isShort = qtyGt(ing.needed, onHand)}
									<Table.Row>
										<Table.Cell class="font-medium">
											{ing.name}
										</Table.Cell>
										<Table.Cell class="text-right">
											<div class="flex items-center justify-end gap-1">
												<Input
													type="number"
													step="any"
													min="0"
													bind:value={ing.needed}
													oninput={() => {
														isIngredientsManuallyEdited = true;
													}}
													class="h-7 w-20 text-right font-mono text-xs font-bold"
												/>
												<span class="w-5 truncate text-left text-2xs text-muted-foreground"
													>{ing.unit}</span
												>
											</div>
										</Table.Cell>
										<Table.Cell class="text-right font-mono text-muted-foreground">
											{onHand}
											{ing.unit}
										</Table.Cell>
										<Table.Cell class="text-center">
											{#if isShort}
												<span
													class="inline-flex items-center rounded bg-rose-100 px-1.5 py-0.5 text-2xs font-bold text-rose-700"
												>
													ขาดสต็อก
												</span>
											{:else}
												<span
													class="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-2xs font-bold text-green-700"
												>
													พร้อม
												</span>
											{/if}
										</Table.Cell>
										<Table.Cell class="w-8 p-1 text-center">
											<Button
												type="button"
												variant="ghost"
												size="icon"
												class="h-6 w-6 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
												onclick={() => removeIngredient(idx)}
												title="ลบวัตถุดิบนี้"
											>
												<Trash2 class="h-3.5 w-3.5" />
											</Button>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>

					<!-- Add Ingredient Form / Button -->
					{#if showAddIngredient}
						<div class="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
							<div class="text-xs font-semibold text-foreground">เพิ่มวัตถุดิบเข้าชุดการผลิต</div>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-12">
								<div class="sm:col-span-6">
									<Label class="text-2xs text-muted-foreground">เลือกวัตถุดิบ</Label>
									<Combobox
										items={ingredientComboItems}
										value={newItemId}
										onValueChange={handleNewItemSelect}
										placeholder="-- เลือกวัตถุดิบ --"
										searchPlaceholder="ค้นหาวัตถุดิบ..."
										emptyText="ไม่พบวัตถุดิบ"
										class="mt-1 h-8 px-2 text-xs"
									/>
								</div>
								<div class="sm:col-span-3">
									<Label class="text-2xs text-muted-foreground">จำนวน</Label>
									<Input
										type="number"
										step="any"
										min="0.01"
										bind:value={newQty}
										placeholder="0"
										class="mt-1 h-8 text-xs font-bold"
									/>
								</div>
								<div class="sm:col-span-3">
									<Label class="text-2xs text-muted-foreground">หน่วย</Label>
									<Input
										value={newUnit}
										readonly
										tabindex={-1}
										placeholder="หน่วย"
										class="mt-1 h-8 bg-muted text-xs text-muted-foreground"
									/>
								</div>
							</div>
							<div class="flex items-center justify-end gap-1.5 pt-1">
								<Button
									type="button"
									size="sm"
									variant="outline"
									class="h-7 text-xs"
									onclick={() => {
										showAddIngredient = false;
									}}
								>
									ยกเลิก
								</Button>
								<Button
									type="button"
									size="sm"
									class="h-7 gap-1 text-xs"
									onclick={confirmAddIngredient}
									disabled={!newItemId || !newQty || Number(newQty) <= 0}
								>
									<Plus class="h-3 w-3" />
									เพิ่มวัตถุดิบนี้
								</Button>
							</div>
						</div>
					{:else}
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="h-8 w-full gap-1.5 border-dashed text-xs text-primary hover:bg-primary/5"
							onclick={() => {
								showAddIngredient = true;
								newItemId = '';
								newQty = '1';
								newUnit = '';
							}}
						>
							<Plus class="h-3.5 w-3.5" />
							เพิ่มวัตถุดิบ
						</Button>
					{/if}

					<p class="text-2xs text-muted-foreground">
						* หากสต็อกในคลังไม่พอ คลังสินค้าสามารถตัดจ่ายบางส่วนในขั้นตอนอนุมัติได้
					</p>
				</Card.Content>
			</Card.Root>
		</div>

		{#if !activeTicket}
			<div class="rounded-xl border border-primary/20 bg-primary/5 p-4">
				<Button
					class="w-full gap-2 font-semibold shadow-sm"
					onclick={handleCreateRequisition}
					disabled={createMealPlanMutation.isPending || createTicketMutation.isPending}
				>
					<Sparkles class="h-4 w-4" />
					{createMealPlanMutation.isPending || createTicketMutation.isPending
						? 'กำลังเปิดตั๋วเบิก...'
						: 'สร้างใบเบิกวัตถุดิบ'}
				</Button>
			</div>
		{:else if activeTicket.status === 'PENDING_PICK'}
			<div class="rounded-xl border border-primary/20 bg-primary/5 p-4">
				<Button
					class="w-full gap-2 font-semibold shadow-sm"
					onclick={handleSaveEdits}
					disabled={updateTicketItemsMutation.isPending ||
						updateConfirmedMealPlanMutation.isPending}
				>
					<Check class="h-4 w-4" />
					{updateTicketItemsMutation.isPending || updateConfirmedMealPlanMutation.isPending
						? 'กำลังบันทึกการแก้ไข...'
						: 'บันทึกการแก้ไข'}
				</Button>
			</div>
		{/if}
	{:else if currentStage === 'B'}
		<!-- STAGE B: Ticket status (read-only — allocate/approve/dispatch happen at
		     /back-office/tickets/[id], not here — CR-121/CR-141 role split) -->
		<Card.Root class="border shadow-sm">
			<Card.Header class="border-b bg-muted/20">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<Card.Title class="flex items-center gap-2 text-lg font-bold">
							รอคลังอนุมัติใบเบิก: {activePlan?.label ?? 'รายการวัตถุดิบ'}
						</Card.Title>
						<Card.Description class="text-xs">
							{#if activeTicket}
								{activeTicket.ticket_no} · เป้าหมาย {activePlan?.allocated_target ??
									allocatedTarget} จาน
							{:else}
								ชุดการผลิต: {activePlan?.label ?? 'เมนูอาหาร'} · เป้าหมาย {activePlan?.allocated_target ??
									allocatedTarget} จาน
							{/if}
						</Card.Description>
					</div>

					<!-- Status Badge -->
					{#if activeTicket?.status === 'COMPLETED'}
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800"
						>
							<CheckCircle2 class="h-4 w-4 text-green-600" />
							รับวัตถุดิบแล้ว
						</span>
					{:else if activeTicket?.status === 'CANCELLED'}
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800"
						>
							<XCircle class="h-4 w-4 text-rose-600" />
							ยกเลิกแล้ว
						</span>
					{:else if activeTicket}
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800"
						>
							<Clock class="h-4 w-4 text-amber-600" />
							{TICKET_STATUS_LABELS[activeTicket.status]}
						</span>
					{/if}
				</div>
			</Card.Header>

			<Card.Content class="space-y-4 p-5 text-xs">
				<!-- Status Notification Banner -->
				{#if activeTicket?.status === 'PENDING_PICK'}
					<div
						class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800"
					>
						<Clock class="h-5 w-5 shrink-0 text-amber-600" />
						<div>
							<h4 class="font-bold">รอคลังจัดของ</h4>
							<p class="mt-1 text-xs text-amber-700">
								ยังแก้ไขรายการที่ Stage A ได้จนกว่าคลังจะเริ่มจัดของ
							</p>
						</div>
					</div>
				{:else if activeTicket?.status === 'READY_FOR_DISPATCH'}
					<div
						class="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-800"
					>
						<PackageCheck class="h-5 w-5 shrink-0 text-blue-600" />
						<div>
							<h4 class="font-bold">ผู้จัดการอนุมัติแล้ว รอคลังปล่อยของ</h4>
							<p class="mt-1 text-xs text-blue-700">อนุมัติโดย: {activeTicket.approved_by}</p>
						</div>
					</div>
				{:else if activeTicket?.status === 'IN_TRANSIT'}
					<div
						class="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800"
					>
						<CheckCircle2 class="h-5 w-5 shrink-0 text-green-600" />
						<div class="flex-1">
							<h4 class="font-bold">คลังปล่อยของแล้ว พร้อมยืนยันรับวัตถุดิบ</h4>
							<p class="mt-1 text-xs text-green-700">
								ปล่อยของโดย: {activeTicket.dispatched_by} · ตัดสต็อกวัตถุดิบแล้ว
							</p>
							<div class="mt-2.5">
								<Button
									size="sm"
									class="h-7 gap-1.5 bg-green-600 text-xs font-semibold text-white shadow-xs hover:bg-green-700"
									disabled={receiveTicketMutation.isPending}
									onclick={handleReceiveTicket}
								>
									<CheckCircle2 class="h-3.5 w-3.5" />
									ยืนยันรับวัตถุดิบ
								</Button>
							</div>
						</div>
					</div>
				{:else if activeTicket?.status === 'CANCELLED'}
					<div
						class="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800"
					>
						<AlertCircle class="h-5 w-5 shrink-0 text-rose-600" />
						<div class="flex-1">
							<h4 class="font-bold">ตั๋วนี้ถูกยกเลิกแล้ว</h4>
							<p class="mt-1 text-xs text-rose-700">เปิดตั๋วใหม่ได้จากขั้นตอน A</p>
						</div>
					</div>
				{/if}

				<!-- Requisition Items Review Table -->
				<div class="rounded-lg border">
					<div class="border-b bg-muted/40 px-3 py-2 font-semibold text-foreground">
						รายการวัตถุดิบที่ขอเบิก
					</div>
					<Table.Root>
						<Table.Header class="text-2xs">
							<Table.Row>
								<Table.Head>รายการ</Table.Head>
								<Table.Head class="text-right">จำนวนที่ขอ</Table.Head>
								<Table.Head class="text-right">จำนวนที่คลังจัด</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body class="text-xs">
							{#each activeTicket?.items ?? [] as it (it.item_id)}
								<Table.Row>
									<Table.Cell>
										<span class="font-medium text-foreground">{it.item_name}</span>
									</Table.Cell>
									<Table.Cell class="text-right font-mono">{it.requested_qty} {it.unit}</Table.Cell>
									<Table.Cell
										class="text-right font-mono font-bold {it.allocated_qty !== '0'
											? 'text-green-700'
											: 'text-muted-foreground'}"
									>
										{it.allocated_qty !== '0' ? `${it.allocated_qty} ${it.unit}` : 'รอดำเนินการ'}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>

				<!-- Action Buttons -->
				<div class="flex flex-wrap items-center justify-end gap-2 pt-2">
					{#if activeTicket}
						<Button
							variant="outline"
							href={resolve(`/back-office/tickets/${encodeURIComponent(activeTicket._id)}`)}
						>
							ดูรายละเอียดใบเบิก
						</Button>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	{:else if currentStage === 'C'}
		<!-- STAGE C: Actual Yield & Meal Service Recording -->
		<Card.Root class="border shadow-sm">
			<Card.Header class="flex flex-wrap items-start justify-between gap-4 border-b bg-muted/20">
				{@const Icon = stageCInfo.icon}
				<div class="flex items-start gap-2.5">
					<span
						class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full {stageCInfo.dotClass}"
					>
						<Icon class="h-4 w-4" />
					</span>
					<div>
						<Card.Title class="text-base font-bold">{stageCInfo.title}</Card.Title>
						<Card.Description class="mt-1 text-xs">{stageCInfo.description}</Card.Description>
					</div>
				</div>

				<div class="flex flex-col items-start gap-1.5 sm:items-end">
					<span
						class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold {stageCInfo.badgeClass}"
					>
						{stageCInfo.badgeLabel}
					</span>
					<span class="text-xs text-muted-foreground">
						สูตร: {activePlan?.label ?? 'เมนูประกอบอาหาร'} ({activePlan?.allocated_target ??
							allocatedTarget} กล่อง)
					</span>
				</div>
			</Card.Header>

			<Card.Content class="space-y-4 p-5 text-xs">
				<div class="grid grid-cols-1 gap-4">
					<div class="space-y-4">
						{#if serviceRejected}
							<div
								class="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"
							>
								<XCircle class="h-5 w-5 shrink-0 text-red-600" />
								<div>
									<h4 class="font-bold">คลังปฏิเสธการรับมอบ — กรุณาบันทึกผลผลิตใหม่</h4>
									<p class="mt-1 text-xs text-red-800">เหตุผล: {activeServiceReceipt?.reason}</p>
								</div>
							</div>
						{:else if activeService && serviceReceiptConfirmed}
							<div
								class="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800"
							>
								<CheckCircle2 class="h-5 w-5 shrink-0 text-green-600" />
								<div class="flex-1">
									<h4 class="font-bold">บันทึกผลการผลิตและตรวจรับเข้าคลังเรียบร้อยแล้ว</h4>
									<p class="mt-1 text-xs text-green-700">
										บันทึกเมื่อ {formatThaiDateTime(activeService.created_at)} โดย {activeService.created_by}
									</p>
								</div>
							</div>
						{/if}

						{#if !isServiceFinalized && !cookingStarted}
							<Button
								class="w-full gap-2 bg-orange-600 font-semibold text-white hover:bg-orange-700"
								disabled={startCookingMutation.isPending}
								onclick={handleStartCooking}
							>
								<Flame class="h-4 w-4" />
								{startCookingMutation.isPending ? 'กำลังเริ่มปรุง...' : 'เริ่มปรุงอาหาร'}
							</Button>
						{/if}

						<div
							class="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3"
						>
							<div>
								<span class="font-bold text-foreground"
									>{activePlan?.label ?? 'เมนูประกอบอาหาร'}</span
								>
								<p class="text-2xs text-muted-foreground">
									เป้าหมายตามแผน: {activePlan?.allocated_target ?? allocatedTarget} จาน
								</p>
							</div>
							{#if activeTicket}
								<span
									class="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-800"
								>
									ตั๋ว {activeTicket.ticket_no}: รับวัตถุดิบแล้ว
								</span>
							{/if}
						</div>

						<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
							<div>
								<Label class="text-xs font-semibold">จำนวนจานปรุงได้จริง</Label>
								<Input
									type="number"
									min="0"
									bind:value={yieldActualPortions}
									class="mt-1 text-xs font-bold"
								/>
							</div>
							<div>
								<Label class="text-xs">แจกจ่ายในศูนย์</Label>
								<Input type="number" min="0" bind:value={servedInShelter} class="mt-1 text-xs" />
							</div>
							<div>
								<Label class="text-xs">อาหารเหลือทิ้ง</Label>
								<Input type="number" min="0" bind:value={wastePortions} class="mt-1 text-xs" />
							</div>
						</div>

						<div class="grid grid-cols-2 gap-3">
							<div>
								<Label class="text-xs">แจกอาสาสมัคร/เจ้าหน้าที่</Label>
								<Input type="number" min="0" bind:value={extVolunteers} class="mt-1 text-xs" />
							</div>
							<div>
								<Label class="text-xs">แจกผู้พักพิงภายนอก</Label>
								<Input type="number" min="0" bind:value={extOutside} class="mt-1 text-xs" />
							</div>
						</div>

						<div>
							<Label class="text-xs">บันทึกเพิ่มเติม</Label>
							<Textarea
								bind:value={serviceNotes}
								placeholder="เช่น อาหารปรุงสุกครบถ้วน รสชาติดี..."
								rows={2}
								class="mt-1 text-xs"
							/>
						</div>

						<div class="flex items-center justify-between pt-2">
							<Button variant="outline" onclick={() => (currentStage = 'B')}>
								<ArrowLeft class="mr-1 h-3.5 w-3.5" />
								กลับ
							</Button>
							{#if isServiceFinalized}
								<div class="flex items-center gap-2">
									<span
										class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800"
									>
										✓ บันทึกผลผลิตเรียบร้อยแล้ว
									</span>
									<Button variant="default" onclick={() => goto(resolve('/back-office/kitchen'))}>
										กลับหน้ารวมมื้ออาหาร
									</Button>
								</div>
							{:else}
								<Button
									class="gap-1.5 bg-primary shadow-sm"
									onclick={handleRecordService}
									disabled={recordServiceMutation.isPending || !cookingStarted}
									title={!cookingStarted ? 'กดเริ่มปรุงอาหารก่อน' : undefined}
								>
									>
									<Check class="h-4 w-4" />
									{recordServiceMutation.isPending
										? 'กำลังบันทึก...'
										: serviceRejected
											? 'บันทึกผลผลิตใหม่ (แก้ไขตามคำแนะนำ)'
											: 'บันทึกผลการผลิต'}
								</Button>
							{/if}
						</div>
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
