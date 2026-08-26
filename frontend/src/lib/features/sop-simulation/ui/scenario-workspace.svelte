<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import ConsoleBanner from '$lib/components/console-banner.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		useCurrentCalculationSnapshot,
		useDeleteScenario,
		useOpenScenario,
		useSaveScenario,
		useScenarios
	} from '../application/queries';
	import { useRunSimulation } from '../application/use-run-simulation';
	import type { ScenarioInput, ScenarioResult } from '../domain/scenario.schema';
	import ScenarioForm from './scenario-form.svelte';
	import ScenarioComparePanel from './scenario-compare-panel.svelte';
	import SavedScenarioList from './saved-scenario-list.svelte';
	import Save from '@lucide/svelte/icons/save';
	import History from '@lucide/svelte/icons/history';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Database from '@lucide/svelte/icons/database';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { toast } from 'svelte-sonner';

	let { shelterCode }: { shelterCode: string } = $props();
	const currentQuery = useCurrentCalculationSnapshot(() => shelterCode);
	const runMutation = useRunSimulation(() => shelterCode);
	const saveMutation = useSaveScenario(() => shelterCode);
	const deleteMutation = useDeleteScenario(() => shelterCode);
	const scenariosQuery = useScenarios(() => shelterCode);
	const openMutation = useOpenScenario(() => shelterCode);
	let result = $state<ScenarioResult | null>(null);
	let savedView = $state(false);
	let historyOpen = $state(false);
	let openedScenarioId = $state<string | null>(null);
	const savedScenarios = $derived(scenariosQuery.data?.pages.flatMap((page) => page.items) ?? []);
	const syncedStockCount = $derived(
		currentQuery.data
			? Object.values(currentQuery.data.stock_snapshot).filter((value) => value !== null).length
			: 0
	);
	const totalStockCount = $derived(
		currentQuery.data ? Object.keys(currentQuery.data.stock_snapshot).length : 0
	);
	const canShowWorkspace = $derived(Boolean(currentQuery.data) || (savedView && result !== null));

	function errorMessage(error: unknown, fallback: string) {
		return error instanceof Error && error.message.trim().length > 0
			? `${fallback}: ${error.message}`
			: fallback;
	}

	async function run(input: ScenarioInput) {
		try {
			const previous = currentQuery.data;
			const refreshed = await currentQuery.refetch();
			if (refreshed.isError || !refreshed.data)
				throw new Error('Could not refresh the current calculation snapshot');
			if (
				previous &&
				(previous.current_occupancy !== refreshed.data.current_occupancy ||
					JSON.stringify(previous.current_ratios) !== JSON.stringify(refreshed.data.current_ratios))
			)
				toast.info('ข้อมูลปัจจุบันเปลี่ยนแล้ว ระบบใช้ข้อมูลล่าสุดในการเปรียบเทียบ');
			result = await runMutation.mutateAsync({ input, snapshot: refreshed.data });
			savedView = false;
			toast.success('คำนวณสถานการณ์แล้ว');
		} catch (error) {
			toast.error(errorMessage(error, 'รันสถานการณ์ไม่สำเร็จ'));
		}
	}

	async function save() {
		if (!result) return;
		try {
			const saved = await saveMutation.mutateAsync({
				result,
				ctx: { shelterCode, createdBy: authStore.user?.name ?? 'unknown' }
			});
			result = saved.result;
			openedScenarioId = saved._id;
			savedView = true;
			toast.success('บันทึกสถานการณ์แล้ว');
		} catch (error) {
			toast.error(errorMessage(error, 'บันทึกสถานการณ์ไม่สำเร็จ'));
		}
	}

	async function openScenario(id: string) {
		try {
			const scenario = await openMutation.mutateAsync(id);
			result = scenario.result;
			openedScenarioId = id;
			savedView = true;
			historyOpen = false;
		} catch (error) {
			toast.error(errorMessage(error, 'เปิดสถานการณ์ไม่สำเร็จ'));
		}
	}

	async function deleteScenario(id: string) {
		try {
			await deleteMutation.mutateAsync({
				id,
				ctx: { shelterCode, createdBy: authStore.user?.name ?? 'unknown' }
			});
			if (openedScenarioId === id) {
				result = null;
				savedView = false;
				openedScenarioId = null;
			}
			toast.success('ลบสถานการณ์แล้ว');
		} catch (error) {
			toast.error(errorMessage(error, 'ลบสถานการณ์ไม่สำเร็จ'));
		}
	}
</script>

<div class="sim-shell">
	<ConsoleBanner
		subtitle="SOP What-if Simulation"
		title="จำลองสถานการณ์ SOP (SOP What-if Simulation)"
		description="จำลองจำนวนผู้พักพิง ระยะเวลา และเกณฑ์ SOP เพื่อดูทรัพยากรที่ต้องใช้ โดยไม่กระทบข้อมูลรายวัน"
	/>

	<div class="sim-toolbar" aria-label="สถานะการจำลอง">
		<div class="sim-toolbar-status">
			<ShieldCheck class="size-4" />
			<div><strong>โหมดทดลอง</strong><span>ไม่เขียน Daily Calc</span></div>
		</div>
		<div class="sim-toolbar-snapshot">
			<Database class="size-4" />
			{#if currentQuery.isPending}
				<span>กำลังอ่าน Stock และข้อมูลปัจจุบัน…</span>
			{:else if currentQuery.isError || !currentQuery.data}
				<span>อ่าน Stock และข้อมูลปัจจุบันไม่สำเร็จ</span>
			{:else}
				<span
					>Stock และข้อมูลปัจจุบัน ณ {new Date(currentQuery.data.as_of).toLocaleString(
						'th-TH'
					)}</span
				>
			{/if}
		</div>
		<Button type="button" variant="outline" size="sm" onclick={() => (historyOpen = true)}>
			<History class="size-4" /> ผลที่บันทึก
			<span class="sim-count">{savedScenarios.length}</span>
		</Button>
	</div>

	{#if currentQuery.isPending && !canShowWorkspace}
		<div class="sim-state-panel">
			<div class="sim-state-mark"></div>
			<p>กำลังเตรียมข้อมูลปัจจุบัน…</p>
		</div>
	{:else if !canShowWorkspace}
		<div class="sim-state-panel sim-state-panel--error">
			<p class="font-semibold text-destructive">โหลดข้อมูลปัจจุบันไม่สำเร็จ</p>
			<p class="mt-1 text-sm text-muted-foreground">
				กรุณาตรวจสอบ SOP และการเชื่อมต่อ แล้วลองใหม่อีกครั้ง
			</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="mt-3"
				disabled={currentQuery.isFetching}
				onclick={() => currentQuery.refetch()}
			>
				{currentQuery.isFetching ? 'กำลังลองใหม่…' : 'ลองใหม่'}
			</Button>
		</div>
	{:else}
		<div class="sim-bento">
			<section class="sim-card sim-controls" aria-labelledby="scenario-controls-title">
				<div class="sim-card-heading">
					<div>
						<h2 id="scenario-controls-title">ตั้งสถานการณ์</h2>
						<p>Current อ่านอย่างเดียว · Scenario แก้ได้</p>
					</div>
				</div>
				{#if currentQuery.data}<div class="sim-current">
						<Database class="size-5" />
						<div>
							<span>Current baseline</span><strong
								>{currentQuery.data.current_occupancy.toLocaleString('th-TH')} คน</strong
							>
							<small>มีข้อมูล Stock {syncedStockCount}/{totalStockCount} รายการ</small>
						</div>
						<details>
							<summary>รายละเอียด</summary>
							<div>
								สูตร {currentQuery.data.formula_v}<br />ข้อมูล ณ {new Date(
									currentQuery.data.as_of
								).toLocaleString('th-TH')}
							</div>
						</details>
					</div>
					<ScenarioForm
						currentOccupancy={currentQuery.data.current_occupancy}
						currentRatios={currentQuery.data.current_ratios}
						running={runMutation.isPending}
						onRun={run}
						onDirty={() => {
							result = null;
							savedView = false;
						}}
					/>
				{:else}<div class="sim-controls-unavailable">
						<p class="font-semibold text-destructive">ข้อมูลปัจจุบันไม่พร้อมใช้งาน</p>
						<p>ยังเปิดดูผลที่บันทึกไว้ได้ แต่ต้องโหลด baseline สำเร็จก่อนรันสถานการณ์ใหม่</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={currentQuery.isFetching}
							onclick={() => currentQuery.refetch()}
						>
							{currentQuery.isFetching ? 'กำลังลองใหม่…' : 'ลองโหลดข้อมูลปัจจุบันอีกครั้ง'}
						</Button>
					</div>{/if}
			</section>

			<section class="sim-card sim-output" aria-labelledby="simulation-output-title">
				<div class="sim-card-heading">
					<div>
						<h2 id="simulation-output-title">ผลเทียบกับปัจจุบัน</h2>
						<p>Current → Scenario · ใช้ Stock snapshot ชุดเดียวกัน</p>
					</div>
					{#if result && !savedView}<Button
							size="sm"
							onclick={save}
							disabled={saveMutation.isPending}
							><Save class="size-4" />{saveMutation.isPending ? 'กำลังบันทึก…' : 'บันทึกผล'}</Button
						>{:else if result}<span class="sim-readonly-badge">บันทึกแล้ว</span>{/if}
				</div>

				{#if result}
					<div class="sim-result-heading">
						<div>
							<h3>{result.input.name}</h3>
							<p>
								{savedView
									? 'ผลที่บันทึกไว้ · เปิดดูโดยไม่คำนวณใหม่'
									: 'ผลล่าสุด พร้อมบันทึกเพื่อเปิดดูภายหลัง'}
							</p>
						</div>
					</div>
					<ScenarioComparePanel {result} />
				{:else}
					<div class="sim-empty-output">
						<div class="sim-empty-icon"><ArrowRight class="size-5" /></div>
						<div>
							<h3>กรอกข้อมูลแล้วรันสถานการณ์</h3>
							<p>ระบบจะแสดงความต้องการทรัพยากร ระยะเวลาที่รองรับ และส่วนต่างจากของที่มีอยู่</p>
						</div>
					</div>
				{/if}
			</section>
		</div>
	{/if}

	<Dialog.Root bind:open={historyOpen}>
		<Dialog.Content class="history-dialog max-h-[82dvh] overflow-y-auto sm:max-w-3xl">
			<Dialog.Header class="border-b border-border/70 pb-3"
				><Dialog.Title class="flex items-center gap-2 text-lg font-black"
					><History class="size-5 text-primary" />ผลจำลองที่บันทึกไว้</Dialog.Title
				><Dialog.Description
					>เปิดผลเดิมได้ทันที โดยไม่ดึงข้อมูลปัจจุบันหรือคำนวณใหม่</Dialog.Description
				></Dialog.Header
			>
			<SavedScenarioList
				scenarios={savedScenarios}
				loading={scenariosQuery.isPending}
				error={scenariosQuery.isError}
				onRetry={() => scenariosQuery.refetch()}
				loadingMore={scenariosQuery.isFetchingNextPage}
				hasMore={scenariosQuery.hasNextPage}
				onLoadMore={() => scenariosQuery.fetchNextPage()}
				onOpen={openScenario}
				onDelete={deleteScenario}
				deleting={deleteMutation.isPending}
			/>
		</Dialog.Content>
	</Dialog.Root>
</div>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Bento Grid · theme: studied-DNA (SmartShelter Master Data) · nav: inherited · footer: inherited · contrast/responsive: pass */
	/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
	.sim-shell {
		--sim-panel-shadow: 0 1px 3px color-mix(in srgb, var(--foreground) 7%, transparent);
		min-width: 0;
		padding-bottom: 2rem;
	}
	.sim-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: var(--card);
		padding: 0.6rem 0.7rem;
		box-shadow: var(--sim-panel-shadow);
	}
	.sim-toolbar-status,
	.sim-toolbar-snapshot {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.5rem;
	}
	.sim-toolbar-status {
		color: var(--success-dark);
	}
	.sim-toolbar-status > div {
		display: grid;
	}
	.sim-toolbar-status strong {
		font-size: 0.72rem;
	}
	.sim-toolbar-status span,
	.sim-toolbar-snapshot {
		font-size: 0.65rem;
		color: var(--muted-foreground);
	}
	.sim-toolbar-snapshot {
		flex: 1;
		justify-content: center;
	}
	.sim-toolbar-snapshot span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sim-count {
		display: inline-grid;
		min-width: 1.15rem;
		height: 1.15rem;
		place-items: center;
		border-radius: 999px;
		background: var(--background);
		padding-inline: 0.25rem;
		font-size: 0.62rem;
		color: var(--foreground);
	}
	.sim-bento {
		display: grid;
		grid-template-columns: minmax(20rem, 0.78fr) minmax(0, 1.22fr);
		align-items: start;
		gap: 1rem;
		margin-top: 1rem;
	}
	.sim-card {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--card);
		padding: 1.15rem;
		box-shadow: var(--sim-panel-shadow);
	}
	.sim-card-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.85rem;
	}
	.sim-card-heading h2 {
		margin-top: 0.2rem;
		font-size: 1.05rem;
		font-weight: 850;
		letter-spacing: -0.02em;
	}
	.sim-card-heading p {
		margin-top: 0.15rem;
		font-size: 0.72rem;
		color: var(--muted-foreground);
	}
	.sim-current {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.65rem;
		margin: 0.9rem 0 1rem;
		border-radius: 0.65rem;
		background: var(--primary-muted);
		padding: 0.7rem 0.8rem;
		color: var(--primary-dark);
	}
	.sim-current > div {
		display: grid;
	}
	.sim-current span,
	.sim-current summary,
	.sim-current details div {
		font-size: 0.65rem;
		color: var(--muted-foreground);
	}
	.sim-current strong {
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}
	.sim-current small {
		font-size: 0.62rem;
		color: var(--muted-foreground);
	}
	.sim-current details {
		position: relative;
		text-align: right;
	}
	.sim-current summary {
		cursor: pointer;
		font-weight: 750;
	}
	.sim-current details div {
		position: absolute;
		z-index: 5;
		top: calc(100% + 0.4rem);
		right: 0;
		min-width: 13rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--popover);
		padding: 0.55rem;
		color: var(--popover-foreground);
		box-shadow: 0 6px 18px color-mix(in srgb, var(--foreground) 12%, transparent);
	}
	.sim-readonly-badge {
		border-radius: 999px;
		background: var(--success-muted);
		padding: 0.35rem 0.55rem;
		font-size: 0.68rem;
		font-weight: 750;
		color: var(--success-dark);
		white-space: nowrap;
	}
	.sim-result-heading {
		padding: 0.85rem 0 0.7rem;
	}
	.sim-result-heading h3 {
		font-size: 1rem;
		font-weight: 850;
	}
	.sim-result-heading p {
		margin-top: 0.15rem;
		font-size: 0.7rem;
		color: var(--muted-foreground);
	}
	.sim-empty-output {
		display: flex;
		min-height: 20rem;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
		padding: 2rem;
		text-align: left;
	}
	.sim-empty-icon {
		display: grid;
		flex: 0 0 auto;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border-radius: 0.7rem;
		background: var(--primary-muted);
		color: var(--primary);
	}
	.sim-empty-output h3 {
		font-size: 0.95rem;
		font-weight: 800;
	}
	.sim-empty-output p {
		max-width: 26rem;
		margin-top: 0.25rem;
		font-size: 0.75rem;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.sim-state-panel {
		margin-top: 1rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--card);
		padding: 3rem 1rem;
		text-align: center;
		font-size: 0.85rem;
		color: var(--muted-foreground);
	}
	.sim-state-panel--error {
		text-align: left;
	}
	.sim-controls-unavailable {
		display: grid;
		justify-items: start;
		gap: 0.65rem;
		margin-top: 1rem;
		border: 1px solid color-mix(in srgb, var(--destructive) 25%, var(--border));
		border-radius: 0.7rem;
		background: color-mix(in srgb, var(--destructive) 4%, transparent);
		padding: 1rem;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.sim-state-mark {
		width: 2rem;
		height: 2px;
		margin: 0 auto 0.75rem;
		background: var(--primary);
	}
	@media (max-width: 64rem) {
		.sim-bento {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 48rem) {
		.sim-toolbar {
			flex-direction: column;
			align-items: stretch;
		}
		.sim-toolbar-snapshot {
			justify-content: flex-start;
		}
	}
	@media (max-width: 32rem) {
		.sim-toolbar :global(button) {
			width: 100%;
		}
		.sim-card {
			padding: 0.9rem;
		}
		.sim-current {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.sim-current details {
			grid-column: 2;
			text-align: left;
		}
		.sim-current details div {
			right: auto;
			left: 0;
		}
		.sim-empty-output {
			align-items: flex-start;
			min-height: 13rem;
			padding-inline: 0.5rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sim-shell :global(*) {
			scroll-behavior: auto !important;
			transition-duration: 0.01ms !important;
		}
	}
</style>
