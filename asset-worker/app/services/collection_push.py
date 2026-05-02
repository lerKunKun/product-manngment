"""
Push custom collections (REST ``custom_collections.json``).

Used by saga step W3-NEW-04 (COLLECTIONS): the backend hands the worker a
list of collection inputs; the worker creates each via Shopify Admin REST
and reports per-input results. Per-input errors are recorded inline rather
than raised, so a partial failure doesn't abort the whole batch — the
backend can retry only the failed entries on saga retry.

Failure semantics:

* Per-input ``ShopifyAdminError`` is captured into the result dict under
  ``error`` (string). Successful entries get ``shopify_id`` + ``handle``.
* ``ShopifyCliError`` / ``RuntimeError`` (CLI / config) propagate before
  any Shopify call → route maps to 503.
* Dry-run returns synthetic ids so end-to-end UI work never blocks.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.clients.shopify_admin import ShopifyAdminClient, ShopifyAdminError

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CollectionPushService:
    """Orchestrates Shopify custom_collections create for a saga COLLECTIONS step."""

    def __init__(
        self,
        shopify_cli: Any,
        admin_factory: Callable[..., ShopifyAdminClient] = ShopifyAdminClient,
        dry_run: bool = False,
    ) -> None:
        self.shopify_cli = shopify_cli
        self.admin_factory = admin_factory
        self.dry_run = dry_run

    # ----------------------------------------------------------------- public

    def push(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        collections: list[dict],
        access_token: Optional[str] = None,
    ) -> dict:
        if self.dry_run:
            return self._push_dry_run(
                shop_domain=shop_domain,
                tenant_id=tenant_id,
                store_id=store_id,
                task_id=task_id,
                collections=collections,
            )
        return self._push_real(
            shop_domain=shop_domain,
            tenant_id=tenant_id,
            store_id=store_id,
            task_id=task_id,
            collections=collections,
            access_token=access_token,
        )

    # ------------------------------------------------------------------ modes

    def _push_real(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        collections: list[dict],
        access_token: Optional[str],
    ) -> dict:
        started_at = _now_iso()
        clock_start = time.perf_counter()

        if not collections:
            logger.info("collection push noop shop=%s task=%s", shop_domain, task_id)
            return {
                "task_id": task_id,
                "collections": [],
                "started_at": started_at,
                "completed_at": _now_iso(),
                "dry_run": False,
            }

        # Resolve auth.
        if access_token:
            token = access_token
        else:
            token = self.shopify_cli.get_token(shop_domain)

        admin = self.admin_factory(shop_domain, token)
        created: list[dict[str, Any]] = []
        for c in collections:
            entry: dict[str, Any] = {"input": c}
            try:
                resp = admin.create_custom_collection(c)
                shopify_id = resp.get("id")
                entry["shopify_id"] = (
                    f"gid://shopify/Collection/{shopify_id}"
                    if shopify_id is not None
                    else None
                )
                entry["handle"] = resp.get("handle")
                entry["title"] = resp.get("title")
            except ShopifyAdminError as exc:
                logger.warning(
                    "collection push failed shop=%s task=%s handle=%s err=%s",
                    shop_domain,
                    task_id,
                    c.get("handle"),
                    exc,
                )
                entry["error"] = str(exc)
            created.append(entry)

        completed_at = _now_iso()
        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "collection push done shop=%s task=%s count=%d elapsed=%ss",
            shop_domain,
            task_id,
            len(created),
            elapsed,
        )
        return {
            "task_id": task_id,
            "collections": created,
            "started_at": started_at,
            "completed_at": completed_at,
            "dry_run": False,
        }

    def _push_dry_run(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        collections: list[dict],
    ) -> dict:
        started_at = _now_iso()
        created = [
            {
                "input": c,
                "shopify_id": f"gid://shopify/Collection/{77000000 + i}",
                "handle": c.get("handle") or f"c{i}",
                "title": c.get("title"),
            }
            for i, c in enumerate(collections)
        ]
        logger.info(
            "collection push DRY-RUN shop=%s task=%s count=%d",
            shop_domain,
            task_id,
            len(created),
        )
        return {
            "task_id": task_id,
            "collections": created,
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": True,
        }
