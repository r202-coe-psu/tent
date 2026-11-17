import { describe, expect, it, vi } from 'vitest';
import { TemplateExportError, exportTemplatePng } from './kiosk-banner-template-export';

const PNG_URL = 'data:image/png;base64,iVBORw0KGgo=';
const node = { tagName: 'DIV', querySelectorAll: () => [] } as unknown as HTMLElement;

function nodeWithImages(...decodes: (() => Promise<void>)[]): HTMLElement {
	const images = decodes.map((decode) => ({ decode }));
	return { tagName: 'DIV', querySelectorAll: () => images } as unknown as HTMLElement;
}

function setup(toPngResult: string = PNG_URL) {
	const calls: string[] = [];
	const toPng = vi.fn(async (): Promise<string> => {
		calls.push('toPng');
		return toPngResult;
	});
	const fonts = {
		load: vi.fn(async (font: string): Promise<FontFace[]> => {
			calls.push(`load:${font}`);
			return [];
		}),
		// A thenable so 'ready' is recorded when it is awaited, not when the fake is built.
		ready: {
			then: (resolve: (value: unknown) => void): void => {
				calls.push('ready');
				resolve({});
			}
		} as unknown as Promise<FontFaceSet>
	};
	return { calls, toPng, fonts };
}

describe('exportTemplatePng', () => {
	it('waits for the template font before rendering', async () => {
		const { calls, toPng, fonts } = setup();

		await exportTemplatePng(node, 'tv', { toPng: toPng as never, fonts });

		expect(calls).toEqual([
			'load:700 64px "IBM Plex Sans Thai Looped"',
			'load:400 32px "IBM Plex Sans Thai Looped"',
			'ready',
			'toPng'
		]);
	});

	it.each([
		['tv', 1920, 1080],
		['portrait', 1080, 1920]
	] as const)('renders at the real %s screen size', async (screen, width, height) => {
		const { toPng, fonts } = setup();

		await exportTemplatePng(node, screen, { toPng: toPng as never, fonts });

		expect(toPng).toHaveBeenCalledWith(node, {
			width,
			height,
			canvasWidth: width,
			canvasHeight: height,
			pixelRatio: 1,
			style: { transform: 'none' }
		});
	});

	it('returns the png as a banner image payload', async () => {
		const { toPng, fonts } = setup();

		await expect(
			exportTemplatePng(node, 'compact', { toPng: toPng as never, fonts })
		).resolves.toEqual({ content_type: 'image/png', data_base64: 'iVBORw0KGgo=' });
	});

	it('rejects when the render is not a png data url', async () => {
		const { toPng, fonts } = setup('data:image/svg+xml;base64,PHN2Zz4=');

		await expect(
			exportTemplatePng(node, 'compact', { toPng: toPng as never, fonts })
		).rejects.toThrow('สร้างรูปประกาศไม่สำเร็จ');
	});

	it('waits for every image in the template to decode before rendering', async () => {
		const { calls, toPng, fonts } = setup();
		const withLogo = nodeWithImages(async () => {
			calls.push('decode');
		});

		await exportTemplatePng(withLogo, 'tv', { toPng: toPng as never, fonts });

		expect(calls.indexOf('decode')).toBeGreaterThanOrEqual(0);
		expect(calls.indexOf('decode')).toBeLessThan(calls.indexOf('toPng'));
	});

	it('refuses to render without a logo that failed to load', async () => {
		const { toPng, fonts } = setup();
		const broken = nodeWithImages(() => Promise.reject(new Error('404')));

		await expect(exportTemplatePng(broken, 'tv', { toPng: toPng as never, fonts })).rejects.toThrow(
			new TemplateExportError('โหลดรูป/โลโก้ไม่สำเร็จ ลองเลือกรูปใหม่หรือลบรูปออก')
		);
		expect(toPng).not.toHaveBeenCalled();
	});

	it('rejects a png over the 2 MB banner cap with a message staff can act on', async () => {
		const tooBig = 'A'.repeat(Math.ceil(((2 * 1024 * 1024 + 1) * 4) / 3 / 4) * 4);
		const { toPng, fonts } = setup(`data:image/png;base64,${tooBig}`);

		await expect(exportTemplatePng(node, 'tv', { toPng: toPng as never, fonts })).rejects.toThrow(
			new TemplateExportError('รูปประกาศใหญ่เกิน 2 MB ลองใช้รูป/โลโก้ที่เรียบขึ้นหรือลบรูปออก')
		);
	});
});
