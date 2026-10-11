"""Version of the CouchDB -> MongoDB projection output.

``PROJECTION_VERSION`` is stored in Mongo (``_worker_meta``) after every successful
full bootstrap. On start the worker compares the stored value with this constant and,
when the stored one is missing or lower, re-runs the full bootstrap before resuming
``_changes`` — so a deploy that changes what projectors write also fixes the rows of
idle shelters that no change event would ever touch.

BUMP THIS (``+= 1``) in the same PR whenever you change what any projector or
``refresh_*`` aggregation WRITES to a ``public_*`` / ``shelter_*`` collection:

* a field is added, removed, renamed or re-typed
  (e.g. ``occupancy_breakdown.gender_unspecified``);
* the semantics of an existing field change (a different filter, mask, bucket or formula);
* a new doc type starts being projected, or an existing one starts/stops being filtered out.

Do NOT bump for changes that do not alter stored output (refactors, logging, tests,
read-side FastAPI changes). Never decrement it. Bumping costs one full bootstrap scan
per deploy, so batch related projector changes into one bump per release when possible.
"""

PROJECTION_VERSION: int = 2
