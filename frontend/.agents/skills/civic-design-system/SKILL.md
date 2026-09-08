---
name: civic-design-system
description: Mandatory Civic Light Design System guidelines, negative constraints, color/type/spatial tokens, and Svelte 5 component patterns for SmartShelter Thailand. Load whenever creating, editing, or reviewing any UI component, page, or layout.
---

# SmartShelter Thailand Civic Light Design System (v2.4)
### Minimal, Modern & Clean Architecture Guide for AI Agents & Developers

This skill establishes the non-negotiable frontend design and engineering standards for the **SmartShelter Thailand** application. All Svelte 5 components, layouts, forms, and dialogs MUST adhere to these rules.

---

## 🚫 ABSOLUTE NEGATIVE CONSTRAINTS (STRICT RULES)

1. **ALWAYS LIGHT THEME CANVAS**:
   - Never render a dark background for full pages or sections.
   - Canvas is strictly `#F8FAFC` (Slate-50) and card surfaces are `#FFFFFF` (Pure White).
2. **NO SINGLE-SIDED BORDER STRIPES**:
   - Never use `border-l-4`, `border-l-2`, or `border-t-4` for status cards.
   - Status cards MUST use a complete 360-degree tinted border around the entire perimeter (e.g. `border border-emerald-200 bg-white`).
3. **NO HEAVY DROP SHADOWS**:
   - Avoid `shadow-lg`, `shadow-xl`, or `shadow-2xl` on cards.
   - Use razor-thin 1px borders (`border border-slate-200/80`) combined with micro-elevations (`shadow-2xs` or `shadow-xs`).
4. **NO OVERLY ROUNDED CONTAINERS**:
   - Container and card border radius is strictly 12px to 16px (`rounded-xl` or `rounded-2xl`).
   - Do NOT use `rounded-3xl` or pill containers for rectangular cards.
5. **NO TINY UNREADABLE TEXT**:
   - Base body text is 16px (`text-base`), lead field text is 18px (`text-lg`), form labels are 14px (`text-sm font-semibold`).
   - Never use `text-[10px]` or `text-[11px]` for vital medical, CID, or shelter capacity data. Use standard token scale (`text-xs`, `text-sm`, `text-base`).
6. **NO COLOR-ONLY STATUS INDICATORS**:
   - Always pair colors with explicit text labels and icons for colorblind accessibility (WCAG 2.1 AA).
7. **MANDATORY SHADCN-SVELTE FORM CONTROLS**:
   - All inputs, selects, textareas, switches, checkboxes, labels, and dialogs MUST use official `shadcn-svelte` components (`$lib/components/ui/*`).
   - Never write raw unstyled HTML `<input>`, `<select>`, or custom toggle divs.
8. **UNIFIED SINGLE-FONT SYSTEM (IBM Plex Sans Thai)**:
   - All UI text, headings, buttons, form controls, badges, telemetry KPI numbers, CID numbers, and timestamps MUST use `'IBM Plex Sans Thai', -apple-system, sans-serif`.
   - Numerical data and metrics MUST use `tabular-nums` within IBM Plex Sans Thai for consistent digit alignment.
   - Monospace font (`'Geist Mono'`) is strictly reserved for technical programming code snippets and developer blocks (`<pre>`, `<code>`).

---

## 🎨 DESIGN TOKENS (TypeScript Import: `$lib/tokens`)

You can import all tokens directly in TypeScript:
```typescript
import { tokens } from '$lib/tokens';
// tokens.colors, tokens.typography, tokens.spatial, tokens.responsive, tokens.motion
```

### 1. Color Tokens & Specialized Operations Mapping
- **Brand Navy (Primary)**: `#0A2647` (`bg-[#0A2647]`, `text-[#0A2647]`) — Hover: `#051930`
- **GovTech Cerulean (Secondary)**: `#0284C7` (`.btn-secondary-brand`, active filters, map points, export actions)
- **Destructive Red**: `#DC2626` (`.btn-destructive-brand`, delete, emergency cancel, close admissions)
- **Neutral Secondary**: White card with Slate-300 border (`#CBD5E1`, `.btn-secondary-outline`)
- **Accent (Ice Blue Tint)**: `#F0F9FF` bg, `#BAE6FD` border, `#0369A1` text (`.badge-accent`, row selection tint)
- **Warning Advisory**: `#FFFBEB` bg, `#FDE68A` border, `#78350F` text (`.badge-warning-advisory`)
- **Muted Slate**: `#F1F5F9` bg, `#E2E8F0` border, `#64748B` text (`.badge-muted`, helper panels, disabled states)
- **Canvas**: `#F8FAFC` (`bg-[#F8FAFC]`) | **Card Surface**: `#FFFFFF` (`bg-white`)
- **Text Primary**: `#0F172A` (`text-slate-900`) | **Text Body**: `#334155` (`text-slate-700`)
- **Text Muted**: `#64748B` (`text-slate-500`) | **Borders**: `#E2E8F0` (`border-slate-200/80`)

#### Specialized Operations (Strictly Mapped to Palette)
- **Kitchen & LPG Energy**: Warm Orange `#EA580C` (`.badge-kitchen`, `.card-ops-kitchen`, `border-orange-200 bg-orange-50 text-orange-900`)
- **Family Care (Maternal & Infant)**: Soft Rose `#E11D48` (`.badge-family`, `.card-ops-family`, `border-rose-200 bg-rose-50 text-rose-900`)
- **Donors & Public Portal**: Civic Cerulean `#0284C7` (`.badge-donor`, `.card-ops-donor`, `border-sky-200 bg-sky-50 text-sky-900` — inherits from Secondary)
- **Volunteers & Field Responders**: Civic Emerald `#059669` (`.badge-volunteer`, `.card-ops-volunteer`, `border-emerald-200 bg-emerald-50 text-emerald-900`)
- **Inventory & SPHERE**: Clean Teal `#0D9488` (`.badge-inventory`, `.card-ops-inventory`, `border-teal-200 bg-teal-50 text-teal-900`)

> [!IMPORTANT]
> **Single Source of Truth Architecture**: All downstream tokens (Semantic, Domain, Status, Portal Services) inherit directly from `baseBrand`, `baseSecondary`, `baseDestructive`, etc. in `$lib/tokens/colors.ts` and CSS variables (`--brand-primary`, `--brand-secondary`, etc.) in `app.css`. Any change to a base token propagates across the entire application.

#### Public Portal Essential Services Mapping (Adaptive Semantic Palette)
- **1. ค้นหาที่พักพิง (Shelters)**: Red `#DC2626` (`portalServices.shelter`: border-red-200, bg-red-50 icon container, primary btn-destructive)
- **2. ค้นหาญาติ / ผู้พักพิง (Family Tracing)**: Navy `#0A2647` & Cerulean `#0284C7` (`portalServices.tracing`: border-sky-200, bg-sky-50 icon container, primary btn-primary)
- **3. ผู้บริจาค / มอบเสบียง (Donations)**: Warm Amber `#EA580C` (`portalServices.donation`: border-amber-200, bg-amber-50 icon container, primary amber button)
- **4. จิตอาสา / อาสาสมัคร (Volunteers)**: Civic Emerald `#059669` (`portalServices.volunteer`: border-emerald-200, bg-emerald-50 icon container, primary emerald button)
- **Emergency FAQ**: Active border `border-sky-300`, active badge `bg-[#0A2647] text-white`
- **Floating Emergency Controls**: 1669 Hotline pill (`bg-red-600` Destructive), Alert bell pill (`bg-[#0284C7]` Secondary Cerulean)

### 2. 360° Refined Status Matrix
| Status Category | Hex | Complete Card Framing | Badge Classes |
| :--- | :--- | :--- | :--- |
| **Operational (Green)** | `#16A34A` | `border border-emerald-200 bg-white shadow-2xs` | `border border-emerald-200 bg-emerald-50 text-emerald-900 font-semibold` |
| **Warning (Amber)** | `#F59E0B` | `border border-amber-200 bg-white shadow-2xs` | `border border-amber-200 bg-amber-50 text-amber-900 font-semibold` |
| **Critical (Red)** | `#DC2626` | `border border-red-200 bg-white shadow-2xs` | `border border-red-200 bg-red-50 text-red-900 font-semibold` |
| **Logistics (Sky)** | `#0284C7` | `border border-sky-200 bg-white shadow-2xs` | `border border-sky-200 bg-sky-50 text-sky-900 font-semibold` |
| **EOC Command (Purple)** | `#9333EA` | `border border-purple-200 bg-white shadow-2xs` | `border border-purple-200 bg-purple-50 text-purple-900 font-semibold` |

### 3. Typography Hierarchy
- `h1`: `text-3xl sm:text-4xl font-extrabold text-[#0A2647] tracking-tight` (36px-40px)
- `h2`: `text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight` (24px-28px)
- `h3`: `text-lg sm:text-xl font-bold text-slate-900` (18px-20px)
- `h4`: `text-base font-semibold text-slate-800` (15px-16px)
- `p.lead`: `text-lg text-slate-700 leading-relaxed font-medium` (18px)
- `p`: `text-base text-slate-700 leading-normal font-normal` (16px)
- `p.small`: `text-sm text-slate-500 leading-normal font-normal` (14px)
- `label`: `text-sm font-semibold text-slate-700` (14px)
- `span.badge`: `text-xs font-semibold tracking-wide` (12px)
- `.metric-lg`: `text-3xl sm:text-4xl font-bold text-slate-900 tabular-nums` (36px-44px)

### 4. 1-Page Spatial Geometry & Radii
- **Page Container**: `mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-16 space-y-12 sm:space-y-16`
- **Section Box**: `rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-10 shadow-2xs space-y-6`
- **Card Padding**: `p-4 sm:p-5` | **Grid Gutters**: `gap-4 sm:gap-6`
- **Border Radius**: `rounded-2xl` (16px - Sections/Modals), `rounded-xl` (12px - Cards/Grids), `rounded-lg` (8px - Buttons/Inputs), `rounded-full` (Pills/Badges)
- **Elevation**: `shadow-2xs` (Cards), `shadow-xs` (Hover/Floating), `shadow-md` (Dialogs), `shadow-2xl` (Command Palette)

---

## ♿ ACCESSIBILITY (A11Y) & TOUCH ERGONOMICS

1. **Touch Targets**:
   - Mobile: Minimum `44x44px` (`min-h-11 min-w-11`).
   - Field Tablet: Minimum `48x48px` (`min-h-12 min-w-12`) for gloved or stylus operation in disaster shelters.
2. **Keyboard Focus Rings**:
   - Every focusable element MUST have: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2`.
3. **Screen Reader (SR)**:
   - Always provide `<span class="sr-only">คำอธิบาย</span>` on icon-only buttons.
   - Always associate form `<Label for="id">` with shadcn-svelte input controls `<Input id="id" />`.

---

## 📟 RESPONSIVE & FIELD TABLET MATRIX

- **Mobile (< 640px / sm)**: 1-column vertical stacking (`grid-cols-1`), full-width action buttons (`w-full`), horizontally scrollable tables.
- **Tablet Portrait (640px - 1024px / md)**: 2-column KPI grids, 2-column intake forms, 48px touch targets, thumb-zone CTAs.
- **Tablet Landscape (1024px - 1280px / lg)**: **Master-Detail Split View (5:7 ratio)** (`grid grid-cols-12 gap-5`: 5-col master list, 7-col detail inspection), 3-column KPI grids.
- **Desktop EOC (> 1280px / xl)**: 4-column KPI grids, expansive sidebars, max width `max-w-7xl mx-auto`.

---

## ⌨️ COMMAND PALETTE & KEYBOARD SHORTCUTS (`⌘K`)

- Global `⌘K` (Mac) / `Ctrl+K` (Win) opens `<CivicCommandPalette bind:open={isOpen} />`.
- Use standard `<kbd>` styling:
  ```html
  <kbd class="px-2 py-0.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-md shadow-2xs">⌘K</kbd>
  ```
- Shortcut Standard: `⌘K` (Search/Command), `⌘N` (New Intake), `⌘D` (Distribute Supplies), `⌘E` (Broadcast Alert), `⌘O` (Offline Mode), `Esc` (Close).

---

## 💾 OFFLINE & REMOTE-FIRST COUCHDB SYNC INDICATORS

1. **Online (Synced)**:
   ```html
   <div class="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
     <span class="relative flex h-2 w-2">
       <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
       <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
     </span>
     <span>ออนไลน์ • ซิงก์สมบูรณ์</span>
   </div>
   ```
2. **Offline Disaster Banner**:
   ```html
   <div class="rounded-xl border border-slate-300 bg-slate-100 p-4 text-slate-800 flex items-center justify-between shadow-2xs">
     <div class="flex items-center gap-3">
       <WifiOff class="h-5 w-5 text-slate-500" />
       <div>
         <div class="text-xs font-bold text-slate-900">กำลังทำงานในโหมดออฟไลน์ (Local CouchDB)</div>
         <div class="text-xs text-slate-500">ข้อมูลจะถูกจัดเก็บบนเครื่องและซิงก์อัตโนมัติเมื่อมีสัญญาณ</div>
       </div>
     </div>
     <span class="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700 tabular-nums">3 รายการรอซิงก์</span>
   </div>
   ```

---

## 🧩 SVELTE 5 & SHADCN-SVELTE PRODUCTION TEMPLATES

### 1. Telemetry KPI Card with 360° Framing
```svelte
<script lang="ts">
  import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
  
  interface Props {
    title: string;
    value: number;
    total: number;
    percentage: number;
  }
  let { title, value, total, percentage }: Props = $props();
</script>

<div class="rounded-xl border border-emerald-200 bg-white p-5 shadow-2xs space-y-3 transition-all hover:border-emerald-300">
  <div class="flex items-center justify-between">
    <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</span>
    <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
      <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
      พร้อมรับ <span class="tabular-nums">{percentage}%</span>
    </span>
  </div>
  <div class="flex items-baseline gap-2">
    <span class="text-3xl sm:text-4xl font-bold text-slate-900 tabular-nums">{value}</span>
    <span class="text-xs font-semibold text-slate-400 tabular-nums">/ {total}</span>
  </div>
  <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
    <div class="h-full rounded-full bg-emerald-600 transition-all duration-300" style="width: {percentage}%"></div>
  </div>
</div>
```

### 2. Tablet-Optimized Master-Detail Split View with shadcn-svelte Input
```svelte
<script lang="ts">
  import { Input } from '$lib/components/ui/input/index.js';
  import Search from '@lucide/svelte/icons/search';

  let searchQuery = $state('');
</script>

<div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
  <!-- Left Master List (5 cols) -->
  <div class="lg:col-span-5 rounded-xl border border-slate-200/80 bg-white p-4 space-y-3 shadow-2xs">
    <div class="relative">
      <Search class="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <Input
        type="text"
        placeholder="ค้นหาผู้พักพิง..."
        bind:value={searchQuery}
        class="h-11 sm:h-10 pl-9 text-sm"
      />
    </div>
    <div class="space-y-1.5">
      <button class="w-full text-left p-3 rounded-lg bg-[#0A2647]/5 border border-[#0A2647]/20 flex items-center justify-between">
        <div>
          <div class="text-sm font-bold text-[#0A2647]">นายสมชาย ใจดี</div>
          <div class="text-xs text-slate-500">เต็นท์ A-12 • CID: 1-5099-00123-45-6</div>
        </div>
      </button>
    </div>
  </div>

  <!-- Right Detail Panel (7 cols) -->
  <div class="lg:col-span-7 rounded-xl border border-slate-200/80 bg-white p-6 space-y-4 shadow-2xs">
    <h3 class="text-lg font-bold text-slate-900">ข้อมูลการตรวจคัดกรองและการแจกเสบียง</h3>
    <!-- Content details -->
  </div>
</div>
```

### 3. Accessible Form Input with shadcn-svelte & Svelte 5 Runes
```svelte
<script lang="ts">
  import { Label } from '$lib/components/ui/label/index.js';
  import { Input } from '$lib/components/ui/input/index.js';

  let cid = $state('');
</script>

<div class="space-y-1.5">
  <Label for="cid-input" class="text-sm font-semibold text-slate-700">
    เลขประจำตัวประชาชน <span class="text-red-500">*</span>
  </Label>
  <Input
    id="cid-input"
    type="text"
    placeholder="1-XXXX-XXXXX-XX-X"
    bind:value={cid}
    class="h-11 sm:h-10 tabular-nums"
  />
  <p class="text-xs text-slate-500">กรอก 13 หลักเพื่อออกรหัสประจำเต็นท์</p>
</div>
```

### 4. Compound Field with Validation (shadcn-svelte Field)
```svelte
<script lang="ts">
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';

  let value = $state('');
  let isError = $state(false);
</script>

<Field.Root data-invalid={isError}>
  <Field.Label for="field-id">ชื่อเต็นท์ที่พัก</Field.Label>
  <Input id="field-id" bind:value aria-invalid={isError} />
  {#if isError}
    <Field.Error>กรุณาระบุชื่อเต็นท์ที่พักให้ถูกต้อง</Field.Error>
  {:else}
    <Field.Description>เช่น เต็นท์ A-01 หรือ โซนพยาบาล</Field.Description>
  {/if}
</Field.Root>
```

---

## 📋 PRE-FLIGHT COMPONENT REVIEW CHECKLIST FOR AI AGENTS

Before completing any UI change in this workspace, verify:
- [ ] **Canvas Theme**: Is the background `#F8FAFC` or `#FFFFFF` (no dark canvas)?
- [ ] **Status Borders**: Are all status cards bordered on all 4 sides with 360° tint (`border border-emerald-200` etc.)?
- [ ] **Shadows**: Are shadows subtle (`shadow-2xs` or `shadow-xs`), never heavy (`shadow-lg`/`xl`)?
- [ ] **Typography & Fonts**: Are headings using exact tokens (`h1` to `h4`), 100% unified `IBM Plex Sans Thai` with `tabular-nums` for numbers (`font-mono` reserved only for actual `<pre>`/`<code>` technical snippets), and no arbitrary `text-[10px]` classes?
- [ ] **Form Standards**: Are all form controls built with official `shadcn-svelte` components (`$lib/components/ui/*`) and Svelte 5 runes (`$state`, `bind:value`, `bind:checked`)?
- [ ] **Touch Targets**: Are buttons/inputs at least 44px (mobile) and 48px (field tablet)?
- [ ] **A11y**: Are labels paired with inputs (`for` / `id`), focus rings visible, and icons accompanied by text or `sr-only`?
- [ ] **Svelte 5**: Are state runes used (`$state`, `$derived`, `$props`) instead of legacy Svelte 4 syntax?
- [ ] **Type Check**: Does `pnpm check` pass with **0 errors and 0 warnings**?
