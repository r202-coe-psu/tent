<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import Compass from '@lucide/svelte/icons/compass';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Terminal from '@lucide/svelte/icons/terminal';
	import Eye from '@lucide/svelte/icons/eye';
	import { toast } from 'svelte-sonner';

	let activeTab = $state<'components' | 'prompt-guide'>('components');
	let copied = $state(false);

	const AI_STUDIO_SYSTEM_PROMPT = `You are an expert Frontend Engineer and UI/UX Designer specializing in the **SmartShelter Thailand Civic Light Design System**.

### 🏛️ DESIGN PHILOSOPHY: Civic Light & Modern Tactical
A high-contrast, crystal-clear, mission-critical interface designed for disaster management, humanitarian shelters, and civic operations in Thailand. It prioritizes rapid situational awareness (glanceability), large legible typography, high affordance, and zero user confusion.

---

### 🚫 ABSOLUTE NEGATIVE CONSTRAINTS (STRICT RULES)
1. **ALWAYS LIGHT THEME**: Never use dark backgrounds for full pages or sections. The canvas is always Slate-50 (#F8FAFC) or Pure White (#FFFFFF).
2. **NO SINGLE-SIDED BORDER STRIPES**: Never create cards with a colored accent stripe on only one edge (e.g. border-l-4 or border-t-4). Status cards MUST use a complete 360-degree tinted border around the entire card (e.g., border-2 border-emerald-200 with bg-white).
3. **NO HEAVY DROP SHADOWS**: Avoid shadow-lg, shadow-xl, or shadow-2xl. Use subtle micro-elevation (shadow-2xs, shadow-xs, or shadow-sm) with 1px/1.5px crisp borders.
4. **NO OVERLY ROUNDED CONTAINERS**: Container and card border-radius is strictly 8px to 12px (rounded-lg or rounded-xl). Avoid rounded-3xl or pill containers for cards.
5. **NO TINY UNREADABLE TEXT**: Base body text is 16px-18px. Do not use text-[10px] for vital operational text.

---

### 🎨 COLOR PALETTE & SEMANTIC TOKENS
- **Brand Navy (Primary)**: \`#0A2647\` (Tailwind: \`bg-[#0A2647]\` / \`bg-primary\`, text: \`#FFFFFF\`)
- **Canvas / Background**: \`#F8FAFC\` (Slate-50)
- **Card / Surface**: \`#FFFFFF\` with \`border border-slate-200\`
- **Primary Text**: \`#0F172A\` (Slate-900)
- **Secondary Text**: \`#475569\` (Slate-600)
- **Border / Divider**: \`#E2E8F0\` (Slate-200)

#### 🚦 Triage & Status Colors (Full 360° Framing):
- 🟢 **Operational / Available**:
  - Card: \`border-2 border-emerald-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/20\`
  - Badge: \`border border-emerald-300 bg-emerald-100 text-emerald-950 font-bold\`
- 🟠 **Warning / Heavy Load (80%+ Occupancy)**:
  - Card: \`border-2 border-amber-200 bg-white hover:border-amber-300 hover:bg-amber-50/20\`
  - Badge: \`border border-amber-300 bg-amber-100 text-amber-950 font-bold\`
- 🔴 **Critical / Emergency (Triage Red / Stock Out)**:
  - Card: \`border-2 border-red-200 bg-white hover:border-red-300 hover:bg-red-50/20\`
  - Badge: \`border border-red-300 bg-red-100 text-red-900 font-bold\`
- 🔵 **Logistics / Info (Supply Runway / Services)**:
  - Card: \`border-2 border-sky-200 bg-white hover:border-sky-300 hover:bg-sky-50/20\`
  - Badge: \`border border-sky-300 bg-sky-100 text-sky-950 font-bold\`

---

### ✍️ TYPOGRAPHY HIERARCHY (Thai & English)
- **Main Font**: 'IBM Plex Sans Thai', 'Inter', -apple-system, sans-serif
- **Telemetry & Numbers**: 'Geist Mono', 'SF Mono', monospace (tabular-nums font-bold)
- **Page Titles**: \`text-2xl sm:text-3xl font-extrabold text-[#0A2647] tracking-tight\`
- **Section Headers**: \`text-xl font-bold text-slate-900\`
- **Body Text**: \`text-base text-slate-600 leading-relaxed\`
- **Metrics Numerals**: \`font-mono text-3xl sm:text-4xl font-extrabold tracking-tight\`

---

### 🧩 SVELTE 5 CODE PATTERNS

#### 1. KPI Telemetry Status Card (360° Border)
\`\`\`svelte
<div class="rounded-xl border-2 border-emerald-200 bg-white p-5 shadow-xs transition-all hover:border-emerald-300 hover:bg-emerald-50/20 space-y-3">
  <div class="flex items-center justify-between">
    <span class="text-sm font-bold text-slate-600">ศูนย์เปิดรับผู้พักพิง</span>
    <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-950">
      <span class="h-2 w-2 rounded-full bg-emerald-600"></span>
      ปกติ 75%
    </span>
  </div>
  <div class="flex items-baseline gap-2">
    <span class="font-mono text-3xl sm:text-4xl font-extrabold text-slate-900">18</span>
    <span class="text-sm font-bold text-slate-500">/ 24 แห่ง</span>
  </div>
  <div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
    <div class="h-full rounded-full bg-emerald-600" style="width: 75%"></div>
  </div>
</div>
\`\`\`

#### 2. Primary Civic Button
\`\`\`svelte
<button class="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0A2647] px-5 py-3 text-base font-semibold text-white shadow-xs transition-all hover:bg-[#051930] active:scale-[0.98]">
  <span>เริ่มลงทะเบียนเข้าพัก</span>
</button>
\`\`\`

When writing UI code, strictly produce clean Svelte 5 runes ($state, $derived, $props) and Tailwind CSS classes adhering to these Civic Light guidelines.`;

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
		copied = true;
		toast.success('คัดลอก Prompt สำหรับ Google AI Studio แล้ว');
		setTimeout(() => (copied = false), 2500);
	}
</script>

<svelte:head>
	<title>Design System & AI Studio Guide | SmartShelter Thailand</title>
</svelte:head>

<div class="min-h-screen bg-[#F8FAFC] py-10">
	<div class="mx-auto max-w-7xl space-y-10 px-4 sm:px-6 lg:px-8">
		<!-- Header Banner -->
		<div class="rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-xs">
			<div class="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
				<div class="space-y-2">
					<div
						class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-[#0A2647]"
					>
						<Sparkles class="h-3.5 w-3.5" />
						<span>SMARTSHELTER DESIGN SYSTEM v2.4</span>
					</div>
					<h1 class="text-3xl font-extrabold tracking-tight text-[#0A2647] sm:text-4xl">
						Civic Light Design System
					</h1>
					<p class="max-w-2xl text-base text-slate-600">
						ระบบดีไซน์มาตรฐานสำหรับศูนย์พักพิงและงานบรรเทาภัยพิบัติ เน้นความชัดเจน สว่าง คมชัด
						ตัวหนังสือใหญ่ (18px) และรองรับการนำไปใช้ Prompt ต่อยอดด้วย Google AI Studio
					</p>
				</div>

				<!-- Tab Switches -->
				<div
					class="flex shrink-0 items-center gap-2 self-start rounded-xl border border-slate-200 bg-slate-100 p-1.5 md:self-auto"
				>
					<button
						onclick={() => (activeTab = 'components')}
						class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all {activeTab ===
						'components'
							? 'bg-white text-slate-900 shadow-xs'
							: 'text-slate-600 hover:text-slate-900'}"
					>
						<Eye class="h-4 w-4" />
						<span>Living Components</span>
					</button>
					<button
						onclick={() => (activeTab = 'prompt-guide')}
						class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all {activeTab ===
						'prompt-guide'
							? 'bg-[#0A2647] text-white shadow-xs'
							: 'text-slate-600 hover:text-slate-900'}"
					>
						<Terminal class="h-4 w-4" />
						<span>Google AI Studio Prompt</span>
					</button>
				</div>
			</div>
		</div>

		{#if activeTab === 'components'}
			<!-- 1. Design Core Principles -->
			<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
				<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
					<div class="text-2xl font-black text-[#0A2647]">01</div>
					<h3 class="text-lg font-bold text-slate-900">Always Light Theme</h3>
					<p class="text-sm leading-relaxed text-slate-600">
						พื้นหลัง Slate-50 สะอาด สบายตา คมชัดทุกสภาพแสง อ่านง่ายแม้อยู่กลางแจ้ง
					</p>
				</div>

				<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
					<div class="text-2xl font-black text-emerald-700">02</div>
					<h3 class="text-lg font-bold text-slate-900">Full 360° Status Border</h3>
					<p class="text-sm leading-relaxed text-slate-600">
						ใช้เส้นขอบระบุสถานะรอบการ์ดทั้งใบ ไม่มีเส้นขีดข้างเดียว ดูเป็นระเบียบ เรียบร้อย
					</p>
				</div>

				<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
					<div class="text-2xl font-black text-blue-700">03</div>
					<h3 class="text-lg font-bold text-slate-900">Large Type (18px)</h3>
					<p class="text-sm leading-relaxed text-slate-600">
						ใช้ IBM Plex Sans Thai ขนาดใหญ่ อ่านออกสบายตาจากระยะ 1 เมตร
					</p>
				</div>

				<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
					<div class="text-2xl font-black text-amber-700">04</div>
					<h3 class="text-lg font-bold text-slate-900">Micro-Elevations</h3>
					<p class="text-sm leading-relaxed text-slate-600">
						ควบคุมเงาให้อยู่ในระดับไมโคร (shadow-xs) ป้องกันการ์ดลอยหลอกตา
					</p>
				</div>
			</div>

			<!-- 2. Color System & Semantic Palette -->
			<div class="space-y-6 rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-xs">
				<div>
					<h2 class="text-2xl font-bold text-slate-900">🎨 Color Tokens & Palette</h2>
					<p class="text-sm text-slate-500">ระบบสีหลักและสีบอกสถานะระดับความวิกฤต (Triage)</p>
				</div>

				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
					<!-- Brand Primary -->
					<div class="space-y-2 rounded-xl border border-slate-200 p-4">
						<div class="h-16 w-full rounded-lg bg-[#0A2647] shadow-xs"></div>
						<div>
							<div class="text-sm font-bold text-slate-900">Brand Navy</div>
							<div class="font-mono text-xs text-slate-500">#0A2647</div>
							<div class="text-[11px] text-slate-400">Primary / Header</div>
						</div>
					</div>

					<!-- Operational Green -->
					<div class="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/20 p-4">
						<div class="h-16 w-full rounded-lg bg-emerald-600 shadow-xs"></div>
						<div>
							<div class="text-sm font-bold text-emerald-950">Operational</div>
							<div class="font-mono text-xs text-emerald-700">#16A34A</div>
							<div class="text-[11px] text-emerald-600">พร้อมรับ / ปกติ</div>
						</div>
					</div>

					<!-- Heavy Load Amber -->
					<div class="space-y-2 rounded-xl border border-amber-200 bg-amber-50/20 p-4">
						<div class="h-16 w-full rounded-lg bg-amber-500 shadow-xs"></div>
						<div>
							<div class="text-sm font-bold text-amber-950">Warning</div>
							<div class="font-mono text-xs text-amber-700">#F59E0B</div>
							<div class="text-[11px] text-amber-600">ครองเตียง 80%+</div>
						</div>
					</div>

					<!-- Critical Red -->
					<div class="space-y-2 rounded-xl border border-red-200 bg-red-50/20 p-4">
						<div class="h-16 w-full rounded-lg bg-red-600 shadow-xs"></div>
						<div>
							<div class="text-sm font-bold text-red-950">Critical Triage</div>
							<div class="font-mono text-xs text-red-700">#DC2626</div>
							<div class="text-[11px] text-red-600">เคสวิกฤต / ฉุกเฉิน</div>
						</div>
					</div>

					<!-- Supply Blue -->
					<div class="space-y-2 rounded-xl border border-sky-200 bg-sky-50/20 p-4">
						<div class="h-16 w-full rounded-lg bg-sky-600 shadow-xs"></div>
						<div>
							<div class="text-sm font-bold text-sky-950">Logistics</div>
							<div class="font-mono text-xs text-sky-700">#0284C7</div>
							<div class="text-[11px] text-sky-600">เสบียง / บริการ</div>
						</div>
					</div>

					<!-- Slate Canvas -->
					<div class="space-y-2 rounded-xl border border-slate-200 p-4">
						<div
							class="h-16 w-full rounded-lg border border-slate-300 bg-[#F8FAFC] shadow-xs"
						></div>
						<div>
							<div class="text-sm font-bold text-slate-900">Canvas Slate</div>
							<div class="font-mono text-xs text-slate-500">#F8FAFC</div>
							<div class="text-[11px] text-slate-400">Background</div>
						</div>
					</div>
				</div>
			</div>

			<!-- 3. Telemetry Status Cards (Full 360° Border) -->
			<div class="space-y-6 rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-xs">
				<div>
					<h2 class="text-2xl font-bold text-slate-900">
						📊 Status Telemetry Cards (Full 360° Framing)
					</h2>
					<p class="text-sm text-slate-500">
						การ์ดแสดงตัวเลขชี้วัดความจุและสถานะวิกฤตแบบมีเส้นขอบรอบตัว
					</p>
				</div>

				<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
					<!-- Operational Card -->
					<div class="card-status-operational space-y-3 rounded-xl p-5 shadow-xs">
						<div class="flex items-center justify-between">
							<span class="text-sm font-bold text-slate-700">ศูนย์เปิดทำการ</span>
							<span
								class="badge-status-adequate inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold"
							>
								<span class="badge-dot-adequate h-2 w-2 rounded-full"></span>
								พร้อมรับ 75%
							</span>
						</div>
						<div class="flex items-baseline gap-2">
							<span class="font-mono text-4xl font-extrabold text-slate-900">18</span>
							<span class="font-mono text-sm font-bold text-slate-500">/ 24 แห่ง</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full bg-emerald-600" style="width: 75%"></div>
						</div>
					</div>

					<!-- Warning Card -->
					<div class="card-status-warning space-y-3 rounded-xl p-5 shadow-xs">
						<div class="flex items-center justify-between">
							<span class="text-sm font-bold text-slate-700">อัตราครองเตียง</span>
							<span
								class="badge-status-warning inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold"
							>
								<span class="badge-dot-warning h-2 w-2 rounded-full"></span>
								โหลดสูง 82%
							</span>
						</div>
						<div class="flex items-baseline gap-2">
							<span class="font-mono text-4xl font-extrabold text-slate-900">3,420</span>
							<span class="font-mono text-sm font-bold text-slate-500">/ 4,150 เตียง</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full bg-amber-500" style="width: 82.4%"></div>
						</div>
					</div>

					<!-- Critical Card -->
					<div class="card-status-critical space-y-3 rounded-xl p-5 shadow-xs">
						<div class="flex items-center justify-between">
							<span class="text-sm font-bold text-slate-700">กลุ่มเปราะบาง (Red)</span>
							<span
								class="badge-status-critical inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold"
							>
								<span class="badge-dot-critical h-2 w-2 rounded-full"></span>
								48 วิกฤต
							</span>
						</div>
						<div class="flex items-baseline gap-2">
							<span class="font-mono text-4xl font-extrabold text-red-600">412</span>
							<span class="font-mono text-sm font-bold text-slate-500">คน</span>
						</div>
						<div class="grid grid-cols-2 gap-2 pt-1 text-xs font-semibold text-slate-700">
							<div
								class="rounded border border-red-200 bg-red-100/60 p-1.5 text-center text-red-900"
							>
								ติดเตียง: <strong>48</strong>
							</div>
							<div
								class="rounded border border-slate-200 bg-slate-100 p-1.5 text-center text-slate-800"
							>
								สูงอายุ: <strong>284</strong>
							</div>
						</div>
					</div>

					<!-- Supply Card -->
					<div class="card-status-supply space-y-3 rounded-xl p-5 shadow-xs">
						<div class="flex items-center justify-between">
							<span class="text-sm font-bold text-slate-700">สำรองอาหาร (DoC)</span>
							<span
								class="badge-status-overstock inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold"
							>
								<span class="badge-dot-overstock h-2 w-2 rounded-full"></span>
								สำรอง 4.8 วัน
							</span>
						</div>
						<div class="flex items-baseline gap-2">
							<span class="font-mono text-4xl font-extrabold text-[#0A2647]">10,260</span>
							<span class="font-mono text-sm font-bold text-slate-500">มื้อ/วัน</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full bg-sky-600" style="width: 68%"></div>
						</div>
					</div>
				</div>
			</div>

			<!-- 4. Interactive Buttons & Form Controls -->
			<div class="space-y-6 rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-xs">
				<div>
					<h2 class="text-2xl font-bold text-slate-900">🔘 Action Buttons & Controls</h2>
					<p class="text-sm text-slate-500">ปุ่มสั่งการหลัก ปุ่มรอง และช่องค้นหาพร้อมคีย์ลัด</p>
				</div>

				<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
					<div class="space-y-4">
						<h3 class="text-base font-bold text-slate-800">Button Variants & Sizes</h3>
						<div class="flex flex-wrap items-center gap-3">
							<!-- Primary Navy -->
							<button
								class="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0A2647] px-5 py-3 text-base font-semibold text-white shadow-xs transition-all hover:bg-[#051930] active:scale-[0.98]"
							>
								<span>Primary Action</span>
							</button>

							<!-- Secondary Outline -->
							<button
								class="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-5 py-3 text-base font-semibold text-slate-800 shadow-xs transition-all hover:border-slate-400 hover:bg-slate-50"
							>
								<span>Secondary Outline</span>
							</button>

							<!-- Destructive -->
							<button
								class="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-3 text-base font-semibold text-white shadow-xs transition-all hover:bg-red-700"
							>
								<span>Destructive</span>
							</button>
						</div>
					</div>

					<div class="space-y-4">
						<h3 class="text-base font-bold text-slate-800">Search Box with Command Hint</h3>
						<div class="relative">
							<input
								type="text"
								placeholder="ค้นหาศูนย์พักพิง, รายชื่อญาติ, รหัสสิ่งของ..."
								class="h-12 w-full rounded-lg border-2 border-slate-300 bg-slate-50 pr-16 pl-10 text-sm font-medium text-slate-900 transition-all outline-none placeholder:text-slate-400 focus:border-[#0A2647] focus:bg-white"
							/>
							<Compass class="absolute top-3.5 left-3.5 h-5 w-5 text-slate-400" />
							<span
								class="absolute top-3 right-3 rounded border border-slate-300 bg-slate-200/60 px-2 py-0.5 font-mono text-xs font-bold text-slate-600"
							>
								⌘K
							</span>
						</div>
					</div>
				</div>
			</div>
		{:else}
			<!-- Google AI Studio Prompt Kit -->
			<div class="space-y-6 rounded-2xl border-2 border-[#0A2647] bg-white p-8 shadow-sm">
				<div
					class="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between"
				>
					<div class="space-y-1">
						<div class="flex items-center gap-2">
							<Terminal class="h-5 w-5 text-[#0A2647]" />
							<h2 class="text-2xl font-bold text-[#0A2647]">Google AI Studio System Prompt Kit</h2>
						</div>
						<p class="text-sm text-slate-600">
							คัดลอกข้อความด้านล่างนี้ไปวางในช่อง <strong>System Instructions</strong> ของ Google AI Studio
							เพื่อให้โมเดลเจนหน้าจอ UI ได้ตรงตามดีไซน์เป๊ะ 100%
						</p>
					</div>

					<button
						onclick={() => copyToClipboard(AI_STUDIO_SYSTEM_PROMPT)}
						class="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0A2647] px-6 py-3 text-sm font-bold text-white shadow-xs transition-all hover:bg-[#051930] active:scale-95"
					>
						{#if copied}
							<Check class="h-4 w-4 text-emerald-400" />
							<span>คัดลอกเรียบร้อย!</span>
						{:else}
							<Copy class="h-4 w-4" />
							<span>คัดลอก System Prompt</span>
						{/if}
					</button>
				</div>

				<div class="relative">
					<pre
						class="max-h-[600px] overflow-x-auto rounded-xl border border-slate-800 bg-[#0F172A] p-6 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-200">{AI_STUDIO_SYSTEM_PROMPT}</pre>
				</div>
			</div>
		{/if}
	</div>
</div>
