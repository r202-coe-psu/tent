"""Quantity helpers shared by the worker and the backend (CR-038 ``qty_str``).

A quantity is stored as ``Decimal128`` in Mongo and sent over the API as a string with
at most four decimal places and no exponent (``"20"``, ``"0.3"`` — never ``"20.0"`` or
``"1E+2"``). Mirrors ``persistQty`` in ``frontend/src/lib/utils/qty.ts``.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

#: Mirrors ``QTY_DECIMALS`` in ``frontend/src/lib/utils/qty.ts``.
QTY_STEP = Decimal("0.0001")


def quantize_qty(value: Any) -> Decimal:
	"""``value`` rounded to four places, half-up. Unusable or non-finite input is 0.

	Rounding happens here, before any ``<= 0`` or open/closed comparison, so the status a
	reader derives always agrees with the quantity it prints.
	"""
	try:
		number = value if isinstance(value, Decimal) else Decimal(str(value))
		if not number.is_finite():
			return Decimal(0)
		return number.quantize(QTY_STEP, rounding=ROUND_HALF_UP)
	except (InvalidOperation, TypeError, ValueError):
		return Decimal(0)


def format_qty(value: Any) -> str:
	"""``value`` as a ``qty_str``: four places half-up, zero is ``"0"``, no exponent."""
	rounded = quantize_qty(value)
	if rounded.is_zero():
		return "0"
	return format(rounded.normalize(), "f")


def canonical_qty(value: Any) -> Decimal:
	"""``value`` as the ``Decimal`` of its ``qty_str`` — ``Decimal("0.3")``, not ``0.3000``.

	What the projector stores: ``Decimal128`` keeps the digits it is given, so a padded
	``0.3000`` would sit in Mongo (and compare under ``==``) differently from ``0.3``.
	"""
	return Decimal(format_qty(value))
