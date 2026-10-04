import { describe, expect, it } from 'vitest';
import { formatThresholdLine, stockBarFill } from './stock-bar';

describe('stockBarFill', () => {
	it('fills half the track at the threshold, in the warning tone', () => {
		expect(stockBarFill('40', '40')).toEqual({ pct: 50, tickPct: 50, tone: 'warning' });
	});

	it('scales against twice the threshold (matches the mockup rows)', () => {
		expect(stockBarFill('36', '40').pct).toBe(45);
		expect(stockBarFill('42', '80').pct).toBe(26.3);
		expect(stockBarFill('24', '30').pct).toBe(40);
	});

	it('is ok-toned above the threshold and caps at 100', () => {
		expect(stockBarFill('12', '8')).toEqual({ pct: 75, tickPct: 50, tone: 'ok' });
		expect(stockBarFill('500', '8')).toEqual({ pct: 100, tickPct: 50, tone: 'ok' });
	});

	it('is empty and critical at zero stock, keeping the tick when a threshold exists', () => {
		expect(stockBarFill('0', '40')).toEqual({ pct: 0, tickPct: 50, tone: 'critical' });
		expect(stockBarFill('0', null)).toEqual({ pct: 0, tickPct: null, tone: 'critical' });
	});

	it('shows a full neutral bar without a tick when no threshold is configured', () => {
		expect(stockBarFill('210', null)).toEqual({ pct: 100, tickPct: null, tone: 'neutral' });
		expect(stockBarFill('210', '0')).toEqual({ pct: 100, tickPct: null, tone: 'neutral' });
	});

	it('handles decimal quantities without float drift', () => {
		expect(stockBarFill('0.3', '0.6').pct).toBe(25);
	});
});

describe('formatThresholdLine', () => {
	it('reads "ไม่มีเกณฑ์" without a threshold', () => {
		expect(formatThresholdLine(null, 'ผืน', null)).toBe('ไม่มีเกณฑ์');
	});

	it('appends days of cover when known and positive', () => {
		expect(formatThresholdLine('40', 'กล่อง', 0.8)).toBe('เกณฑ์ 40 กล่อง · พอ ~0.8 วัน');
	});

	it('omits cover when unknown or zero', () => {
		expect(formatThresholdLine('40', 'ถุง', null)).toBe('เกณฑ์ 40 ถุง');
		expect(formatThresholdLine('40', 'ถุง', 0)).toBe('เกณฑ์ 40 ถุง');
	});
});
