<script lang="ts">
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
</script>

<!--
	Decorative loop of a Thai national ID card sliding into the reader slot, drawn like the kiosk's
	real slot: a horizontal slit with the card tilted toward the user. The card goes in face up, short
	edge first, so the barcode strip on its front leads into the slot. The face is a simplified
	silhouette of the real card (barcode, chip, photo, a few bars for text), turned 90° so the
	barcode edge is on top. The text above carries the instruction, so the scene is hidden from
	assistive tech. Everything scales from --w; the card face scales from --cw (its long side).
-->
<div
	class="insert-scene [--w:13.9rem] kiosk-portrait:[--w:27rem] kiosk-compact:[--w:11.5rem]"
	aria-hidden="true"
>
	<span class="slot"></span>
	<div class="clip">
		<div class="mover">
			<span class="arrow"><ArrowUp class="size-full" strokeWidth={2.5} /></span>
			<div class="tilt">
				<div class="card">
					<span class="barcode"></span>
					<span class="bar strong" style="top: 5%; left: 15%; width: 38%; height: 4%"></span>
					<span class="bar strong" style="top: 16.5%; left: 46%; width: 31%; height: 5.5%"></span>
					<span class="bar strong" style="top: 26%; left: 38%; width: 34%; height: 4.5%"></span>
					<span class="bar strong" style="top: 36.5%; left: 36%; width: 25%; height: 3.5%"></span>
					<span class="bar" style="top: 55%; left: 24%; width: 22%; height: 2.4%"></span>
					<span class="bar" style="top: 71%; left: 24%; width: 34%; height: 2.2%"></span>
					<span class="bar" style="top: 77%; left: 24%; width: 26%; height: 2.2%"></span>
					<span class="chip">
						<span class="line h1"></span>
						<span class="line h2"></span>
						<span class="line v"></span>
					</span>
					<span class="photo">
						<span class="head"></span>
						<span class="shoulders"></span>
					</span>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.insert-scene {
		position: relative;
		width: calc(var(--w) * 1.8);
		max-width: 100%;
		height: calc(var(--w) * 1.15);
	}

	/* Slot is a little wider than the card's short edge, which is what goes in first. */
	.slot {
		position: absolute;
		top: calc(var(--w) * 0.031);
		left: 50%;
		width: calc(var(--w) * 0.62);
		height: calc(var(--w) * 0.026);
		margin-left: calc(var(--w) * -0.31);
		border-radius: 999px;
		background: #0a2647;
	}

	/* Starts at the slot's centre line, so whatever rises past it is "inside" the kiosk. */
	.clip {
		position: absolute;
		inset: calc(var(--w) * 0.044) 0 0 0;
		overflow: hidden;
	}

	/* Portrait box = the card turned 90° (ID-1 ratio 1.585): short edge up, long edge into the slot. */
	.mover {
		position: absolute;
		top: 0;
		left: 50%;
		width: calc(var(--w) * 0.5);
		height: calc(var(--w) * 0.7925);
		margin-left: calc(var(--w) * -0.25);
		animation: insert 5s ease infinite;
	}

	.arrow {
		position: absolute;
		top: calc(var(--w) * -0.152);
		left: calc(50% - var(--w) * 0.052);
		width: calc(var(--w) * 0.104);
		height: calc(var(--w) * 0.104);
		color: #0a2647;
		animation: nudge 1s ease-in-out infinite;
	}

	.tilt {
		position: absolute;
		inset: 0;
		transform: perspective(calc(var(--w) * 1.85)) rotateX(42deg);
		transform-origin: 50% 0;
	}

	/* The face is drawn landscape (--cw × --cw/1.585), then turned so its left edge is the top. */
	.card {
		--cw: calc(var(--w) * 0.7925);
		position: absolute;
		top: 50%;
		left: 50%;
		width: var(--cw);
		height: calc(var(--cw) / 1.585);
		transform: translate(-50%, -50%) rotate(90deg);
		overflow: hidden;
		border: 0.09rem solid rgb(10 38 71 / 0.22);
		border-radius: calc(var(--cw) * 0.04);
		background:
			radial-gradient(circle at 78% 30%, rgb(186 214 245 / 0.8), transparent 55%),
			linear-gradient(100deg, #e4f0fa 30%, #cfe3f4 70%, #e0edf8);
	}

	.card > * {
		position: absolute;
	}

	/* The barcode runs the full short left edge: horizontal bars, two pitches layered. */
	.barcode {
		top: 4%;
		left: 1.6%;
		width: 3.4%;
		height: 92%;
		background:
			repeating-linear-gradient(
				to bottom,
				#1f2937 0 calc(var(--cw) * 0.0045),
				transparent calc(var(--cw) * 0.0045) calc(var(--cw) * 0.009)
			),
			repeating-linear-gradient(
				to bottom,
				#1f2937 0 calc(var(--cw) * 0.003),
				transparent calc(var(--cw) * 0.003) calc(var(--cw) * 0.0147)
			);
	}

	.bar {
		border-radius: 999px;
		background: #5b6a9a;
		opacity: 0.35;
	}

	.bar.strong {
		background: #1e2a78;
		opacity: 0.6;
	}

	/* Positions and sizes are fractions of the real card's face, measured from a photo of it. */
	.chip {
		top: 38%;
		left: 8%;
		width: 12%;
		height: 17%;
		border: 0.1rem solid #8f7230;
		border-radius: calc(var(--cw) * 0.018);
		background: #c9a24d;
	}

	.photo {
		top: 52%;
		right: 4%;
		width: 24%;
		height: 38%;
		overflow: hidden;
		border: 0.06rem solid rgb(30 42 120 / 0.35);
		background: linear-gradient(#cfdcea, #aebfd3);
	}

	.head {
		top: 16%;
		left: 28%;
		width: 44%;
		height: 38%;
		border-radius: 50%;
		background: #6b5a52;
	}

	.shoulders {
		bottom: -18%;
		left: 8%;
		width: 84%;
		height: 46%;
		border-radius: 50%;
		background: #4b5d78;
	}

	.photo > * {
		position: absolute;
	}

	.line {
		position: absolute;
		background: #8f7230;
		opacity: 0.65;
	}

	.line.h1,
	.line.h2 {
		right: 11%;
		left: 11%;
		height: 0.1rem;
	}

	.line.h1 {
		top: 33%;
	}

	.line.h2 {
		top: 66%;
	}

	.line.v {
		top: 14%;
		bottom: 14%;
		left: 50%;
		width: 0.1rem;
	}

	@keyframes insert {
		0% {
			transform: translateY(calc(var(--w) * 0.2));
			opacity: 0;
		}
		8% {
			transform: translateY(calc(var(--w) * 0.2));
			opacity: 1;
		}
		20% {
			transform: translateY(calc(var(--w) * 0.2));
			opacity: 1;
			animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
		}
		55%,
		85% {
			transform: translateY(calc(var(--w) * -0.2));
			opacity: 1;
		}
		93% {
			transform: translateY(calc(var(--w) * -0.2));
			opacity: 0;
		}
		100% {
			transform: translateY(calc(var(--w) * 0.2));
			opacity: 0;
		}
	}

	@keyframes nudge {
		50% {
			transform: translateY(calc(var(--w) * -0.02));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mover,
		.arrow {
			animation: none;
		}
	}
</style>
