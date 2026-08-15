<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useMasterData } from '$lib/features/master-data';
	import { useShelters } from '$lib/features/shelters';
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
	import { findExistingDuplicates, type DuplicateMatch } from '../domain/duplicates';
	import { buildShelterTemplateBlob, type TemplateMasters } from '../data/template';
	import { parseShelterWorkbook } from '../data/parse';
	import { useImportShelters, type DuplicateAction } from '../application/queries';
	import ImportPreviewTable from './import-preview-table.svelte';
	import ImportLogHistory from './import-log-history.svelte';

	let { basePath }: { basePath?: string } = $props();
	const resolvedBasePath = $derived(basePath ?? resolve('/portal/system-management/shelters'));

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

	const sheltersQuery = useShelters();
	const existingShelters = $derived(
		(sheltersQuery.data ?? []).map((s) => ({ code: s.code, name: s.name }))
	);
	const duplicates = $derived(
		workbook.shelters.length
			? findExistingDuplicates(validations, existingShelters)
			: new Map<number, DuplicateMatch>()
	);
	const dupCount = $derived(validations.filter((v) => v.ok && duplicates.has(v.row)).length);
	const newCount = $derived(validCount - dupCount);

	let duplicateAction = $state<DuplicateAction>('skip');

	const importMutation = useImportShelters();

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
			workbook = await parseShelterWorkbook(file);
			filename = file.name;
			if (workbook.shelters.length === 0) toast.warning('ไม่พบข้อมูลในไฟล์');
		} catch {
			toast.error('อ่านไฟล์ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ .xlsx ที่ถูกต้อง');
			workbook = { shelters: [], zones: [] };
			filename = '';
		} finally {
			parsing = false;
			input.value = '';
		}
	}

	function clearFile() {
		workbook = { shelters: [], zones: [] };
		filename = '';
	}

	const importDisabled = $derived(
		newCount === 0 && !(duplicateAction === 'update' && dupCount > 0)
	);

	const importLabel = $derived(
		dupCount === 0
			? `นำเข้า ${validCount} ศูนย์`
			: duplicateAction === 'update'
				? `นำเข้า ${newCount} ศูนย์ (อัปเดต ${dupCount})`
				: `นำเข้า ${newCount} ศูนย์ (ข้าม ${dupCount})`
	);

	function runImport() {
		if (importDisabled) return;
		importMutation.mutate(
			{
				filename,
				importedBy: authStore.user?.name ?? 'unknown',
				rows: validations,
				duplicates,
				duplicateAction
			},
			{ onSuccess: () => clearFile() }
		);
	}
</script>

<div class="flex w-full flex-1 flex-col gap-6 p-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h2 class="text-2xl font-bold tracking-tight text-foreground">นำเข้าศูนย์พักพิงจาก Excel</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				ดาวน์โหลด template กรอกข้อมูล แล้วอัปโหลดเพื่อสร้างศูนย์พักพิงหลายแห่งพร้อมกัน
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				{APP_ONLY_FIELDS.join(' · ')} ไม่มีในไฟล์ — ตั้งค่าในหน้าแก้ไขศูนย์พักพิงหลังนำเข้าเสร็จ
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
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
	<div class="rounded-2xl border border-shelter-border bg-card p-4 shadow-sm md:p-6">
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
				<Button variant="ghost" size="sm" onclick={clearFile}>
					<X class="mr-1 h-4 w-4" /> ล้างไฟล์
				</Button>
			</div>
		{:else if masterDataLoading}
			<p class="py-10 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลตั้งต้น...</p>
		{:else}
			<label
				class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors hover:bg-muted/40"
			>
				<Upload class="h-8 w-8 text-muted-foreground" />
				<span class="text-sm font-medium">{parsing ? 'กำลังอ่านไฟล์...' : 'เลือกไฟล์ .xlsx'}</span>
				<span class="text-xs text-muted-foreground">
					กรอกข้อมูลตาม template — คอลัมน์ที่ไฮไลต์คือช่องที่จำเป็น
				</span>
				<input
					type="file"
					accept=".xlsx"
					class="hidden"
					disabled={parsing}
					onchange={onFileChange}
				/>
			</label>
		{/if}
	</div>

	<!-- Preview + commit -->
	{#if validations.length > 0}
		<div class="rounded-2xl border border-shelter-border bg-card p-4 shadow-sm md:p-6">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h3 class="text-lg font-semibold text-foreground">ตรวจสอบข้อมูลก่อนนำเข้า</h3>
				<Button onclick={runImport} disabled={importDisabled || importMutation.isPending}>
					<Upload class="mr-2 h-4 w-4" />
					{importMutation.isPending ? 'กำลังนำเข้า...' : importLabel}
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
					<div class="mt-3 space-y-2">
						<label class="flex items-center space-x-3 text-sm">
							<input
								type="radio"
								name="duplicate-action"
								value="skip"
								checked={duplicateAction === 'skip'}
								onchange={() => (duplicateAction = 'skip')}
								class="h-4 w-4 accent-shelter-blue-text"
							/>
							<span>ข้ามศูนย์ที่ซ้ำ (ไม่แก้ไขข้อมูลเดิม)</span>
						</label>
						<label class="flex items-center space-x-3 text-sm">
							<input
								type="radio"
								name="duplicate-action"
								value="update"
								checked={duplicateAction === 'update'}
								onchange={() => (duplicateAction = 'update')}
								class="h-4 w-4 accent-shelter-blue-text"
							/>
							<span>อัปเดตข้อมูลเดิมทับด้วยค่าจากไฟล์</span>
						</label>
					</div>
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
	<div class="rounded-2xl border border-shelter-border bg-card p-4 shadow-sm md:p-6">
		<h3 class="mb-4 text-lg font-semibold text-foreground">ประวัติการนำเข้า</h3>
		<ImportLogHistory basePath={resolvedBasePath} />
	</div>
</div>
