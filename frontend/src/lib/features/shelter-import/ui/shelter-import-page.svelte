<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import Activity from '@lucide/svelte/icons/activity';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { useMasterData } from '$lib/features/master-data';
	import { listShelters, sheltersKeys } from '$lib/features/shelters';
	import {
		buildMasterLookup,
		orphanZoneRows,
		validateWorkbook,
		type Lookups,
		type ParsedWorkbook,
		type RowValidation
	} from '../domain/import-row';
	import {
		APP_ONLY_FIELDS,
		MASTER_COLUMNS,
		type EnumChoice,
		type MasterColumn
	} from '../domain/columns';
	import {
		findExistingDuplicates,
		type DuplicateMatch,
		type ExistingShelter
	} from '../domain/duplicates';
	import { buildShelterTemplateBlob, type TemplateMasters } from '../data/template';
	import { parseShelterWorkbook } from '../data/parse';
	import {
		useImportJob,
		useImportShelters,
		useRetryImportJob,
		isImportJobTerminal,
		type DuplicateAction
	} from '../application/queries';
	import ImportPreviewTable from './import-preview-table.svelte';
	import ImportLogHistory from './import-log-history.svelte';
	import ImportProgress from './import-progress.svelte';

	let { basePath }: { basePath?: string } = $props();
	const resolvedBasePath = $derived(basePath ?? resolve('/system-management/shelters'));

	const shelterTypeQuery = useMasterData(() => 'shelter_type');

	const activeItems = $derived<Record<MasterColumn, { code: string; label: string }[]>>({
		shelter_type: (shelterTypeQuery.data?.items ?? []).filter((i) => i.status === 'active')
	});

	const masterDataLoading = $derived(shelterTypeQuery.isLoading);

	const lookups = $derived(
		Object.fromEntries(MASTER_COLUMNS.map((t) => [t, buildMasterLookup(activeItems[t])])) as Lookups
	);

	let workbook = $state<ParsedWorkbook>({ shelters: [], zones: [] });
	let filename = $state('');
	let parsing = $state(false);

	const validations = $derived<RowValidation[]>(
		workbook.shelters.length ? validateWorkbook(workbook, lookups) : []
	);
	const validCount = $derived(validations.filter((v) => v.ok).length);
	const errorCount = $derived(validations.length - validCount);
	const orphanZones = $derived(workbook.shelters.length ? orphanZoneRows(workbook) : []);
	const zoneCount = $derived(workbook.zones.length);

	let existingShelters = $state<ExistingShelter[]>([]);
	let duplicateCheckReady = $state(false);
	let duplicateCheckLoading = $state(false);
	const duplicates = $derived(
		workbook.shelters.length
			? findExistingDuplicates(validations, existingShelters)
			: new Map<number, DuplicateMatch>()
	);
	const dupCount = $derived(validations.filter((v) => v.ok && duplicates.has(v.row)).length);
	const newCount = $derived(validCount - dupCount);

	let duplicateAction = $state<DuplicateAction>('skip');

	const importMutation = useImportShelters();
	const retryMutation = useRetryImportJob();
	const queryClient = useQueryClient();
	let activeJobId = $state<string | null>(null);
	const activeJobQuery = useImportJob(() => activeJobId);
	const activeJob = $derived(activeJobQuery.data);
	const jobRunning = $derived(
		Boolean(activeJob && !isImportJobTerminal(activeJob.job.status)) || importMutation.isPending
	);
	let progressDialogOpen = $state(false);
	let importSubmitted = $state(false);
	let restoreDialogHandled = $state(false);
	let invalidatedJobId = $state<string | null>(null);

	onMount(() => {
		activeJobId = sessionStorage.getItem('shelter-import-active-job');
		if (!activeJobId) restoreDialogHandled = true;
	});

	$effect(() => {
		const job = activeJobQuery.data?.job;
		if (!job || restoreDialogHandled) return;
		restoreDialogHandled = true;
		if (!isImportJobTerminal(job.status)) progressDialogOpen = true;
	});

	$effect(() => {
		const job = activeJobQuery.data?.job;
		if (!job || !isImportJobTerminal(job.status) || invalidatedJobId === job._id) return;
		invalidatedJobId = job._id;
		queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
		queryClient.invalidateQueries({ queryKey: ['shelter-import', 'logs'] });
	});

	async function refreshExistingShelters(): Promise<ExistingShelter[] | null> {
		duplicateCheckLoading = true;
		duplicateCheckReady = false;
		try {
			const shelters = await listShelters({ cache: 'no-store' });
			existingShelters = shelters.map((s) => ({ code: s.code, name: s.name }));
			duplicateCheckReady = true;
			return existingShelters;
		} catch {
			existingShelters = [];
			toast.error('ตรวจสอบศูนย์พักพิงในระบบไม่สำเร็จ — กรุณาลองใหม่');
			return null;
		} finally {
			duplicateCheckLoading = false;
		}
	}

	async function downloadTemplate(withSample: boolean) {
		try {
			const masters = Object.fromEntries(
				MASTER_COLUMNS.map((t) => [
					t,
					activeItems[t].map((i): EnumChoice => ({ value: i.code, label: i.label }))
				])
			) as TemplateMasters;
			const blob = await buildShelterTemplateBlob(masters, { withSample });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = withSample
				? 'shelter-import-template-sample.xlsx'
				: 'shelter-import-template.xlsx';
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			toast.error('สร้างไฟล์ template ไม่สำเร็จ');
		}
	}

	async function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		parsing = true;
		try {
			const parsed = await parseShelterWorkbook(file);
			workbook = parsed;
			filename = file.name;
			importSubmitted = false;
			if (workbook.shelters.length === 0) toast.warning('ไม่พบข้อมูลในไฟล์');
			else await refreshExistingShelters();
		} catch {
			toast.error('อ่านไฟล์ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ .xlsx ที่ถูกต้อง');
			workbook = { shelters: [], zones: [] };
			filename = '';
			existingShelters = [];
			duplicateCheckReady = false;
			importSubmitted = false;
		} finally {
			parsing = false;
			input.value = '';
		}
	}

	function clearFile() {
		workbook = { shelters: [], zones: [] };
		filename = '';
		existingShelters = [];
		duplicateCheckReady = false;
		importSubmitted = false;
	}

	const importDisabled = $derived(
		!duplicateCheckReady ||
			duplicateCheckLoading ||
			jobRunning ||
			(newCount === 0 && !(duplicateAction === 'update' && dupCount > 0))
	);

	const importLabel = $derived(
		dupCount === 0
			? `นำเข้า ${validCount} ศูนย์`
			: duplicateAction === 'update'
				? `นำเข้า ${newCount} ศูนย์ (อัปเดต ${dupCount})`
				: `นำเข้า ${newCount} ศูนย์ (ข้าม ${dupCount})`
	);

	async function runImport() {
		if (importDisabled) return;
		if (!(await refreshExistingShelters())) return;
		importSubmitted = true;
		importMutation.mutate(
			{
				filename,
				rows: validations,
				duplicateAction
			},
			{
				onSuccess: (result) => {
					activeJobId = result.jobId;
					sessionStorage.setItem('shelter-import-active-job', result.jobId);
					progressDialogOpen = true;
				},
				onError: () => {
					importSubmitted = false;
				}
			}
		);
	}

	function retryFailed() {
		if (activeJobId) retryMutation.mutate(activeJobId);
	}

	const hasRetryableFailures = $derived(
		Boolean(
			activeJob?.job.status === 'completed_with_errors' &&
			activeJob?.items.some(
				(item) => item.status === 'failed' && item.attempts < (item.max_attempts ?? 3)
			)
		)
	);
</script>

<div class="flex w-full flex-1 flex-col gap-6 bg-[#F8FAFC] p-4 sm:p-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-extrabold tracking-tight text-[#0A2647]">
				นำเข้าศูนย์พักพิงจาก Excel
			</h1>
			<p class="mt-2 text-base text-slate-700">
				ดาวน์โหลด template กรอกข้อมูล แล้วอัปโหลดเพื่อสร้างศูนย์พักพิงหลายแห่งพร้อมกัน
			</p>
			<p class="mt-1 text-sm text-slate-500">
				{APP_ONLY_FIELDS.join(' · ')} ไม่มีในไฟล์ — ตั้งค่าในหน้าแก้ไขศูนย์พักพิงหลังนำเข้าเสร็จ
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if activeJobId}
				<Button variant="outline" onclick={() => (progressDialogOpen = true)}>
					<Activity class="mr-2 h-4 w-4" aria-hidden="true" />
					ดูความคืบหน้างานล่าสุด
				</Button>
			{/if}
			<Button
				variant="outline"
				onclick={() => downloadTemplate(false)}
				disabled={masterDataLoading}
			>
				<Download class="mr-2 h-4 w-4" /> ดาวน์โหลด Template
			</Button>
			<Button variant="outline" onclick={() => downloadTemplate(true)} disabled={masterDataLoading}>
				<Download class="mr-2 h-4 w-4" /> Template + ตัวอย่างข้อมูล
			</Button>
		</div>
	</div>

	<!-- Upload -->
	<div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs md:p-6">
		{#if filename}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex items-center gap-2 text-sm">
					<FileSpreadsheet class="h-5 w-5 text-muted-foreground" />
					<span class="font-medium">{filename}</span>
					<span class="text-muted-foreground">
						· {validations.length} ศูนย์ · {zoneCount} โซน · พร้อมนำเข้า {validCount} · ผิดพลาด {errorCount}{dupCount >
						0
							? ` · ชื่อซ้ำ ${dupCount}`
							: ''}
					</span>
				</div>
				<Button variant="ghost" size="sm" onclick={clearFile} disabled={jobRunning}>
					<X class="mr-1 h-4 w-4" /> ล้างไฟล์
				</Button>
			</div>
		{:else if masterDataLoading}
			<p class="py-10 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลตั้งต้น...</p>
		{:else}
			<label
				class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 hover:bg-muted/40"
			>
				<Upload class="h-8 w-8 text-muted-foreground" />
				<span class="text-sm font-medium">{parsing ? 'กำลังอ่านไฟล์...' : 'เลือกไฟล์ .xlsx'}</span>
				<span class="text-xs text-muted-foreground">
					กรอกข้อมูลตาม template — คอลัมน์ที่ไฮไลต์คือช่องที่จำเป็น
				</span>
				<!-- sr-only, not `hidden`: display:none drops the input out of the tab
				     order, leaving keyboard users no way to open the file picker. -->
				<input
					type="file"
					accept=".xlsx"
					class="sr-only"
					disabled={parsing || jobRunning}
					onchange={onFileChange}
				/>
			</label>
		{/if}
	</div>

	<!-- Preview + commit -->
	{#if validations.length > 0 && !importMutation.isPending && !importSubmitted}
		<div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs md:p-6">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h3 class="text-lg font-semibold text-foreground">ตรวจสอบข้อมูลก่อนนำเข้า</h3>
				<Button onclick={runImport} disabled={importDisabled}>
					<Upload class="mr-2 h-4 w-4" />
					{importMutation.isPending ? 'กำลังสร้างงาน...' : importLabel}
				</Button>
			</div>
			{#if errorCount > 0}
				<p class="mb-3 text-sm text-destructive">
					มี {errorCount} แถวที่มีข้อผิดพลาด — ระบบจะข้ามแถวเหล่านี้และนำเข้าเฉพาะแถวที่พร้อม
				</p>
			{/if}
			{#if orphanZones.length > 0}
				<p class="mb-3 text-sm text-amber-600">
					ชีต "โซน" มี {orphanZones.length} แถวที่ "รหัสศูนย์พักพิง" ไม่ตรงกับศูนย์ใดเลย (แถวที่
					{orphanZones.map((z) => z.line).join(', ')}) — แถวเหล่านี้จะไม่ถูกนำเข้า
				</p>
			{/if}
			{#if duplicates.size > 0}
				<div class="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
					<p class="text-sm text-amber-600">
						พบ {duplicates.size} ศูนย์ที่ชื่อซ้ำกับในระบบ
					</p>
					<ul class="mt-2 space-y-1 text-sm text-amber-700">
						{#each [...duplicates.values()] as dup (dup.existingCode + dup.row)}
							<li>{dup.name} → {dup.existingCode}</li>
						{/each}
					</ul>
					<RadioGroup.Root
						value={duplicateAction}
						onValueChange={(value) => {
							if (value === 'skip' || value === 'update') duplicateAction = value;
						}}
						class="mt-3 gap-2"
					>
						<label for="duplicate-action-skip" class="flex items-center gap-3 text-sm">
							<RadioGroup.Item value="skip" id="duplicate-action-skip" />
							<span>ข้ามศูนย์ที่ซ้ำ (ไม่แก้ไขข้อมูลเดิม)</span>
						</label>
						<label for="duplicate-action-update" class="flex items-center gap-3 text-sm">
							<RadioGroup.Item value="update" id="duplicate-action-update" />
							<span>อัปเดตข้อมูลเดิมทับด้วยค่าจากไฟล์</span>
						</label>
					</RadioGroup.Root>
					{#if duplicateAction === 'update'}
						<p class="mt-2 text-sm text-amber-700">
							คำเตือน: ข้อมูลศูนย์ที่มีอยู่เดิมจะถูกเขียนทับด้วยค่าจากไฟล์นี้ทั้งหมด
						</p>
					{/if}
				</div>
			{/if}
			<ImportPreviewTable {validations} {duplicates} {duplicateAction} />
		</div>
	{/if}

	<!-- History -->
	<div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs md:p-6">
		<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
			<div>
				<h2 class="text-2xl font-bold tracking-tight text-slate-900">ประวัติการนำเข้า</h2>
				<p class="mt-1 text-sm text-slate-500">ติดตามสถานะงานและเปิดดูผลลัพธ์รายศูนย์เมื่อจำเป็น</p>
			</div>
		</div>
		<ImportLogHistory
			basePath={resolvedBasePath}
			{activeJob}
			onprogress={() => (progressDialogOpen = true)}
		/>
	</div>

	{#if activeJobId}
		<Dialog.Root bind:open={progressDialogOpen}>
			<Dialog.Content class="max-h-[90vh] overflow-y-auto shadow-md sm:max-w-5xl">
				<Dialog.Header>
					<Dialog.Title class="text-xl font-bold text-slate-900">ความคืบหน้าการนำเข้า</Dialog.Title>
					<Dialog.Description>
						ติดตามการประมวลผลทีละศูนย์และส่งรายการที่ล้มเหลวกลับเข้าคิวได้จากหน้านี้
					</Dialog.Description>
				</Dialog.Header>

				{#if activeJob}
					<ImportProgress
						data={activeJob}
						retrying={retryMutation.isPending}
						onretry={hasRetryableFailures ? retryFailed : undefined}
					/>
				{:else if activeJobQuery.isLoading}
					<div
						class="rounded-xl border border-slate-200/80 bg-slate-50 p-8 text-center text-sm text-slate-600"
					>
						กำลังโหลดสถานะงานล่าสุด...
					</div>
				{:else}
					<div
						class="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-900"
					>
						ไม่พบข้อมูลงานนำเข้านี้แล้ว
					</div>
				{/if}

				<Dialog.Footer>
					<Button variant="outline" onclick={() => (progressDialogOpen = false)}>ปิดหน้าต่าง</Button
					>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}
</div>
