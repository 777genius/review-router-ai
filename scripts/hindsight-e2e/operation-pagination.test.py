"""Run the pinned native list method against real SQL with two legal tie plans.

This is an SQL-ordering regression in SQLite, not a PostgreSQL/native-container
integration result. Only indexes change between pages; logical rows never change.
The SELECT, parameters, result projection, and pagination come from the supplied
native memory_engine.py, not from a copied comparison or synthetic page result.
"""
from __future__ import annotations

import ast
import asyncio
import hashlib
import json
import sqlite3
import sys
import textwrap
from datetime import datetime

PINNED_SHA256 = "44d4f173e5eaf5644390055c2ed55aa254ecea635d2dec870cf949b38de33a5b"


def identifier(number: int) -> str:
    return f"{number:08x}-1111-4111-8111-{number:012x}"


class NativeSqlConnection:
    def __init__(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.execute("ATTACH DATABASE ':memory:' AS public")
        self.db.execute("""CREATE TABLE public.async_operations (
            operation_id TEXT PRIMARY KEY, bank_id TEXT NOT NULL,
            operation_type TEXT NOT NULL, created_at TEXT NOT NULL,
            updated_at TEXT, status TEXT NOT NULL, error_message TEXT,
            result_metadata TEXT NOT NULL, retry_count INTEGER, next_retry_at TEXT
        )""")
        self.original_ids = [identifier(100 + pair) for pair in range(8)]
        self.late_id = self.original_ids[6]
        for pair, parent in enumerate(self.original_ids):
            timestamp = f"2026-01-02T03:{pair:02d}:00+00:00"
            for operation_id, operation_type, metadata in [
                (parent, "batch_retain", {"is_parent": True}),
                (identifier(200 + pair), "retain", {"parent_operation_id": parent}),
            ]:
                self.db.execute(
                    "INSERT INTO public.async_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (operation_id, "fixture-bank", operation_type, timestamp,
                     timestamp, "completed", None, json.dumps(metadata), 0, None),
                )
        self.db.commit()
        self.expected = {row[0] for row in self.db.execute(
            "SELECT operation_id FROM public.async_operations"
        )}
        self.queries = set()
        self.plans = set()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def parse_json(self, value):
        return json.loads(value) if value is not None else None

    @staticmethod
    def convert(row):
        if row is None:
            return None
        result = dict(row)
        for field in ("created_at", "updated_at", "next_retry_at"):
            if result.get(field) is not None:
                result[field] = datetime.fromisoformat(result[field])
        return result

    async def fetchrow(self, sql, *parameters):
        bindings = {str(index): value for index, value in enumerate(parameters, 1)}
        return self.convert(self.db.execute(sql, bindings).fetchone())

    async def fetch(self, sql, *parameters):
        # OFFSET 2 is the start of the late parent/child tie. Both indexes satisfy
        # the old primary ORDER BY; switching just this page exposes the missing
        # total order without changing a single table row or editing the query.
        self.db.execute("DROP INDEX IF EXISTS public.fixture_tie_plan")
        direction = "DESC" if parameters[-1] == 2 else "ASC"
        self.db.execute(
            "CREATE INDEX public.fixture_tie_plan ON async_operations"
            f"(bank_id, created_at DESC, operation_id {direction}, operation_type,"
            "updated_at, status, error_message, result_metadata, retry_count, next_retry_at)"
        )
        self.queries.add(" ".join(sql.split()))
        bindings = {str(index): value for index, value in enumerate(parameters, 1)}
        self.plans.update(row[3] for row in self.db.execute(
            "EXPLAIN QUERY PLAN " + sql, bindings
        ))
        return [self.convert(row) for row in self.db.execute(sql, bindings)]


def native_method(source, name):
    tree = ast.parse(source)
    matches = [node for node in ast.walk(tree)
               if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
               and node.name == name]
    assert len(matches) == 1, (name, len(matches))
    return textwrap.dedent(ast.get_source_segment(source, matches[0]))


async def run_source(source):
    connection = NativeSqlConnection()
    namespace = {
        "fq_table": lambda name: f"public.{name}",
        "acquire_with_retry": lambda backend: backend,
    }
    # Extraction executes the actual native list method and outcome projection.
    # Authentication and the connection adapter are fixture seams; this does not
    # run the native API process or claim PostgreSQL/runtime qualification.
    for name in ("_operation_details", "list_operations"):
        exec("from __future__ import annotations\n" + native_method(source, name), namespace)

    class Probe:
        _operation_validator = None
        list_operations = namespace["list_operations"]

        async def _authenticate_tenant(self, *_):
            pass

        async def _refuse_bank_wide_if_scoped(self, *_):
            pass

        async def _require_bank_exists(self, *_):
            pass

        async def _get_backend(self):
            return connection

    engine = Probe()
    discovered = {}
    listed = []
    offset = 0
    total = float("inf")
    while offset < total:
        page = await engine.list_operations(
            "fixture-bank", limit=1, offset=offset, request_context=None,
        )
        total = page["total"]
        assert total == len(connection.expected)
        for operation in page["operations"]:
            listed.append(operation["operation_id"])
            discovered[operation["operation_id"]] = operation
        offset += len(page["operations"])
        assert page["operations"] or offset >= total
    # qualify-native records one repeated parent UUID for its idempotent replay.
    retained_ids = connection.original_ids + [connection.original_ids[0]]
    return {
        "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
        "pages": offset,
        "native_total": total,
        "unique_discovered": len(discovered),
        "old_cardinality_guard_passes": len(discovered) >= len(retained_ids),
        "original_uuid_count": len(connection.original_ids),
        "original_uuids_present": all(key in discovered for key in retained_ids),
        "late_uuid_present": connection.late_id in discovered,
        "all_rows_discovered": set(discovered) == connection.expected,
        "duplicate_page_ids": len(listed) - len(set(listed)),
        "query": sorted(connection.queries),
        "plans": sorted(connection.plans),
    }


async def main():
    sources = json.load(sys.stdin)
    original = sources["before"]
    hardened = sources["after"]
    assert hashlib.sha256(original.encode()).hexdigest() == PINNED_SHA256
    before = await run_source(original)
    assert before["old_cardinality_guard_passes"]
    assert before["unique_discovered"] == 15, before
    assert before["duplicate_page_ids"] == 1
    assert not before["late_uuid_present"]
    assert not before["all_rows_discovered"]
    after = await run_source(hardened)
    assert after["unique_discovered"] == 16, after
    assert after["duplicate_page_ids"] == 0
    assert after["original_uuids_present"]
    assert after["late_uuid_present"]
    assert after["all_rows_discovered"]
    print(json.dumps({
        "scope": "SQLite actual-native-query regression; not a PostgreSQL integration run",
        "before": before,
        "after": after,
    }))


asyncio.run(main())

