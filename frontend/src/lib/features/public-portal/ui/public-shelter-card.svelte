<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Eye from '@lucide/svelte/icons/eye';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Users from '@lucide/svelte/icons/users';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import PawPrint from '@lucide/svelte/icons/paw-print';

	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';

	import type { PublicShelterCardModel } from '../domain/types';

	let {
		shelter,
		getStatusColor,
		getStatusText
	}: {
		shelter: PublicShelterCardModel;
		getStatusColor: (status: string) => string;
		getStatusText: (status: string) => string;
	} = $props();

	function translateVulnerableGroup(group: string): string {
		const map: Record<string, string> = {
			general_vulnerable: 'กลุ่มเปราะบางทั่วไป',
			quarantine: 'ผู้ป่วยแยกกักโรค',
			wheelchair: 'ผู้ใช้วีลแชร์',
			none: 'ไม่มีโซนเฉพาะ'
		};
		return map[group] || group;
	}

	function translatePetPolicy(policyStr: string | undefined): string {
		if (!policyStr) return '-';
		if (policyStr === 'not_allowed') return 'ไม่อนุญาต';
		if (policyStr === 'allowed') return 'อนุญาต (มีโซนสัตว์เลี้ยง)';
		if (policyStr.startsWith('conditional:')) {
			const categories = policyStr.split(':')[1];
			const map: Record<string, string> = {
				small_general: 'สัตว์เล็กทั่วไป',
				large_dog: 'สุนัขพันธุ์ใหญ่',
				livestock: 'ปศุสัตว์'
			};
			const translated = categories
				.split(',')
				.map((c) => map[c] || c)
				.join(', ');
			return `อนุญาตแบบมีเงื่อนไข (${translated})`;
		}
		return policyStr;
	}
</script>

<Card.Root
	class="flex flex-col gap-2! rounded-2xl border-border p-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/10 hover:shadow-md"
>
	<!-- Title and Status -->
	<div class="flex items-start justify-between gap-2">
		<div>
			<h4 class="line-clamp-2 leading-tight font-bold text-foreground transition-colors">
				{shelter.name}
			</h4>
			{#if shelter.admin_type}
				<div class="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
					<span class="h-1.5 w-1.5 rounded-full bg-primary/40"></span>
					{shelter.admin_type}
				</div>
			{/if}
		</div>
		<span
			class="shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold {getStatusColor(
				shelter.status
			)}"
		>
			<span class="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current"></span>{getStatusText(
				shelter.status
			)}
		</span>
	</div>

	<!-- Address and Distance -->
	<div class="mt-1 flex flex-col gap-1.5 text-xs text-muted-foreground">
		<div class="flex items-start gap-1.5">
			<MapPin class="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
			<span class="leading-relaxed"
				>{shelter.address} อ.{shelter.district}, จ.{shelter.province}
			</span>
		</div>
		<div class="ml-5 flex items-center gap-1.5">
			<Navigation class="h-3 w-3 opacity-70" />
			ระยะห่าง:
			{#if shelter.distance !== undefined && shelter.distance !== null && !isNaN(shelter.distance) && shelter.distance > 0}
				<span class="font-bold text-foreground">{shelter.distance} กม.</span>
			{:else}
				<span class="font-medium text-muted-foreground/70">-</span>
			{/if}
		</div>
	</div>

	<div class="mt-2 flex flex-col gap-2 rounded-xl bg-muted/40 p-3 ring-1 ring-border/50">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
				<Users class="h-3.5 w-3.5" />
				รองรับได้สูงสุด
			</div>
			<div class="font-bold text-foreground">
				<span class="text-sm">{shelter.capacity}</span>
				<span class="ml-0.5 text-[10px] font-bold text-muted-foreground">คน</span>
			</div>
		</div>
		{#if shelter.pet_policy || (shelter.vulnerable_groups && shelter.vulnerable_groups.filter((g) => g !== 'none' && g !== 'ไม่มีโซนเฉพาะ').length > 0)}
			<div class="flex flex-col gap-2 border-t border-border/60 pt-2.5">
				{#if shelter.vulnerable_groups && shelter.vulnerable_groups.filter((g) => g !== 'none' && g !== 'ไม่มีโซนเฉพาะ').length > 0}
					<div class="flex flex-col gap-1.5">
						<div class="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
							<HeartPulse class="h-3 w-3" />
							กลุ่มเปราะบางที่รองรับ
						</div>
						<div class="flex flex-wrap gap-1">
							{#each shelter.vulnerable_groups.filter((g) => g !== 'none' && g !== 'ไม่มีโซนเฉพาะ') as group, i (i)}
								<Badge
									variant="secondary"
									class="h-auto min-h-5 border-primary/10 bg-primary/5 py-1 text-left text-[10px] leading-tight whitespace-normal text-foreground hover:bg-primary/10"
								>
									{translateVulnerableGroup(group)}
								</Badge>
							{/each}
						</div>
					</div>
				{/if}

				{#if shelter.pet_policy}
					<div
						class="flex flex-col gap-1.5 {shelter.vulnerable_groups &&
						shelter.vulnerable_groups.filter((g) => g !== 'none' && g !== 'ไม่มีโซนเฉพาะ').length >
							0
							? 'mt-1'
							: ''}"
					>
						<div class="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
							<PawPrint class="h-3 w-3" />
							นโยบายสัตว์เลี้ยง
						</div>
						<div class="flex flex-wrap">
							<Badge
								variant="outline"
								class="h-auto min-h-5 py-1 text-left text-[10px] leading-tight whitespace-normal {shelter.pet_policy ===
									'not_allowed' || shelter.pet_policy.includes('ไม่')
									? 'border-danger/30 bg-danger/5 text-danger'
									: 'border-success/30 bg-success/5 text-success-dark'}"
							>
								{translatePetPolicy(shelter.pet_policy)}
							</Badge>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Actions -->
	<div class="mt-auto flex gap-2 pt-2">
		<Button
			href={`/shelters/${shelter.id}`}
			variant="outline"
			size="sm"
			class="h-9 flex-1 rounded-xl border-border text-xs font-bold text-foreground hover:bg-muted"
		>
			<Eye class="mr-1.5 h-3.5 w-3.5" /> ดูรายละเอียด
		</Button>
		<Button
			href={shelter.geo?.lat != null && shelter.geo?.lng != null
				? `https://www.google.com/maps/dir/?api=1&destination=${shelter.geo.lat},${shelter.geo.lng}`
				: undefined}
			target={shelter.geo?.lat != null && shelter.geo?.lng != null ? '_blank' : null}
			rel={shelter.geo?.lat != null && shelter.geo?.lng != null ? 'noopener noreferrer' : null}
			disabled={shelter.geo?.lat == null || shelter.geo?.lng == null}
			size="sm"
			class="h-9 flex-1 rounded-xl bg-primary-dark text-xs font-bold text-primary-foreground hover:bg-primary disabled:opacity-50"
		>
			<Navigation class="mr-1.5 h-3.5 w-3.5" /> นำทาง
		</Button>
	</div>
</Card.Root>
