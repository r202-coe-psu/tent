/**
 * SmartShelter Thailand Civic Light Design System v2.4
 * Central Token Export Hub
 */

import { colors } from './colors.js';
import { typography } from './typography.js';
import { spatial } from './spatial.js';
import { responsive } from './responsive.js';
import { motion } from './motion.js';

export * from './colors.js';
export * from './typography.js';
export * from './spatial.js';
export * from './responsive.js';
export * from './motion.js';

export const tokens = {
	colors,
	typography,
	spatial,
	responsive,
	motion
} as const;

export default tokens;
