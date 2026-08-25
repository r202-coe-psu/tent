<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useMasterData } from '$lib/features/master-data';
	import { useEvacuees } from '$lib/features/people';
	import {
		buildMasterLookup,
		orphanMemberRows,
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
	import {
		buildPeopleCsvTemplateBlob,
		buildPeopleTemplateBlob,
		type TemplateMasters
	} from '../data/template';
	import { parsePeopleWorkbook } from '../data/parse';
	import { useImportPeople } from '../application/queries';
	import ImportPreviewTable from './import-preview-table.svelte';
	import ImportLogHistory from './import-log-history.svelte';

	const shelterCode = $derived(getShelterCode());

	const municipalityZoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');

	const activeItems = $derived<Record<MasterColumn, { code: string; label: string }[]>>({
		municipality_zone: (municipalityZoneQuery.data?.items ?? []).filter(
			(i) => i.status === 'active'
		),
		community: (communityQuery.data?.items ?? []).filter((i) => i.status === 'active')
	});

	const masterDataLoading = $derived(municipalityZoneQuery.isLoading || communityQuery.isLoading);

	const lookups = $derived(
		Object.fromEntries(MASTER_COLUMNS.map((t) => [t, buildMasterLookup(activeItems[t])])) as Lookups
	);

	let workbook = $state<ParsedWorkbook>({ households: [], members: [] });
	let filename = $state('');
	let parsing = $state(false);

	const validations = $derived<RowValidation[]>(
		workbook.households.length ? validateWorkbook(workbook, lookups) : []
	);
	const validCount = $derived(validations.filter((v) => v.ok).length);
	const errorCount = $derived(validations.length - validCount);
	const orphanMembers = $derived(workbook.households.length ? orphanMemberRows(workbook) : []);
	const memberCount = $derived(workbook.members.length);

	// Duplicate detection needs everyone already registered in this shelter.
	const evacueesQuery = useEvacuees();
	// Until that list is in, every row would look new — importing then would
	// silently create a second record for someone already registered.
	const duplicatesReady = $derived(!evacueesQuery.isLoading && !evacueesQuery.isError);
	const duplicates = $derived(
		workbook.households.length
			? findExistingDuplicates(validations, evacueesQuery.data ?? [])
			: new Map<number, DuplicateMatch>()
	);
	const skippedHouseholds = $derived(
		validations.filter((v) => v.ok && duplicates.get(v.row)?.head).length
	);
	const skippedMembers = $derived(
		[...duplicates.values()].reduce((sum, d) => sum + (d.head ? 0 : d.members.length), 0)
	);
	const importableHouseholds = $derived(validCount - skippedHouseholds);
	const importablePeople = $derived(
		validations
			.filter((v) => v.ok && !duplicates.get(v.row)?.head)
			.reduce((sum, v) => sum + 1 + v.memberCount, 0) - skippedMembers
	);

	const importMutation = useImportPeople();

	function templateMasters(): TemplateMasters {
		return Object.fromEntries(
			MASTER_COLUMNS.map((t) => [
				t,
				activeItems[t].map((i): EnumChoice => ({ value: i.code, label: i.label }))
			])
		) as TemplateMasters;
	}

	function download(blob: Blob, name: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function downloadTemplate(withSample: boolean) {
		try {
			download(
				await buildPeopleTemplateBlob(templateMasters(), { withSample }),
				withSample ? 'people-import-template-sample.xlsx' : 'people-import-template.xlsx'
			);
		} catch {
			toast.error('สร้างไฟล์ template ไม่สำเร็จ');
		}
	}

	function downloadCsvTemplate() {
		try {
			download(
				buildPeopleCsvTemplateBlob(templateMasters(), { withSample: true }),
				'people-import-template.csv'
			);
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
			workbook = await parsePeopleWorkbook(file);
			filename = file.name;
			if (workbook.households.length === 0) toast.warning('ไม่พบข้อมูลในไฟล์');
		} catch {
			toast.error('อ่านไฟล์ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ .xlsx หรือ .csv ที่ถูกต้อง');
			workbook = { households: [], members: [] };
			filename = '';
		} finally {
			parsing = false;
			input.value = '';
		}
	}

	function clearFile() {
		workbook = { households: [], members: [] };
		filename = '';
	}

	const importDisabled = $derived(importableHouseholds === 0 || !duplicatesReady);

	function runImport() {
		if (importDisabled) return;
		importMutation.mutate(
			{
				filename,
				ctx: { shelterCode, createdBy: authStore.user?.name ?? 'unknown' },
				rows: validations,
				duplicates
			},
			{ onSuccess: () => clearFile() }
		);
	}
</script>

<div class="flex w-full flex-1 flex-col gap-6 p-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h2 class="text-2xl font-bold tracking-tight text-foreground">นำเข้าผู้ประสบภัยจาก Excel</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				ดาวน์โหลด template กรอกข้อมูล แล้วอัปโหลดเพื่อลงทะเบียนล่วงหน้าหลายครัวเรือนพร้อมกัน
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				ทุกแถวจะเข้าศูนย์ <span class="font-medium text-foreground">{shelterCode}</span>
				ที่เปิดอยู่ตอนนี้ และได้สถานะ "ลงทะเบียนล่วงหน้า" — {APP_ONLY_FIELDS.join(' · ')} ตั้งค่าในระบบหลังนำเข้าเสร็จ
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
			<Button variant="outline" onclick={downloadCsvTemplate} disabled={masterDataLoading}>
				<Download class="mr-2 h-4 w-4" /> Template (CSV)
			</Button>
		</div>
	</div>

	<!-- Upload -->
	<div class="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
		{#if filename}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex items-center gap-2 text-sm">
					<FileSpreadsheet class="h-5 w-5 text-muted-foreground" />
					<span class="font-medium">{filename}</span>
					<span class="text-muted-foreground">
						· {validations.length} ครัวเรือน · สมาชิก {memberCount} คน · พร้อมนำเข้า {validCount} · ผิดพลาด
						{errorCount}{skippedHouseholds > 0 ? ` · ซ้ำ ${skippedHouseholds}` : ''}
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
				class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 hover:bg-muted/40"
			>
				<Upload class="h-8 w-8 text-muted-foreground" />
				<span class="text-sm font-medium">
					{parsing ? 'กำลังอ่านไฟล์...' : 'เลือกไฟล์ .xlsx หรือ .csv'}
				</span>
				<span class="text-xs text-muted-foreground">
					กรอกข้อมูลตาม template — คอลัมน์ที่ไฮไลต์คือช่องที่จำเป็น
				</span>
				<!-- sr-only, not `hidden`: display:none drops the input out of the tab
				     order, leaving keyboard users no way to open the file picker. -->
				<input
					type="file"
					accept=".xlsx,.csv"
					class="sr-only"
					disabled={parsing}
					onchange={onFileChange}
				/>
			</label>
		{/if}
	</div>

	<!-- Preview + commit -->
	{#if validations.length > 0}
		<div class="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h3 class="text-lg font-semibold text-foreground">ตรวจสอบข้อมูลก่อนนำเข้า</h3>
				<Button onclick={runImport} disabled={importDisabled || importMutation.isPending}>
					<Upload class="mr-2 h-4 w-4" />
					{importMutation.isPending
						? 'กำลังนำเข้า...'
						: `นำเข้า ${importableHouseholds} ครัวเรือน (${importablePeople} คน)`}
				</Button>
			</div>
			{#if !duplicatesReady}
				<p class="mb-3 text-sm text-muted-foreground">
					{evacueesQuery.isError
						? 'อ่านรายชื่อผู้ประสบภัยเดิมไม่สำเร็จ — ยังนำเข้าไม่ได้เพราะตรวจสอบรายชื่อซ้ำไม่ได้'
						: 'กำลังตรวจสอบรายชื่อซ้ำกับผู้ประสบภัยที่ลงทะเบียนไว้แล้ว...'}
				</p>
			{/if}
			{#if errorCount > 0}
				<p class="mb-3 text-sm text-destructive">
					มี {errorCount} ครัวเรือนที่มีข้อผิดพลาด — ระบบจะข้ามแถวเหล่านี้และนำเข้าเฉพาะแถวที่พร้อม
				</p>
			{/if}
			{#if orphanMembers.length > 0}
				<p class="mb-3 text-sm text-amber-600">
					ชีต "สมาชิก" มี {orphanMembers.length} แถวที่ "ลำดับที่ครัวเรือน" ไม่ตรงกับครัวเรือนใดเลย (แถวที่
					{orphanMembers.map((m) => m.line).join(', ')}) — แถวเหล่านี้จะไม่ถูกนำเข้า
				</p>
			{/if}
			{#if duplicates.size > 0}
				<div class="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
					<p class="text-sm text-amber-600">
						พบคนที่ลงทะเบียนในศูนย์นี้อยู่แล้ว — จะข้ามคนเหล่านี้ ไม่เขียนทับข้อมูลเดิม
						{#if skippedHouseholds > 0}
							(ครัวเรือนที่หัวหน้าซ้ำจะถูกข้ามทั้งครัวเรือน)
						{/if}
					</p>
					<ul class="mt-2 space-y-1 text-sm text-amber-700">
						{#each [...duplicates.values()] as dup (dup.row)}
							<li>
								แถวที่ {dup.row}:
								{#if dup.head}
									หัวหน้าครัวเรือน "{dup.head.name}" มีอยู่แล้ว
								{:else}
									{dup.members.map((m) => m.name).join(', ')}
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			<ImportPreviewTable {validations} {duplicates} />
		</div>
	{/if}

	<!-- History -->
	<div class="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
		<h3 class="mb-4 text-lg font-semibold text-foreground">ประวัติการนำเข้า</h3>
		<ImportLogHistory />
	</div>
</div>
