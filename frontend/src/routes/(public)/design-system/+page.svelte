<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Users from '@lucide/svelte/icons/users';
	import Package from '@lucide/svelte/icons/package';
	import Compass from '@lucide/svelte/icons/compass';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Terminal from '@lucide/svelte/icons/terminal';
	import Eye from '@lucide/svelte/icons/eye';
	import Code from '@lucide/svelte/icons/code';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import Bell from '@lucide/svelte/icons/bell';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Phone from '@lucide/svelte/icons/phone';
	import Home from '@lucide/svelte/icons/home';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import Bed from '@lucide/svelte/icons/bed';
	import Baby from '@lucide/svelte/icons/baby';
	import Dog from '@lucide/svelte/icons/dog';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Tag from '@lucide/svelte/icons/tag';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Filter from '@lucide/svelte/icons/filter';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Layers from '@lucide/svelte/icons/layers';
	import Palette from '@lucide/svelte/icons/palette';
	import Type from '@lucide/svelte/icons/type';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Radio from '@lucide/svelte/icons/radio';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Ruler from '@lucide/svelte/icons/ruler';
	import Box from '@lucide/svelte/icons/box';
	import Sun from '@lucide/svelte/icons/sun';
	import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Tablet from '@lucide/svelte/icons/tablet';
	import Laptop from '@lucide/svelte/icons/laptop';
	import Monitor from '@lucide/svelte/icons/monitor';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Accessibility from '@lucide/svelte/icons/accessibility';
	import CommandIcon from '@lucide/svelte/icons/command';
	import Database from '@lucide/svelte/icons/database';
	import AlertOctagon from '@lucide/svelte/icons/alert-octagon';
	import Search from '@lucide/svelte/icons/search';
	import MapPin from '@lucide/svelte/icons/map-pin';

	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import { DatePicker } from '$lib/components/ui/date-picker/index.js';
	import { toast } from 'svelte-sonner';
	import CivicCommandPalette from '$lib/components/CivicCommandPalette.svelte';
	// Page State
	let activeTab = $state<'components' | 'prompt-guide'>('components');
	let copiedKey = $state<string | null>(null);
	let responsivePreviewMode = $state<'mobile' | 'tablet-portrait' | 'tablet-landscape' | 'desktop'>(
		'tablet-portrait'
	);

	// Section Code View Toggles
	let showCode = $state<Record<string, boolean>>({
		spatial: false,
		a11y: false,
		uistates: false,
		responsive: false,
		motion: false,
		colors: false,
		typography: false,
		telemetry: false,
		forms: false,
		badges: false,
		alerts: false,
		tables: false,
		dialogs: false,
		navigation: false,
		commandPalette: false,
		syncIndicators: false
	});

	// Interactive Demo States
	let faqOpenItem = $state<number | null>(1);
	let sampleName = $state('สมชาย ใจดี');
	let sampleCid = $state('1-5099-00123-45-6');
	let sampleErrorInput = $state('REF-ERR-999');
	let sampleZone = $state('zone-a');
	let sampleDate = $state('2026-09-05');
	let sampleFacility = $state('fac-1');
	let sampleNote = $state('');
	let isEmergencyMode = $state(true);
	let isOfflineMode = $state(false);
	let needSpecialCare = $state(true);
	let isDialogOpen = $state(false);
	let isLoadingDemo = $state(false);

	const zoneOptions = [
		{ value: 'zone-a', label: 'อาคาร 1 - โซน A (กลุ่มทั่วไป)' },
		{ value: 'zone-b', label: 'อาคาร 2 - โซน B (กลุ่มเปราะบาง/ติดเตียง)' },
		{ value: 'zone-c', label: 'อาคาร 3 - โซน C (ครอบครัวมีเด็กเล็ก)' },
		{ value: 'zone-p', label: 'อาคาร 4 - โซน Pet (มีสัตว์เลี้ยง)' }
	];

	const facilityItems = [
		{ value: 'fac-1', label: 'โรงเรียนเทศบาล 1 (ศูนย์หลัก)' },
		{ value: 'fac-2', label: 'สนามกีฬาเทศบาลนคร (จุดพักคอย)' },
		{ value: 'fac-3', label: 'หอประชุมอำเภอเมือง (ศูนย์สำรอง)' }
	];

	// New Feature States
	let isCommandPaletteOpen = $state(false);
	let syncState = $state<'online' | 'syncing' | 'offline' | 'conflict'>('online');
	let unsyncedRecords = $state(3);

	function triggerLoadingDemo() {
		isLoadingDemo = true;
		setTimeout(() => (isLoadingDemo = false), 2000);
	}

	function toggleCode(section: string) {
		showCode[section] = !showCode[section];
	}

	function copySnippet(text: string, label: string) {
		navigator.clipboard.writeText(text);
		copiedKey = label;
		toast.success(`คัดลอก ${label} เรียบร้อยแล้ว`);
		setTimeout(() => {
			if (copiedKey === label) copiedKey = null;
		}, 2000);
	}

	// AI Studio Complete System Prompt
	const AI_STUDIO_SYSTEM_PROMPT = `You are an expert Frontend Engineer and UI/UX Designer specializing in the **SmartShelter Thailand Civic Light Design System v2.4 (Minimal, Modern & Clean)**.

### 🏛️ DESIGN PHILOSOPHY: Civic Light & Minimal Modern
A refined, high-contrast, crystal-clear interface designed for disaster management, humanitarian shelters, and civic operations in Thailand. It combines modern minimalist aesthetics with tactical clarity: generous whitespace, razor-thin borders, subtle micro-elevation, large readable typography, comprehensive accessibility (a11y), clear edge-case UI states, responsive layout rules, and smooth micro-interactions.

---

### 🚫 ABSOLUTE NEGATIVE CONSTRAINTS (STRICT RULES)
1. **ALWAYS LIGHT THEME**: Never use dark backgrounds for full pages or sections. The canvas is always Slate-50 (#F8FAFC) or Pure White (#FFFFFF).
2. **NO SINGLE-SIDED BORDER STRIPES**: Never create cards with a colored accent stripe on only one edge (e.g. border-l-4 or border-t-4). Status cards MUST use a complete 360-degree tinted border around the entire card (e.g., border border-emerald-200 with bg-white).
3. **NO HEAVY DROP SHADOWS**: Avoid shadow-lg, shadow-xl, or shadow-2xl. Use subtle micro-elevation (shadow-2xs or shadow-xs) with 1px crisp borders.
4. **NO OVERLY ROUNDED CONTAINERS**: Container and card border-radius is strictly 12px to 16px (rounded-xl or rounded-2xl). Avoid rounded-3xl or pill containers for cards.
5. **NO TINY UNREADABLE TEXT**: Base body text is 16px (text-base), field reading is 18px (text-lg). Do not use text-[10px] or text-[11px] for vital operational text. Use standard tokens (text-xs, text-sm, text-base).
6. **NO COLOR-ONLY STATUS INDICATORS**: Always pair status colors with clear text labels and icons for colorblind accessibility.
7. **MANDATORY SHADCN-SVELTE FORM CONTROLS**: All inputs, selects, textareas, switches, checkboxes, labels, and dialogs MUST use official shadcn-svelte components ($lib/components/ui/*) with Svelte 5 runes ($state, bind:value, bind:checked).
8. **UNIFIED SINGLE-FONT SYSTEM (IBM Plex Sans Thai)**: 100% of UI typography (headings, body text, form controls, numbers, CID, telemetry KPIs, badges, and tables) MUST use 'IBM Plex Sans Thai' with 'tabular-nums' for digit alignment. 'font-mono' (Geist Mono) is strictly reserved for technical programming code blocks (<pre>, <code>).`;

	const SNIPPETS = {
		commandPalette: `<!-- Civic Command Palette (⌘K) Trigger & Modal Integration -->
<!-- In your +layout.svelte or page: -->
<!-- import CivicCommandPalette from '$lib/components/CivicCommandPalette.svelte'; -->
<!-- let isCommandOpen = $state(false); -->

<!-- Quick Open Button -->
<button 
  onclick={() => isCommandOpen = true}
  class="h-10 px-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-600 flex items-center gap-3 shadow-2xs"
>
  <Search class="h-4 w-4 text-slate-400" />
  <span>ค้นหาหรือพิมพ์คำสั่ง...</span>
  <kbd class="px-1.5 py-0.5 text-xs font-mono bg-slate-100 border border-slate-200 rounded text-slate-500">⌘K</kbd>
</button>

<CivicCommandPalette bind:open={isCommandOpen} />`,

		syncIndicators: `<!-- Remote-First CouchDB Sync Status Indicator -->
<!-- 1. Floating / Navbar Sync Status Pill -->
<div class="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
  <span class="relative flex h-2 w-2">
    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
    <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
  </span>
  <span class="font-semibold">ออนไลน์ & ซิงก์สมบูรณ์</span>
</div>

<!-- 2. Offline Mode Disaster Banner -->
<div class="rounded-xl border border-slate-300 bg-slate-100/90 p-4 text-slate-800 flex items-center justify-between shadow-2xs">
  <div class="flex items-center gap-3">
    <WifiOff class="h-5 w-5 text-slate-500" />
    <div>
      <div class="text-xs font-bold text-slate-900">กำลังทำงานในโหมดออฟไลน์ (Local CouchDB)</div>
      <div class="text-xs text-slate-500">ข้อมูลจะถูกบันทึกในเครื่องและซิงก์ขึ้นคลาวด์อัตโนมัติเมื่อมีสัญญาณ</div>
    </div>
  </div>
  <span class="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-slate-700">3 รายการรอซิงก์</span>
</div>`,
		a11y: `<!-- 1. Accessible Icon Button with Screen Reader Label & Touch Target (min 44x44px) -->
<button 
  class="relative inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 active:scale-[0.98]"
  aria-label="ตั้งค่าระบบ"
>
  <Settings class="h-5 w-5" />
  <span class="sr-only">ตั้งค่าระบบ</span>
</button>

<!-- 2. Accessible Multi-modal Status Badge (Color + Icon + Text) -->
<span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
  <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
  <span>ปกติ 75%</span>
</span>`,

		uistates: `<!-- 1. Empty State Pattern -->
<div class="rounded-xl border border-dashed border-slate-300 p-8 text-center bg-white space-y-3">
  <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
    <Inbox class="h-6 w-6" />
  </div>
  <h4 class="text-base font-bold text-slate-900">ยังไม่มีรายชื่อผู้พักพิงในศูนย์นี้</h4>
  <p class="text-xs text-slate-500 max-w-sm mx-auto">เริ่มลงทะเบียนผู้พักพิงคนแรกเพื่อจัดสรรเตียงและบันทึกประวัติการรับเสบียง</p>
  <button class="btn-primary mt-2">+ เริ่มลงทะเบียน</button>
</div>

<!-- 2. Skeleton Shimmer Loading Pattern -->
<div class="rounded-xl border border-slate-200/80 bg-white p-5 space-y-3 animate-pulse">
  <div class="flex justify-between items-center">
    <div class="h-4 w-24 bg-slate-200 rounded"></div>
    <div class="h-4 w-16 bg-slate-100 rounded-full"></div>
  </div>
  <div class="h-8 w-20 bg-slate-200 rounded"></div>
  <div class="h-2 w-full bg-slate-100 rounded-full"></div>
</div>`,

		responsive: `<!-- 1. Tablet-Optimized Split View (Master-Detail) -->
<div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
  <!-- Left Master List (5 cols on Tablet Landscape / Desktop) -->
  <div class="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 space-y-2">
    <input type="text" placeholder="ค้นหาผู้พักพิง..." class="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm" />
    <div class="space-y-1.5">
      <div class="p-3 rounded-lg bg-slate-100 font-semibold text-sm">นายสมชาย ใจดี (เต็นท์ A-12)</div>
      <div class="p-3 rounded-lg hover:bg-slate-50 text-sm">นางกัญญารัตน์ สุขสวัสดิ์</div>
    </div>
  </div>

  <!-- Right Detail View (7 cols on Tablet Landscape / Desktop) -->
  <div class="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
    <h3 class="text-lg font-bold text-slate-900">รายละเอียดผู้พักพิง: นายสมชาย ใจดี</h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="text-xs font-semibold text-slate-500">เลขบัตร ปชช.</label>
        <div class="font-bold tabular-nums text-sm text-slate-800">1-5099-00123-45-6</div>
      </div>
      <div>
        <label class="text-xs font-semibold text-slate-500">สถานะ Triage</label>
        <div class="text-sm font-semibold text-emerald-700">ปกติ (Green)</div>
      </div>
    </div>
  </div>
</div>

<!-- 2. Responsive 48px Field Tablet Touch Target Button -->
<button class="h-12 w-full sm:w-auto px-6 rounded-xl bg-[#0A2647] text-white font-semibold text-sm active:scale-[0.98]">
  + บันทึกข้อมูลคัดกรอง
</button>`,

		motion: `<!-- Snappy Micro-interactions & Tactile Feedback -->
<button class="transition-all duration-150 ease-out hover:bg-[#051930] active:scale-[0.98] active:duration-75">
  Interactive Button
</button>`,

		spatial: `<!-- Page Container: max-w-7xl, px-4 sm:px-6 lg:px-8, py-10 sm:py-16 -->
<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-16 space-y-12 sm:space-y-16">
  <!-- Section: rounded-2xl, p-6 sm:p-10, border border-slate-200/80, shadow-2xs -->
  <section class="rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-10 shadow-2xs space-y-6">
    ...
  </section>
</div>`,

		colors: `<!-- 1. Brand & Action Foundations -->
<div class="bg-[#0A2647] text-white">Brand Navy Primary #0A2647</div>
<div class="bg-[#0284C7] text-white">GovTech Cerulean Secondary #0284C7</div>
<div class="bg-[#DC2626] text-white">Destructive Red #DC2626</div>

<!-- 2. Surface, Accent & Structural Tokens -->
<div class="bg-[#F0F9FF] border border-[#BAE6FD] text-[#0369A1]">Accent Ice Blue #F0F9FF</div>
<div class="bg-[#F8FAFC] text-slate-900">Canvas Background #F8FAFC</div>
<div class="bg-white border border-slate-200/80">Card Surface #FFFFFF</div>
<div class="border border-[#E2E8F0]">Border Standard #E2E8F0</div>
<div class="border border-[#CBD5E1]">Border Strong #CBD5E1</div>

<!-- 3. Unified Domain Operations (5 Areas) -->
<div class="border border-orange-200 bg-orange-50 text-orange-900">Kitchen & Food Supply #EA580C</div>
<div class="border border-rose-200 bg-rose-50 text-rose-900">Maternal & Infant Care #E11D48</div>
<div class="border border-sky-200 bg-sky-50 text-sky-900">Donors & Family Tracing #0284C7</div>
<div class="border border-emerald-200 bg-emerald-50 text-emerald-900">Volunteers & Field Responders #059669</div>
<div class="border border-teal-200 bg-teal-50 text-teal-900">SPHERE Catalog & Inventory #0D9488</div>

<!-- 4. Real-world Public Portal Application (4 Service Cards) -->
<div class="border-2 border-red-200 bg-white">1. ค้นหาที่พักพิง (#DC2626 Destructive)</div>
<div class="border-2 border-sky-200 bg-white">2. ค้นหาญาติ / ผู้พักพิง (#0A2647 Navy / #0284C7 Cerulean)</div>
<div class="border-2 border-amber-200 bg-white">3. ผู้บริจาค / มอบเสบียง (#EA580C Kitchen & Food)</div>
<div class="border-2 border-emerald-200 bg-white">4. จิตอาสา / อาสาสมัคร (#059669 Volunteers)</div>

<!-- 5. 360° Refined Status Borders -->
<div class="border border-emerald-200 bg-white text-emerald-900">Operational Green #16A34A</div>
<div class="border border-amber-200 bg-white text-amber-900">Warning Amber #F59E0B</div>
<div class="border border-red-200 bg-white text-red-900">Critical Red #DC2626</div>
<div class="border border-sky-200 bg-white text-sky-900">Logistics Sky #0284C7</div>
<div class="border border-purple-200 bg-white text-purple-900">EOC Purple #9333EA</div>`,

		typography: `<!-- Minimal Modern Typography Hierarchy -->
<h1 class="text-3xl sm:text-4xl font-extrabold text-[#0A2647] tracking-tight">H1: Page Title (36px-40px)</h1>
<h2 class="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">H2: Section Header (24px-28px)</h2>
<h3 class="text-lg sm:text-xl font-bold text-slate-900">H3: Card / Modal Title (18px-20px)</h3>
<h4 class="text-base font-semibold text-slate-800">H4: Group Title (15px-16px)</h4>
<p class="text-lg text-slate-700 leading-relaxed">p.lead: Field Reading Text (18px)</p>
<p class="text-base text-slate-700 leading-normal">p: Standard Body Text (16px)</p>
<p class="text-sm text-slate-500 leading-normal">p.small: Helper Text (14px)</p>
<label class="text-sm font-semibold text-slate-700">label: Form Label (14px)</label>
<span class="text-xs font-semibold tracking-wide">span.badge: Badge Text (12px)</span>
<div class="text-3xl sm:text-4xl font-bold text-slate-900 tabular-nums">4,150 (Metric Number)</div>`,

		telemetry: `<div class="rounded-xl border border-emerald-200/90 bg-white p-5 shadow-2xs space-y-3 transition-all hover:border-emerald-300">
  <div class="flex items-center justify-between">
    <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">ศูนย์เปิดทำการ</span>
    <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
      <span class="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
      พร้อมรับ 75%
    </span>
  </div>
  <div class="flex items-baseline gap-2">
    <span class="text-3xl sm:text-4xl font-bold text-slate-900 tabular-nums">18</span>
    <span class="text-xs font-semibold text-slate-400">/ 24 แห่ง</span>
  </div>
  <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
    <div class="h-full rounded-full bg-emerald-600" style="width: 75%"></div>
  </div>
</div>`,

		forms: `<!-- shadcn-svelte Form Controls with Svelte 5 Runes -->
<script lang="ts">
  import { Label } from '$lib/components/ui/label/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';

  let name = $state('สมชาย ใจดี');
  let cid = $state('1-5099-00123-45-6');
  let zone = $state('zone-a');
  let isEmergency = $state(true);
<${'/script'}>

<div class="space-y-4">
  <!-- 1. Text Input with Label -->
  <div class="space-y-1.5">
    <Label for="name" class="text-sm font-semibold text-slate-700">ชื่อ-นามสกุล <span class="text-red-500">*</span></Label>
    <Input id="name" type="text" bind:value={name} placeholder="ระบุชื่อจริงตามบัตรประชาชน" />
  </div>

  <!-- 2. Validated Input with Status Icon -->
  <div class="space-y-1.5">
    <Label for="cid" class="text-sm font-semibold text-slate-700">เลขประจำตัวประชาชน</Label>
    <div class="relative">
      <Input id="cid" type="text" bind:value={cid} class="tabular-nums pr-9" />
      <CheckCircle2 class="absolute right-3 top-2.5 h-4 w-4 text-emerald-600" />
    </div>
  </div>

  <!-- 3. shadcn-svelte Select -->
  <div class="space-y-1.5">
    <Label for="zone" class="text-sm font-semibold text-slate-700">อาคาร / โซนพักพิง</Label>
    <Select.Root type="single" bind:value={zone}>
      <Select.Trigger id="zone" class="w-full">
        <span>{zone === 'zone-a' ? 'อาคาร 1 - โซน A' : 'เลือกโซน'}</span>
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="zone-a">อาคาร 1 - โซน A</Select.Item>
        <Select.Item value="zone-b">อาคาร 2 - โซน B</Select.Item>
      </Select.Content>
    </Select.Root>
  </div>
</div>`,

		badges: `<!-- 1. Triage Severity Badges -->
<span class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-900">
  <span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>วิกฤต (Red)
</span>
<span class="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
  <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>เฝ้าระวัง (Yellow)
</span>
<span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
  <span class="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>ปกติ (Green)
</span>

<!-- 2. Domain Operations Badges (Mapped to Palette) -->
<span class="badge-kitchen">ครัวกลาง & LPG</span>
<span class="badge-family">แม่และเด็ก / นมผง</span>
<span class="badge-donor">ของบริจาค & จิตอาสา</span>
<span class="badge-inventory">คลัง SPHERE</span>

<!-- 3. Functional Badges -->
<span class="badge-accent">ไฮไลท์เน้น</span>
<span class="badge-warning-advisory">ข้อแนะนำเฝ้าระวัง</span>
<span class="badge-muted">ไม่ระบุ / ปิดรับ</span>`,

		alerts: `<!-- Minimal Alert Callout -->
<div class="rounded-xl border border-red-200/90 bg-red-50/60 p-4 text-red-950 flex items-start gap-3 shadow-2xs">
  <AlertTriangle class="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
  <div>
    <h4 class="text-sm font-bold text-red-900">ประกาศเตือนภัยระดับ 3: น้ำท่วมฉับพลัน</h4>
    <p class="text-xs text-red-800 mt-0.5">ให้อพยพประชาชนในโซนริมน้ำเข้าศูนย์พักพิงหลักทันที</p>
  </div>
</div>`,

		tables: `<div class="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-2xs">
  <table class="w-full text-left text-sm">
    <thead class="bg-slate-50/75 border-b border-slate-200/80 text-xs font-medium text-slate-500">
      <tr>
        <th class="px-4 py-3">ผู้พักพิง</th>
        <th class="px-4 py-3">ระดับ Triage</th>
        <th class="px-4 py-3">กลุ่มเปราะบาง</th>
        <th class="px-4 py-3">เตียง</th>
        <th class="px-4 py-3 text-right">การจัดการ</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100 text-xs">
      <tr class="hover:bg-slate-50/60 transition-colors">
        <td class="px-4 py-3 font-semibold text-slate-900">นายสมชาย ใจดี</td>
        <td class="px-4 py-3"><span class="badge-status-critical">วิกฤต (Red)</span></td>
        <td class="px-4 py-3"><span class="badge-vulnerable">ผู้ป่วยติดเตียง</span></td>
        <td class="px-4 py-3 text-slate-600 font-medium tabular-nums">B-104</td>
        <td class="px-4 py-3 text-right"><button class="text-xs font-semibold text-slate-700 hover:text-slate-900">แก้ไข</button></td>
      </tr>
    </tbody>
  </table>
</div>`,

		dialogs: `<Dialog.Root bind:open>
  <Dialog.Trigger class="btn-primary">เปิดคำสั่งฉุกเฉิน</Dialog.Trigger>
  <Dialog.Content class="sm:max-w-[420px] rounded-2xl border border-slate-200/80 bg-white p-6 shadow-md">
    <Dialog.Header class="space-y-1.5">
      <Dialog.Title class="text-lg font-bold text-slate-900">ยืนยันการประกาศปิดรับผู้พักพิง</Dialog.Title>
      <Dialog.Description class="text-xs text-slate-500">
        เมื่อสั่งปิดรับ ระบบจะแจ้งเตือนจุดคัดกรองให้เปลี่ยนเส้นทางไปยังศูนย์สำรอง
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer class="gap-2 mt-5">
      <button onclick={() => open = false} class="btn-outline">ยกเลิก</button>
      <button onclick={() => open = false} class="btn-destructive">ยืนยันปิดรับ</button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>`,

		navigation: `<!-- 1. Minimal Breadcrumbs -->
<nav class="flex items-center gap-1.5 text-xs font-medium text-slate-500">
  <a href="/shelters" class="hover:text-slate-900 transition-colors">ศูนย์พักพิงทั้งหมด</a>
  <ChevronRight class="h-3.5 w-3.5 text-slate-400" />
  <a href="/shelters/sh-01" class="hover:text-slate-900 transition-colors">ศูนย์โรงเรียนเทศบาล 1</a>
  <ChevronRight class="h-3.5 w-3.5 text-slate-400" />
  <span class="font-semibold text-slate-900">ข้อมูลผู้พักพิง</span>
</nav>

<!-- 2. Civic Action Button Variants -->
<button class="btn-primary-brand">Primary Action</button>
<button class="btn-secondary-brand">Secondary (GovTech Cerulean)</button>
<button class="btn-secondary-outline">Secondary Outline</button>`
	};
</script>

<svelte:head>
	<title>Civic Light Design System & Architecture Guide | SmartShelter</title>
</svelte:head>

<div class="min-h-screen bg-[#F8FAFC] py-10 text-slate-900 antialiased sm:py-16">
	<div class="mx-auto max-w-7xl space-y-12 px-4 sm:space-y-16 sm:px-6 lg:px-8">
		<!-- 🏛️ HEADER HERO BANNER -->
		<div
			class="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_0_rgba(15,23,42,0.03)] sm:p-10"
		>
			<div class="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
				<div class="space-y-3">
					<div
						class="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
					>
						<Sparkles class="h-3.5 w-3.5 text-[#0A2647]" />
						<span>SMARTSHELTER CIVIC LIGHT v2.4</span>
					</div>
					<h1 class="text-3xl font-extrabold tracking-tight text-[#0A2647] sm:text-4xl">
						Civic Light UI Standards & Design System
					</h1>
					<p class="max-w-3xl text-base leading-relaxed font-normal text-slate-600">
						สถาปัตยกรรม UI ที่ครบถ้วนสมบูรณ์ระดับสากล: ครอบคลุมทั้ง Accessibility (a11y), UI States
						(Empty/Loading/Error), Responsive Matrix, Motion และ Spatial Geometry ตามหลัก Minimal,
						Modern & Clean
					</p>
				</div>

				<!-- SEGMENTED TAB SWITCHER -->
				<div
					class="flex shrink-0 items-center gap-1 self-start rounded-xl border border-slate-200/80 bg-slate-100/80 p-1 md:self-auto"
				>
					<button
						onclick={() => (activeTab = 'components')}
						class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all {activeTab ===
						'components'
							? 'bg-white text-slate-900 shadow-2xs'
							: 'text-slate-600 hover:text-slate-900'}"
					>
						<Eye class="h-3.5 w-3.5" />
						<span>Living Showcase</span>
					</button>
					<button
						onclick={() => (activeTab = 'prompt-guide')}
						class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all {activeTab ===
						'prompt-guide'
							? 'bg-[#0A2647] text-white shadow-2xs'
							: 'text-slate-600 hover:text-slate-900'}"
					>
						<Terminal class="h-3.5 w-3.5" />
						<span>AI Studio Prompt</span>
					</button>
				</div>
			</div>
		</div>

		{#if activeTab === 'components'}
			<!-- 🏛️ 1. CORE PILLARS -->
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div class="space-y-2 rounded-xl border border-slate-200/80 bg-white p-6 shadow-2xs">
					<div class="font-mono text-xs font-bold tracking-wider text-slate-400">01 / THEME</div>
					<h3 class="text-base font-bold text-slate-900">Always Light Canvas</h3>
					<p class="text-xs leading-relaxed text-slate-500">
						พื้นหลัง Slate-50 (#F8FAFC) คมชัด สบายตา อ่านง่ายแม้อยู่กลางแจ้ง
					</p>
				</div>

				<div class="space-y-2 rounded-xl border border-slate-200/80 bg-white p-6 shadow-2xs">
					<div class="font-mono text-xs font-bold tracking-wider text-emerald-600/70">
						02 / BORDER
					</div>
					<h3 class="text-base font-bold text-slate-900">360° Framing</h3>
					<p class="text-xs leading-relaxed text-slate-500">
						เส้นขอบระบุสถานะรอบตัวการ์ดทั้งใบ ไม่มีเส้นขีดข้างเดียว ดูเป็นระเบียบ
					</p>
				</div>

				<div class="space-y-2 rounded-xl border border-slate-200/80 bg-white p-6 shadow-2xs">
					<div class="font-mono text-xs font-bold tracking-wider text-blue-600/70">03 / TYPE</div>
					<h3 class="text-base font-bold text-slate-900">Large & Readable</h3>
					<p class="text-xs leading-relaxed text-slate-500">
						IBM Plex Sans Thai ชัดเจนระยะ 1 เมตร พร้อม tabular-nums สำหรับจัดหลักตัวเลข
					</p>
				</div>

				<div class="space-y-2 rounded-xl border border-slate-200/80 bg-white p-6 shadow-2xs">
					<div class="font-mono text-xs font-bold tracking-wider text-amber-600/70">04 / DEPTH</div>
					<h3 class="text-base font-bold text-slate-900">Micro-Elevation</h3>
					<p class="text-xs leading-relaxed text-slate-500">
						เงาระดับไมโคร (shadow-2xs) ร่วมกับเส้นขอบคมชัด แบนราบ ไม่ลอยหลอกตา
					</p>
				</div>
			</div>

			<!-- ♿ 1. ACCESSIBILITY (A11Y) & INCLUSIVE DESIGN STANDARD -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Accessibility class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								1. Accessibility (a11y) & Inclusive Design
							</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							มาตรฐานการเข้าถึงสำหรับทุกคน: Touch Targets, Contrast Ratios, Focus Rings และ Screen
							Reader Support
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('a11y')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.a11y ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.a11y, 'a11y Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.a11y}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.a11y}</pre>
					</div>
				{/if}

				<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
					<!-- Touch Target Spec Card -->
					<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5">
						<div class="flex items-center justify-between">
							<span class="text-xs font-bold tracking-wider text-slate-500 uppercase"
								>Touch Target Sizes</span
							>
							<span class="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800"
								>WCAG 2.5.5</span
							>
						</div>
						<p class="text-xs text-slate-600">
							ขนาดเป้าสัมผัสขั้นต่ำสำหรับการกดผ่าน Tablet หรือมือถือภาคสนามที่สวมถุงมือ
						</p>
						<div class="flex items-center gap-3 pt-2">
							<button
								class="flex h-11 min-w-[44px] items-center justify-center rounded-lg bg-[#0A2647] px-3.5 text-xs font-semibold text-white shadow-2xs"
							>
								44x44px (Mobile)
							</button>
							<button
								class="flex h-12 min-w-[48px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 shadow-2xs"
							>
								48x48px (Field Tablet)
							</button>
						</div>
					</div>

					<!-- Contrast & Multi-modal Indicator -->
					<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5">
						<div class="flex items-center justify-between">
							<span class="text-xs font-bold tracking-wider text-slate-500 uppercase"
								>Contrast & Multi-modal</span
							>
							<span class="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800"
								>WCAG 2.1 AA 4.5:1</span
							>
						</div>
						<p class="text-xs text-slate-600">
							ไม่พึ่งพาสีเพียงอย่างเดียว (Color + Icon + Label)
							ช่วยให้ผู้มีความบกพร่องทางสายตาอ่านได้ชัดเจน
						</p>
						<div class="flex flex-wrap items-center gap-2 pt-1">
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-950"
							>
								<CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
								<span>พร้อมรับ (Green)</span>
							</span>
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-950"
							>
								<AlertCircle class="h-3.5 w-3.5 text-red-600" />
								<span>วิกฤต (Red)</span>
							</span>
						</div>
					</div>

					<!-- Focus Ring & Keyboard Navigation -->
					<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5">
						<div class="flex items-center justify-between">
							<span class="text-xs font-bold tracking-wider text-slate-500 uppercase"
								>Focus Indicator & ARIA</span
							>
							<span class="rounded bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-800"
								>Keyboard Ready</span
							>
						</div>
						<p class="text-xs text-slate-600">
							Focus Ring คมชัด 2px พร้อม Offset ชัดเจนเมื่อกดปุ่ม Tab บนคีย์บอร์ด
						</p>
						<div class="pt-1">
							<button
								class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
							>
								<span>ทดสอบกด Tab ที่นี่</span>
							</button>
						</div>
					</div>
				</div>
			</section>

			<!-- ⏳ 2. UI STATES & EDGE CASES (EMPTY, LOADING, ERROR, DISABLED) -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Layers class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">2. UI State Management & Edge Cases</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							แบบแผนการแสดงผลในทุกสถานะ: Empty State, Skeleton Shimmer Loading, Error Recovery และ
							Disabled Controls
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('uistates')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.uistates ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.uistates, 'UI States Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.uistates}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.uistates}</pre>
					</div>
				{/if}

				<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
					<!-- 1. Empty State Card -->
					<div
						class="flex flex-col justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center"
					>
						<div class="space-y-2">
							<div
								class="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400"
							>
								<Inbox class="h-5 w-5" />
							</div>
							<h4 class="text-sm font-bold text-slate-900">ยังไม่มีรายชื่อผู้พักพิงในโซนนี้</h4>
							<p class="text-xs leading-relaxed text-slate-500">
								เมื่อมีประชาชนเดินทางมาถึง ให้กดปุ่มด้านล่างเพื่อเริ่มลงทะเบียนคัดกรอง
							</p>
						</div>
						<div class="pt-4">
							<button
								class="w-full rounded-lg bg-[#0A2647] px-3.5 py-2 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#051930]"
							>
								+ เริ่มลงทะเบียนคนแรก
							</button>
						</div>
					</div>

					<!-- 2. Skeleton Shimmer Loading Demo -->
					<div
						class="flex flex-col justify-between space-y-4 rounded-xl border border-slate-200/80 bg-white p-6"
					>
						<div class="flex items-center justify-between border-b border-slate-100 pb-2">
							<span class="text-xs font-bold text-slate-900">Skeleton Shimmer State</span>
							<button
								onclick={triggerLoadingDemo}
								class="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
							>
								<RefreshCw class="h-3 w-3 {isLoadingDemo ? 'animate-spin' : ''}" />
								<span>{isLoadingDemo ? 'กำลังจำลอง...' : 'กดทดสอบโหลด'}</span>
							</button>
						</div>

						{#if isLoadingDemo}
							<div class="animate-pulse space-y-3">
								<div class="flex items-center justify-between">
									<div class="h-3.5 w-28 rounded bg-slate-200"></div>
									<div class="h-3.5 w-16 rounded-full bg-slate-100"></div>
								</div>
								<div class="h-7 w-24 rounded bg-slate-200"></div>
								<div class="h-1.5 w-full rounded-full bg-slate-100"></div>
							</div>
						{:else}
							<div class="space-y-3">
								<div class="flex items-center justify-between">
									<span class="text-xs font-semibold text-slate-500">ยอดผู้พักพิงรวม</span>
									<span
										class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"
										>Loaded</span
									>
								</div>
								<div class="text-2xl font-bold text-slate-900">
									<span class="tabular-nums">412</span> คน
								</div>
								<div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
									<div class="h-full rounded-full bg-emerald-600" style="width: 75%"></div>
								</div>
							</div>
						{/if}

						<p class="text-xs text-slate-400">
							ใช้ความสูงและรูปทรงเทียบเท่าเนื้อหาจริง ป้องกัน Layout Shift
						</p>
					</div>

					<!-- 3. Error / Recovery State Card -->
					<div
						class="flex flex-col justify-between rounded-xl border border-red-200/80 bg-red-50/30 p-6"
					>
						<div class="space-y-2">
							<div class="flex items-center gap-2 text-red-900">
								<AlertCircle class="h-4 w-4 shrink-0 text-red-600" />
								<h4 class="text-sm font-bold">ไม่สามารถดึงข้อมูลคลังเสบียงได้</h4>
							</div>
							<p class="text-xs leading-relaxed text-red-800/80">
								การเชื่อมต่อไปยังฐานข้อมูลส่วนกลางขัดข้อง ข้อมูลออฟไลน์ล่าสุดถูกแคชไว้เมื่อ 5
								นาทีที่แล้ว
							</p>
						</div>
						<div class="flex items-center gap-2 pt-4">
							<button
								class="w-full rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 transition-colors hover:bg-red-50"
							>
								ลองใหม่อีกครั้ง (Retry)
							</button>
						</div>
					</div>
				</div>
			</section>

			<!-- 📱 3. RESPONSIVE BREAKPOINTS & STACKING MATRIX -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Smartphone class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								3. Responsive Breakpoint & Layout Stacking
							</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							กฎเกณฑ์การปรับเปลี่ยนโครงสร้าง Layout เมื่อเปิดบน Mobile, Tablet ภาคสนาม และ Desktop
							EOC
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('responsive')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.responsive ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.responsive, 'Responsive Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.responsive}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.responsive}</pre>
					</div>
				{/if}

				<div class="space-y-6">
					<!-- 4 Breakpoint Cards Grid -->
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<!-- 1. Mobile -->
						<div class="space-y-2.5 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5">
							<div class="flex items-center gap-2 text-sm font-bold text-slate-900">
								<Smartphone class="h-4 w-4 text-slate-600" />
								<span>1. Mobile (&lt; 640px)</span>
							</div>
							<ul class="list-inside list-disc space-y-1.5 text-xs leading-relaxed text-slate-600">
								<li>Grid จัดเรียง 1 Column Stacking</li>
								<li>
									ปุ่ม Action กว้างเต็มจอ <code class="font-mono text-[#0A2647]">w-full</code>
								</li>
								<li>ตารางแสดงผลแบบแนวนอนเลื่อนได้</li>
								<li>ใช้ Bottom Sheet แทน Modal ขนาดใหญ่</li>
							</ul>
						</div>

						<!-- 2. Tablet Portrait -->
						<div
							class="space-y-2.5 rounded-xl border border-blue-200/90 bg-blue-50/20 p-5 shadow-2xs"
						>
							<div class="flex items-center gap-2 text-sm font-bold text-[#0A2647]">
								<Tablet class="h-4 w-4 text-[#0A2647]" />
								<span>2. Tablet Portrait (768px)</span>
							</div>
							<ul class="list-inside list-disc space-y-1.5 text-xs leading-relaxed text-slate-600">
								<li>Grid จัดเรียง 2 Columns สำหรับ KPI & ฟอร์ม</li>
								<li>Touch Target ขยายเป็น 48px รองรับถุงมือแพทย์</li>
								<li>วางปุ่มหลักในโซนนิ้วโป้ง (Thumb Zone)</li>
								<li>Filter Toolbar ปรับเป็นชิปเลื่อนแนวนอน</li>
							</ul>
						</div>

						<!-- 3. Tablet Landscape -->
						<div
							class="space-y-2.5 rounded-xl border border-indigo-200/90 bg-indigo-50/20 p-5 shadow-2xs"
						>
							<div class="flex items-center gap-2 text-sm font-bold text-indigo-950">
								<Laptop class="h-4 w-4 text-indigo-700" />
								<span>3. Tablet Landscape (1024px)</span>
							</div>
							<ul class="list-inside list-disc space-y-1.5 text-xs leading-relaxed text-slate-600">
								<li>แบ่งหน้าจอ <strong>Master-Detail Split View</strong> (5:7)</li>
								<li>KPI Telemetry วางเรียง 3 Columns</li>
								<li>เมนูนำทางปรับเป็น Slim Rail ด้านข้าง</li>
								<li>ดูรายชื่อพร้อมแก้ไขข้อมูลได้ในหน้าจอเดียว</li>
							</ul>
						</div>

						<!-- 4. Desktop -->
						<div class="space-y-2.5 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5">
							<div class="flex items-center gap-2 text-sm font-bold text-slate-900">
								<Monitor class="h-4 w-4 text-slate-600" />
								<span>4. Desktop EOC (&gt; 1280px)</span>
							</div>
							<ul class="list-inside list-disc space-y-1.5 text-xs leading-relaxed text-slate-600">
								<li>Grid วางเต็ม 4 Columns สำหรับแดชบอร์ด EOC</li>
								<li>Sidebar Navigation เต็มรูปแบบคงที่ด้านข้าง</li>
								<li>ตารางแสดงผลครบทุกคอลัมน์และเมนูด่วน</li>
								<li>
									จำกัดความกว้างสูงสุด <code class="text-slate-700 tabular-nums">max-w-7xl</code>
								</li>
							</ul>
						</div>
					</div>

					<!-- Interactive Viewport Simulator -->
					<div class="space-y-4 rounded-xl border border-slate-200/90 bg-slate-50/60 p-5 sm:p-6">
						<div
							class="flex flex-col justify-between gap-3 border-b border-slate-200/80 pb-3 sm:flex-row sm:items-center"
						>
							<div class="space-y-0.5">
								<h3 class="text-sm font-bold text-slate-900">
									Interactive Viewport Simulator (ทดสอบสลับขนาดหน้าจอจำลอง)
								</h3>
								<p class="text-xs text-slate-500">
									เลือกดูการปรับตัวของ Component เมื่อเปิดใช้งานบนอุปกรณ์แต่ละประเภท
								</p>
							</div>

							<!-- Device Switcher Buttons -->
							<div
								class="flex flex-wrap items-center gap-1 self-start rounded-lg border border-slate-200 bg-white p-1 shadow-2xs sm:self-auto"
							>
								<button
									type="button"
									onclick={() => (responsivePreviewMode = 'mobile')}
									class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all {responsivePreviewMode ===
									'mobile'
										? 'bg-[#0A2647] text-white shadow-2xs'
										: 'text-slate-600 hover:text-slate-900'}"
								>
									<Smartphone class="h-3.5 w-3.5" />
									<span>Mobile (375px)</span>
								</button>
								<button
									type="button"
									onclick={() => (responsivePreviewMode = 'tablet-portrait')}
									class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all {responsivePreviewMode ===
									'tablet-portrait'
										? 'bg-[#0A2647] text-white shadow-2xs'
										: 'text-slate-600 hover:text-slate-900'}"
								>
									<Tablet class="h-3.5 w-3.5" />
									<span>Tablet Portrait (768px)</span>
								</button>
								<button
									type="button"
									onclick={() => (responsivePreviewMode = 'tablet-landscape')}
									class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all {responsivePreviewMode ===
									'tablet-landscape'
										? 'bg-[#0A2647] text-white shadow-2xs'
										: 'text-slate-600 hover:text-slate-900'}"
								>
									<Laptop class="h-3.5 w-3.5" />
									<span>Tablet Landscape (1024px)</span>
								</button>
								<button
									type="button"
									onclick={() => (responsivePreviewMode = 'desktop')}
									class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all {responsivePreviewMode ===
									'desktop'
										? 'bg-[#0A2647] text-white shadow-2xs'
										: 'text-slate-600 hover:text-slate-900'}"
								>
									<Monitor class="h-3.5 w-3.5" />
									<span>Desktop (Full)</span>
								</button>
							</div>
						</div>

						<!-- Simulated Frame Box -->
						<div class="flex justify-center transition-all duration-300">
							<div
								class="w-full space-y-4 rounded-xl border border-slate-300/80 bg-white p-4 shadow-md transition-all duration-300 sm:p-5 {responsivePreviewMode ===
								'mobile'
									? 'max-w-[375px]'
									: responsivePreviewMode === 'tablet-portrait'
										? 'max-w-[768px]'
										: responsivePreviewMode === 'tablet-landscape'
											? 'max-w-[1024px]'
											: 'max-w-full'}"
							>
								<!-- Top Status Header -->
								<div class="flex items-center justify-between border-b border-slate-100 pb-3">
									<div class="flex items-center gap-2">
										<div
											class="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0A2647] text-xs font-bold text-white"
										>
											T1
										</div>
										<div>
											<div class="text-xs font-bold text-slate-900">
												ศูนย์โรงเรียนเทศบาล 1 (ช้างคลาน)
											</div>
											<div class="text-xs text-slate-500 tabular-nums">
												Viewport: {responsivePreviewMode}
											</div>
										</div>
									</div>
									<span
										class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 tabular-nums"
									>
										<span class="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
										Online
									</span>
								</div>

								<!-- Responsive Telemetry Grid -->
								<div
									class="grid gap-3 transition-all {responsivePreviewMode === 'mobile'
										? 'grid-cols-1'
										: responsivePreviewMode === 'tablet-portrait'
											? 'grid-cols-2'
											: responsivePreviewMode === 'tablet-landscape'
												? 'grid-cols-3'
												: 'grid-cols-4'}"
								>
									<div class="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
										<div class="text-xs font-semibold text-slate-500">ยอดผู้พักพิง</div>
										<div class="text-xl font-bold text-slate-900">
											<span class="tabular-nums">412</span> คน
										</div>
									</div>
									<div class="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
										<div class="text-xs font-semibold text-slate-500">เตียงว่าง</div>
										<div class="text-xl font-bold text-emerald-700">
											<span class="tabular-nums">88</span> เตียง
										</div>
									</div>
									{#if responsivePreviewMode !== 'mobile'}
										<div class="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
											<div class="text-xs font-semibold text-slate-500">กลุ่มเปราะบาง</div>
											<div class="text-xl font-bold text-amber-700">
												<span class="tabular-nums">64</span> คน
											</div>
										</div>
									{/if}
									{#if responsivePreviewMode === 'desktop'}
										<div class="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
											<div class="text-xs font-semibold text-slate-500">ถุงยังชีพคงเหลือ</div>
											<div class="text-xl font-bold text-blue-700">
												<span class="tabular-nums">1,250</span> ชุด
											</div>
										</div>
									{/if}
								</div>

								<!-- Layout Content Area: Split View for Tablet Landscape / Desktop vs Stacked for Mobile / Tablet Portrait -->
								{#if responsivePreviewMode === 'tablet-landscape' || responsivePreviewMode === 'desktop'}
									<!-- Tablet Landscape: Master-Detail Split View -->
									<div
										class="grid grid-cols-12 gap-4 rounded-xl border border-slate-200/80 bg-slate-50/30 p-3"
									>
										<!-- Left Master List (5 cols) -->
										<div
											class="col-span-5 space-y-2 rounded-lg border border-slate-200 bg-white p-3"
										>
											<div class="text-xs font-bold text-slate-700">
												รายชื่อผู้พักพิง (Master List)
											</div>
											<div class="space-y-1.5">
												<div
													class="flex items-center justify-between rounded-lg border border-[#0A2647]/20 bg-[#0A2647]/5 p-2.5"
												>
													<div>
														<div class="text-xs font-bold text-[#0A2647]">นายสมชาย ใจดี</div>
														<div class="text-xs text-slate-500">เต็นท์ A-12 • Triage: ปกติ</div>
													</div>
													<ChevronRight class="h-3.5 w-3.5 text-[#0A2647]" />
												</div>
												<div
													class="flex items-center justify-between rounded-lg border border-slate-100 p-2.5 hover:bg-slate-50"
												>
													<div>
														<div class="text-xs font-bold text-slate-800">
															นางกัญญารัตน์ สุขสวัสดิ์
														</div>
														<div class="text-xs text-slate-500">เต็นท์ M-02 • ผู้ป่วยติดเตียง</div>
													</div>
													<ChevronRight class="h-3.5 w-3.5 text-slate-400" />
												</div>
											</div>
										</div>

										<!-- Right Detail Card (7 cols) -->
										<div
											class="col-span-7 space-y-3 rounded-lg border border-slate-200 bg-white p-4"
										>
											<div class="flex items-center justify-between border-b border-slate-100 pb-2">
												<div>
													<h4 class="text-xs font-bold text-slate-900">
														ข้อมูลผู้พักพิง: นายสมชาย ใจดี
													</h4>
													<p class="text-xs text-slate-500 tabular-nums">CID: 1-5099-00123-45-6</p>
												</div>
												<span
													class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700"
												>
													ตรวจคัดกรองแล้ว
												</span>
											</div>

											<div class="grid grid-cols-2 gap-3 text-xs">
												<div class="rounded bg-slate-50 p-2">
													<span class="block text-xs text-slate-400">โซนพักอาศัย</span>
													<span class="font-bold text-slate-800">เต็นท์ โซน A (A-12)</span>
												</div>
												<div class="rounded bg-slate-50 p-2">
													<span class="block text-xs text-slate-400">สิทธิการรับเสบียง</span>
													<span class="font-bold text-emerald-700">รับแล้ว (1 ชุด/วัน)</span>
												</div>
											</div>

											<div class="flex items-center gap-2 pt-1">
												<button
													class="h-10 rounded-lg bg-[#0A2647] px-4 text-xs font-semibold text-white hover:bg-[#051930] active:scale-[0.98]"
												>
													จ่ายสิ่งของเพิ่ม
												</button>
												<button
													class="h-10 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
												>
													พิมพ์บัตร
												</button>
											</div>
										</div>
									</div>
								{:else if responsivePreviewMode === 'tablet-portrait'}
									<!-- Tablet Portrait: 2-Column Form with 48px Touch Targets -->
									<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
										<div class="flex items-center justify-between">
											<div class="text-xs font-bold text-slate-900">
												ฟอร์มคัดกรองภาคสนาม (Field Intake Form)
											</div>
											<span
												class="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700"
											>
												Touch Target: 48px
											</span>
										</div>
										<div class="grid grid-cols-2 gap-3">
											<div class="space-y-1">
												<Label for="sim-name" class="text-xs font-semibold text-slate-700"
													>ชื่อ-นามสกุล</Label
												>
												<Input
													id="sim-name"
													type="text"
													value="นายสมชาย ใจดี"
													class="h-11 text-sm sm:h-12"
												/>
											</div>
											<div class="space-y-1">
												<Label for="sim-cid" class="text-xs font-semibold text-slate-700"
													>เลขบัตร ปชช.</Label
												>
												<Input
													id="sim-cid"
													type="text"
													value="1-5099-00123-45-6"
													class="h-11 text-sm tabular-nums sm:h-12"
												/>
											</div>
										</div>
										<div class="grid grid-cols-2 gap-3 pt-1">
											<button
												class="h-12 w-full rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98]"
											>
												สแกนบัตรประชาชน
											</button>
											<button
												class="h-12 w-full rounded-xl bg-[#0A2647] text-xs font-semibold text-white hover:bg-[#051930] active:scale-[0.98]"
											>
												+ บันทึกรับเข้าเต็นท์
											</button>
										</div>
									</div>
								{:else}
									<!-- Mobile: 1-Column Stack with Full-Width 44px Button -->
									<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
										<div class="text-xs font-bold text-slate-900">
											ผู้พักพิงล่าสุด: นายสมชาย ใจดี
										</div>
										<div class="space-y-1 rounded bg-slate-50 p-2.5 text-xs text-slate-600">
											<div>CID: <span class="tabular-nums">1-5099-00123-45-6</span></div>
											<div>เต็นท์: โซน A (A-12) • Triage: ปกติ</div>
										</div>
										<button
											class="h-11 w-full rounded-lg bg-[#0A2647] text-xs font-semibold text-white hover:bg-[#051930] active:scale-[0.98]"
										>
											+ ลงทะเบียนผู้พักพิงใหม่
										</button>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- ✨ 4. MOTION & MICRO-INTERACTIONS SYSTEM -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<MousePointerClick class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								4. Motion & Micro-interactions Token System
							</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							ระบบการเคลื่อนไหวที่นุ่มนวล รวดเร็ว และให้ Tactile Feedback ทันทีเมื่อผู้ใช้สัมผัส
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('motion')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.motion ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.motion, 'Motion Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.motion}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.motion}</pre>
					</div>
				{/if}

				<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
					<div class="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5">
						<span class="text-xs font-bold tracking-wider text-slate-500 uppercase"
							>Duration Tokens</span
						>
						<ul class="space-y-1 text-xs text-slate-600">
							<li><strong>100ms (Fast)</strong>: สถานะ Hover สีปุ่ม, Border highlight</li>
							<li><strong>150ms-200ms (Normal)</strong>: สวิตช์เปิด-ปิด, Dropdown menu</li>
							<li><strong>300ms (Slow)</strong>: Modal Dialog, Drawer overlay</li>
						</ul>
					</div>

					<div class="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5">
						<span class="text-xs font-bold tracking-wider text-slate-500 uppercase"
							>Easing Curve</span
						>
						<p class="text-xs text-slate-600">
							ใช้ <strong>Snappy Ease-Out</strong> (<code class="font-mono text-xs text-blue-900"
								>cubic-bezier(0.16, 1, 0.3, 1)</code
							>) เพื่อให้แอนิเมชันเริ่มตอบสนองทันทีโดยไม่รู้สึกหน่วง
						</p>
					</div>

					<div
						class="flex flex-col justify-between space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5"
					>
						<div>
							<span class="text-xs font-bold tracking-wider text-slate-500 uppercase"
								>Tactile Click Feedback</span
							>
							<p class="mt-1 text-xs text-slate-600">
								ทดสอบการกดยุบตัวแบบไมโคร (active:scale-[0.98])
							</p>
						</div>
						<button
							class="w-full rounded-lg bg-[#0A2647] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-all duration-150 hover:bg-[#051930] active:scale-[0.98]"
						>
							ลองกดเพื่อดู Feedback
						</button>
					</div>
				</div>
			</section>

			<!-- 📐 5. SPATIAL, RADIUS, SHADOW & DEPTH SYSTEM -->
			<section
				class="space-y-8 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Ruler class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								5. Spatial, Radius & Elevation System
							</h2>
						</div>
						<p class="mt-1 text-xs text-slate-500">
							ข้อกำหนดระยะห่าง (Margins/Padding), ความโค้งมน (Border Radius), แสงเงา (Elevation)
							และความหนา-บาง (Borders)
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('spatial')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.spatial ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.spatial, 'Spatial Spec')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.spatial}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.spatial}</pre>
					</div>
				{/if}

				<!-- Interactive Visual Architecture Map of 1 Page -->
				<div class="space-y-4 rounded-xl border border-slate-200/80 bg-slate-50/50 p-6">
					<div class="flex items-center justify-between">
						<span
							class="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-600 uppercase"
						>
							<Box class="h-4 w-4 text-[#0A2647]" />
							<span>แผนผังโครงสร้างระยะและสัดส่วนใน 1 หน้าเว็บ (Visual 1-Page Layout Anatomy)</span>
						</span>
						<span class="font-mono text-xs text-slate-400">Standard Grid System</span>
					</div>

					<div
						class="relative space-y-4 rounded-xl border-2 border-dashed border-slate-300 bg-white p-4 sm:p-6"
					>
						<!-- Annotation Overlay Top -->
						<div
							class="flex items-center justify-between border-b border-dashed border-slate-200 pb-2 font-mono text-xs text-slate-400"
						>
							<span>PAGE CONTAINER: max-w-7xl (1280px)</span>
							<span>PADDING: px-4 sm:px-6 lg:px-8 | py-10 sm:py-16</span>
						</div>

						<!-- Section Container Representation -->
						<div class="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/20 p-4 sm:p-6">
							<div class="flex items-center justify-between">
								<span class="font-mono text-xs font-bold text-[#0A2647]"
									>SECTION CONTAINER: rounded-2xl (16px) | p-6 sm:p-10 | shadow-2xs</span
								>
								<span class="rounded bg-blue-100 px-2 py-0.5 font-mono text-xs text-blue-700"
									>border border-slate-200/80 (1px)</span
								>
							</div>

							<!-- Sub Grid Representation -->
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
								<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
									<div class="font-mono text-xs font-bold text-slate-700">
										KPI CARD (12px rounded-xl)
									</div>
									<div class="text-xs text-slate-500">Padding: p-4 sm:p-5</div>
									<div class="h-1.5 w-full rounded-full bg-slate-100"></div>
								</div>
								<div
									class="space-y-2 rounded-xl border border-emerald-200 bg-white p-3.5 shadow-2xs"
								>
									<div class="font-mono text-xs font-bold text-emerald-900">
										STATUS (360° Framing)
									</div>
									<div class="text-xs text-emerald-700">Border: 1px emerald-200</div>
									<div class="h-1.5 w-full rounded-full bg-emerald-100"></div>
								</div>
								<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
									<div class="font-mono text-xs font-bold text-slate-700">
										FORM INPUT (8px rounded-lg)
									</div>
									<div class="text-xs text-slate-500">Height: h-10 (40px) | px-3.5</div>
									<div class="h-1.5 w-full rounded-full bg-slate-100"></div>
								</div>
								<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
									<div class="font-mono text-xs font-bold text-slate-700">
										ACTION BTN (8px rounded-lg)
									</div>
									<div class="text-xs text-slate-500">Padding: px-4 py-2 | shadow-2xs</div>
									<div class="h-1.5 w-full rounded-full bg-slate-100"></div>
								</div>
							</div>
						</div>

						<div class="py-1 text-center font-mono text-xs text-slate-400">
							▲ SECTION-TO-SECTION VERTICAL GAP: space-y-12 sm:space-y-16 (48px - 64px) ▲
						</div>
					</div>
				</div>

				<!-- 4 In-Depth Specification Grids -->
				<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
					<!-- 1. Spacing & Rhythm Tokens -->
					<div class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-5">
						<div class="flex items-center gap-2 border-b border-slate-100 pb-3">
							<Ruler class="h-4 w-4 text-[#0A2647]" />
							<h3 class="text-sm font-bold text-slate-900">Spacing & Layout Rhythm (ระยะห่าง)</h3>
						</div>

						<div class="space-y-2.5 text-xs">
							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Section Gap (ระหว่างหมวด)</div>
									<div class="text-xs text-slate-500">ระยะห่างระหว่างการ์ด Section ใหญ่</div>
								</div>
								<span class="rounded bg-blue-50 px-2 py-1 font-mono font-semibold text-blue-900"
									>48px - 64px (space-y-12 sm:space-y-16)</span
								>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Section Inner Padding</div>
									<div class="text-xs text-slate-500">ระยะขอบภายในการ์ดใหญ่</div>
								</div>
								<span class="rounded bg-blue-50 px-2 py-1 font-mono font-semibold text-blue-900"
									>24px - 40px (p-6 sm:p-10)</span
								>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Card & Tile Padding</div>
									<div class="text-xs text-slate-500">ระยะขอบในการ์ดย่อย / Telemetry</div>
								</div>
								<span class="rounded bg-blue-50 px-2 py-1 font-mono font-semibold text-blue-900"
									>16px - 20px (p-4 sm:p-5)</span
								>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Grid Column Gutters</div>
									<div class="text-xs text-slate-500">ระยะห่างระหว่างคอลัมน์ในการ์ด</div>
								</div>
								<span class="rounded bg-blue-50 px-2 py-1 font-mono font-semibold text-blue-900"
									>16px - 24px (gap-4 sm:gap-6)</span
								>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Input & Label Gap</div>
									<div class="text-xs text-slate-500">ระยะห่าง Label ถึงตัวช่องกรอก</div>
								</div>
								<span class="rounded bg-blue-50 px-2 py-1 font-mono font-semibold text-blue-900"
									>6px (space-y-1.5)</span
								>
							</div>
						</div>
					</div>

					<!-- 2. Border Radius Scale -->
					<div class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-5">
						<div class="flex items-center gap-2 border-b border-slate-100 pb-3">
							<Box class="h-4 w-4 text-[#0A2647]" />
							<h3 class="text-sm font-bold text-slate-900">Border Radius Hierarchy (ความโค้งมน)</h3>
						</div>

						<div class="space-y-2.5 text-xs">
							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div class="flex items-center gap-2.5">
									<div
										class="h-7 w-7 shrink-0 rounded-2xl border-2 border-slate-400 bg-white"
									></div>
									<div>
										<div class="font-bold text-slate-900">rounded-2xl (16px / 1rem)</div>
										<div class="text-xs text-slate-500">Outer Sections, Hero Banner, Modals</div>
									</div>
								</div>
								<span class="font-mono font-semibold text-slate-700">16px</span>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div class="flex items-center gap-2.5">
									<div class="h-7 w-7 shrink-0 rounded-xl border-2 border-slate-400 bg-white"></div>
									<div>
										<div class="font-bold text-slate-900">rounded-xl (12px / 0.75rem)</div>
										<div class="text-xs text-slate-500">Standard Cards, Status Cards, Code Box</div>
									</div>
								</div>
								<span class="font-mono font-semibold text-slate-700">12px</span>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div class="flex items-center gap-2.5">
									<div class="h-7 w-7 shrink-0 rounded-lg border-2 border-slate-400 bg-white"></div>
									<div>
										<div class="font-bold text-slate-900">rounded-lg (8px / 0.5rem)</div>
										<div class="text-xs text-slate-500">Buttons, Inputs, Select, Search Bar</div>
									</div>
								</div>
								<span class="font-mono font-semibold text-slate-700">8px</span>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div class="flex items-center gap-2.5">
									<div class="h-7 w-7 shrink-0 rounded-md border-2 border-slate-400 bg-white"></div>
									<div>
										<div class="font-bold text-slate-900">rounded-md (6px / 0.375rem)</div>
										<div class="text-xs text-slate-500">Vulnerability Tags, Chips, Tooltips</div>
									</div>
								</div>
								<span class="font-mono font-semibold text-slate-700">6px</span>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div class="flex items-center gap-2.5">
									<div
										class="h-7 w-7 shrink-0 rounded-full border-2 border-slate-400 bg-white"
									></div>
									<div>
										<div class="font-bold text-slate-900">rounded-full (9999px)</div>
										<div class="text-xs text-slate-500">
											Status Pills, Triage Badges, Indicators
										</div>
									</div>
								</div>
								<span class="font-mono font-semibold text-slate-700">Pill</span>
							</div>
						</div>
					</div>

					<!-- 3. Elevation & Shadow Depth -->
					<div class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-5">
						<div class="flex items-center gap-2 border-b border-slate-100 pb-3">
							<Sun class="h-4 w-4 text-[#0A2647]" />
							<h3 class="text-sm font-bold text-slate-900">
								Elevation & Lighting Depth (แสงเงาและความลึก)
							</h3>
						</div>

						<div class="space-y-2.5 text-xs">
							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Level 0: Canvas (แบนราบ)</div>
									<div class="text-xs text-slate-500">พื้นหลังหน้าจอทั้งหมด #F8FAFC</div>
								</div>
								<span class="font-mono font-semibold text-slate-700">shadow-none</span>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Level 1: Micro-Elevation</div>
									<div class="text-xs text-slate-500">การ์ดทั่วไป, Input, Swatches</div>
								</div>
								<span class="rounded bg-blue-50 px-2 py-1 font-mono font-semibold text-blue-900"
									>shadow-2xs (0 1px 2px rgba(15,23,42,0.03))</span
								>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Level 2: Soft Elevation</div>
									<div class="text-xs text-slate-500">สถานะ Card Hover, Dropdown Popover</div>
								</div>
								<span class="rounded bg-blue-50 px-2 py-1 font-mono font-semibold text-blue-900"
									>shadow-xs (0 1px 3px rgba(15,23,42,0.05))</span
								>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Level 3: Overlay Modal</div>
									<div class="text-xs text-slate-500">Confirmation Dialog, Drawer Layer</div>
								</div>
								<span class="rounded bg-blue-50 px-2 py-1 font-mono font-semibold text-blue-900"
									>shadow-md (0 8px 30px rgba(0,0,0,0.06))</span
								>
							</div>
						</div>
					</div>

					<!-- 4. Border Thickness & Stroke Hierarchy -->
					<div class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-5">
						<div class="flex items-center gap-2 border-b border-slate-100 pb-3">
							<Layers class="h-4 w-4 text-[#0A2647]" />
							<h3 class="text-sm font-bold text-slate-900">
								Border Thickness & Stroke (ความหนา-บางของเส้นขอบ)
							</h3>
						</div>

						<div class="space-y-2.5 text-xs">
							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">1px Standard Border (บางเบา)</div>
									<div class="text-xs text-slate-500">การ์ดทั่วไป, เส้นแบ่งตาราง, Divider</div>
								</div>
								<span class="font-mono font-semibold text-slate-700"
									>border border-slate-200/80</span
								>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">1px Input Border (คมชัด)</div>
									<div class="text-xs text-slate-500">ช่องกรอกฟอร์ม Text Input, Textarea</div>
								</div>
								<span class="font-mono font-semibold text-slate-700">border border-slate-300</span>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">1px 360° Semantic Tint (สถานะวิกฤต)</div>
									<div class="text-xs text-slate-500">การ์ด Triage Green, Amber, Red, Sky</div>
								</div>
								<span
									class="rounded bg-emerald-50 px-2 py-1 font-mono font-semibold text-emerald-900"
									>border border-emerald-200</span
								>
							</div>

							<div
								class="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2"
							>
								<div>
									<div class="font-bold text-slate-900">Focus Ring (สถานะโฟกัส)</div>
									<div class="text-xs text-slate-500">
										เมื่อคลิกหรือ Tab เข้าใช้งาน Form Control
									</div>
								</div>
								<span class="rounded bg-blue-50 px-2 py-1 font-mono font-semibold text-blue-900"
									>focus:ring-2 focus:ring-slate-900/5</span
								>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- 🎨 6. COLOR TOKENS, DOMAIN & PUBLIC PORTAL PALETTE STANDARDS -->
			<section
				class="space-y-8 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Palette class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								6. Color Tokens, Domain & Public Portal Palette Standards
							</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							ระบบโทนสีแม่บท, สีย่อยเชิงฟังก์ชัน, กลุ่มงานเฉพาะทาง 5 ด้าน
							และการประยุกต์ใช้ในการ์ดบริการ Portal ประชาชนจริง
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('colors')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.colors ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.colors, 'Unified Color Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.colors}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.colors}</pre>
					</div>
				{/if}

				<!-- 1. Brand & Foundation Swatches (Divided into 2 Logical Rows) -->
				<div class="space-y-5">
					<!-- Row 1: Brand & Action Foundations -->
					<div class="space-y-2.5">
						<div class="flex items-center justify-between">
							<h3 class="text-xs font-bold tracking-wider text-slate-500 uppercase">
								1. Brand & Action Foundations (สีสั่งการและอัตลักษณ์หลัก)
							</h3>
							<span class="text-xs text-slate-400">ปุ่มหลัก คำสั่งรอง และการลบ/ยกเลิก</span>
						</div>
						<div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
							<!-- 1. Brand Navy -->
							<div class="space-y-2.5 rounded-xl border border-slate-200/80 bg-white p-3.5">
								<div class="flex h-12 w-full items-end rounded-lg bg-[#0A2647] p-2 shadow-2xs">
									<span class="font-mono text-xs font-medium text-white/90">Primary #0A2647</span>
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900">Brand Navy (Primary)</div>
									<div class="mt-0.5 text-xs text-slate-500">
										อำนาจสั่งการ, บันทึกข้อมูล, หัวข้อหลัก
									</div>
									<div class="mt-1 font-mono text-xs text-slate-400">.btn-primary-brand</div>
								</div>
							</div>

							<!-- 2. Navy Hover -->
							<div class="space-y-2.5 rounded-xl border border-slate-200/80 bg-white p-3.5">
								<div class="flex h-12 w-full items-end rounded-lg bg-[#051930] p-2 shadow-2xs">
									<span class="font-mono text-xs font-medium text-white/90">Hover #051930</span>
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900">Navy Hover & Focus</div>
									<div class="mt-0.5 text-xs text-slate-500">สถานะชี้เมาส์และกดปุ่มหลัก</div>
									<div class="mt-1 font-mono text-xs text-slate-400">hover:bg-[#051930]</div>
								</div>
							</div>

							<!-- 3. GovTech Cerulean -->
							<div class="space-y-2.5 rounded-xl border border-sky-200/80 bg-white p-3.5">
								<div class="flex h-12 w-full items-end rounded-lg bg-[#0284C7] p-2 shadow-2xs">
									<span class="font-mono text-xs font-medium text-white/95">Secondary #0284C7</span>
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900">GovTech Cerulean</div>
									<div class="mt-0.5 text-xs text-slate-500">
										คำสั่งรองเชิงปฏิบัติการ, แผนที่, ส่งออก
									</div>
									<div class="mt-1 font-mono text-xs text-slate-400">.btn-secondary-brand</div>
								</div>
							</div>

							<!-- 4. Destructive Red -->
							<div class="space-y-2.5 rounded-xl border border-red-200/80 bg-white p-3.5">
								<div class="flex h-12 w-full items-end rounded-lg bg-[#DC2626] p-2 shadow-2xs">
									<span class="font-mono text-xs font-medium text-white/95"
										>Destructive #DC2626</span
									>
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900">Destructive Red</div>
									<div class="mt-0.5 text-xs text-slate-500">
										ลบข้อมูล, ปิดรับผู้พักพิง, สั่งหยุดฉุกเฉิน
									</div>
									<div class="mt-1 font-mono text-xs text-slate-400">.btn-destructive-brand</div>
								</div>
							</div>
						</div>
					</div>

					<!-- Row 2: Surface, Accent & Structural Borders -->
					<div class="space-y-2.5 pt-1">
						<div class="flex items-center justify-between">
							<h3 class="text-xs font-bold tracking-wider text-slate-500 uppercase">
								2. Surface, Accent & Structural Borders (พื้นผิวและเส้นโครงสร้าง)
							</h3>
							<span class="text-xs text-slate-400">ความคมชัด 360° และระบบไฮไลท์</span>
						</div>
						<div class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
							<!-- 1. Accent Ice Blue -->
							<div class="space-y-2 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
								<div
									class="flex h-10 w-full items-end rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] p-1.5 shadow-2xs"
								>
									<span class="font-mono text-xs font-bold text-[#0369A1]">#F0F9FF</span>
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900">Ice Blue Accent</div>
									<div class="text-xs text-slate-500">ไฮไลท์แถว & โฟกัสนุ่มนวล</div>
									<div class="mt-0.5 font-mono text-xs text-slate-400">bg-sky-50/40</div>
								</div>
							</div>

							<!-- 2. Canvas Slate -->
							<div class="space-y-2 rounded-xl border border-slate-200/80 bg-white p-3">
								<div
									class="flex h-10 w-full items-end rounded-lg border border-slate-200 bg-[#F8FAFC] p-1.5 shadow-2xs"
								>
									<span class="font-mono text-xs font-medium text-slate-600">#F8FAFC</span>
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900">Canvas Slate</div>
									<div class="text-xs text-slate-500">พื้นหลังแอปพลิเคชัน</div>
									<div class="mt-0.5 font-mono text-xs text-slate-400">bg-[#F8FAFC]</div>
								</div>
							</div>

							<!-- 3. Card Surface -->
							<div class="space-y-2 rounded-xl border border-slate-200/80 bg-white p-3">
								<div
									class="flex h-10 w-full items-end rounded-lg border border-slate-200 bg-white p-1.5 shadow-2xs"
								>
									<span class="font-mono text-xs font-medium text-slate-600">#FFFFFF</span>
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900">Card Surface</div>
									<div class="text-xs text-slate-500">การ์ดข้อมูลและโมดอล</div>
									<div class="mt-0.5 font-mono text-xs text-slate-400">bg-white</div>
								</div>
							</div>

							<!-- 4. Border Standard -->
							<div class="space-y-2 rounded-xl border border-slate-200/80 bg-white p-3">
								<div class="flex h-10 w-full items-end rounded-lg bg-[#E2E8F0] p-1.5 shadow-2xs">
									<span class="font-mono text-xs font-medium text-slate-600">#E2E8F0</span>
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900">Border Standard</div>
									<div class="text-xs text-slate-500">เส้นแบ่งการ์ด 1px มาตรฐาน</div>
									<div class="mt-0.5 font-mono text-xs text-slate-400">border-slate-200/80</div>
								</div>
							</div>

							<!-- 5. Border Strong -->
							<div class="space-y-2 rounded-xl border border-slate-300 bg-white p-3">
								<div class="flex h-10 w-full items-end rounded-lg bg-[#CBD5E1] p-1.5 shadow-2xs">
									<span class="font-mono text-xs font-medium text-slate-700">#CBD5E1</span>
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900">Border Strong</div>
									<div class="text-xs text-slate-500">กรอบฟอร์มคอนโทรล</div>
									<div class="mt-0.5 font-mono text-xs text-slate-400">border-slate-300</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- 2. Unified Domain Operations (5 Areas) -->
				<div class="space-y-4 pt-2">
					<div class="flex items-center justify-between">
						<h3 class="text-xs font-bold tracking-wider text-slate-500 uppercase">
							3. Unified Domain Operations (กลุ่มงานเฉพาะทาง 5 ด้าน)
						</h3>
						<span class="text-xs font-medium text-slate-400"
							>แบ่ง 2 แถวเพื่อให้อ่านง่าย • บริบทศูนย์พักพิงและพอร์ทัลประชาชน</span
						>
					</div>

					<!-- Row 1: Frontline Supplies & Vulnerable Care (3 Areas) -->
					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
								<span class="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
								แถวที่ 1: กลุ่มงานปัจจัย 4, ดูแลกลุ่มเปราะบาง และการส่งต่อความช่วยเหลือ (3 ด้าน)
							</span>
							<span class="font-mono text-xs text-slate-400">3 คอลัมน์</span>
						</div>
						<div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
							<!-- 1. Kitchen & Energy / Food Supply -->
							<div
								class="space-y-2.5 rounded-xl border-2 border-orange-200/90 bg-white p-4 shadow-2xs transition-all hover:border-orange-300"
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-600"
										>
											<Utensils class="h-4 w-4" />
										</div>
										<div>
											<div class="text-xs font-bold text-slate-900">ครัวกลาง & เสบียง</div>
											<div class="text-xs text-slate-500">Kitchen & Food Supply</div>
										</div>
									</div>
									<span class="badge-kitchen">#EA580C</span>
								</div>
								<p class="text-xs text-slate-600">
									บริหารจัดการอาหารปรุงสุก ถังก๊าซ LPG และการรับมอบเสบียงอาหาร
								</p>
								<div class="flex items-center gap-1 pt-1 font-mono text-xs text-slate-400">
									<span>Token:</span>
									<code class="font-semibold text-orange-700">operations.kitchen</code>
								</div>
							</div>

							<!-- 2. Family Care (Maternal & Infant) -->
							<div
								class="space-y-2.5 rounded-xl border-2 border-rose-200/90 bg-white p-4 shadow-2xs transition-all hover:border-rose-300"
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600"
										>
											<Baby class="h-4 w-4" />
										</div>
										<div>
											<div class="text-xs font-bold text-slate-900">แม่และเด็ก / มีครรภ์</div>
											<div class="text-xs text-slate-500">Maternal & Infant</div>
										</div>
									</div>
									<span class="badge-family">#E11D48</span>
								</div>
								<p class="text-xs text-slate-600">
									นมผงเด็กอ่อน แพมเพิส มุมให้นมแม่ และการดูแลสตรีมีครรภ์
								</p>
								<div class="flex items-center gap-1 pt-1 font-mono text-xs text-slate-400">
									<span>Token:</span>
									<code class="font-semibold text-rose-700">operations.family</code>
								</div>
							</div>

							<!-- 3. Donors & Family Tracing -->
							<div
								class="space-y-2.5 rounded-xl border-2 border-sky-200/90 bg-white p-4 shadow-2xs transition-all hover:border-sky-300"
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-600"
										>
											<HeartHandshake class="h-4 w-4" />
										</div>
										<div>
											<div class="text-xs font-bold text-slate-900">ผู้บริจาค & ค้นหาญาติ</div>
											<div class="text-xs text-slate-500">Donors & Tracing</div>
										</div>
									</div>
									<span class="badge-donor">#0284C7</span>
								</div>
								<p class="text-xs text-slate-600">
									ลงทะเบียนของบริจาค ความต้องการสิ่งของ และการติดตามหาญาติ
								</p>
								<div class="flex items-center gap-1 pt-1 font-mono text-xs text-slate-400">
									<span>Token:</span>
									<code class="font-semibold text-sky-700">operations.donor</code>
								</div>
							</div>
						</div>
					</div>

					<!-- Row 2: Field Force & SPHERE Standards (2 Areas) -->
					<div class="space-y-2 pt-1">
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
								<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
								แถวที่ 2: กลุ่มงานกำลังพลอาสาสมัคร และมาตรฐานสากล SPHERE (2 ด้าน)
							</span>
							<span class="font-mono text-xs text-slate-400">2 คอลัมน์</span>
						</div>
						<div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
							<!-- 4. Volunteers & Field Responders -->
							<div
								class="space-y-2.5 rounded-xl border-2 border-emerald-200/90 bg-white p-4 shadow-2xs transition-all hover:border-emerald-300"
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600"
										>
											<UserPlus class="h-4 w-4" />
										</div>
										<div>
											<div class="text-xs font-bold text-slate-900">จิตอาสา & การแพทย์</div>
											<div class="text-xs text-slate-500">Volunteers & Care</div>
										</div>
									</div>
									<span class="badge-volunteer">#059669</span>
								</div>
								<p class="text-xs text-slate-600">
									ลงทะเบียนอาสาสมัคร จัดกะการทำงาน และภารกิจแพทย์สนาม
								</p>
								<div class="flex items-center gap-1 pt-1 font-mono text-xs text-slate-400">
									<span>Token:</span>
									<code class="font-semibold text-emerald-700">operations.volunteer</code>
								</div>
							</div>

							<!-- 5. Inventory & SPHERE -->
							<div
								class="space-y-2.5 rounded-xl border-2 border-teal-200/90 bg-white p-4 shadow-2xs transition-all hover:border-teal-300"
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-600"
										>
											<Package class="h-4 w-4" />
										</div>
										<div>
											<div class="text-xs font-bold text-slate-900">มาตรฐาน SPHERE</div>
											<div class="text-xs text-slate-500">Catalog & SPHERE</div>
										</div>
									</div>
									<span class="badge-inventory">#0D9488</span>
								</div>
								<p class="text-xs text-slate-600">
									สัดส่วนสิ่งของจำเป็นต่อคน/วัน แคตตาล็อกกลาง และพัสดุยังชีพ
								</p>
								<div class="flex items-center gap-1 pt-1 font-mono text-xs text-slate-400">
									<span>Token:</span>
									<code class="font-semibold text-teal-700">operations.inventory</code>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- 3. Functional UI Tokens -->
				<div class="space-y-3 pt-2">
					<h3 class="text-xs font-bold tracking-wider text-slate-500 uppercase">
						4. Functional UI Tokens (Accent, Warning Advisory & Muted)
					</h3>
					<div class="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
						<!-- Accent -->
						<div class="space-y-2 rounded-xl border border-sky-200 bg-sky-50/40 p-3.5">
							<div class="flex items-center justify-between">
								<span class="badge-accent">Accent Ice Blue</span>
								<span class="font-mono text-xs text-slate-500">#0284C7 / #F0F9FF</span>
							</div>
							<p class="text-xs text-slate-600">
								ใช้สำหรับไฮไลท์แถวใน Data Table ที่กำลังเลือก (Row Selection), กรอบโฟกัสที่นุ่มนวล
								และแท็กเน้นฟีเจอร์สำคัญ
							</p>
							<div class="text-xs font-semibold text-sky-800">
								คลาส: <code>.badge-accent</code> / <code>bg-sky-50/40 border-sky-200</code>
							</div>
						</div>

						<!-- Warning Advisory -->
						<div class="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
							<div class="flex items-center justify-between">
								<span class="badge-warning-advisory">Warning Advisory</span>
								<span class="font-mono text-xs text-slate-500">#F59E0B / #FFFBEB</span>
							</div>
							<p class="text-xs text-slate-600">
								ใช้สำหรับข้อความคำแนะนำทั่วไป กล่องข้อสังเกต หรือการแจ้งเตือนที่ไม่ใช่วิกฤตเร่งด่วน
								(Non-emergency notice)
							</p>
							<div class="text-xs font-semibold text-amber-900">
								คลาส: <code>.badge-warning-advisory</code> /
								<code>border-amber-200 bg-amber-50</code>
							</div>
						</div>

						<!-- Muted Slate -->
						<div class="space-y-2 rounded-xl border border-slate-200 bg-slate-100/70 p-3.5">
							<div class="flex items-center justify-between">
								<span class="badge-muted">Muted Slate</span>
								<span class="font-mono text-xs text-slate-500">#64748B / #F1F5F9</span>
							</div>
							<p class="text-xs text-slate-600">
								ใช้สำหรับสถานะที่ไม่ระบุ รายการที่ปิดใช้งานแล้ว ข้อมูลเก่า
								หรือกล่องข้อความช่วยเหลือรอง (Secondary panels)
							</p>
							<div class="text-xs font-semibold text-slate-700">
								คลาส: <code>.badge-muted</code> / <code>bg-slate-100 border-slate-200</code>
							</div>
						</div>
					</div>
				</div>

				<!-- 4. Public Portal Application (4 Essential Service Cards) -->
				<div class="space-y-4 border-t border-slate-100 pt-2">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-xs font-bold tracking-wider text-slate-700 uppercase">
								5. Public Portal Practical Application (การประยุกต์ใช้สีหลักในพอร์ทัลบริการประชาชน)
							</h3>
							<p class="mt-0.5 text-xs text-slate-500">
								เชื่อมโยง 4 บริการหลักด้วยสีแม่บท สอดประสาน 360° Tinted Border และปุ่ม Action ชัดเจน
							</p>
						</div>
						<span
							class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
						>
							100% Harmonized Tokens
						</span>
					</div>

					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<!-- Card 1: Shelter Search (Red / Destructive-Triage) -->
						<div
							class="flex flex-col justify-between space-y-4 rounded-2xl border-2 border-red-200 bg-white p-5 shadow-2xs transition-all hover:border-red-300 hover:shadow-xs"
						>
							<div class="space-y-3">
								<div class="flex items-center justify-between">
									<div
										class="flex h-11 w-11 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-600"
									>
										<ShieldAlert class="h-5 w-5" />
									</div>
									<span
										class="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 font-mono text-xs font-bold text-red-700"
									>
										#DC2626
									</span>
								</div>
								<div>
									<h4 class="text-base font-bold text-slate-900">1. ค้นหาที่พักพิง</h4>
									<p class="mt-1 text-xs leading-relaxed text-slate-500">
										ค้นหาศูนย์พักพิงใกล้ตัว ตรวจสอบเตียงว่าง
										และลงทะเบียนแจ้งความประสงค์เข้าพักพิงล่วงหน้า
									</p>
								</div>
							</div>
							<div class="space-y-2 border-t border-red-50 pt-1">
								<button
									class="flex w-full items-center justify-center gap-1 rounded-xl bg-red-600 px-3 py-2.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-red-700"
								>
									<span>ค้นหาศูนย์พักพิง</span>
									<ChevronRight class="h-3.5 w-3.5" />
								</button>
								<button
									class="flex w-full items-center justify-center gap-1 rounded-xl border border-red-100/80 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
								>
									<span>ลงทะเบียนเข้าพักล่วงหน้า</span>
									<ChevronRight class="h-3.5 w-3.5" />
								</button>
								<div class="pt-0.5 text-center font-mono text-xs text-slate-400">
									Token: <code class="font-semibold text-red-700">portalServices.shelter</code>
								</div>
							</div>
						</div>

						<!-- Card 2: Family Tracing (Navy & Cerulean) -->
						<div
							class="flex flex-col justify-between space-y-4 rounded-2xl border-2 border-sky-200 bg-white p-5 shadow-2xs transition-all hover:border-sky-300 hover:shadow-xs"
						>
							<div class="space-y-3">
								<div class="flex items-center justify-between">
									<div
										class="flex h-11 w-11 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-[#0284C7]"
									>
										<Search class="h-5 w-5" />
									</div>
									<span
										class="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 font-mono text-xs font-bold text-[#0284C7]"
									>
										#0A2647
									</span>
								</div>
								<div>
									<h4 class="text-base font-bold text-slate-900">2. ค้นหาญาติ / ผู้พักพิง</h4>
									<p class="mt-1 text-xs leading-relaxed text-slate-500">
										ค้นหารายชื่อผู้พักพิง ตรวจสอบสถานะความปลอดภัย
										และพิกัดศูนย์พักพิงที่คนในครอบครัวเข้าพักอยู่
									</p>
								</div>
							</div>
							<div class="space-y-2 border-t border-sky-50 pt-1">
								<button
									class="flex w-full items-center justify-center gap-1 rounded-xl bg-[#0A2647] px-3 py-2.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-[#051930]"
								>
									<span>ค้นหารายชื่อผู้พักพิง</span>
									<ArrowRight class="h-3.5 w-3.5" />
								</button>
								<button
									class="flex w-full items-center justify-center gap-1 rounded-xl border border-sky-100/80 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100"
								>
									<MapPin class="h-3.5 w-3.5 text-sky-600" />
									<span>ดูแผนที่พิกัดศูนย์พักพิง</span>
								</button>
								<div class="pt-0.5 text-center font-mono text-xs text-slate-400">
									Token: <code class="font-semibold text-sky-700">portalServices.tracing</code>
								</div>
							</div>
						</div>

						<!-- Card 3: Donors & Supplies (Warm Amber) -->
						<div
							class="flex flex-col justify-between space-y-4 rounded-2xl border-2 border-amber-200 bg-white p-5 shadow-2xs transition-all hover:border-amber-300 hover:shadow-xs"
						>
							<div class="space-y-3">
								<div class="flex items-center justify-between">
									<div
										class="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-100 bg-amber-50 text-amber-600"
									>
										<Package class="h-5 w-5" />
									</div>
									<span
										class="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-mono text-xs font-bold text-amber-700"
									>
										#EA580C
									</span>
								</div>
								<div>
									<h4 class="text-base font-bold text-slate-900">3. ผู้บริจาค / มอบเสบียง</h4>
									<p class="mt-1 text-xs leading-relaxed text-slate-500">
										ประสานงานมอบอาหารปรุงสุก น้ำดื่ม สิ่งของจำเป็น หรือสมทบทุนช่วยเหลือผู้ประสบภัย
									</p>
								</div>
							</div>
							<div class="space-y-2 border-t border-amber-50 pt-1">
								<button
									class="flex w-full items-center justify-center gap-1 rounded-xl bg-amber-600 px-3 py-2.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-amber-700"
								>
									<span>แจ้งความประสงค์บริจาค</span>
									<ChevronRight class="h-3.5 w-3.5" />
								</button>
								<button
									class="flex w-full items-center justify-center gap-1 rounded-xl border border-amber-100/80 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
								>
									<span>ตรวจสอบสถานะการบริจาค</span>
									<ArrowRight class="h-3.5 w-3.5" />
								</button>
								<div class="pt-0.5 text-center font-mono text-xs text-slate-400">
									Token: <code class="font-semibold text-amber-700">portalServices.donation</code>
								</div>
							</div>
						</div>

						<!-- Card 4: Volunteers & Community (Emerald Green) -->
						<div
							class="flex flex-col justify-between space-y-4 rounded-2xl border-2 border-emerald-200 bg-white p-5 shadow-2xs transition-all hover:border-emerald-300 hover:shadow-xs"
						>
							<div class="space-y-3">
								<div class="flex items-center justify-between">
									<div
										class="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600"
									>
										<UserPlus class="h-5 w-5" />
									</div>
									<span
										class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-700"
									>
										#059669
									</span>
								</div>
								<div>
									<h4 class="text-base font-bold text-slate-900">4. จิตอาสา / อาสาสมัคร</h4>
									<p class="mt-1 text-xs leading-relaxed text-slate-500">
										ลงทะเบียนร่วมช่วยเหลือ เลือกลงกะตามความถนัด เช่น ทีมแพทย์สนาม ครัวกลาง
										และขนย้ายผู้ประสบภัย
									</p>
								</div>
							</div>
							<div class="space-y-2 border-t border-emerald-50 pt-1">
								<button
									class="flex w-full items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-emerald-700"
								>
									<span>สมัครจิตอาสา (เลือกลงกะ)</span>
									<ChevronRight class="h-3.5 w-3.5" />
								</button>
								<button
									class="flex w-full items-center justify-center gap-1 rounded-xl border border-emerald-100/80 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100"
								>
									<Home class="h-3.5 w-3.5 text-emerald-600" />
									<span>ลงทะเบียนเปิดบ้านพี่เลี้ยง</span>
								</button>
								<div class="pt-0.5 text-center font-mono text-xs text-slate-400">
									Token: <code class="font-semibold text-emerald-700">portalServices.volunteer</code
									>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- 5. Interactive FAQ Accordion & Emergency Quick Callouts -->
				<div class="grid grid-cols-1 gap-5 pt-2 lg:grid-cols-12">
					<!-- FAQ Accordion (7 cols) -->
					<div
						class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 sm:p-5 lg:col-span-7"
					>
						<div class="flex items-center justify-between">
							<h3 class="text-xs font-bold tracking-wider text-slate-700 uppercase">
								6. Emergency FAQ Accordion Standards
							</h3>
							<span class="text-xs text-slate-500">คลิกเพื่อทดสอบ Active/Inactive State</span>
						</div>

						<div class="space-y-2.5">
							<!-- FAQ Item 1 (Active by default) -->
							<div
								class="rounded-xl border transition-all {faqOpenItem === 1
									? 'border-sky-300 bg-white shadow-2xs'
									: 'border-slate-200 bg-white hover:border-slate-300'}"
							>
								<button
									onclick={() => (faqOpenItem = faqOpenItem === 1 ? null : 1)}
									class="flex w-full items-center justify-between p-3.5 text-left"
								>
									<div class="flex items-center gap-3">
										<span
											class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors {faqOpenItem ===
											1
												? 'bg-[#0A2647] text-white'
												: 'bg-slate-100 text-slate-600'}"
										>
											1
										</span>
										<span class="text-xs font-bold text-slate-900 sm:text-sm">
											นำสัตว์เลี้ยง (สุนัข/แมว) เข้าพักที่ศูนย์ไหนได้บ้าง?
										</span>
									</div>
									{#if faqOpenItem === 1}
										<ChevronUp class="h-4 w-4 shrink-0 text-slate-500" />
									{:else}
										<ChevronDown class="h-4 w-4 shrink-0 text-slate-400" />
									{/if}
								</button>
								{#if faqOpenItem === 1}
									<div
										class="border-t border-sky-50 px-3.5 pt-1 pb-3.5 text-xs leading-relaxed text-slate-600"
									>
										ศูนย์ประชุม ม.สงขลานครินทร์ (ม.อ.) มีการจัด ‘โซนคนและสัตว์เลี้ยง (Pet-Friendly
										Zone)’ เฉพาะ โดยขอให้เตรียมกรงหรือสายจูง และสมุดวัคซีนหากมี
										เพื่อสุขอนามัยและความปลอดภัยของผู้ประสบภัยทุกท่าน
									</div>
								{/if}
							</div>

							<!-- FAQ Item 2 -->
							<div
								class="rounded-xl border transition-all {faqOpenItem === 2
									? 'border-sky-300 bg-white shadow-2xs'
									: 'border-slate-200 bg-white hover:border-slate-300'}"
							>
								<button
									onclick={() => (faqOpenItem = faqOpenItem === 2 ? null : 2)}
									class="flex w-full items-center justify-between p-3.5 text-left"
								>
									<div class="flex items-center gap-3">
										<span
											class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors {faqOpenItem ===
											2
												? 'bg-[#0A2647] text-white'
												: 'bg-slate-100 text-slate-600'}"
										>
											2
										</span>
										<span class="text-xs font-bold text-slate-900 sm:text-sm">
											การสืบค้นรายชื่อญาติ มีการป้องกันข้อมูลส่วนบุคคล (PDPA) อย่างไร?
										</span>
									</div>
									{#if faqOpenItem === 2}
										<ChevronUp class="h-4 w-4 shrink-0 text-slate-500" />
									{:else}
										<ChevronDown class="h-4 w-4 shrink-0 text-slate-400" />
									{/if}
								</button>
								{#if faqOpenItem === 2}
									<div
										class="border-t border-sky-50 px-3.5 pt-1 pb-3.5 text-xs leading-relaxed text-slate-600"
									>
										ระบบสืบค้นญาติจะ Mask เลขบัตรประชาชนและข้อมูลส่วนตัวที่ละเอียดอ่อน
										จะแสดงเฉพาะชื่อ-นามสกุล, สถานะความปลอดภัย (Safe)
										และชื่อศูนย์พักพิงที่ลงทะเบียนไว้เท่านั้น เพื่อความปลอดภัยสูงสุด
									</div>
								{/if}
							</div>

							<!-- FAQ Item 3 -->
							<div
								class="rounded-xl border transition-all {faqOpenItem === 3
									? 'border-sky-300 bg-white shadow-2xs'
									: 'border-slate-200 bg-white hover:border-slate-300'}"
							>
								<button
									onclick={() => (faqOpenItem = faqOpenItem === 3 ? null : 3)}
									class="flex w-full items-center justify-between p-3.5 text-left"
								>
									<div class="flex items-center gap-3">
										<span
											class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors {faqOpenItem ===
											3
												? 'bg-[#0A2647] text-white'
												: 'bg-slate-100 text-slate-600'}"
										>
											3
										</span>
										<span class="text-xs font-bold text-slate-900 sm:text-sm">
											หากต้องการเปิดบ้านเป็น 'บ้านพี่เลี้ยง' พักพิงชั่วคราว ต้องทำอย่างไร?
										</span>
									</div>
									{#if faqOpenItem === 3}
										<ChevronUp class="h-4 w-4 shrink-0 text-slate-500" />
									{:else}
										<ChevronDown class="h-4 w-4 shrink-0 text-slate-400" />
									{/if}
								</button>
								{#if faqOpenItem === 3}
									<div
										class="border-t border-sky-50 px-3.5 pt-1 pb-3.5 text-xs leading-relaxed text-slate-600"
									>
										สามารถกดปุ่ม ‘ลงทะเบียนเปิดบ้านพี่เลี้ยง’ ในการ์ดที่ 4
										โดยระบุจำนวนคนที่รองรับได้และสิ่งอำนวยความสะดวก เจ้าหน้าที่ EOC
										จะตรวจสอบและติดต่อกลับเพื่อส่งต่อผู้ประสบภัย
									</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- Floating Controls & Online Hub (5 cols) -->
					<div
						class="flex flex-col justify-between space-y-4 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 sm:p-5 lg:col-span-5"
					>
						<div>
							<h3 class="text-xs font-bold tracking-wider text-slate-700 uppercase">
								7. Floating Emergency Pills & Online Channels
							</h3>
							<p class="mt-1 text-xs text-slate-500">
								ปุ่มด่วนมุมขวาล่าง และช่องทางออนไลน์ด่วนบนพื้นหลัง Brand Navy
							</p>

							<!-- Floating Pills Demo -->
							<div class="flex flex-wrap items-center gap-2.5 pt-3">
								<a
									href="tel:1669"
									class="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-md transition-all hover:bg-red-700 active:scale-95"
								>
									<Phone class="h-4 w-4" />
									<span>1669 โทรฉุกเฉิน</span>
								</a>
								<button
									class="inline-flex items-center gap-2 rounded-full bg-[#0284C7] px-4 py-2 text-xs font-bold text-white shadow-md transition-all hover:bg-[#0369a1] active:scale-95"
								>
									<Bell class="h-4 w-4 text-amber-200" />
									<span>แจ้งเตือนภัย (2)</span>
								</button>
							</div>
						</div>

						<!-- Footer Online Channels Hub Preview -->
						<div class="space-y-2.5 rounded-xl bg-[#0A2647] p-3.5 text-white">
							<div
								class="flex items-center justify-between border-b border-white/10 pb-2 text-xs font-semibold text-slate-300"
							>
								<span>ช่องทางออนไลน์ด่วน (EOC Channels)</span>
								<span class="font-mono text-xs text-sky-400">#0A2647</span>
							</div>
							<div class="space-y-2">
								<div
									class="flex cursor-pointer items-center justify-between rounded-lg border border-white/5 bg-white/10 px-3 py-2 text-xs transition-colors hover:bg-white/15"
								>
									<div class="flex items-center gap-2">
										<span class="h-2 w-2 rounded-full bg-emerald-400"></span>
										<span>LINE OA ฉุกเฉิน</span>
									</div>
									<ExternalLink class="h-3.5 w-3.5 text-slate-400" />
								</div>
								<div
									class="flex cursor-pointer items-center justify-between rounded-lg border border-white/5 bg-white/10 px-3 py-2 text-xs transition-colors hover:bg-white/15"
								>
									<div class="flex items-center gap-2">
										<span class="h-2 w-2 rounded-full bg-sky-400"></span>
										<span>Facebook ข่าวสาร EOC</span>
									</div>
									<ExternalLink class="h-3.5 w-3.5 text-slate-400" />
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- 3. Extraction & Token Mapping Specification Table -->
				<div class="space-y-3 pt-2">
					<div class="flex items-center justify-between">
						<h3 class="text-xs font-bold tracking-wider text-slate-500 uppercase">
							4. Color Extraction & Civic Light Token Mapping Matrix
						</h3>
						<span class="text-xs text-slate-400">การเทียบค่าสีจาก Mockup สู่ Invariant Token</span>
					</div>

					<div class="overflow-x-auto rounded-xl border border-slate-200">
						<table class="w-full text-left text-xs">
							<thead class="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
								<tr>
									<th class="px-4 py-2.5">UI Component / Service Role</th>
									<th class="px-4 py-2.5">Extracted Hex</th>
									<th class="px-4 py-2.5">Civic Light Token</th>
									<th class="px-4 py-2.5">Accessibility Contrast</th>
									<th class="px-4 py-2.5">Standard Usage Rule</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100 text-slate-600">
								<tr class="hover:bg-slate-50/60">
									<td class="flex items-center gap-2 px-4 py-2.5 font-bold text-slate-900">
										<span class="h-3 w-3 rounded-full bg-[#DC2626]"></span>
										ค้นหาที่พักพิง (Card 1)
									</td>
									<td class="px-4 py-2.5 font-mono text-slate-500">#E7000B</td>
									<td class="px-4 py-2.5 font-mono font-semibold text-red-700"
										>portalServices.shelter (#DC2626)</td
									>
									<td class="px-4 py-2.5 font-semibold text-emerald-700">4.8:1 (WCAG AA)</td>
									<td class="px-4 py-2.5"
										>ปุ่มแดงสำหรับค้นหาที่พักพิงด่วน กรอบการ์ดสีแดงอ่อน 360°</td
									>
								</tr>
								<tr class="hover:bg-slate-50/60">
									<td class="flex items-center gap-2 px-4 py-2.5 font-bold text-slate-900">
										<span class="h-3 w-3 rounded-full bg-[#0A2647]"></span>
										ค้นหาญาติ / ผู้พักพิง (Card 2)
									</td>
									<td class="px-4 py-2.5 font-mono text-slate-500">#013365 / #0284C7</td>
									<td class="px-4 py-2.5 font-mono font-semibold text-sky-800"
										>portalServices.tracing (#0A2647 / #0284C7)</td
									>
									<td class="px-4 py-2.5 font-semibold text-emerald-700">14.2:1 (WCAG AAA)</td>
									<td class="px-4 py-2.5">ปุ่ม Navy หลักสำหรับสืบค้นญาติ กรอบการ์ดสีฟ้าอ่อน</td>
								</tr>
								<tr class="hover:bg-slate-50/60">
									<td class="flex items-center gap-2 px-4 py-2.5 font-bold text-slate-900">
										<span class="h-3 w-3 rounded-full bg-[#EA580C]"></span>
										ผู้บริจาค / มอบเสบียง (Card 3)
									</td>
									<td class="px-4 py-2.5 font-mono text-slate-500">#E17100</td>
									<td class="px-4 py-2.5 font-mono font-semibold text-amber-700"
										>portalServices.donation (#EA580C)</td
									>
									<td class="px-4 py-2.5 font-semibold text-emerald-700">5.1:1 (WCAG AA)</td>
									<td class="px-4 py-2.5"
										>ปุ่ม Amber สำหรับการบริจาคเสบียง สอดคล้องกับโทนครัวกลาง</td
									>
								</tr>
								<tr class="hover:bg-slate-50/60">
									<td class="flex items-center gap-2 px-4 py-2.5 font-bold text-slate-900">
										<span class="h-3 w-3 rounded-full bg-[#059669]"></span>
										จิตอาสา / อาสาสมัคร (Card 4)
									</td>
									<td class="px-4 py-2.5 font-mono text-slate-500">#009866</td>
									<td class="px-4 py-2.5 font-mono font-semibold text-emerald-700"
										>portalServices.volunteer (#059669)</td
									>
									<td class="px-4 py-2.5 font-semibold text-emerald-700">4.6:1 (WCAG AA)</td>
									<td class="px-4 py-2.5"
										>ปุ่ม Emerald สำหรับงานจิตอาสา กรอบการ์ดสีเขียวมิ้นต์อ่อน</td
									>
								</tr>
								<tr class="hover:bg-slate-50/60">
									<td class="flex items-center gap-2 px-4 py-2.5 font-bold text-slate-900">
										<span class="h-3 w-3 rounded-full bg-[#0A2647]"></span>
										Hero Banner & Footer
									</td>
									<td class="px-4 py-2.5 font-mono text-slate-500">#0C3C78</td>
									<td class="px-4 py-2.5 font-mono font-semibold text-slate-800"
										>colors.brand.navy (#0A2647)</td
									>
									<td class="px-4 py-2.5 font-semibold text-emerald-700">14.2:1 (WCAG AAA)</td>
									<td class="px-4 py-2.5">ใช้ Brand Navy ของ Civic Light เป็น Invariant หลัก</td>
								</tr>
								<tr class="hover:bg-slate-50/60">
									<td class="flex items-center gap-2 px-4 py-2.5 font-bold text-slate-900">
										<span class="h-3 w-3 rounded-full bg-red-600"></span>
										Floating 1669 Hotline
									</td>
									<td class="px-4 py-2.5 font-mono text-slate-500">#EA202A</td>
									<td class="px-4 py-2.5 font-mono font-semibold text-red-700"
										>colors.destructive.red (#DC2626)</td
									>
									<td class="px-4 py-2.5 font-semibold text-emerald-700">4.8:1 (WCAG AA)</td>
									<td class="px-4 py-2.5">Pill ลอยมุมขวาเพื่อการโทรด่วนฉุกเฉิน 1669</td>
								</tr>
								<tr class="hover:bg-slate-50/60">
									<td class="flex items-center gap-2 px-4 py-2.5 font-bold text-slate-900">
										<span class="h-3 w-3 rounded-full bg-[#0284C7]"></span>
										Floating Alert (แจ้งเตือนภัย)
									</td>
									<td class="px-4 py-2.5 font-mono text-slate-500">#0C3C78</td>
									<td class="px-4 py-2.5 font-mono font-semibold text-sky-700"
										>colors.brand.secondary (#0284C7)</td
									>
									<td class="px-4 py-2.5 font-semibold text-emerald-700">4.5:1 (WCAG AA)</td>
									<td class="px-4 py-2.5"
										>ปรับเป็น Secondary Cerulean เพื่อแยกชั้นความสำคัญจากการโทร 1669 และไม่กลืนกับ
										Footer</td
									>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</section>

			<!-- ✍️ 7. TYPOGRAPHY SCALE & HIERARCHY SPECIFICATION -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Type class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								7. Typography Scale & Hierarchy Standards
							</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							กำหนดขนาดตัวอักษร ความหนา Line-height และการใช้งานสำหรับ H1-H4, p, span, badge, metric
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('typography')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.typography ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.typography, 'Typography Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.typography}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.typography}</pre>
					</div>
				{/if}

				<!-- Typography Scale Table -->
				<div class="overflow-x-auto rounded-xl border border-slate-200/80">
					<table class="w-full text-left text-sm">
						<thead
							class="border-b border-slate-200/80 bg-slate-50/75 text-xs font-medium text-slate-500"
						>
							<tr>
								<th class="px-4 py-3">Tag / Type</th>
								<th class="px-4 py-3">Size (px / rem)</th>
								<th class="px-4 py-3">Weight</th>
								<th class="px-4 py-3">Color</th>
								<th class="px-4 py-3">Tailwind Classes</th>
								<th class="px-4 py-3">การใช้งาน (Usage)</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100 font-sans text-xs">
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-[#0A2647]">h1</td>
								<td class="px-4 py-3 font-mono">36px - 40px (2.25 - 2.5rem)</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Extrabold (800)</td>
								<td class="px-4 py-3 font-mono text-slate-600">#0A2647</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-3xl sm:text-4xl font-extrabold text-[#0A2647] tracking-tight</td
								>
								<td class="px-4 py-3 text-slate-600">ชื่อหน้าหลัก (Page Hero Title)</td>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-slate-900">h2</td>
								<td class="px-4 py-3 font-mono">24px - 28px (1.5 - 1.75rem)</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Bold (700)</td>
								<td class="px-4 py-3 font-mono text-slate-600">#0F172A</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight</td
								>
								<td class="px-4 py-3 text-slate-600">หัวข้อหมวดหมู่ใหญ่ (Section Title)</td>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-slate-900">h3</td>
								<td class="px-4 py-3 font-mono">18px - 20px (1.125 - 1.25rem)</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Bold (700)</td>
								<td class="px-4 py-3 font-mono text-slate-600">#0F172A</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-lg sm:text-xl font-bold text-slate-900</td
								>
								<td class="px-4 py-3 text-slate-600"
									>หัวข้อการ์ด, บอร์ด, โมดอล (Card / Modal Title)</td
								>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-slate-800">h4</td>
								<td class="px-4 py-3 font-mono">15px - 16px (0.9375 - 1rem)</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Semibold (600)</td>
								<td class="px-4 py-3 font-mono text-slate-600">#1E293B</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-base font-semibold text-slate-800</td
								>
								<td class="px-4 py-3 text-slate-600">หัวข้อย่อยในฟอร์ม, ชื่อกลุ่มตัวเลือก</td>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-slate-700">p.lead</td>
								<td class="px-4 py-3 font-mono">18px (1.125rem)</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Medium (500)</td>
								<td class="px-4 py-3 font-mono text-slate-600">#334155</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-lg text-slate-700 leading-relaxed</td
								>
								<td class="px-4 py-3 text-slate-600"
									>ข้อความสำคัญสำหรับอ่านระยะ 1 เมตร (Field Lead)</td
								>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-slate-700">p</td>
								<td class="px-4 py-3 font-mono">16px (1rem)</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Normal (400)</td>
								<td class="px-4 py-3 font-mono text-slate-600">#334155</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-base text-slate-700 leading-normal</td
								>
								<td class="px-4 py-3 text-slate-600">ข้อความเนื้อหาทั่วไป (Standard Body Text)</td>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-slate-500">p.small</td>
								<td class="px-4 py-3 font-mono">14px (0.875rem)</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Normal (400)</td>
								<td class="px-4 py-3 font-mono text-slate-600">#64748B</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-sm text-slate-500 leading-normal</td
								>
								<td class="px-4 py-3 text-slate-600">คำอธิบายใต้ช่องกรอก (Helper Text), หมายเหตุ</td
								>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-slate-700">label</td>
								<td class="px-4 py-3 font-mono">14px (0.875rem)</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Semibold (600)</td>
								<td class="px-4 py-3 font-mono text-slate-600">#334155</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-sm font-semibold text-slate-700</td
								>
								<td class="px-4 py-3 text-slate-600">ป้ายกำกับฟิลด์ (Form Label)</td>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-slate-600">span.badge</td>
								<td class="px-4 py-3 font-mono">12px (0.75rem)</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Semibold (600)</td>
								<td class="px-4 py-3 font-mono text-slate-600">Semantic Tint</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-xs font-semibold tracking-wide</td
								>
								<td class="px-4 py-3 text-slate-600">ป้ายระบุสถานะ, Triage Tag</td>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="px-4 py-3 font-mono font-bold text-[#0A2647]">.metric-lg</td>
								<td class="px-4 py-3 font-mono">36px - 44px</td>
								<td class="px-4 py-3 font-semibold text-slate-900">Bold (700)</td>
								<td class="px-4 py-3 font-mono text-slate-600">#0F172A / Status</td>
								<td class="px-4 py-3 font-mono text-blue-900"
									>text-3xl sm:text-4xl font-bold tabular-nums</td
								>
								<td class="px-4 py-3 text-slate-600"
									>ตัวเลขชี้วัดสถิติความจุศูนย์ (Telemetry KPI)</td
								>
							</tr>
						</tbody>
					</table>
				</div>
			</section>

			<!-- 📊 8. STATUS TELEMETRY CARDS (FULL 360° BORDER) -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<LayoutDashboard class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								8. Status Telemetry Cards (360° Framing)
							</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							การ์ดสถิติตัวชี้วัดความจุและระดับความวิกฤต (360-degree border, ตัวเลข 36px
							tabular-nums)
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('telemetry')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.telemetry ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.telemetry, 'Telemetry Card Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.telemetry}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.telemetry}</pre>
					</div>
				{/if}

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<!-- Operational Card -->
					<div
						class="space-y-3 rounded-xl border border-emerald-200/90 bg-white p-5 shadow-2xs transition-all hover:border-emerald-300"
					>
						<div class="flex items-center justify-between">
							<span class="text-xs font-semibold tracking-wider text-slate-500 uppercase"
								>ศูนย์เปิดทำการ</span
							>
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
								พร้อมรับ <span class="tabular-nums">75%</span>
							</span>
						</div>
						<div class="flex items-baseline gap-2">
							<span class="text-3xl font-bold text-slate-900 tabular-nums sm:text-4xl">18</span>
							<span class="text-xs font-semibold text-slate-400"
								>/ <span class="tabular-nums">24</span> แห่ง</span
							>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full bg-emerald-600" style="width: 75%"></div>
						</div>
					</div>

					<!-- Warning Card -->
					<div
						class="space-y-3 rounded-xl border border-amber-200/90 bg-white p-5 shadow-2xs transition-all hover:border-amber-300"
					>
						<div class="flex items-center justify-between">
							<span class="text-xs font-semibold tracking-wider text-slate-500 uppercase"
								>อัตราครองเตียง</span
							>
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
								โหลดสูง <span class="tabular-nums">82%</span>
							</span>
						</div>
						<div class="flex items-baseline gap-2">
							<span class="text-3xl font-bold text-slate-900 tabular-nums sm:text-4xl">3,420</span>
							<span class="text-xs font-semibold text-slate-400"
								>/ <span class="tabular-nums">4,150</span> เตียง</span
							>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full bg-amber-500" style="width: 82.4%"></div>
						</div>
					</div>

					<!-- Critical Card -->
					<div
						class="space-y-3 rounded-xl border border-red-200/90 bg-white p-5 shadow-2xs transition-all hover:border-red-300"
					>
						<div class="flex items-center justify-between">
							<span class="text-xs font-semibold tracking-wider text-slate-500 uppercase"
								>กลุ่มเปราะบาง (Red)</span
							>
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-900"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>
								<span class="tabular-nums">48</span> วิกฤต
							</span>
						</div>
						<div class="flex items-baseline gap-2">
							<span class="text-3xl font-bold text-red-600 tabular-nums sm:text-4xl">412</span>
							<span class="text-xs font-semibold text-slate-400">คน</span>
						</div>
						<div class="grid grid-cols-2 gap-2 pt-1 text-xs font-medium text-slate-700">
							<div
								class="rounded-lg border border-red-100 bg-red-50/70 p-1.5 text-center text-red-900"
							>
								ติดเตียง: <strong class="font-bold tabular-nums">48</strong>
							</div>
							<div
								class="rounded-lg border border-slate-200/80 bg-slate-50 p-1.5 text-center text-slate-700"
							>
								สูงอายุ: <strong class="font-bold tabular-nums">284</strong>
							</div>
						</div>
					</div>

					<!-- Supply Card -->
					<div
						class="space-y-3 rounded-xl border border-sky-200/90 bg-white p-5 shadow-2xs transition-all hover:border-sky-300"
					>
						<div class="flex items-center justify-between">
							<span class="text-xs font-semibold tracking-wider text-slate-500 uppercase"
								>สำรองอาหาร (DoC)</span
							>
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-900"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-sky-600"></span>
								สำรอง <span class="tabular-nums">4.8</span> วัน
							</span>
						</div>
						<div class="flex items-baseline gap-2">
							<span class="text-3xl font-bold text-[#0A2647] tabular-nums sm:text-4xl">10,260</span>
							<span class="text-xs font-semibold text-slate-400">มื้อ/วัน</span>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full bg-sky-600" style="width: 68%"></div>
						</div>
					</div>
				</div>
			</section>

			<!-- 📝 9. FORM CONTROLS & INPUTS (SHADCN-SVELTE) -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Layers class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								9. Form Controls & shadcn-svelte Inputs
							</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							แบบฟอร์มมาตรฐาน shadcn-svelte ช่องกรอกข้อมูล ตัวเลือก วันที่ สวิตช์
							และการตรวจสอบความถูกต้อง
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('forms')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.forms ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.forms, 'Forms Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.forms}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.forms}</pre>
					</div>
				{/if}

				<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
					<!-- Standard Input with Label -->
					<div class="space-y-1.5">
						<Label
							for="f-name"
							class="flex items-center justify-between text-sm font-semibold text-slate-700"
						>
							<span>ชื่อ-นามสกุล <span class="text-red-500">*</span></span>
							<span class="text-xs font-normal text-slate-400">ภาษาไทย</span>
						</Label>
						<Input
							id="f-name"
							type="text"
							bind:value={sampleName}
							placeholder="ระบุชื่อจริงตามบัตรประชาชน"
							class="h-10 text-sm"
						/>
						<p class="text-xs text-slate-500">ระบุชื่อจริงและนามสกุลตามบัตรประชาชน</p>
					</div>

					<!-- Valid Input with Leading Icon -->
					<div class="space-y-1.5">
						<Label
							for="f-cid"
							class="flex items-center justify-between text-sm font-semibold text-slate-700"
						>
							<span
								>เลขประจำตัวประชาชน <span class="font-medium text-emerald-600">✓ ถูกต้อง</span
								></span
							>
							<span class="text-xs text-slate-400">13 หลัก</span>
						</Label>
						<div class="relative">
							<Input
								id="f-cid"
								type="text"
								bind:value={sampleCid}
								class="h-10 border-emerald-500/80 bg-emerald-50/10 pr-9 text-sm tabular-nums focus-visible:ring-emerald-500/30"
							/>
							<CheckCircle2
								class="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-emerald-600"
							/>
						</div>
						<p class="text-xs text-emerald-700">ตรวจสอบฐานข้อมูลประชากรเรียบร้อย</p>
					</div>

					<!-- Invalid Input State -->
					<div class="space-y-1.5">
						<Label
							for="f-err"
							class="flex items-center justify-between text-sm font-semibold text-red-700"
						>
							<span>รหัสส่งต่อ <span class="font-medium text-red-600">✕ ไม่ถูกต้อง</span></span>
							<span class="text-xs font-semibold text-red-400">REF-ID</span>
						</Label>
						<div class="relative">
							<Input
								id="f-err"
								type="text"
								bind:value={sampleErrorInput}
								aria-invalid={true}
								class="h-10 border-red-300 bg-red-50/20 pr-9 text-sm text-red-900 tabular-nums focus-visible:ring-red-500/30"
							/>
							<XCircle class="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-red-600" />
						</div>
						<p class="text-xs text-red-600">ไม่พบรหัสส่งต่อนี้ในระบบบัญชาการ EOC</p>
					</div>

					<!-- shadcn Select Dropdown -->
					<div class="space-y-1.5">
						<Label for="f-zone" class="text-sm font-semibold text-slate-700"
							>อาคาร / โซนพักพิง</Label
						>
						<Select.Root type="single" bind:value={sampleZone}>
							<Select.Trigger id="f-zone" class="h-10 w-full text-sm">
								<span
									>{zoneOptions.find((o) => o.value === sampleZone)?.label ??
										'เลือกโซนพักพิง'}</span
								>
							</Select.Trigger>
							<Select.Content>
								{#each zoneOptions as opt (opt.value)}
									<Select.Item value={opt.value} label={opt.label}>
										{opt.label}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<p class="text-xs text-slate-500">เลือกโซนตามกลุ่มการคัดกรอง</p>
					</div>

					<!-- Combobox / Search Select -->
					<div class="space-y-1.5">
						<Label class="text-sm font-semibold text-slate-700">ศูนย์พักพิงปลายทาง (Combobox)</Label
						>
						<Combobox
							items={facilityItems}
							bind:value={sampleFacility}
							placeholder="เลือกศูนย์พักพิง..."
							searchPlaceholder="ค้นหาชื่อศูนย์พักพิง..."
							class="h-10 w-full text-sm"
						/>
						<p class="text-xs text-slate-500">ค้นหาศูนย์พักพิงจากฐานข้อมูลกลาง</p>
					</div>

					<!-- Date Picker -->
					<div class="space-y-1.5">
						<Label for="f-date" class="text-sm font-semibold text-slate-700"
							>วันที่รับเข้าศูนย์ (DatePicker)</Label
						>
						<DatePicker
							id="f-date"
							bind:value={sampleDate}
							placeholder="วว/ดด/ปปปป"
							class="h-10 w-full text-sm"
						/>
						<p class="text-xs text-slate-500">กำหนดวันที่เข้าพักในระบบ</p>
					</div>

					<!-- Textarea -->
					<div class="space-y-1.5 md:col-span-2 lg:col-span-3">
						<Label
							for="f-note"
							class="flex items-center justify-between text-sm font-semibold text-slate-700"
						>
							<span>ประวัติการแพ้ยา / ความต้องการพิเศษ</span>
							<span class="text-xs text-slate-400">ถ้ามี</span>
						</Label>
						<Textarea
							id="f-note"
							rows={3}
							bind:value={sampleNote}
							placeholder="ระบุยาที่ต้องรับประจำ อาหารพิเศษ หรืออุปกรณ์ช่วยเหลือทางการแพทย์..."
							class="w-full text-sm"
						/>
					</div>
				</div>

				<!-- shadcn Switches & Checkboxes -->
				<div class="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
					<!-- Emergency Mode Switch -->
					<div
						class="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5"
					>
						<div class="space-y-0.5">
							<Label for="sw-emergency" class="cursor-pointer text-sm font-bold text-slate-900"
								>Emergency Broadcast</Label
							>
							<p class="text-xs text-slate-500">ส่งแจ้งเตือนไซเรนระดับ 3</p>
						</div>
						<Switch id="sw-emergency" bind:checked={isEmergencyMode} />
					</div>

					<!-- Offline Mode Switch -->
					<div
						class="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5"
					>
						<div class="space-y-0.5">
							<Label for="sw-offline" class="cursor-pointer text-sm font-bold text-slate-900"
								>Offline Local Sync</Label
							>
							<p class="text-xs text-slate-500">บันทึกลง Local Storage</p>
						</div>
						<Switch id="sw-offline" bind:checked={isOfflineMode} />
					</div>

					<!-- Checkbox Option -->
					<div
						class="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5"
					>
						<div class="space-y-0.5">
							<Label for="chk-special" class="cursor-pointer text-sm font-bold text-slate-900"
								>ขอรับเตียงพยาบาล</Label
							>
							<p class="text-xs text-slate-500">สำหรับผู้ป่วยติดเตียง</p>
						</div>
						<Checkbox id="chk-special" bind:checked={needSpecialCare} />
					</div>
				</div>
			</section>

			<!-- 🏷️ 10. BADGES & TRIAGE STATUS PILLS -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<HeartPulse class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">10. Badges & Triage Status Pills</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							ป้ายระบุระดับความวิกฤต Triage กลุ่มเปราะบาง และสถานะเสบียงคงคลัง
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('badges')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.badges ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.badges, 'Badges Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.badges}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.badges}</pre>
					</div>
				{/if}

				<div class="space-y-5">
					<!-- Triage Status Badges -->
					<div class="space-y-2">
						<span class="text-xs font-bold tracking-wider text-slate-400 uppercase"
							>Triage Severity Badges</span
						>
						<div class="flex flex-wrap items-center gap-2.5">
							<!-- Red -->
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-900"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>
								วิกฤตฉุกเฉิน (Triage Red)
							</span>

							<!-- Amber -->
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
								เร่งด่วน / กึ่งวิกฤต (Yellow)
							</span>

							<!-- Green -->
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
								อาการทั่วไป / ปกติ (Green)
							</span>

							<!-- Sky -->
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-900"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-sky-600"></span>
								ส่งต่อโรงพยาบาล (Blue)
							</span>

							<!-- Purple -->
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-900"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-purple-600"></span>
								คำสั่ง EOC บัญชาการ
							</span>
						</div>
					</div>

					<!-- Domain Operations & Functional Badges -->
					<div class="space-y-2">
						<span class="text-xs font-bold tracking-wider text-slate-400 uppercase">
							Domain Operations & Functional Badges (ป้ายกำกับเฉพาะทางและระบบการทำงาน)
						</span>
						<div class="flex flex-wrap items-center gap-2.5">
							<!-- Kitchen -->
							<span class="badge-kitchen">
								<Utensils class="h-3.5 w-3.5" />
								<span>ครัวกลาง & ก๊าซ LPG (#EA580C)</span>
							</span>

							<!-- Family -->
							<span class="badge-family">
								<Baby class="h-3.5 w-3.5" />
								<span>แม่และเด็ก / สตรีมีครรภ์ (#E11D48)</span>
							</span>

							<!-- Donor -->
							<span class="badge-donor">
								<HeartHandshake class="h-3.5 w-3.5" />
								<span>ผู้บริจาค & ค้นหาญาติ (#0284C7)</span>
							</span>

							<!-- Inventory -->
							<span class="badge-inventory">
								<Package class="h-3.5 w-3.5" />
								<span>คลังสิ่งของ SPHERE (#0D9488)</span>
							</span>

							<!-- Accent -->
							<span class="badge-accent">
								<Tag class="h-3.5 w-3.5" />
								<span>แท็กเน้นพิเศษ (Accent Ice Blue)</span>
							</span>

							<!-- Advisory -->
							<span class="badge-warning-advisory">
								<AlertTriangle class="h-3.5 w-3.5 text-amber-600" />
								<span>คำแนะนำเฝ้าระวัง (Warning Advisory)</span>
							</span>

							<!-- Muted -->
							<span class="badge-muted">
								<span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
								<span>ไม่ระบุ / ปิดรับ (Muted)</span>
							</span>
						</div>
					</div>

					<!-- Vulnerability Group Tags -->
					<div class="space-y-2">
						<span class="text-xs font-bold tracking-wider text-slate-400 uppercase"
							>Vulnerability Group Tags (กลุ่มเปราะบาง)</span
						>
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="inline-flex items-center gap-1.5 rounded-md border border-red-200/80 bg-red-50/60 px-2.5 py-1 text-xs font-medium text-red-900"
							>
								<Bed class="h-3.5 w-3.5 text-red-600" />
								<span>ผู้ป่วยติดเตียง (Bedridden)</span>
							</span>

							<span
								class="inline-flex items-center gap-1.5 rounded-md border border-amber-200/80 bg-amber-50/60 px-2.5 py-1 text-xs font-medium text-amber-900"
							>
								<Users class="h-3.5 w-3.5 text-amber-600" />
								<span>ผู้สูงอายุ 60+ (Elderly)</span>
							</span>

							<span
								class="inline-flex items-center gap-1.5 rounded-md border border-rose-200/80 bg-rose-50/60 px-2.5 py-1 text-xs font-medium text-rose-900"
							>
								<Baby class="h-3.5 w-3.5 text-rose-600" />
								<span>เด็กทารก / หญิงมีครรภ์</span>
							</span>

							<span
								class="inline-flex items-center gap-1.5 rounded-md border border-emerald-200/80 bg-emerald-50/60 px-2.5 py-1 text-xs font-medium text-emerald-900"
							>
								<Dog class="h-3.5 w-3.5 text-emerald-600" />
								<span>สัตว์เลี้ยงร่วม (Pet Zone)</span>
							</span>

							<span
								class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100/70 px-2.5 py-1 text-xs font-medium text-slate-800"
							>
								<ShieldAlert class="h-3.5 w-3.5 text-slate-600" />
								<span>ผู้พิการทางการเคลื่อนไหว</span>
							</span>
						</div>
					</div>

					<!-- Stock Runway Status -->
					<div class="space-y-2">
						<span class="text-xs font-bold tracking-wider text-slate-400 uppercase"
							>Supply Runway Status</span
						>
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"
							>
								● สำรองพอเพียง (> 7 วัน)
							</span>
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800"
							>
								▲ เฝ้าระวังต่ำกว่า 3 วัน
							</span>
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800"
							>
								✕ ขาดแคลนวิกฤต (Stock Out)
							</span>
						</div>
					</div>
				</div>
			</section>

			<!-- 🚨 11. ALERTS, BANNERS & EMERGENCY CALLOUTS -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<AlertTriangle class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">11. Alerts, Banners & Callouts</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							แบนเนอร์แจ้งเตือนภัยพิบัติ แถบสถานะออฟไลน์ และประกาศจากศูนย์บัญชาการ
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('alerts')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.alerts ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.alerts, 'Alerts Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.alerts}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.alerts}</pre>
					</div>
				{/if}

				<div class="space-y-3">
					<!-- Emergency Red Alert Banner -->
					<div
						class="flex flex-col justify-between gap-3 rounded-xl border border-red-200/90 bg-red-50/60 p-4 text-red-950 shadow-2xs sm:flex-row sm:items-center"
					>
						<div class="flex items-start gap-3">
							<div class="shrink-0 rounded-lg bg-red-100 p-2 text-red-800">
								<AlertTriangle class="h-4 w-4" />
							</div>
							<div>
								<div class="flex items-center gap-2">
									<h4 class="text-sm font-bold text-red-900">
										ประกาศเตือนภัยฉุกเฉินระดับ 3: น้ำท่วมฉับพลัน
									</h4>
									<span class="rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white"
										>LIVE</span
									>
								</div>
								<p class="mt-0.5 text-xs text-red-800">
									ระดับน้ำแม่น้ำปิงเกินจุดวิกฤต 4.20 เมตร
									ให้อพยพประชาชนในโซนช้างคลานมายังศูนย์หลักทันที
								</p>
							</div>
						</div>
						<button
							class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-red-700"
						>
							<span>ดูแผนที่อพยพ</span>
							<ArrowRight class="h-3.5 w-3.5" />
						</button>
					</div>

					<!-- Offline Mode Banner -->
					<div
						class="flex flex-col justify-between gap-3 rounded-xl border border-amber-200/90 bg-amber-50/60 p-4 text-amber-950 shadow-2xs sm:flex-row sm:items-center"
					>
						<div class="flex items-center gap-3">
							<div class="shrink-0 rounded-lg bg-amber-100 p-2 text-amber-800">
								<WifiOff class="h-4 w-4" />
							</div>
							<div>
								<span class="text-xs font-bold text-amber-950"
									>โหมดการทำงานออฟไลน์ (Offline Mode Active)</span
								>
								<p class="mt-0.5 text-xs text-amber-800">
									ข้อมูลทั้งหมดจะถูกบันทึกไว้ในอุปกรณ์นี้อย่างปลอดภัย และจะทำการ Sync
									ทันทีเมื่อต่อเน็ต
								</p>
							</div>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<span
								class="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-950"
							>
								4 รายการรอ Sync
							</span>
							<button
								class="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-50"
							>
								ลองเชื่อมต่อใหม่
							</button>
						</div>
					</div>

					<!-- EOC Purple Broadcast -->
					<div
						class="flex items-start gap-3 rounded-xl border border-purple-200/90 bg-purple-50/40 p-4 text-purple-950 shadow-2xs"
					>
						<div class="shrink-0 rounded-lg bg-purple-100 p-2 text-purple-800">
							<Radio class="h-4 w-4" />
						</div>
						<div>
							<h4 class="text-xs font-bold text-purple-950">
								คำสั่งศูนย์บัญชาการเหตุการณ์ (EOC Command) #2026-08
							</h4>
							<p class="mt-0.5 text-xs text-purple-800">
								ทีมแพทย์เคลื่อนที่กำลังเดินทางมาถึงศูนย์ฯ ภายในเวลา 18:30 น. โปรดเตรียมโซน B
								รองรับผู้ป่วยคัดกรอง
							</p>
						</div>
					</div>
				</div>
			</section>

			<!-- 📋 12. DATA TABLES & OCCUPANT REGISTRY LIST -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Users class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								12. Data Tables & Operational Registry
							</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							ตารางข้อมูลรายชื่อผู้พักพิง/คลังสิ่งของ พร้อมระบบค้นหา ป้าย Triage และ Pagination
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('tables')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.tables ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.tables, 'Table Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.tables}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.tables}</pre>
					</div>
				{/if}

				<!-- Search & Filter Controls -->
				<div class="flex flex-col items-center justify-between gap-3 sm:flex-row">
					<div class="relative w-full sm:w-80">
						<Search class="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
						<Input
							type="text"
							placeholder="ค้นหาชื่อ, เลขบัตร, รหัสเตียง..."
							class="h-9 w-full pr-4 pl-8 text-xs"
						/>
					</div>
					<div class="flex w-full items-center justify-end gap-2 sm:w-auto">
						<button
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
						>
							<Filter class="h-3.5 w-3.5" />
							<span>ตัวกรอง (Triage)</span>
						</button>
						<button
							class="inline-flex items-center gap-1.5 rounded-lg bg-[#0A2647] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#051930]"
						>
							<span>+ ลงทะเบียน</span>
						</button>
					</div>
				</div>

				<!-- Minimal Table -->
				<div class="overflow-x-auto rounded-xl border border-slate-200/80">
					<table class="w-full text-left text-sm">
						<thead
							class="border-b border-slate-200/80 bg-slate-50/75 text-xs font-medium text-slate-500"
						>
							<tr>
								<th class="px-4 py-3">ผู้พักพิง / เลขบัตร</th>
								<th class="px-4 py-3">ระดับ Triage</th>
								<th class="px-4 py-3">กลุ่มเปราะบาง</th>
								<th class="px-4 py-3">โซน / เตียง</th>
								<th class="px-4 py-3">เวลาเช็คอิน</th>
								<th class="px-4 py-3 text-right">การจัดการ</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100 text-xs">
							<tr class="transition-colors hover:bg-slate-50/60">
								<td class="px-4 py-3">
									<div class="font-semibold text-slate-900">นายสมชาย ใจดี</div>
									<div class="text-xs text-slate-400 tabular-nums">1-5099-00123-xx-x</div>
								</td>
								<td class="px-4 py-3">
									<span
										class="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-900"
									>
										<span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>
										Red (วิกฤต)
									</span>
								</td>
								<td class="px-4 py-3">
									<span
										class="inline-flex items-center gap-1 rounded border border-red-200/80 bg-red-50/60 px-2 py-0.5 text-xs font-medium text-red-900"
									>
										<Bed class="h-3 w-3 text-red-600" />
										ผู้ป่วยติดเตียง
									</span>
								</td>
								<td class="px-4 py-3">
									<span class="font-bold text-slate-900">Zone B</span>
									<span class="ml-1 text-xs text-slate-400">(เตียง B-102)</span>
								</td>
								<td class="px-4 py-3 text-slate-500 tabular-nums">14:20 น.</td>
								<td class="px-4 py-3 text-right">
									<button
										class="rounded px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
										>แก้ไข</button
									>
								</td>
							</tr>

							<!-- Row 2: Demonstrating Accent Ice Blue Row Selection -->
							<tr class="bg-sky-50/50 transition-colors hover:bg-sky-50/75">
								<td class="px-4 py-3">
									<div class="flex items-center gap-2">
										<div class="font-semibold text-slate-900">นางนภา พิทักษ์ไทย</div>
										<span class="badge-accent px-1.5 py-0 text-[11px]">เลือกอยู่ (Selected)</span>
									</div>
									<div class="text-xs text-slate-400 tabular-nums">3-5001-00456-xx-x</div>
								</td>
								<td class="px-4 py-3">
									<span
										class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
									>
										<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
										Yellow (เฝ้าระวัง)
									</span>
								</td>
								<td class="px-4 py-3">
									<span
										class="inline-flex items-center gap-1 rounded border border-amber-200/80 bg-amber-50/60 px-2 py-0.5 text-xs font-medium text-amber-900"
									>
										<Users class="h-3 w-3 text-amber-600" />
										ผู้สูงอายุ 74 ปี
									</span>
								</td>
								<td class="px-4 py-3">
									<span class="font-bold text-slate-900">Zone B</span>
									<span class="ml-1 text-xs text-slate-400">(เตียง B-105)</span>
								</td>
								<td class="px-4 py-3 text-slate-500 tabular-nums">15:05 น.</td>
								<td class="px-4 py-3 text-right">
									<button
										class="rounded px-2 py-1 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100 hover:text-sky-950"
										>แก้ไข</button
									>
								</td>
							</tr>

							<!-- Row 3: Standard Row with Mapped Family Care Badge -->
							<tr class="transition-colors hover:bg-slate-50/60">
								<td class="px-4 py-3">
									<div class="font-semibold text-slate-900">ด.ช. ภูมิภัทร ดวงแก้ว</div>
									<div class="text-xs text-slate-400 tabular-nums">1-5099-00987-xx-x</div>
								</td>
								<td class="px-4 py-3">
									<span
										class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
									>
										<span class="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
										Green (ปกติ)
									</span>
								</td>
								<td class="px-4 py-3">
									<span
										class="inline-flex items-center gap-1 rounded border border-rose-200/80 bg-rose-50/60 px-2 py-0.5 text-xs font-medium text-rose-900"
									>
										<Baby class="h-3 w-3 text-rose-600" />
										เด็กเล็ก 3 ขวบ
									</span>
								</td>
								<td class="px-4 py-3">
									<span class="font-bold text-slate-900">Zone C</span>
									<span class="ml-1 text-xs text-slate-400">(เตียง C-204)</span>
								</td>
								<td class="px-4 py-3 text-slate-500 tabular-nums">15:45 น.</td>
								<td class="px-4 py-3 text-right">
									<button
										class="rounded px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
										>แก้ไข</button
									>
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<!-- Pagination Bar -->
				<div
					class="flex flex-col items-center justify-between gap-3 text-xs font-normal text-slate-500 sm:flex-row"
				>
					<div>
						แสดง <span class="font-semibold text-slate-900">1-3</span> จากทั้งหมด
						<span class="font-semibold text-slate-900">412</span> ราย
					</div>
					<div class="flex items-center gap-1">
						<button
							class="rounded-lg border border-slate-200 px-2.5 py-1 transition-colors hover:bg-slate-50 disabled:opacity-40"
							disabled
						>
							ก่อนหน้า
						</button>
						<button class="rounded-lg bg-[#0A2647] px-2.5 py-1 font-semibold text-white">1</button>
						<button
							class="rounded-lg border border-slate-200 px-2.5 py-1 transition-colors hover:bg-slate-50"
							>2</button
						>
						<button
							class="rounded-lg border border-slate-200 px-2.5 py-1 transition-colors hover:bg-slate-50"
							>3</button
						>
						<span class="px-1 text-slate-400">...</span>
						<button
							class="rounded-lg border border-slate-200 px-2.5 py-1 transition-colors hover:bg-slate-50"
							>14</button
						>
						<button
							class="rounded-lg border border-slate-200 px-2.5 py-1 transition-colors hover:bg-slate-50"
						>
							ถัดไป
						</button>
					</div>
				</div>
			</section>

			<!-- 🪟 13. OVERLAYS, MODALS & TOAST NOTIFICATIONS -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<ShieldAlert class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">13. Overlays & User Feedback</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							ไดอะล็อกยืนยันคำสั่งฉุกเฉิน และระบบแจ้งเตือน Sonner Toasts แบบ Interactive
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('dialogs')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.dialogs ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.dialogs, 'Dialog Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.dialogs}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.dialogs}</pre>
					</div>
				{/if}

				<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
					<!-- Modal Trigger Demo -->
					<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5">
						<h3 class="text-sm font-bold text-slate-900">Emergency Confirmation Dialog</h3>
						<p class="text-xs text-slate-500">
							ทดสอบเปิด Modal ยืนยันการปิดรับผู้พักพิงหรือส่งต่อเคสวิกฤต
						</p>

						<Dialog.Root bind:open={isDialogOpen}>
							<Dialog.Trigger>
								<button
									class="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-red-700"
								>
									<AlertTriangle class="h-3.5 w-3.5" />
									<span>เปิด Dialog คำสั่งฉุกเฉิน</span>
								</button>
							</Dialog.Trigger>
							<Dialog.Content
								class="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-md sm:max-w-[420px]"
							>
								<Dialog.Header class="space-y-2">
									<div
										class="inline-flex w-fit items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-900"
									>
										<AlertTriangle class="h-3 w-3 text-red-600" />
										<span>EMERGENCY ACTION</span>
									</div>
									<Dialog.Title class="text-lg font-bold text-slate-900">
										ยืนยันการประกาศปิดรับผู้พักพิง?
									</Dialog.Title>
									<Dialog.Description class="text-xs leading-relaxed text-slate-500">
										เมื่อสั่งปิดรับ ระบบจะเปลี่ยนสถานะศูนย์เป็น "ความจุเต็ม 100%"
										และแจ้งเตือนไปยังจุดคัดกรองส่วนหน้าเพื่อกระจายผู้พักพิงไปยังศูนย์สำรองทันที
									</Dialog.Description>
								</Dialog.Header>
								<Dialog.Footer class="mt-5 gap-2">
									<button
										onclick={() => (isDialogOpen = false)}
										class="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
									>
										ยกเลิก
									</button>
									<button
										onclick={() => {
											isDialogOpen = false;
											toast.error('ประกาศปิดรับผู้พักพิงเรียบร้อยแล้ว');
										}}
										class="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700"
									>
										ยืนยันปิดรับ
									</button>
								</Dialog.Footer>
							</Dialog.Content>
						</Dialog.Root>
					</div>

					<!-- Toast Triggers Demo -->
					<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-5">
						<h3 class="text-sm font-bold text-slate-900">Interactive Sonner Toasts</h3>
						<p class="text-xs text-slate-500">
							ทดสอบการแสดงผลข้อความแจ้งเตือนสถานะต่างๆ แบบ Interactive
						</p>

						<div class="flex flex-wrap items-center gap-2 pt-1">
							<button
								onclick={() => toast.success('บันทึกข้อมูลผู้พักพิงสำเร็จ')}
								class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 transition-colors hover:bg-emerald-100"
							>
								Success Toast
							</button>

							<button
								onclick={() => toast.warning('เสบียงอาหารเหลือสำรองต่ำกว่า 3 วัน')}
								class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
							>
								Warning Toast
							</button>

							<button
								onclick={() => toast.error('ไม่สามารถเชื่อมต่อฐานข้อมูลส่วนกลางได้')}
								class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-900 transition-colors hover:bg-red-100"
							>
								Error Toast
							</button>

							<button
								onclick={() => toast.info('ระบบกำลังสำรองข้อมูลลงเครื่อง (Offline)')}
								class="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-900 transition-colors hover:bg-sky-100"
							>
								Info Toast
							</button>
						</div>
					</div>
				</div>
			</section>

			<!-- 🧭 14. NAVIGATION & ACTION CONTROLS -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Compass class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">14. Navigation & Action Controls</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							เมนูนำทาง Breadcrumbs ปุ่มคำสั่งหลัก (Civic Buttons) และแถบ Search พร้อม Shortcut Hint
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('navigation')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.navigation ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.navigation, 'Navigation Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.navigation}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.navigation}</pre>
					</div>
				{/if}

				<div class="space-y-6">
					<!-- Breadcrumb Demo -->
					<div class="rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5">
						<span class="mb-1.5 block text-xs font-bold tracking-wider text-slate-400 uppercase"
							>Field Breadcrumbs Trail</span
						>
						<nav class="flex items-center gap-1.5 text-xs font-medium text-slate-500">
							<a href="/shelters" class="transition-colors hover:text-slate-900">
								ศูนย์พักพิงทั้งหมด
							</a>
							<ChevronRight class="h-3.5 w-3.5 text-slate-400" />
							<a href="/shelters/sh-01" class="transition-colors hover:text-slate-900">
								ศูนย์โรงเรียนเทศบาล 1 (ช้างคลาน)
							</a>
							<ChevronRight class="h-3.5 w-3.5 text-slate-400" />
							<span class="font-semibold text-slate-900">รายชื่อผู้พักพิงและกลุ่มเปราะบาง</span>
						</nav>
					</div>

					<!-- Button Variants & Sizes -->
					<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
						<div class="space-y-2.5">
							<span class="block text-xs font-bold tracking-wider text-slate-400 uppercase"
								>Civic Button Variants</span
							>
							<div class="flex flex-wrap items-center gap-2.5">
								<!-- Primary Navy -->
								<button class="btn-primary-brand">
									<span>Primary Action</span>
								</button>

								<!-- Secondary GovTech Cerulean -->
								<button class="btn-secondary-brand">
									<Compass class="h-3.5 w-3.5" />
									<span>Secondary (Cerulean)</span>
								</button>

								<!-- Secondary Outline -->
								<button class="btn-secondary-outline">
									<span>Secondary Outline</span>
								</button>

								<!-- Destructive -->
								<button
									class="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-red-700 active:scale-[0.98]"
								>
									<span>Destructive</span>
								</button>

								<!-- Ghost Icon -->
								<button
									class="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
									aria-label="ตัวเลือกเพิ่มเติม"
								>
									<MoreHorizontal class="h-4 w-4" />
								</button>
							</div>
						</div>

						<!-- Command Search Bar -->
						<div class="space-y-2.5">
							<span class="block text-xs font-bold tracking-wider text-slate-400 uppercase"
								>Quick Command Bar with Shortcut</span
							>
							<div class="relative">
								<Search class="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400" />
								<Input
									type="text"
									placeholder="ค้นหาศูนย์พักพิง, รายชื่อญาติ, รหัสสิ่งของ..."
									class="h-10 w-full bg-slate-50/60 pr-14 pl-9 text-xs placeholder:text-slate-400"
								/>
								<span
									class="absolute top-2 right-2.5 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-500"
								>
									⌘K
								</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- ⌨️ 15. COMMAND PALETTE (⌘K) & KEYBOARD SHORTCUTS SYSTEM -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<CommandIcon class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">15. Command Palette (⌘K) & Shortcuts</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							ศูนย์รวมการค้นหาและการสั่งการด่วนด้วยคีย์บอร์ด
							สำหรับเจ้าหน้าที่ภาคสนามในสถานการณ์ฉุกเฉิน
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('commandPalette')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.commandPalette ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.commandPalette, 'Command Palette Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.commandPalette}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.commandPalette}</pre>
					</div>
				{/if}

				<div class="space-y-6">
					<!-- Interactive Trigger Card -->
					<div
						class="flex flex-col gap-6 rounded-xl border border-slate-200/90 bg-gradient-to-r from-slate-50 via-white to-slate-50 p-6 md:flex-row md:items-center md:justify-between"
					>
						<div class="space-y-1.5">
							<div
								class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700 shadow-2xs"
							>
								<Sparkles class="h-3.5 w-3.5 text-[#0A2647]" />
								<span>Interactive Global Component</span>
							</div>
							<h3 class="text-base font-bold text-slate-900">
								ทดสอบเปิดใช้งาน Civic Command Palette
							</h3>
							<p class="max-w-xl text-xs text-slate-500">
								กดคีย์ลัด <kbd
									class="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-700 shadow-2xs"
									>⌘K</kbd
								>
								(Mac) หรือ
								<kbd
									class="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-700 shadow-2xs"
									>Ctrl+K</kbd
								> (Windows) จากที่ใดก็ได้บนหน้านี้ หรือคลิกปุ่มด้านข้างเพื่อเปิด
							</p>
						</div>

						<button
							type="button"
							onclick={() => (isCommandPaletteOpen = true)}
							class="inline-flex shrink-0 items-center justify-center gap-3 rounded-xl bg-[#0A2647] px-6 py-3.5 text-sm font-semibold text-white shadow-xs transition-all hover:bg-[#051930] active:scale-[0.98]"
						>
							<Search class="h-4 w-4" />
							<span>เปิด Command Palette</span>
							<kbd
								class="rounded border border-white/20 bg-white/10 px-2 py-0.5 font-mono text-xs font-bold text-slate-200"
								>⌘K</kbd
							>
						</button>
					</div>

					<!-- Shortcuts Matrix Table -->
					<div class="space-y-3">
						<h4 class="text-xs font-bold tracking-wider text-slate-400 uppercase">
							คีย์ลัดมาตรฐานของระบบ (Standard Keyboard Shortcuts Matrix)
						</h4>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<div
								class="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
							>
								<div class="space-y-0.5">
									<div class="text-xs font-bold text-slate-900">ค้นหา & คำสั่งด่วน</div>
									<div class="text-xs text-slate-500">เปิด Command Palette</div>
								</div>
								<kbd
									class="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 shadow-2xs"
									>⌘K</kbd
								>
							</div>

							<div
								class="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
							>
								<div class="space-y-0.5">
									<div class="text-xs font-bold text-slate-900">ลงทะเบียนผู้พักพิง</div>
									<div class="text-xs text-slate-500">New Evacuee Intake</div>
								</div>
								<kbd
									class="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 shadow-2xs"
									>⌘N</kbd
								>
							</div>

							<div
								class="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
							>
								<div class="space-y-0.5">
									<div class="text-xs font-bold text-slate-900">จ่ายถุงยังชีพ</div>
									<div class="text-xs text-slate-500">Distribute Supplies</div>
								</div>
								<kbd
									class="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 shadow-2xs"
									>⌘D</kbd
								>
							</div>

							<div
								class="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
							>
								<div class="space-y-0.5">
									<div class="text-xs font-bold text-slate-900">เตือนภัยฉุกเฉิน</div>
									<div class="text-xs text-slate-500">Broadcast Alert</div>
								</div>
								<kbd
									class="rounded-md border border-red-200 bg-red-50 px-2 py-1 font-mono text-xs font-bold text-red-700 shadow-2xs"
									>⌘E</kbd
								>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- 💾 16. OFFLINE & COUCHDB REMOTE-FIRST SYNC INDICATORS -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center"
				>
					<div>
						<div class="flex items-center gap-2">
							<Database class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-slate-900">
								16. Offline & CouchDB Remote-First Sync Indicators
							</h2>
						</div>
						<p class="mt-0.5 text-xs text-slate-500">
							ระบบแสดงผลความพร้อมของข้อมูลและสถานะการเชื่อมต่อ CouchDB/LocalDB
							ในภาวะฉุกเฉินและสัญญาณอินเทอร์เน็ตขาดหาย
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={() => toggleCode('syncIndicators')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Code class="h-3.5 w-3.5" />
							<span>{showCode.syncIndicators ? 'Hide Code' : 'View Code'}</span>
						</button>
						<button
							onclick={() => copySnippet(SNIPPETS.syncIndicators, 'Sync Indicators Snippet')}
							class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Copy class="h-3.5 w-3.5" />
							<span>Copy</span>
						</button>
					</div>
				</div>

				{#if showCode.syncIndicators}
					<div
						class="overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs text-slate-300"
					>
						<pre>{SNIPPETS.syncIndicators}</pre>
					</div>
				{/if}

				<div class="space-y-6">
					<!-- State Switcher Playground -->
					<div
						class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4"
					>
						<div class="flex items-center gap-2">
							<span class="text-xs font-bold text-slate-700">จำลองสถานะการเชื่อมต่อ:</span>
							<div
								class="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-2xs"
							>
								<button
									type="button"
									onclick={() => (syncState = 'online')}
									class="rounded-md px-3 py-1 text-xs font-semibold transition-all {syncState ===
									'online'
										? 'bg-emerald-600 text-white shadow-2xs'
										: 'text-slate-600 hover:text-slate-900'}"
								>
									Online (Synced)
								</button>
								<button
									type="button"
									onclick={() => (syncState = 'syncing')}
									class="rounded-md px-3 py-1 text-xs font-semibold transition-all {syncState ===
									'syncing'
										? 'bg-amber-500 text-white shadow-2xs'
										: 'text-slate-600 hover:text-slate-900'}"
								>
									Syncing...
								</button>
								<button
									type="button"
									onclick={() => (syncState = 'offline')}
									class="rounded-md px-3 py-1 text-xs font-semibold transition-all {syncState ===
									'offline'
										? 'bg-slate-800 text-white shadow-2xs'
										: 'text-slate-600 hover:text-slate-900'}"
								>
									Offline Mode
								</button>
								<button
									type="button"
									onclick={() => (syncState = 'conflict')}
									class="rounded-md px-3 py-1 text-xs font-semibold transition-all {syncState ===
									'conflict'
										? 'bg-red-600 text-white shadow-2xs'
										: 'text-slate-600 hover:text-slate-900'}"
								>
									Sync Conflict
								</button>
							</div>
						</div>

						<div class="flex items-center gap-2">
							<span class="text-xs font-medium text-slate-500">จำนวนข้อมูลรอซิงก์:</span>
							<div
								class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1"
							>
								<button
									type="button"
									onclick={() => (unsyncedRecords = Math.max(0, unsyncedRecords - 1))}
									class="flex h-5 w-5 items-center justify-center rounded text-xs font-bold text-slate-500 hover:text-slate-900"
									>-</button
								>
								<span class="px-2 text-xs font-bold text-slate-800 tabular-nums"
									>{unsyncedRecords}</span
								>
								<button
									type="button"
									onclick={() => (unsyncedRecords = unsyncedRecords + 1)}
									class="flex h-5 w-5 items-center justify-center rounded text-xs font-bold text-slate-500 hover:text-slate-900"
									>+</button
								>
							</div>
						</div>
					</div>

					<!-- Visual State Render Demonstrations -->
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<!-- 1. Floating Pill Indicator -->
						<div class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
							<span class="block text-xs font-bold tracking-wider text-slate-400 uppercase">
								1. Floating / Navbar Status Indicator
							</span>
							<div class="flex items-center gap-3">
								{#if syncState === 'online'}
									<div
										class="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-900"
									>
										<span class="relative flex h-2.5 w-2.5">
											<span
												class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
											></span>
											<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"
											></span>
										</span>
										<span>ออนไลน์ • ซิงก์สมบูรณ์ (CouchDB Cloud)</span>
									</div>
								{:else if syncState === 'syncing'}
									<div
										class="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1.5 text-xs font-semibold text-amber-900"
									>
										<RefreshCw class="h-3.5 w-3.5 animate-spin text-amber-600" />
										<span>กำลังส่งถ่ายข้อมูล ({unsyncedRecords} รายการ)...</span>
									</div>
								{:else if syncState === 'offline'}
									<div
										class="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3.5 py-1.5 text-xs font-semibold text-slate-800"
									>
										<WifiOff class="h-3.5 w-3.5 text-slate-500" />
										<span>โหมดออฟไลน์ • รอซิงก์ {unsyncedRecords} รายการ</span>
									</div>
								{:else}
									<div
										class="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-red-900"
									>
										<AlertOctagon class="h-3.5 w-3.5 text-red-600" />
										<span>พบข้อมูลขัดแย้ง (Sync Conflict)</span>
									</div>
								{/if}
							</div>
							<p class="text-xs leading-relaxed text-slate-500">
								แสดงผลบนมุมขวาบนของ Header หรือเป็น Floating Pill
								ให้เจ้าหน้าที่มั่นใจตลอดเวลาว่าข้อมูลที่คีย์ลงไปถูกบันทึกปลอดภัย
							</p>
						</div>

						<!-- 2. LocalDB Storage Card -->
						<div class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
							<span class="block text-xs font-bold tracking-wider text-slate-400 uppercase">
								2. Local Storage Partition (PouchDB / IndexedDB)
							</span>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div
										class="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700"
									>
										<Database class="h-4 w-4" />
									</div>
									<div>
										<div class="text-xs font-bold text-slate-900">
											Local CouchDB Replicate Queue
										</div>
										<div class="text-xs text-slate-500 tabular-nums">
											_changes sequence: #84,209
										</div>
									</div>
								</div>
								<span
									class="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 tabular-nums"
								>
									{unsyncedRecords} Unsynced
								</span>
							</div>
							<div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
								<div
									class="h-full rounded-full transition-all duration-300 {syncState === 'online'
										? 'bg-emerald-500'
										: syncState === 'syncing'
											? 'bg-amber-500'
											: 'bg-slate-400'}"
									style="width: {syncState === 'online' ? '100%' : '65%'}"
								></div>
							</div>
						</div>
					</div>

					<!-- 3. Disaster Persistent Offline & Conflict Banners -->
					{#if syncState === 'offline'}
						<div
							class="flex animate-in flex-col justify-between gap-3 rounded-xl border border-slate-300/90 bg-slate-100/90 p-4 text-slate-800 shadow-2xs duration-150 fade-in sm:flex-row sm:items-center"
						>
							<div class="flex items-center gap-3">
								<WifiOff class="h-5 w-5 shrink-0 text-slate-600" />
								<div>
									<h4 class="text-xs font-bold text-slate-900">
										ระบบกำลังทำงานในโหมดออฟไลน์สมบูรณ์ (Remote-First)
									</h4>
									<p class="mt-0.5 text-xs text-slate-600">
										สามารถลงทะเบียนผู้พักพิงและจ่ายของได้ตามปกติ
										ข้อมูลจะถูกจัดเก็บในเครื่องอย่างปลอดภัย และซิงก์ขึ้นส่วนกลางทันทีที่มีสัญญาณ
									</p>
								</div>
							</div>
							<button
								type="button"
								onclick={() => (syncState = 'syncing')}
								class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
							>
								<RefreshCw class="h-3 w-3" />
								<span>ทดสอบเชื่อมต่อใหม่</span>
							</button>
						</div>
					{:else if syncState === 'conflict'}
						<div
							class="flex animate-in flex-col justify-between gap-3 rounded-xl border border-red-200/90 bg-red-50/70 p-4 text-red-950 shadow-2xs duration-150 fade-in sm:flex-row sm:items-center"
						>
							<div class="flex items-center gap-3">
								<AlertOctagon class="h-5 w-5 shrink-0 text-red-600" />
								<div>
									<h4 class="text-xs font-bold text-red-900">
										พบการแก้ไขข้อมูลพร้อมกันจากหลายเครื่อง (Sync Conflict Detected)
									</h4>
									<p class="mt-0.5 text-xs text-red-700">
										ข้อมูลผู้พักพิง CID 1-5099-00123-45-6 มีการอัปเดตจากจุดคัดกรอง 2 แห่งพร้อมกัน
										กรุณาเลือกเวอร์ชันที่ถูกต้อง
									</p>
								</div>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<button
									type="button"
									onclick={() => {
										toast.success('แก้ไขข้อขัดแย้งเรียบร้อย');
										syncState = 'online';
									}}
									class="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-red-700"
								>
									ตรวจสอบและเลือกเวอร์ชัน
								</button>
							</div>
						</div>
					{/if}
				</div>
			</section>
		{:else}
			<!-- 🤖 TAB 2: GOOGLE AI STUDIO PROMPT KIT -->
			<section
				class="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-10"
			>
				<div
					class="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-center sm:justify-between"
				>
					<div class="space-y-1">
						<div class="flex items-center gap-2">
							<Terminal class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-xl font-bold text-[#0A2647]">
								Google AI Studio System Prompt Kit (v2.4 Full Spectrum)
							</h2>
						</div>
						<p class="text-xs text-slate-500">
							คัดลอกข้อความด้านล่างนี้ไปวางในช่อง <strong>System Instructions</strong> ของ Google AI Studio
							เพื่อให้โมเดลสร้าง UI ได้ตรงตามสเปกสากล ครอบคลุม a11y, UI states, Responsive, Motion, สี,
							Typography, Spatial Scale, ⌘K Command Palette และ Offline Sync 100%
						</p>
					</div>

					<button
						onclick={() => copySnippet(AI_STUDIO_SYSTEM_PROMPT, 'AI Studio System Prompt')}
						class="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0A2647] px-5 py-2.5 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-[#051930] active:scale-95"
					>
						{#if copiedKey === 'AI Studio System Prompt'}
							<Check class="h-3.5 w-3.5 text-emerald-400" />
							<span>คัดลอกเรียบร้อย!</span>
						{:else}
							<Copy class="h-3.5 w-3.5" />
							<span>คัดลอก System Prompt</span>
						{/if}
					</button>
				</div>

				<div class="relative">
					<pre
						class="max-h-[700px] overflow-x-auto rounded-xl border border-slate-800 bg-[#0B1120] p-6 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-300">{AI_STUDIO_SYSTEM_PROMPT}</pre>
				</div>
			</section>
		{/if}
	</div>
</div>

<!-- Global Civic Command Palette Modal -->
<CivicCommandPalette bind:open={isCommandPaletteOpen} />
