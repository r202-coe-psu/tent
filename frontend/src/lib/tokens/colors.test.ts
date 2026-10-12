import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { baseDomain, colors, DOMAIN_IDS, type DomainId } from './colors';

const STEPS = ['base', 'strong', 'subtle', 'border', 'text'] as const;
type Step = (typeof STEPS)[number];

const css = readFileSync(new URL('../../app.css', import.meta.url), 'utf8');
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('/* lg+: sidebar chrome'));

function cssVar(name: string): string {
	const match = rootBlock.match(new RegExp(`${name}:\\s*([^;]+);`));
	if (!match) throw new Error(`CSS custom property ${name} not found in :root`);
	return match[1].trim();
}

const cssName = (id: DomainId, step: Step) =>
	step === 'base' ? `--domain-${id}` : `--domain-${id}-${step}`;

function luminance(hex: string): number {
	const channel = (i: number) => {
		const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** oklch(L% C H) → #rrggbb (CSS Color 4 reference matrices). */
function oklchToHex(l: number, c: number, hDeg: number): string {
	const h = (hDeg * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const lin = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
	];
	const hex = lin.map((x) => {
		const g = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
		return Math.round(Math.min(1, Math.max(0, g)) * 255)
			.toString(16)
			.padStart(2, '0');
	});
	return `#${hex.join('')}`.toUpperCase();
}

describe('baseDomain', () => {
	it('defines the 7 work domains', () => {
		expect(DOMAIN_IDS).toEqual([
			'registration',
			'donation',
			'volunteer',
			'kitchen',
			'facility',
			'security',
			'admin'
		]);
	});

	it.each(DOMAIN_IDS)('%s has a Thai name and all 5 steps as hex', (id) => {
		expect(baseDomain[id].name.length).toBeGreaterThan(0);
		for (const step of STEPS) expect(baseDomain[id][step]).toMatch(/^#[0-9A-F]{6}$/);
	});

	it.each(DOMAIN_IDS)('%s: white on strong and text on subtle reach WCAG AA (4.5)', (id) => {
		const d = baseDomain[id];
		expect(contrast('#FFFFFF', d.strong)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(d.text, d.subtle)).toBeGreaterThanOrEqual(4.5);
		// hover colour is the `text` step: white must stay readable on it too
		expect(contrast('#FFFFFF', d.text)).toBeGreaterThanOrEqual(4.5);
	});

	it('exposes every domain on colors.domain with ready class strings', () => {
		for (const id of DOMAIN_IDS) {
			const d = colors.domain[id];
			expect(d.badge).toContain(`bg-domain-${id}-subtle`);
			expect(d.solid).toContain(`bg-domain-${id}-strong`);
			expect(d.card).toContain(`border-domain-${id}-border`);
		}
	});

	it('derives portalServices from the domains', () => {
		expect(colors.portalServices.shelter.domain).toBe('registration');
		expect(colors.portalServices.tracing.domain).toBe('registration');
		expect(colors.portalServices.donation.domain).toBe('donation');
		expect(colors.portalServices.volunteer.domain).toBe('volunteer');
		expect(colors.portalServices.donation.hex).toBe(baseDomain.donation.base);
	});

	it('keeps status colours out of the domain palette', () => {
		const reserved = ['#DC2626', '#F59E0B', '#16A34A', '#9333EA'];
		for (const id of DOMAIN_IDS) {
			for (const step of STEPS) expect(reserved).not.toContain(baseDomain[id][step]);
		}
	});
});

describe('--domain-* in app.css mirrors baseDomain', () => {
	const primary = cssVar('--primary').match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/);

	it.each(DOMAIN_IDS.flatMap((id) => STEPS.map((step) => [id, step] as const)))(
		'%s %s',
		(id, step) => {
			const value = cssVar(cssName(id, step));
			const tsHex = baseDomain[id][step];
			if (value === 'var(--primary)') {
				// registration base/strong are single-sourced from the light --primary token
				expect(id).toBe('registration');
				expect(primary).not.toBeNull();
				const [, l, c, h] = primary!;
				expect(oklchToHex(Number(l) / 100, Number(c), Number(h))).toBe(tsHex);
			} else {
				expect(value.toUpperCase()).toBe(tsHex);
			}
		}
	);
});
