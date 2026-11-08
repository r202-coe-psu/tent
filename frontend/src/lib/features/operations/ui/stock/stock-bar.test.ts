import { describe, expect, it } from 'vitest';
import { formatThresholdLine, stockBarFill, stockBarSegments } from './stock-bar';

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

describe('stockBarSegments (#1153)', () => {
	it('keeps the in-stock segment, tick and tone of stockBarFill and adds incoming after it', () => {
		// threshold 40 → track max 80. in-stock 20 → 25%; incoming 30 → 37.5%.
		expect(stockBarSegments('20', '30', '40')).toEqual({
			pct: 25,
			tickPct: 50,
			tone: 'warning',
			incomingPct: 37.5
		});
	});

	it('stays red with no stock even when a lot is coming (AC-2)', () => {
		// incoming 100 of track max 80 → clipped to the full track.
		expect(stockBarSegments('0', '100', '40')).toEqual({
			pct: 0,
			tickPct: 50,
			tone: 'critical',
			incomingPct: 100
		});
	});

	it('clips incoming to the room left on the track', () => {
		// in-stock 60 → 75%; incoming 40 → 50% but only 25% is left.
		expect(stockBarSegments('60', '40', '40')).toEqual({
			pct: 75,
			tickPct: 50,
			tone: 'ok',
			incomingPct: 25
		});
	});

	it('has no incoming segment when nothing is incoming', () => {
		expect(stockBarSegments('20', '0', '40')).toEqual({
			...stockBarFill('20', '40'),
			incomingPct: 0
		});
	});

	it('splits the track in proportion when there is no threshold', () => {
		// 30 in stock + 10 coming → 75% / 25%.
		expect(stockBarSegments('30', '10', null)).toEqual({
			pct: 75,
			tickPct: null,
			tone: 'neutral',
			incomingPct: 25
		});
		// nothing in stock → all incoming
		expect(stockBarSegments('0', '10', null)).toMatchObject({
			pct: 0,
			incomingPct: 100,
			tone: 'critical'
		});
	});
});
