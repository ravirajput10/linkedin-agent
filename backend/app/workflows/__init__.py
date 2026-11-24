"""Workflow building blocks.

The state machine itself lives in :mod:`app.agents.workflow_engine`; these
modules hold the reusable pieces it drives.
"""

from app.workflows import connection, discovery

__all__ = ["connection", "discovery"]
