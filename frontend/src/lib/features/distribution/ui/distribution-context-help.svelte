<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					type="button"
					class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
					aria-label="วิธีใช้งานการเบิกจ่าย"
					{...props}
				>
					<Info class="size-5" />
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content
			side="right"
			align="center"
			sideOffset={8}
			class="w-[36rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-4 text-left text-sm text-popover-foreground shadow-lg"
		>
			<div class="grid grid-cols-2 gap-x-5 gap-y-3">
				<section class="space-y-1.5">
					<h2 class="font-semibold text-foreground">เบิกของจากที่ไหน?</h2>
					<p class="text-muted-foreground">
						Item Master คือข้อมูล Catalog ของสิ่งของ ไม่ใช่สต็อกจริง
						เจ้าหน้าที่คลังจะตรวจสอบและเลือก Physical Lot จากสต็อกของศูนย์พักพิงปัจจุบันเมื่ออนุมัติ
					</p>
					<p class="text-muted-foreground">
						Flow นี้ไม่มีการเลือกศูนย์อื่นหรือครัวกลางเป็นแหล่งเบิก;
						การเบิกวัตถุดิบเข้าครัวเป็นกระบวนการแยกต่างหาก
					</p>
				</section>

				<section class="space-y-1.5">
					<h2 class="font-semibold text-foreground">ขั้นตอนการทำงาน</h2>
					<ol class="space-y-1 text-muted-foreground">
						<li>
							<span class="font-medium text-foreground">1. สร้างคำขอ</span> ระบุสิ่งของและจำนวน
						</li>
						<li>
							<span class="font-medium text-foreground">2. คลังตรวจสอบ</span> เลือก Physical Lot
						</li>
						<li>
							<span class="font-medium text-foreground">3. สร้าง Active Batch</span>
							ตัดสต็อกจากคลังเป็นชุดสำหรับแจกจ่าย
						</li>
						<li>
							<span class="font-medium text-foreground">4. แจกจ่ายหน้างาน</span>
							หักจำนวนจาก Active Batch โดยไม่ตัดสต็อกหลักซ้ำ
						</li>
						<li>
							<span class="font-medium text-foreground">5. ปิดรอบ</span>
							กระทบยอดของที่แจก ชำรุด/สูญหาย และคืนของคงเหลือกลับคลัง
						</li>
					</ol>
				</section>

				<p class="col-span-2 border-t border-border pt-2.5 text-xs text-muted-foreground">
					"อนุมัติการจัดสรรแล้ว" อาจเป็นครบจำนวนหรือบางส่วน ซึ่งเป็นผลการจัดสรร ไม่ใช่สถานะใหม่ —
					ตัวอย่าง: ขอผ้าห่ม 50 ผืน → คลังจัดสรร 40 ผืนเป็น Active Batch →
					หน้างานแจกจากชุดนี้และคืนส่วนที่เหลือเมื่อปิดรอบ
				</p>
			</div>
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
