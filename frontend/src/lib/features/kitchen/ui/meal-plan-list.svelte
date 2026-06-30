<script lang="ts">
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import Flame from '@lucide/svelte/icons/flame';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Plus from '@lucide/svelte/icons/plus';
	import Play from '@lucide/svelte/icons/play';
	import FileText from '@lucide/svelte/icons/file-text';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		useMealPlans,
		useConfirmMealPlan,
		useGasCylinderTypes,
		MEAL_PERIOD_LABELS,
		MealPlanForm,
		type MealPlan
	} from '$lib/features/kitchen';
	import { useActiveSopProfile, sopRatioKeys } from '$lib/features/sop-ratios';
	import { seedDefaultSopProfile } from '$lib/features/sop-ratios/data/sop-ratio.seed';
	import { useQueryClient } from '@tanstack/svelte-query';

	const plans = useMealPlans();
	let createOpen = $state(false);
	const confirm = useConfirmMealPlan();
	const sopProfile = useActiveSopProfile();
	const gasTypes = useGasCylinderTypes();
	const queryClient = useQueryClient();

	let seeding = $state(false);

	async function handleSeed() {
		seeding = true;
		try {
			await seedDefaultSopProfile();
			await queryClient.invalidateQueries({ queryKey: sopRatioKeys.all });
			toast.success(
				'สร้าง SOP profile มาตรฐาน (150 ก./คน/มื้อ) แล้ว — กด "จัดสรรใบสั่งทำกิจกรรมใหม่" เพื่อสร้างแผน'
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'seed ไม่สำเร็จ');
		} finally {
			seeding = false;
		}
	}

	const today = new Date().toISOString().slice(0, 10);

	const todayPlans = $derived((plans.data ?? []).filter((p) => p.date === today));

	const stats = $derived.by(() => {
		const all = plans.data ?? [];
		const totalBoxes = all.reduce((sum, p) => sum + p.headcount.total, 0);
		const confirmed = all.filter((p) => p.status === 'confirmed').length;
		return {
			totalBoxes,
			confirmed,
			total: all.length
		};
	});

	async function handleConfirm(plan: MealPlan) {
		try {
			await confirm.mutateAsync(plan);
			toast.success(`ยืนยันแผน ${MEAL_PERIOD_LABELS[plan.meal]} วันที่ ${plan.date} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}

	function formatId(id: string): string {
		// meal_plan:2026-06-26:lunch → PRD-xxxx (last 4 chars of suffix)
		const suffix = id.split(':').pop() ?? id;
		return `PRD-${suffix.slice(-4).toUpperCase()}`;
	}

	const MENU_LABEL: Record<string, string> = {
		breakfast: 'ข้าวต้ม + ไข่ต้ม (มื้อเช้ามาตรฐาน)',
		lunch: 'ข้าวสวย + ไข่ต้ม (มาตรฐานช่วยผู้ประสบภัย)',
		dinner: 'ข้าวสวย + แกงจืด (มื้อเย็นมาตรฐาน)',
		snack: 'ขนมปัง + นม (ของว่างมาตรฐาน)'
	};

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
	}
</script>

<div class="flex flex-col gap-4 p-4">
	<!-- Header card -->
	<Card.Root class="border-0 shadow-sm">
		<Card.Content class="flex flex-wrap items-start justify-between gap-4 pt-4">
			<div class="flex items-start gap-3">
				<div class="rounded-lg bg-primary/10 p-2">
					<UtensilsCrossed class="h-5 w-5 text-primary" />
				</div>
				<div>
					<h2 class="text-base font-bold">ประวัติประกอบโรงครัว (Meal Production Logs)</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">
						บันทึกการวางแผนอาหารและรายการวัตถุดิบที่ต้องเบิกต่อมื้อ
					</p>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
					ผู้พักพิงวันนี้ (LIVE COUNT)
				</span>
				<a
					href={resolve('/back-office/kitchen/gas')}
					class="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800 transition-colors hover:bg-orange-200"
					title="จัดการทรัพยากรแก๊ส"
				>
					<Flame class="h-3.5 w-3.5" />
					ถังแก๊ส ({gasTypes.data?.length ?? 0})
				</a>
				<span
					class="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/40 px-3 py-1 text-xs font-medium text-muted-foreground/60"
					title="ยังไม่พร้อมใช้งาน"
				>
					ฐานสูตร BOM
				</span>
				<span
					class="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium"
				>
					{authStore.user?.name ?? '—'}
				</span>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Stats — borderless cards, shadow only -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">กล่องอาหารสำเร็จรวม</p>
			<p class="mt-1 text-2xl font-bold">{stats.totalBoxes.toLocaleString()}</p>
			<p class="text-xs text-muted-foreground">กล่อง</p>
		</div>
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">แก๊สหุงต้มใช้ไปรวม</p>
			<p class="mt-1 text-2xl font-bold text-muted-foreground">—</p>
			<p class="text-xs text-muted-foreground">กก.</p>
		</div>
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">เตาประกอบพร้อมลุย</p>
			<p class="mt-1 text-2xl font-bold">{stats.confirmed} / {stats.total}</p>
			<p class="text-xs text-muted-foreground">หัว</p>
		</div>
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">เวลาเฉลี่ยประกอบเสบียง</p>
			<p class="mt-1 text-2xl font-bold text-muted-foreground">~ —</p>
			<p class="text-xs text-muted-foreground">นาที</p>
		</div>
	</div>

	<!-- SOP setup banner -->
	{#if !sopProfile.isPending && !sopProfile.data}
		<Card.Root class="border-amber-300 bg-amber-50">
			<Card.Content class="flex flex-wrap items-center justify-between gap-4 pt-4">
				<div>
					<p class="font-semibold text-amber-800">ยังไม่มีค่ามาตรฐาน SOP ในระบบ</p>
					<p class="mt-0.5 text-xs text-amber-700">
						กด "Seed ค่ามาตรฐาน" เพื่อสร้าง SOP profile (150 ก./คน/มื้อ) — ทำครั้งเดียว
						จากนั้นสร้างแผนอาหารได้เลย
					</p>
				</div>
				<Button
					variant="outline"
					onclick={handleSeed}
					disabled={seeding}
					class="border-amber-400 text-amber-900 hover:bg-amber-100"
				>
					{seeding ? 'กำลัง seed...' : 'Seed ค่ามาตรฐาน'}
				</Button>
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- Table section -->
	<Card.Root class="border-0 shadow-sm">
		<Card.Header class="flex flex-row items-center justify-between py-4">
			<div class="flex items-start gap-3">
				<div class="rounded-lg bg-blue-50 p-2">
					<ClipboardList class="h-4 w-4 text-blue-500" />
				</div>
				<div>
					<Card.Title class="text-sm font-bold">
						ตารางแผนอาหาร ({(plans.data ?? []).length} รายการ)
					</Card.Title>
					<Card.Description class="text-xs">
						แผนทั้งหมด — วันนี้ {todayPlans.length} แผน
					</Card.Description>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<Button
					onclick={() => (createOpen = true)}
					class="rounded-full bg-green-600 px-5 text-white hover:bg-green-700"
				>
					<Plus class="mr-1.5 h-3.5 w-3.5" />
					สร้างแผนอาหารใหม่
				</Button>
				<Button
					onclick={() => goto(resolve('/back-office/kitchen/production-board'))}
					class="rounded-full bg-primary px-5 text-white hover:bg-primary/90"
				>
					<Play class="mr-1.5 h-3.5 w-3.5 fill-white" />
					เพิ่มสูตรมาตรฐาน (BOM)
				</Button>
				<Button
					variant="outline"
					onclick={() => goto(resolve('/back-office/kitchen/production-board') + '?mode=custom')}
					class="rounded-full px-5"
				>
					<FileText class="mr-1.5 h-3.5 w-3.5" />
					กำหนดสูตรเอง (Custom)
				</Button>
			</div>
		</Card.Header>

		<Card.Content class="p-0">
			{#if plans.isPending}
				<p class="p-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
			{:else if !plans.data?.length}
				<p class="p-6 text-center text-sm text-muted-foreground">ยังไม่มีแผนอาหาร</p>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row class="text-xs">
								<Table.Head class="min-w-[140px] px-6">รหัส / เวลาบันทึก</Table.Head>
								<Table.Head class="min-w-[240px] px-6">ตำรับเสบียงอาหาร (เมนู)</Table.Head>
								<Table.Head class="min-w-[120px] px-6 text-right">ยอดจัดสรรผลิต</Table.Head>
								<Table.Head class="min-w-[140px] px-6 text-center">สถานะ</Table.Head>
								<Table.Head class="min-w-[140px] px-6 text-center">จัดการข้อมูล</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each plans.data as plan (plan._id)}
								<Table.Row>
									<Table.Cell class="px-6 font-mono text-xs">
										<p class="font-semibold text-foreground">{formatId(plan._id)}</p>
										<p class="text-muted-foreground">
											{new Date(plan.created_at).toLocaleDateString('th-TH', {
												day: '2-digit',
												month: '2-digit',
												year: 'numeric'
											})}
											· {formatTime(plan.created_at)} น.
										</p>
									</Table.Cell>
									<Table.Cell class="max-w-xs px-6">
										<p class="text-sm font-medium">
											{MENU_LABEL[plan.meal] ?? MEAL_PERIOD_LABELS[plan.meal]}
										</p>
										<p class="mt-0.5 text-xs text-muted-foreground">
											ผ่านการรับรองสุขลักษณะเพื่อผู้ประสบภัย
										</p>
									</Table.Cell>
									<Table.Cell class="px-6 text-right">
										<p class="font-semibold">{plan.headcount.total.toLocaleString()}</p>
										<p class="text-xs text-muted-foreground">กล่อง</p>
									</Table.Cell>
									<Table.Cell class="px-6 text-center">
										{#if plan.status === 'confirmed'}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800"
											>
												<CheckCircle class="h-3 w-3" />
												สำเร็จสมบูรณ์
											</span>
										{:else}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800"
											>
												<Clock class="h-3 w-3" />
												รอดำเนินการ
											</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-6 text-center">
										{#if plan.status === 'draft'}
											<Button
												size="sm"
												variant="outline"
												onclick={() => handleConfirm(plan)}
												disabled={confirm.isPending}
											>
												ยืนยันแผน
											</Button>
										{:else}
											<Button
												size="sm"
												variant="outline"
												onclick={() =>
													goto(
														resolve('/back-office/kitchen/production-board') +
															'?ref=' +
															encodeURIComponent(plan._id)
													)}
											>
												จัดการ
											</Button>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<MealPlanForm bind:open={createOpen} />
