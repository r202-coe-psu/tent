---
id: CR-032
title: Add purchase reason to stock_ledger
status: accepted
date: 2026-07-05
author: Pu2f
impact: data-schema, application-logic
---

# CR-032: Add purchase reason to stock_ledger

## 1. Context and Problem Statement
Task T-11 (Stock receive + ledger write) introduces the ability to receive stock from a "purchase" (จัดซื้อจัดจ้าง) source, in addition to donations or transfers. However, `stock_ledger.reason` in `docs/data/schema.md` only had `donation`, `transfer_in`, `receive`, and `adjust`.

## 2. Proposed Change
1. Add `purchase` to the allowed `reason` values in `stock_ledger` schema.
2. Bump `schema_v` of `stock_ledger` from `1` to `2`.
3. Map the `purchase` source input directly to the `purchase` reason.

## 3. Scope of Impact
* **Data Model:** `docs/data/schema.md` updated to reflect `stock_ledger` `schema_v 2` and the new reason.
* **Domain Layer:** `receiveSourceSchema` and `createReceiveEntry` updated to handle `purchase`. `createStockLedger` now stamps `schema_v 2`.
* **UI Layer:** Select input in `ReceiveStockForm` includes "จัดซื้อ / หน่วยงานรัฐ".

## 4. Alternatives Considered
* **Mapping to `receive`**: Originally mapped `purchase` to `receive`, but this loses historical tracking data for dashboard and BI tools that need to distinguish between donations and purchases (T-14).

## 5. Review & Sign-off
* **PO/TL:** @net-lynx
* **Status:** Accepted
