<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useMasterData } from '$lib/features/master-data';
	import {
		buildMasterLookup,
		validateRows,
		type Lookups,
		type RawRow,
		type RowValidation
	} from '../domain/import-row';
	import type { EnumChoice } from '../domain/columns';
	import { buildShelterTemplateBlob, type TemplateMasters } from '../data/template';
	import { parseShelterWorkbook } from '../data/parse';
	import { useImportShelters } from '../application/queries';
	import ImportPreviewTable from './import-preview-table.svelte';
	import ImportLogHistory from './import-log-history.svelte';

	const zoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');
	const zoneItems = $derived(zoneQuery.data?.items ?? []);
	const communityItems = $derived(communityQuery.data?.items ?? []);

	const lookups = $derived<Lookups>({
		municipality_zone: buildMasterLookup(zoneItems),
		community: buildMasterLookup(communityItems)
	});

	let rawRows = $state<RawRow[]>([]);
	let filename = $state('');
	let parsing = $state(false);

	const validations = $derived<RowValidation[]>(
		rawRows.length ? validateRows(rawRows, lookups) : []
	);
	const validCount = $derived(validations.filter((v) => v.ok).length);
	const errorCount = $derived(validations.length - validCount);

	const importMutation = useImportShelters();

	async function downloadTemplate() {
		try {
			const masters: TemplateMasters = {
				municipality_zone: zoneItems.map((i): EnumChoice => ({ value: i.code, label: i.label })),
				community: communityItems.map((i): EnumChoice => ({ value: i.code, label: i.label }))
			};
			const blob = await buildShelterTemplateBlob(masters);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'shelter-import-template.xlsx';
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
			rawRows = await parseShelterWorkbook(file);
			filename = file.name;
			if (rawRows.length === 0) toast.warning('ไม่พบข้อมูลในไฟล์');
		} catch {
			toast.error('อ่านไฟล์ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ .xlsx ที่ถูกต้อง');
			rawRows = [];
			filename = '';
		} finally {
			parsing = false;
			input.value = '';
		}
	}

	function clearFile() {
		rawRows = [];
		filename = '';
	}

	function runImport() {
		if (validCount === 0) return;
		importMutation.mutate(
			{ filename, importedBy: authStore.user?.name ?? 'unknown', rows: validations },
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
		</div>
		<Button variant="outline" onclick={downloadTemplate}>
			<Download class="mr-2 h-4 w-4" /> ดาวน์โหลด Template
		</Button>
	</div>

	<!-- Upload -->
	<div class="rounded-2xl border border-shelter-border bg-card p-4 shadow-sm md:p-6">
		{#if filename}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex items-center gap-2 text-sm">
					<FileSpreadsheet class="h-5 w-5 text-muted-foreground" />
					<span class="font-medium">{filename}</span>
					<span class="text-muted-foreground">
						· {validations.length} แถว · พร้อมนำเข้า {validCount} · ผิดพลาด {errorCount}
					</span>
				</div>
				<Button variant="ghost" size="sm" onclick={clearFile}>
					<X class="mr-1 h-4 w-4" /> ล้างไฟล์
				</Button>
			</div>
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
				<Button onclick={runImport} disabled={validCount === 0 || importMutation.isPending}>
					<Upload class="mr-2 h-4 w-4" />
					{importMutation.isPending ? 'กำลังนำเข้า...' : `นำเข้า ${validCount} ศูนย์`}
				</Button>
			</div>
			{#if errorCount > 0}
				<p class="mb-3 text-sm text-destructive">
					มี {errorCount} แถวที่มีข้อผิดพลาด — ระบบจะข้ามแถวเหล่านี้และนำเข้าเฉพาะแถวที่พร้อม
				</p>
			{/if}
			<ImportPreviewTable {validations} />
		</div>
	{/if}

	<!-- History -->
	<div class="rounded-2xl border border-shelter-border bg-card p-4 shadow-sm md:p-6">
		<h3 class="mb-4 text-lg font-semibold text-foreground">ประวัติการนำเข้า</h3>
		<ImportLogHistory />
	</div>
</div>
