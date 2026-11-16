import { describe, expect, it } from 'vitest';
import { receivedMatchesSent } from './transfer-received';

describe('receivedMatchesSent (#938)', () => {
	it.each([
		['0.30', '0.3'],
		['0.3', '0.30'],
		['5', '5.0000'],
		['5.0000', '5'],
		['0', '0.0'],
		['1200', '1200']
	])('treats sent %s and received %s as a match', (sent, received) => {
		expect(receivedMatchesSent(sent, received)).toBe(true);
	});

	it.each([
		['0.3', '0.2999'],
		['0.3', '0.3001'],
		['1', '2'],
		['2', '1'],
		['5', '0']
	])('flags sent %s and received %s as a mismatch', (sent, received) => {
		expect(receivedMatchesSent(sent, received)).toBe(false);
	});
});
