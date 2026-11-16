"""The four-step demand model (ADR-0019, 09 §2) on AequilibraE: zones, generation, distribution, mode choice,
road and public transport assignment, with feedback of congested car times.
"""  # noqa: D205

import os

# AequilibraE's progress bars would fill the worker log; it reads this when its modules are first imported.
os.environ.setdefault("AEQ_SHOW_PROGRESS", "FALSE")
