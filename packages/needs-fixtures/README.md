# needs-fixtures

One set of scenarios, read by both languages, for the T-22 remaining-need rule:

```
remaining = target − (on_hand + reserved)
```

## Why this exists

That rule is implemented three times, and nothing in the type system or the test suites
made the copies agree:

| Where                                                                                  | Used for           |
| -------------------------------------------------------------------------------------- | ------------------ |
| `frontend/src/lib/features/operations/domain/operations.ts` — `deriveNeedAvailability` | back-office board  |
| `frontend/src/lib/features/donations/domain/compute-needs.ts` — `computeNeeds`         | booking pre-check  |
| `worker/src/worker/projectors/compute_needs.py` — `compute_needs`                      | public needs board |

CR-034 added the on-hand term to the first one. The other two kept the old
`target − donations` and nobody noticed for months: every copy had its own tests
asserting its own behaviour, and they all passed. The public board ended up
advertising "ด่วน! ข้าวสาร ขาด 900 กก." at a shelter holding 540 kg against a 500 kg
target, whose own staff screen showed `FULL` on the same item.

The copies exist for real reasons — the worker is Python because FastAPI cannot read
CouchDB (the gap CR-060 was raised for), and `operations` and `donations` are separate
features — so they are not going away. What was missing is anything that looks at more
than one of them at a time.

`cases.json` is that. Each side asserts the same expected numbers, so a rule change
that lands in only one copy turns a test red instead of going quiet.

## Read by

- `frontend/src/lib/features/donations/domain/needs-parity.test.ts`
- `worker/tests/test_needs_parity.py`

Both resolve the path relative to their own file, so moving this directory breaks the
suites loudly rather than skipping the cases.

## Adding a case

Add an entry to `cases.json` and both suites pick it up — no code change. Give the
`why` field a reason a reader will believe; these cases are the record of what the
rule means.

A donation with no `campaign_id` is owed to no campaign, and a line with no `item_id`
(free text) to no item — in all three copies. `calculateReserved` used to attribute the
first to every campaign and guess the second from the text, so the back-office board
counted bookings the public board and the quota counter did not (#689). The two cases
at the end of `cases.json` hold that line.
