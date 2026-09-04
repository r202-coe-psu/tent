<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		useMealSession,
		useMealPlans,
		useMealServices,
		useKitchenRequisitions,
		useCreatePendingRequisition,
		useRecordMealService,
		useDeleteMealPlanDraft,
		useGasCylinderTypes,
		useGasLedger,
		gasCylinderBalance,
		calculateGasConsumptionKg,
		calculateMaxCookingHours,
		calculateCookingHoursFromPortions,
		sumHeadcountByTags,
		getActiveTagsFromSession,
		TARGET_GROUP_LABELS,
		MEAL_PERIOD_LABELS,
		type TargetGroupTag,
		type MealPlanGasUsage
	} from '$lib/features/kitchen';
	import { useRecipes, useItemMasters, getItemDisplayName } from '$lib/features/catalog';
	import { useSupplyItems } from '$lib/features/supply';
	import { useStockBalance } from '$lib/features/operations';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { qtyGt } from '$lib/utils/qty';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Flame from '@lucide/svelte/icons/flame';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Check from '@lucide/svelte/icons/check';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	const sessionId = $derived(page.params.session_id);
	const planIdParam = $derived(page.url.searchParams.get('plan_id'));
	const stageParam = $derived(page.url.searchParams.get('stage'));

	const sessionQuery = useMealSession(() => sessionId);
	const plans = useMealPlans();
	const services = useMealServices();
	const requisitions = useKitchenRequisitions();
	const gasTypes = useGasCylinderTypes();
	const gasLedger = useGasLedger();
	const recipes = useRecipes(() => getShelterCode());
	const itemMasters = useItemMasters(() => getShelterCode());
	const supplyItems = useSupplyItems();
	const stock = useStockBalance();

	const getItemName = (id: string) => getItemDisplayName(id, itemMasters.data, supplyItems.data);

	const createRequisitionMutation = useCreatePendingRequisition();
	const recordServiceMutation = useRecordMealService();
	const deletePlanMutation = useDeleteMealPlanDraft();

	const session = $derived(sessionQuery.data);

	const sessionPlans = $derived.by(() => {
		if (!sessionId) return [];
		return (plans.data ?? []).filter((p) => p.meal_session_id === sessionId);
	});

	// Current Active Batch State
	let currentStage = $state<'A' | 'B' | 'C'>('A');

	// Plan & Requisition currently tracked in the wizard
	let activePlanId = $state<string | null>(null);
	let activeRequisitionId = $state<string | null>(null);

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

	const activeRequisition = $derived.by(() => {
		if (activeRequisitionId) {
			return (requisitions.data ?? []).find((r) => r._id === activeRequisitionId) ?? null;
		}
		if (activePlanId) {
			return (requisitions.data ?? []).find((r) => r.meal_plan_id === activePlanId) ?? null;
		}
		return null;
	});

	const activeService = $derived.by(() => {
		if (!activePlanId) return null;
		return (services.data ?? []).find((s) => s.meal_plan_id === activePlanId) ?? null;
	});

	// Synchronize stage if activeRequisition changes
	$effect(() => {
		if (activeRequisition) {
			if (activeRequisition.status === 'approved' && currentStage === 'B') {
				// stay on B or user can click proceed to C
			}
		}
	});

	// --- Stage A: Form States ---
	let selectedRecipeId = $state<string>('');
	let menuLabel = $state('');
	let allocatedTarget = $state(50);
	let targetTags = $state<TargetGroupTag[]>(['regular']);
	let isEveryone = $state(false);

	// Stove and LPG allocation (Multi-cylinder support)
	interface GasAllocationRow {
		cylinder_id: string;
		hours: string;
		isManuallyEdited?: boolean;
	}

	let gasRows = $state<GasAllocationRow[]>([
		{ cylinder_id: '', hours: '1.5', isManuallyEdited: false }
	]);

	function getMaxHoursForCylinder(cylinderId: string): number {
		const cyl = (gasTypes.data ?? []).find((t) => t._id === cylinderId);
		if (!cyl) return 999;
		const remainingKg = gasCylinderBalance(gasLedger.data ?? [], cyl._id, cyl.capacity_kg);
		return parseFloat(calculateMaxCookingHours(remainingKg, cyl));
	}

	function spillOverExcessGas() {
		if (gasRows.length <= 1) return;
		const max0 = getMaxHoursForCylinder(gasRows[0].cylinder_id);
		const curr0 = parseFloat(gasRows[0].hours) || 0;
		if (curr0 <= max0) return;

		const excessHours = Math.round((curr0 - max0) * 10) / 10;
		gasRows[0].hours = max0.toFixed(1);

		let remainingToDistribute = excessHours;
		for (let i = 1; i < gasRows.length; i++) {
			if (i === gasRows.length - 1) {
				gasRows[i].hours = remainingToDistribute.toFixed(1);
				gasRows[i].isManuallyEdited = true;
				remainingToDistribute = 0;
			} else {
				const maxI = getMaxHoursForCylinder(gasRows[i].cylinder_id);
				const give = Math.min(remainingToDistribute, maxI);
				gasRows[i].hours = give.toFixed(1);
				gasRows[i].isManuallyEdited = true;
				remainingToDistribute = Math.round((remainingToDistribute - give) * 10) / 10;
			}
		}
		toast.success(`โอนส่วนเกิน ${excessHours} ชม. ไปยังเตาถัดไปเรียบร้อยแล้ว`);
	}

	function distributeRecipeHours(totalHours: number) {
		if (gasRows.length === 0) return;
		let remaining = totalHours;
		for (let i = 0; i < gasRows.length; i++) {
			if (i === gasRows.length - 1) {
				gasRows[i].hours = Math.max(0, Math.round(remaining * 10) / 10).toFixed(1);
				remaining = 0;
			} else {
				const maxH = getMaxHoursForCylinder(gasRows[i].cylinder_id);
				const give = Math.min(remaining, maxH);
				gasRows[i].hours = Math.max(0, Math.round(give * 10) / 10).toFixed(1);
				remaining = Math.max(0, Math.round((remaining - give) * 10) / 10);
			}
		}
	}

	function addGasRow() {
		const types = gasTypes.data ?? [];
		const usedIds = new Set(gasRows.map((r) => r.cylinder_id).filter(Boolean));
		const nextCyl = types.find((t) => !usedIds.has(t._id));
		const nextCylId = nextCyl?._id ?? types[0]?._id ?? '';

		let newRowHours = '1.0';
		if (gasRows.length > 0) {
			const max0 = getMaxHoursForCylinder(gasRows[0].cylinder_id);
			const curr0 = parseFloat(gasRows[0].hours) || 0;
			if (curr0 > max0) {
				const excessHours = Math.round((curr0 - max0) * 10) / 10;
				gasRows[0].hours = max0.toFixed(1);
				newRowHours = excessHours.toFixed(1);
				toast.info(
					`จัดสรรเตาแรก ${max0.toFixed(1)} ชม. และโอนส่วนเกิน ${excessHours} ชม. มายังเตาใหม่นี้`
				);
			}
		}

		gasRows.push({
			cylinder_id: nextCylId,
			hours: newRowHours,
			isManuallyEdited: true
		});
	}

	function removeGasRow(index: number) {
		if (gasRows.length <= 1 || index === 0) return;
		gasRows.splice(index, 1);
	}

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
			selectedRecipeId = activePlan.recipes?.[0]?.recipe_id ?? '';
			if (activePlan.gas_usage && activePlan.gas_usage.length > 0) {
				gasRows = activePlan.gas_usage.map((gu) => {
					const cyl = (gasTypes.data ?? []).find((t) => t._id === gu.cylinder_id);
					let hrs = '1.0';
					if (cyl && cyl.burn_rate_kg_per_hour) {
						const consumption = parseFloat(gu.consumption_kg) || 0;
						const rate = parseFloat(cyl.burn_rate_kg_per_hour) || 1;
						hrs = (Math.round((consumption / rate) * 10) / 10).toFixed(1);
					}
					return {
						cylinder_id: gu.cylinder_id,
						hours: hrs,
						isManuallyEdited: true
					};
				});
			} else {
				const defaultCylId = gasTypes.data?.[0]?._id ?? '';
				gasRows = [{ cylinder_id: defaultCylId, hours: '1.5', isManuallyEdited: false }];
			}

			const req = (requisitions.data ?? []).find((r) => r.meal_plan_id === activePlan._id);
			if (req?.items && req.items.length > 0) {
				ingredientsList = req.items.map((it) => {
					const master = (itemMasters.data ?? []).find((m) => m._id === it.item_id);
					return {
						item_id: it.item_id,
						name: master?.name || it.item_id,
						needed: String(it.qty_requested),
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
			isIngredientsManuallyEdited = false;
			ingredientsList = calculateRecipeIngredients('', allocatedTarget);
			showAddIngredient = false;
			const defaultCylId = gasTypes.data?.[0]?._id ?? '';
			gasRows = [{ cylinder_id: defaultCylId, hours: '1.5', isManuallyEdited: false }];
		}
	});

	function switchToNewBatch() {
		activePlanId = null;
		activeRequisitionId = null;
		lastLoadedPlanId = null;
		currentStage = 'A';
		menuLabel = '';
		targetTags = getActiveSessionTags();
		isEveryone = targetTags.length === 5;
		const count = calculateTargetFromTags(targetTags);
		allocatedTarget = count > 0 ? count : session?.target_headcount?.total || 50;
		selectedRecipeId = '';
		isIngredientsManuallyEdited = false;
		ingredientsList = calculateRecipeIngredients('', allocatedTarget);
		showAddIngredient = false;
		const defaultCylId = gasTypes.data?.[0]?._id ?? '';
		gasRows = [{ cylinder_id: defaultCylId, hours: '1.5', isManuallyEdited: false }];
		goto(resolve(`/back-office/kitchen/production-board/${sessionId}`), { replaceState: true });
	}

	function selectBatch(planId: string) {
		activePlanId = planId;
		const req = (requisitions.data ?? []).find((r) => r.meal_plan_id === planId);
		const svc = (services.data ?? []).find((s) => s.meal_plan_id === planId);
		if (svc || req?.status === 'approved') {
			currentStage = 'C';
		} else if (req) {
			currentStage = 'B';
		} else {
			currentStage = 'A';
		}
		goto(resolve(`/back-office/kitchen/production-board/${sessionId}?plan_id=${planId}`), {
			replaceState: true
		});
	}

	// Auto-select first gas cylinder when types load
	$effect(() => {
		if (gasTypes.data && gasTypes.data.length > 0) {
			if (gasRows.length === 0) {
				gasRows = [{ cylinder_id: gasTypes.data[0]._id, hours: '1.5', isManuallyEdited: false }];
			} else if (!gasRows[0].cylinder_id) {
				gasRows[0].cylinder_id = gasTypes.data[0]._id;
			}
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

	function calculateCookingHoursFromRecipe(recipeId: string, portions: number): string | null {
		const recipe = (recipes.data ?? []).find((r) => r._id === recipeId);
		return calculateCookingHoursFromPortions(recipe, portions);
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

		if (gasRows.length > 0) {
			gasRows.forEach((r) => (r.isManuallyEdited = false));
			const autoHours = calculateCookingHoursFromRecipe(target.value, allocatedTarget);
			if (autoHours !== null) {
				distributeRecipeHours(parseFloat(autoHours));
			}
		}
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

	// Synchronize cooking hours with recipe & portions when not manually customized
	$effect(() => {
		const recId = selectedRecipeId;
		const target = allocatedTarget;
		void recipes.data;
		if (gasRows.length > 0 && !gasRows[0].isManuallyEdited && target > 0 && recId) {
			const autoHours = calculateCookingHoursFromRecipe(recId, target);
			if (autoHours !== null) {
				distributeRecipeHours(parseFloat(autoHours));
			}
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

	function handleNewItemSelect(e: Event) {
		const target = e.target as HTMLSelectElement;
		newItemId = target.value;
		const master = (itemMasters.data ?? []).find((m) => m._id === target.value);
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

	// Calculate gas requirements per row and total
	const gasRowsAnalysis = $derived.by(() => {
		return gasRows.map((row) => {
			const cyl = (gasTypes.data ?? []).find((t) => t._id === row.cylinder_id);
			const hours = parseFloat(row.hours) || 0;
			const consumptionKg = cyl
				? calculateGasConsumptionKg(hours, {
						burn_rate_kg_per_hour: cyl.burn_rate_kg_per_hour,
						time_multiplier: cyl.time_multiplier
					})
				: '0';
			const remainingKg = cyl
				? gasCylinderBalance(gasLedger.data ?? [], cyl._id, cyl.capacity_kg)
				: '0';
			const isInsufficient = cyl ? qtyGt(consumptionKg, remainingKg) : false;

			return {
				...row,
				cylinder: cyl,
				consumptionKg,
				remainingKg,
				isInsufficient
			};
		});
	});

	const totalEstimatedGasKg = $derived.by(() => {
		const total = gasRowsAnalysis.reduce((sum, r) => sum + (parseFloat(r.consumptionKg) || 0), 0);
		return (Math.round(total * 100) / 100).toFixed(2);
	});

	// Backward-compatibility alias for Stage C fallback
	const estimatedGasKg = $derived(totalEstimatedGasKg);

	const isGasInsufficient = $derived(gasRowsAnalysis.some((r) => r.isInsufficient));

	// Submit Stage A ➔ Create Requisition Ticket
	async function handleCreateRequisitionTicket() {
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

		// Validate gas rows
		const hasInvalidGasRow = gasRows.some((r) => !r.cylinder_id || Number(r.hours) <= 0);
		if (hasInvalidGasRow) {
			toast.error('กรุณาเลือกถังแก๊สและระบุชั่วโมงการใช้งานให้ถูกต้องทุกแถว');
			return;
		}

		const cylinderIds = gasRows.map((r) => r.cylinder_id).filter(Boolean);
		if (new Set(cylinderIds).size !== cylinderIds.length) {
			toast.error('มีถังแก๊สซ้ำกัน กรุณาเลือกถังแก๊สที่ไม่ซ้ำกันในแต่ละแถว');
			return;
		}

		const gasUsage: MealPlanGasUsage[] = gasRowsAnalysis
			.filter((r) => r.cylinder_id && Number(r.consumptionKg) > 0)
			.map((r) => ({
				cylinder_id: r.cylinder_id,
				consumption_kg: r.consumptionKg
			}));

		try {
			const res = await createRequisitionMutation.mutateAsync({
				params: {
					planInput: {
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
							: [{ recipe_id: 'recipe:custom', planned_qty: allocatedTarget }],
						gas_usage: gasUsage.length > 0 ? gasUsage : undefined
					},
					requisitionInput: {
						meal_session_id: session._id,
						items: ingredientsList.map((ing) => ({
							item_id: ing.item_id,
							qty_requested: ing.needed,
							unit: ing.unit
						})),
						gas_drawdown: gasUsage.map((g) => ({
							cylinder_id: g.cylinder_id,
							qty_kg: g.consumption_kg
						}))
					}
				},
				ctx: {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'kitchen_staff'
				}
			});

			activePlanId = res.plan?._id ?? null;
			activeRequisitionId = res.requisition._id;
			currentStage = 'B';
			toast.success(`สร้างใบเบิก ${res.requisition.ticket_no} เรียบร้อยแล้ว (รอคลังอนุมัติ)`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'ไม่สามารถสร้างใบเบิกได้';
			toast.error(msg);
		}
	}

	function handleEditAndReRequest() {
		currentStage = 'A';
	}

	async function handleCancelBatch() {
		if (!activePlan) return;
		if (!confirm('คุณต้องการยกเลิกชุดการผลิตนี้หรือไม่?')) return;
		try {
			await deletePlanMutation.mutateAsync(activePlan);
			toast.success('ยกเลิกชุดการผลิตแล้ว');
			goto(resolve('/back-office/kitchen'));
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'ไม่สามารถยกเลิกได้';
			toast.error(msg);
		}
	}

	// --- Stage C: Service & Actual Yield Form States ---
	let yieldActualPortions = $state(50);
	let servedInShelter = $state(48);
	let wastePortions = $state(2);
	let extVolunteers = $state(0);
	let extOutside = $state(0);
	let actualGasUsedKg = $state('');
	let serviceNotes = $state('');

	// Init stage C defaults from activeService or allocatedTarget
	$effect(() => {
		if (currentStage === 'C') {
			if (activeService) {
				yieldActualPortions = activeService.actual_yield ?? activePlan?.allocated_target ?? 50;
				servedInShelter = activeService.served;
				wastePortions = activeService.waste;
				extVolunteers = activeService.external?.volunteers ?? 0;
				extOutside = activeService.external?.outside_evacuees ?? 0;
				actualGasUsedKg = activeService.actual_gas_used_kg ?? '';
			} else {
				yieldActualPortions = activePlan?.allocated_target ?? allocatedTarget;
				servedInShelter = activePlan?.allocated_target ?? allocatedTarget;
				wastePortions = 0;
				actualGasUsedKg = estimatedGasKg;
			}
		}
	});

	async function handleRecordService() {
		if (!session || !activePlanId) return;
		if (yieldActualPortions < 0) {
			toast.error('กรุณาระบุจำนวนจานที่ปรุงได้จริง');
			return;
		}

		if (activeService) {
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
					actual_gas_used_kg: actualGasUsedKg ? String(actualGasUsedKg) : undefined,
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
</script>

<svelte:head>
	<title>กระดานการผลิตอาหาร (Production Board) · SmartShelter</title>
</svelte:head>

<div class="flex-1 space-y-4 overflow-auto p-4">
	<!-- Top Navigation Breadcrumb & Session Info Header -->
	<div class="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
		<div class="flex items-center gap-2">
			<a
				href={resolve('/back-office/kitchen')}
				class="inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-muted"
			>
				<ArrowLeft class="h-4 w-4" />
			</a>
			<div>
				<div class="flex items-center gap-2">
					<h2 class="text-base font-bold text-foreground">กระดานการผลิตอาหาร (Production Board)</h2>
					{#if session}
						<span
							class="rounded-full px-2.5 py-0.5 text-xs font-semibold {session.meal === 'breakfast'
								? 'bg-amber-100 text-amber-800'
								: session.meal === 'lunch'
									? 'bg-orange-100 text-orange-800'
									: session.meal === 'dinner'
										? 'bg-indigo-100 text-indigo-800'
										: 'bg-emerald-100 text-emerald-800'}"
						>
							{MEAL_PERIOD_LABELS[session.meal] ?? session.meal}
						</span>
					{/if}
				</div>
				{#if session}
					<p class="text-xs text-muted-foreground">
						{session.name} · {session.date} · เป้าหมายรวม {session.target_headcount.total} คน
					</p>
				{/if}
			</div>
		</div>

		<!-- 3-Stage Progress Stepper -->
		<div class="flex items-center gap-2 rounded-lg border bg-muted/30 p-1 text-xs">
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition-colors {currentStage ===
				'A'
					? 'bg-primary text-primary-foreground shadow-sm'
					: 'text-muted-foreground'}"
				onclick={() => (currentStage = 'A')}
			>
				<span class="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-2xs"
					>A</span
				>
				สูตร & ขอเบิก
			</button>
			<span class="text-muted-foreground/40">/</span>
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition-colors {currentStage ===
				'B'
					? 'bg-primary text-primary-foreground shadow-sm'
					: 'text-muted-foreground'}"
				disabled={!activeRequisition}
				onclick={() => (currentStage = 'B')}
			>
				<span class="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-2xs"
					>B</span
				>
				ตั๋วเบิก & อนุมัติ
			</button>
			<span class="text-muted-foreground/40">/</span>
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition-colors {currentStage ===
				'C'
					? 'bg-primary text-primary-foreground shadow-sm'
					: 'text-muted-foreground'}"
				disabled={!activePlanId ||
					(!activeService && activeRequisition && activeRequisition.status !== 'approved')}
				onclick={() => (currentStage = 'C')}
			>
				<span class="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-2xs"
					>C</span
				>
				ผลผลิต & แจกจ่าย
			</button>
		</div>
	</div>

	<!-- Batch Selector Bar -->
	{#if sessionPlans.length > 0}
		<div
			class="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-2.5"
		>
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-xs font-semibold text-muted-foreground">ชุดการผลิตในมื้อนี้:</span>
				{#each sessionPlans as p (p._id)}
					{@const isSelected = activePlanId === p._id}
					{@const pReq = (requisitions.data ?? []).find((r) => r.meal_plan_id === p._id)}
					{@const pSvc = (services.data ?? []).find((s) => s.meal_plan_id === p._id)}
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all {isSelected
							? 'bg-primary text-primary-foreground shadow-sm'
							: 'border bg-background text-foreground hover:bg-muted'}"
						onclick={() => selectBatch(p._id)}
					>
						<span>{p.label ?? 'เมนูอาหาร'}</span>
						<span class="text-2xs opacity-80">({p.allocated_target ?? p.headcount.total} จาน)</span>
						{#if pSvc}
							<CheckCircle2 class="h-3.5 w-3.5 text-emerald-400" />
						{:else if pReq?.status === 'approved'}
							<PackageCheck class="h-3.5 w-3.5 text-blue-400" />
						{:else if pReq?.status === 'pending'}
							<Clock class="h-3.5 w-3.5 text-amber-400" />
						{/if}
					</button>
				{/each}
			</div>

			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1 border-dashed text-xs text-primary hover:bg-primary/5"
				onclick={switchToNewBatch}
			>
				<Plus class="h-3.5 w-3.5" />
				สร้างชุดการผลิตใหม่
			</Button>
		</div>
	{/if}

	<!-- Stage Content -->
	{#if currentStage === 'A'}
		<!-- STAGE A: Plan, BOM & Requisition Ticket Creation -->
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
			<!-- Column 1: Menu & Target Groups -->
			<Card.Root class="border shadow-sm">
				<Card.Header class="pb-3">
					<Card.Title class="flex items-center gap-2 text-sm font-bold">
						<ChefHat class="h-4 w-4 text-primary" />
						{#if activePlan}
							1. เมนูและกลุ่มเป้าหมาย (แก้ไขชุดการผลิต)
						{:else}
							1. เมนูและกลุ่มเป้าหมาย (Menu & Target)
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
						<Label class="text-xs">สูตรอาหารมาตรฐาน (Catalog Recipe)</Label>
						<select
							bind:value={selectedRecipeId}
							onchange={handleRecipeChange}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
						>
							<option value="">-- กำหนดวัตถุดิบเอง (Custom) --</option>
							{#each recipes.data ?? [] as rec (rec._id)}
								<option value={rec._id}>{rec.label} (สูตรฐาน {rec.standard_portions} จาน)</option>
							{/each}
						</select>
					</div>

					<div>
						<Label class="text-xs">ชื่อเมนูที่แสดง (Label)</Label>
						<Input
							bind:value={menuLabel}
							placeholder="เช่น ข้าวต้มไก่ฮาลาล, ข้าวผัดไข่..."
							class="mt-1 text-xs"
						/>
					</div>

					<div>
						<div class="flex items-center justify-between">
							<Label class="text-xs">จำนวนจานที่ต้องการผลิต (Allocated Portions)</Label>
							{#if session?.target_headcount}
								{@const suggested = calculateTargetFromTags(targetTags)}
								{#if suggested > 0 && allocatedTarget !== suggested}
									<button
										type="button"
										class="text-2xs font-medium text-primary underline hover:text-primary/80"
										onclick={() => (allocatedTarget = suggested)}
									>
										ใช้ยอดตามกลุ่ม ({suggested} จาน)
									</button>
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
							<button
								type="button"
								class="text-2xs font-semibold text-primary underline"
								onclick={handleEveryoneToggle}
							>
								{isEveryone ? 'ยกเลิกครอบคลุมทุกคน' : 'ครอบคลุมทุกคน (Everyone)'}
							</button>
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
									<select
										value={newItemId}
										onchange={handleNewItemSelect}
										class="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
									>
										<option value="">-- เลือกวัตถุดิบ --</option>
										{#each itemMasters.data ?? [] as item (item._id)}
											<option value={item._id}>{item.name} ({item.base_unit})</option>
										{/each}
									</select>
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
										bind:value={newUnit}
										placeholder="หน่วย"
										class="mt-1 h-8 text-xs text-muted-foreground"
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
							เพิ่มวัตถุดิบ (Add Ingredient)
						</Button>
					{/if}

					<p class="text-2xs text-muted-foreground">
						* หากสต็อกในคลังไม่พอ คลังสินค้าสามารถตัดจ่ายบางส่วน (Partial Issue) ในขั้นตอนอนุมัติได้
					</p>
				</Card.Content>
			</Card.Root>

			<!-- Column 3: Stove & LPG Gas Allocation -->
			<Card.Root class="border shadow-sm">
				<Card.Header class="pb-3">
					<Card.Title class="flex items-center gap-2 text-sm font-bold">
						<Flame class="h-4 w-4 text-orange-600" />
						3. จัดสรรเตาและแก๊ส (Stove & LPG)
					</Card.Title>
					<Card.Description class="text-xs">
						ระบุชั่วโมงปรุงเพื่อประเมินปริมาณแก๊สที่ต้องใช้
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3 text-xs">
					<!-- Multi-cylinder Rows -->
					<div class="space-y-2.5">
						{#each gasRows as row, idx (idx)}
							{@const analysis = gasRowsAnalysis[idx]}
							{@const isRow0 = idx === 0}
							{@const autoHours =
								isRow0 && selectedRecipeId
									? calculateCookingHoursFromRecipe(selectedRecipeId, allocatedTarget)
									: null}

							<div class="space-y-2 rounded-lg border bg-card/60 p-3 shadow-xs">
								<div class="flex items-center justify-between border-b pb-1.5">
									<div class="flex items-center gap-1.5">
										<span
											class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-2xs font-bold text-orange-700"
										>
											{idx + 1}
										</span>
										<span class="font-medium text-foreground">
											เตา / ถังแก๊สที่ {idx + 1}
										</span>
										{#if isRow0}
											<span class="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
												>เตาหลัก</span
											>
										{/if}
									</div>

									<div class="flex items-center gap-1.5">
										{#if isRow0 && row.isManuallyEdited && autoHours !== null}
											<button
												type="button"
												class="inline-flex items-center gap-1 text-2xs text-primary hover:underline"
												onclick={() => {
													gasRows.forEach((r) => (r.isManuallyEdited = false));
													distributeRecipeHours(parseFloat(autoHours));
												}}
											>
												<RotateCcw class="h-3 w-3" />
												คืนค่าตามสูตร ({autoHours} ชม.)
											</button>
										{/if}
										{#if idx > 0}
											<button
												type="button"
												class="rounded p-1 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600"
												onclick={() => removeGasRow(idx)}
												title="ลบแถวนี้"
											>
												<Trash2 class="h-3.5 w-3.5" />
											</button>
										{/if}
									</div>
								</div>

								<div class="space-y-2">
									<div>
										<Label class="text-2xs text-muted-foreground">เลือกถังแก๊ส</Label>
										<select
											bind:value={row.cylinder_id}
											class="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
										>
											<option value="" disabled>-- เลือกถังแก๊ส --</option>
											{#each gasTypes.data ?? [] as cyl (cyl._id)}
												{@const isUsedElsewhere = gasRows.some(
													(r, rIdx) => rIdx !== idx && r.cylinder_id === cyl._id
												)}
												{@const remaining = gasCylinderBalance(
													gasLedger.data ?? [],
													cyl._id,
													cyl.capacity_kg
												)}
												<option value={cyl._id} disabled={isUsedElsewhere}>
													{cyl.name} (คงเหลือ {remaining} / {cyl.capacity_kg} kg){isUsedElsewhere
														? ' - เลือกแล้ว'
														: ''}
												</option>
											{/each}
										</select>
									</div>

									<div>
										<Label class="text-2xs text-muted-foreground">ชั่วโมงใช้งาน (ชม.)</Label>
										<Input
											type="number"
											step="0.1"
											min="0.1"
											bind:value={row.hours}
											oninput={() => (row.isManuallyEdited = true)}
											class="mt-1 h-8 text-xs"
											placeholder="1.0"
										/>
									</div>
								</div>

								<!-- Row Gas Sub-summary -->
								{#if analysis}
									<div
										class="flex items-center justify-between rounded bg-muted/30 px-2.5 py-1.5 text-2xs"
									>
										<span class="text-muted-foreground">
											ใช้ประมาณ: <strong class="font-mono text-foreground"
												>{analysis.consumptionKg} kg</strong
											>
										</span>
										<span class="text-muted-foreground">
											คงเหลือ: <strong
												class="font-mono {analysis.isInsufficient
													? 'text-rose-600'
													: 'text-emerald-600'}">{analysis.remainingKg} kg</strong
											>
										</span>
									</div>
									{#if analysis.isInsufficient}
										<div
											class="flex flex-col gap-1.5 rounded bg-rose-50 px-2.5 py-1.5 text-2xs text-rose-700 sm:flex-row sm:items-center sm:justify-between"
										>
											<div class="flex items-center gap-1">
												<AlertTriangle class="h-3.5 w-3.5 shrink-0 text-rose-600" />
												<span>
													แก๊สในถังนี้ไม่พอ (ต้องการ {analysis.consumptionKg} kg แต่เหลือ {analysis.remainingKg}
													kg)
												</span>
											</div>
											{#if isRow0}
												{@const max0 = getMaxHoursForCylinder(row.cylinder_id)}
												{@const excess = Math.max(
													0,
													Math.round(((parseFloat(row.hours) || 0) - max0) * 10) / 10
												)}
												{#if gasRows.length > 1}
													<button
														type="button"
														class="inline-flex shrink-0 items-center gap-1 rounded bg-rose-200/70 px-2 py-0.5 font-semibold text-rose-800 transition-colors hover:bg-rose-200"
														onclick={spillOverExcessGas}
													>
														<ArrowRight class="h-3 w-3" />
														โอนส่วนเกิน ({excess} ชม.) ไปเตาอื่น
													</button>
												{:else if (gasTypes.data ?? []).length > 1}
													<button
														type="button"
														class="inline-flex shrink-0 items-center gap-1 rounded bg-rose-200/70 px-2 py-0.5 font-semibold text-rose-800 transition-colors hover:bg-rose-200"
														onclick={addGasRow}
													>
														<Plus class="h-3 w-3" />
														เพิ่มเตาและโอนส่วนเกินอัตโนมัติ
													</button>
												{/if}
											{/if}
										</div>
									{/if}
								{/if}
							</div>
						{/each}
					</div>

					<!-- Add cylinder button -->
					{#if (gasTypes.data ?? []).length > gasRows.length}
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="w-full gap-1.5 border-dashed text-xs text-muted-foreground hover:text-foreground"
							onclick={addGasRow}
						>
							<Plus class="h-3.5 w-3.5" />
							เพิ่มเตา / ถังแก๊สอีกถัง ({gasRows.length} / {(gasTypes.data ?? []).length})
						</Button>
					{/if}

					<!-- Recipe Rate Note -->
					{#if selectedRecipeId}
						{@const chosen = (recipes.data ?? []).find((r) => r._id === selectedRecipeId)}
						{#if chosen && parseFloat(chosen.standard_portions) > 0 && parseFloat(chosen.standard_duration_hours) > 0}
							{@const stdPortions = parseFloat(chosen.standard_portions)}
							{@const stdHours = parseFloat(chosen.standard_duration_hours)}
							{@const rate = Math.round((stdPortions / stdHours) * 10) / 10}
							<p class="text-2xs text-muted-foreground">
								คำนวณจากสูตร: กำลังผลิต {rate} จาน/ชม. (มาตรฐาน {stdPortions} จาน ต่อ {stdHours} ชม.)
							</p>
						{/if}
					{/if}

					<!-- Total Allocation Summary -->
					<div class="space-y-2 rounded-lg border bg-muted/20 p-3">
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground">จำนวนถังแก๊สที่ใช้:</span>
							<span class="font-mono font-bold text-foreground">{gasRows.length} ถัง</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-muted-foreground">ประเมินแก๊สรวมที่ต้องใช้:</span>
							<span class="font-mono font-bold text-foreground">{totalEstimatedGasKg} kg</span>
						</div>
						{#if isGasInsufficient}
							<div
								class="flex flex-col gap-1.5 rounded bg-rose-50 p-2.5 text-2xs text-rose-700 sm:flex-row sm:items-center sm:justify-between"
							>
								<div class="flex items-center gap-1.5">
									<AlertTriangle class="h-4 w-4 shrink-0 text-rose-600" />
									<span>มีถังแก๊สที่ไม่เพียงพอต่อการปรุงอาหาร</span>
								</div>
								{#if gasRows.length > 1 && gasRowsAnalysis[0]?.isInsufficient}
									<button
										type="button"
										class="inline-flex shrink-0 items-center gap-1 rounded bg-rose-200/70 px-2 py-1 font-semibold text-rose-800 transition-colors hover:bg-rose-200"
										onclick={spillOverExcessGas}
									>
										<ArrowRight class="h-3 w-3" />
										กระจายชั่วโมงตามความจุถัง (โอนส่วนเกินเตาแรก)
									</button>
								{/if}
							</div>
						{/if}
					</div>

					{#if activeRequisition}
						<div class="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
							<div class="flex items-center justify-between">
								<span class="font-semibold text-foreground">ตั๋วคำขอเบิก:</span>
								<span class="font-mono font-bold text-primary">{activeRequisition.ticket_no}</span>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-muted-foreground">สถานะตั๋ว:</span>
								<span
									class="font-semibold {activeRequisition.status === 'approved'
										? 'text-green-700'
										: activeRequisition.status === 'rejected'
											? 'text-rose-700'
											: 'text-amber-700'}"
								>
									{#if activeRequisition.status === 'approved'}
										คลังอนุมัติแล้ว
									{:else if activeRequisition.status === 'rejected'}
										ถูกปฏิเสธ
									{:else}
										รอคลังสินค้าอนุมัติ
									{/if}
								</span>
							</div>
						</div>

						<div class="flex flex-col gap-2 pt-3">
							{#if activeRequisition.status === 'approved'}
								<Button
									class="w-full gap-2 bg-green-600 font-semibold text-white shadow-sm hover:bg-green-700"
									onclick={() => (currentStage = 'C')}
								>
									<CheckCircle2 class="h-4 w-4" />
									ไปยังบันทึกผลผลิต (Stage 3)
								</Button>
							{/if}
							<Button
								variant="outline"
								class="w-full gap-2 text-xs font-semibold"
								onclick={() => (currentStage = 'B')}
							>
								<ArrowRight class="h-4 w-4" />
								ไปยังตรวจสอบตั๋วเบิก (Stage B)
							</Button>
						</div>
					{:else}
						<div class="pt-4">
							<Button
								class="w-full gap-2 font-semibold shadow-sm"
								onclick={handleCreateRequisitionTicket}
								disabled={createRequisitionMutation.isPending}
							>
								<Sparkles class="h-4 w-4" />
								{createRequisitionMutation.isPending
									? 'กำลังส่งคำขอเบิก...'
									: 'สร้างใบเบิกวัตถุดิบ (Create Requisition)'}
							</Button>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>
	{:else if currentStage === 'B'}
		<!-- STAGE B: Ticket & Warehouse Approval -->
		<Card.Root class="mx-auto max-w-3xl border shadow-sm">
			<Card.Header class="border-b bg-muted/20">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<Card.Title class="flex items-center gap-2 text-lg font-bold">
							ตั๋วคำขอเบิก: {activeRequisition?.ticket_no ?? 'กำลังโหลด...'}
						</Card.Title>
						<Card.Description class="text-xs">
							ชุดการผลิต: {activePlan?.label ?? 'เมนูอาหาร'} · เป้าหมาย {activePlan?.allocated_target ??
								allocatedTarget} จาน
						</Card.Description>
					</div>

					<!-- Status Badge -->
					{#if activeRequisition?.status === 'approved'}
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800"
						>
							<CheckCircle2 class="h-4 w-4 text-green-600" />
							คลังอนุมัติแล้ว
						</span>
					{:else if activeRequisition?.status === 'rejected'}
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800"
						>
							<XCircle class="h-4 w-4 text-rose-600" />
							ถูกปฏิเสธ
						</span>
					{:else}
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800"
						>
							<Clock class="h-4 w-4 text-amber-600" />
							รอคลังสินค้าอนุมัติ
						</span>
					{/if}
				</div>
			</Card.Header>

			<Card.Content class="space-y-4 p-5 text-xs">
				<!-- Status Notification Banner -->
				{#if activeRequisition?.status === 'pending'}
					<div
						class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800"
					>
						<Clock class="h-5 w-5 shrink-0 text-amber-600" />
						<div>
							<h4 class="font-bold">รอคลังสินค้าตรวจสอบและอนุมัติตัดจ่ายสต็อก</h4>
							<p class="mt-1 text-xs text-amber-700">
								ตั๋วคำขอเบิกถูกส่งไปยังระบบคลังเรียบร้อยแล้ว
								เมื่อเจ้าหน้าที่คลังตรวจสอบสต็อกและกดยืนยันจ่ายของ
								ระบบจะปลดล็อกขั้นตอนเริ่มปรุงอาหารทันที
							</p>
						</div>
					</div>
				{:else if activeRequisition?.status === 'approved'}
					<div
						class="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800"
					>
						<CheckCircle2 class="h-5 w-5 shrink-0 text-green-600" />
						<div>
							<h4 class="font-bold">คลังสินค้าอนุมัติตัดจ่ายวัตถุดิบแล้ว พร้อมเริ่มปรุงอาหาร</h4>
							<p class="mt-1 text-xs text-green-700">
								อนุมัติโดย: {activeRequisition.approved_by} · ตัดสต็อกสินค้าและแก๊สแล้ว
							</p>
						</div>
					</div>
				{:else if activeRequisition?.status === 'rejected'}
					<div
						class="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800"
					>
						<AlertCircle class="h-5 w-5 shrink-0 text-rose-600" />
						<div class="flex-1">
							<h4 class="font-bold">คำขอเบิกถูกปฏิเสธโดยคลังสินค้า</h4>
							<p class="mt-1 text-xs text-rose-700">
								เหตุผล: {activeRequisition.reject_reason || 'วัตถุดิบไม่เพียงพอ'}
							</p>
							<div class="mt-3 flex items-center gap-2">
								<Button
									size="sm"
									variant="default"
									class="h-7 text-xs"
									onclick={handleEditAndReRequest}
								>
									แก้ไขแผนและขอเบิกใหม่
								</Button>
								<Button
									size="sm"
									variant="ghost"
									class="h-7 text-xs text-rose-700 hover:bg-rose-100"
									onclick={handleCancelBatch}
								>
									ยกเลิกชุดการผลิตนี้
								</Button>
							</div>
						</div>
					</div>
				{/if}

				<!-- Requisition Items Review Table -->
				<div class="rounded-lg border">
					<div class="border-b bg-muted/40 px-3 py-2 font-semibold text-foreground">
						รายการวัตถุดิบในตั๋วคำขอ
					</div>
					<Table.Root>
						<Table.Header class="text-2xs">
							<Table.Row>
								<Table.Head>รายการ</Table.Head>
								<Table.Head class="text-right">จำนวนที่ขอ</Table.Head>
								<Table.Head class="text-right">จำนวนที่คลังจ่าย</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body class="text-xs">
							{#each activeRequisition?.items ?? [] as it (it.item_id)}
								{@const name = getItemName(it.item_id)}
								<Table.Row>
									<Table.Cell>
										<span class="font-medium text-foreground">{name}</span>
									</Table.Cell>
									<Table.Cell class="text-right font-mono">{it.qty_requested} {it.unit}</Table.Cell>
									<Table.Cell
										class="text-right font-mono font-bold {it.qty_issued !== '0'
											? 'text-green-700'
											: 'text-muted-foreground'}"
									>
										{it.qty_issued !== '0' ? `${it.qty_issued} ${it.unit}` : 'รอดำเนินการ'}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>

				<!-- Gas Drawdown Table -->
				{#if activeRequisition?.gas_drawdown && activeRequisition.gas_drawdown.length > 0}
					<div class="rounded-lg border">
						<div
							class="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-2 font-semibold text-foreground"
						>
							<Flame class="h-3.5 w-3.5 text-orange-600" />
							แก๊สหุงต้มที่ขอเบิก
						</div>
						<div class="space-y-1 p-3 text-xs">
							{#each activeRequisition.gas_drawdown as g (g.cylinder_id)}
								{@const cyl = (gasTypes.data ?? []).find((t) => t._id === g.cylinder_id)}
								<div class="flex items-center justify-between">
									<span>{cyl?.name ?? g.cylinder_id}</span>
									<span class="font-mono font-bold">{g.qty_kg} kg</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Action Buttons -->
				<div class="flex items-center justify-between pt-2">
					<Button variant="outline" onclick={() => goto(resolve('/back-office/kitchen'))}>
						กลับไปหน้ารวมมื้อ
					</Button>

					{#if activeRequisition?.status === 'approved'}
						<Button
							class="gap-1.5 bg-green-600 text-white shadow-sm hover:bg-green-700"
							onclick={() => (currentStage = 'C')}
						>
							เริ่มปรุงและบันทึกผลผลิต (สู่ช่วง C)
							<ArrowRight class="h-4 w-4" />
						</Button>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	{:else if currentStage === 'C'}
		<!-- STAGE C: Actual Yield & Meal Service Recording -->
		<Card.Root class="mx-auto max-w-2xl border shadow-sm">
			<Card.Header class="border-b bg-muted/20">
				<Card.Title class="flex items-center gap-2 text-base font-bold">
					<CheckCircle2 class="h-5 w-5 text-emerald-600" />
					บันทึกผลผลิตจริงและการแจกจ่าย (Actual Yield & Meal Service)
				</Card.Title>
				<Card.Description class="text-xs">
					บันทึกจำนวนจานที่ครัวปรุงได้จริง อาหารที่แจกจ่าย และปริมาณแก๊สที่ใช้งานจริง
				</Card.Description>
			</Card.Header>

			<Card.Content class="space-y-4 p-5 text-xs">
				{#if activeService}
					<div
						class="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800"
					>
						<CheckCircle2 class="h-5 w-5 shrink-0 text-green-600" />
						<div>
							<h4 class="font-bold">บันทึกผลการผลิตและแจกจ่ายเรียบร้อยแล้ว</h4>
							<p class="mt-1 text-xs text-green-700">
								บันทึกเมื่อ {new Date(activeService.created_at).toLocaleString('th-TH')} โดย {activeService.created_by}
							</p>
						</div>
					</div>
				{/if}

				<div
					class="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3"
				>
					<div>
						<span class="font-bold text-foreground">{activePlan?.label ?? 'เมนูประกอบอาหาร'}</span>
						<p class="text-2xs text-muted-foreground">
							เป้าหมายตามแผน: {activePlan?.allocated_target ?? allocatedTarget} จาน
						</p>
					</div>
					{#if activeRequisition}
						<span class="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-800">
							ตั๋วเบิก: {activeRequisition.ticket_no} (อนุมัติแล้ว)
						</span>
					{/if}
				</div>

				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
					<div>
						<Label class="text-xs font-semibold">จำนวนจานปรุงได้จริง (Actual Yield)</Label>
						<Input
							type="number"
							min="0"
							bind:value={yieldActualPortions}
							class="mt-1 text-xs font-bold"
						/>
					</div>
					<div>
						<Label class="text-xs">แจกจ่ายในศูนย์ (Served)</Label>
						<Input type="number" min="0" bind:value={servedInShelter} class="mt-1 text-xs" />
					</div>
					<div>
						<Label class="text-xs">อาหารเหลือทิ้ง (Waste)</Label>
						<Input type="number" min="0" bind:value={wastePortions} class="mt-1 text-xs" />
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label class="text-xs">แจกอาสาสมัคร/เจ้าหน้าที่ (External)</Label>
						<Input type="number" min="0" bind:value={extVolunteers} class="mt-1 text-xs" />
					</div>
					<div>
						<Label class="text-xs">แจกผู้พักพิงภายนอก (Outside)</Label>
						<Input type="number" min="0" bind:value={extOutside} class="mt-1 text-xs" />
					</div>
				</div>

				<div>
					<Label class="text-xs">แก๊สหุงต้มที่ใช้จริง (กิโลกรัม)</Label>
					<Input
						type="number"
						step="0.01"
						min="0"
						bind:value={actualGasUsedKg}
						placeholder="เช่น 1.45"
						class="mt-1 text-xs"
					/>
				</div>

				<div>
					<Label class="text-xs">บันทึกเพิ่มเติม (Notes)</Label>
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
					{#if activeService}
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
							disabled={recordServiceMutation.isPending}
						>
							<Check class="h-4 w-4" />
							{recordServiceMutation.isPending
								? 'กำลังบันทึก...'
								: 'บันทึกผลการผลิต (Complete Batch)'}
						</Button>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
