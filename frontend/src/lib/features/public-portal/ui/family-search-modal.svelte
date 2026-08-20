<script lang="ts">
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Search from '@lucide/svelte/icons/search';
	import User from '@lucide/svelte/icons/user';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input';
	import { familySearch } from '../data/public-api';
	import { searchResultKey } from '../domain/mappers';
	import type { FamilySearchResult } from '../domain/types';

	interface Props {
		open?: boolean;
	}

	let { open = $bindable(false) }: Props = $props();

	let query = $state('');
	let isLoading = $state(false);
	let results = $state<FamilySearchResult[] | null>(null);
	let error = $state('');

	async function performSearch() {
		if (query.trim().length < 3) {
			error = 'กรุณากรอกข้อมูลอย่างน้อย 3 ตัวอักษร';
			return;
		}
		isLoading = true;
		error = '';
		results = null;

		try {
			const data = await familySearch(query.trim());
			results = data.results;
		} catch (e) {
			error = e instanceof Error ? e.message : 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้';
		} finally {
			isLoading = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void performSearch();
		}
	}

	function genderLabel(gender: string | null | undefined) {
		if (gender === 'male') return 'ชาย';
		if (gender === 'female') return 'หญิง';
		return 'อื่นๆ';
	}

	function formatDateTime(iso: string | null | undefined) {
		if (!iso) return 'ไม่ระบุเวลา';
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? 'ไม่ระบุเวลา' : `${d.toLocaleString('th-TH')} น.`;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-lg">
				<Search class="h-5 w-5 text-primary" />
				สืบค้นญาติและครอบครัว
			</Dialog.Title>
			<Dialog.Description>
				ค้นด้วยชื่อ นามสกุล หรือเบอร์โทรศัพท์ — ผลลัพธ์ถูกปกปิดข้อมูลบางส่วนตาม PDPA
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex gap-2">
			<Input
				bind:value={query}
				onkeydown={onKeydown}
				placeholder="ชื่อ นามสกุล หรือเบอร์โทรศัพท์"
				aria-label="คำค้นหา"
			/>
			<Button type="button" onclick={performSearch} disabled={isLoading}>
				{isLoading ? 'กำลังค้นหา…' : 'ค้นหา'}
			</Button>
		</div>

		{#if error}
			<p
				class="rounded-xl border border-danger/30 bg-danger-muted/40 p-3 text-sm text-danger"
				role="alert"
			>
				{error}
			</p>
		{/if}

		{#if results}
			{#if results.length === 0}
				<p class="rounded-xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">
					ไม่พบผู้ที่ตรงกับคำค้นหา — ลองใช้ชื่อเต็มหรือเบอร์โทรศัพท์
				</p>
			{:else}
				<ul class="space-y-2">
					{#each results as result, index (searchResultKey(result, index))}
						<li class="rounded-xl border border-border p-4">
							<p class="flex items-center gap-2 text-sm font-bold text-foreground">
								<User class="h-4 w-4 text-muted-foreground" />
								{result.name}
								<span class="text-xs font-normal text-muted-foreground">
									({genderLabel(result.gender)})
								</span>
							</p>
							<p class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
								<MapPin class="h-3 w-3" />
								{result.shelter_name ?? 'ไม่ระบุศูนย์'}
							</p>
							<p class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
								<Clock class="h-3 w-3" />
								{formatDateTime(result.checked_in_at)}
							</p>
							{#if result.status}
								<p class="mt-2 flex items-center gap-1.5 text-xs font-semibold text-success">
									<CheckCircle class="h-3.5 w-3.5" />
									{result.status}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
