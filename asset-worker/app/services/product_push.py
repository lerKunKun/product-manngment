"""
Product push orchestration.

The worker is the relay layer in front of Shopify Admin: the backend
builds the payload, the worker hands it to Shopify and reports the
result. This module deliberately does NOT mutate the platform DB —
that's the backend's job after the worker call returns.

Failure semantics:

* ``ShopifyAdminValidationError`` (422) is **caught** and returned as a
  successful service response with ``conflict={"type":"VALIDATION"}``;
  the route layer maps it to HTTP 422 for the backend to inspect.
* Any other ``ShopifyAdminError`` propagates → route maps to 502.
* ``ShopifyCliError`` / ``RuntimeError`` propagate → route maps to 503.
* Dry-run path skips Shopify entirely and returns a synthetic id so
  end-to-end UI work never blocks on missing credentials.
"""
from __future__ import annotations

import base64
import logging
import os
import random
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.clients.shopify_admin import (
    ShopifyAdminClient,
    ShopifyAdminError,
    ShopifyAdminValidationError,
)

logger = logging.getLogger(__name__)


class R2FetchError(ShopifyAdminError):
    """Raised when downloading a media object from R2 fails.

    Inherits ``ShopifyAdminError`` so the route layer's existing 502 mapping
    catches it without extra wiring (``shopify CLI / runtime`` errors stay 503;
    upstream-byte errors stay 502).
    """


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _synthetic_shopify_id() -> str:
    """Return a synthetic 10-digit Shopify-looking id for dry-run."""
    return str(random.randint(1_000_000_000, 9_999_999_999))


class ProductPushService:
    """Orchestrates shopify-cli + Admin REST product create for a single push."""

    def __init__(
        self,
        shopify_cli: Any,
        admin_factory: Callable[..., ShopifyAdminClient] = ShopifyAdminClient,
        dry_run: bool = False,
        r2_client: Any = None,
    ) -> None:
        self.shopify_cli = shopify_cli
        self.admin_factory = admin_factory
        self.dry_run = dry_run
        self.r2_client = r2_client

    # --------------------------------------------------------------- helpers

    @staticmethod
    def _filename_for(key: str, index: int) -> str:
        """Derive a safe Shopify-side filename. Falls back to ``image-N.<ext>``.

        We never trust the full R2 key directly (it embeds tenant / store /
        snapshot ids) — only the extension is preserved so Shopify can detect
        the mime correctly.
        """
        ext = os.path.splitext(key)[1] or ".jpg"
        return f"image-{index}{ext}"

    def _attach_r2_media(
        self, product_payload: dict
    ) -> tuple[dict, list[str]]:
        """Pop ``media_r2_keys`` and APPEND base64 attachments to ``images``.

        Returns ``(payload_for_shopify, keys_used)``. ``keys_used`` is the
        original list (or empty), useful for logging. The returned payload is
        a *shallow copy* with ``images`` replaced — the caller's payload is
        not mutated. ``media_r2_keys`` is stripped before posting to Shopify.
        """
        keys = product_payload.get("media_r2_keys") or []
        if not isinstance(keys, list):
            raise ShopifyAdminError(
                "product_payload.media_r2_keys must be a list of strings"
            )
        # Defensive copy so caller payload stays untouched.
        new_payload = {k: v for k, v in product_payload.items() if k != "media_r2_keys"}
        if not keys:
            return new_payload, []

        existing_images = list(new_payload.get("images") or [])
        new_images = list(existing_images)

        if self.r2_client is None:
            raise R2FetchError(
                "media_r2_keys provided but ProductPushService has no r2_client wired"
            )

        for idx, key in enumerate(keys, start=1):
            try:
                body_bytes, _content_type = self.r2_client.get_object(key)
            except Exception as exc:  # noqa: BLE001 - convert to ShopifyAdminError subclass
                logger.error("r2 fetch failed for media key %s: %s", key, exc)
                raise R2FetchError(f"r2 fetch failed for {key}: {exc}") from exc
            attachment_b64 = base64.b64encode(body_bytes).decode("ascii")
            new_images.append(
                {
                    "attachment": attachment_b64,
                    "filename": self._filename_for(key, idx + len(existing_images)),
                }
            )

        new_payload["images"] = new_images
        return new_payload, list(keys)

    @staticmethod
    def _set_metafields(
        admin: Any,
        shopify_product_id: str,
        metafields: list[dict],
    ) -> dict:
        """Re-seed product metafields on the target store via GraphQL ``metafieldsSet``.

        Track AS5: cross-store push needs to bring the source product's
        metafields along. Each entry is shaped like ``{namespace, key, type,
        value}`` (matching our ``product_metafield`` rows). The Shopify product
        gid is constructed from the numeric REST id.

        Returns Shopify's metafields response on success or raises
        :class:`ShopifyAdminError` (which the caller catches & logs).
        """
        if not metafields:
            return {"metafields": [], "userErrors": []}
        owner_id = f"gid://shopify/Product/{shopify_product_id}"
        inputs: list[dict] = []
        for mf in metafields:
            namespace = mf.get("namespace")
            key = mf.get("key")
            if not namespace or not key:
                continue
            inputs.append(
                {
                    "ownerId": owner_id,
                    "namespace": namespace,
                    "key": key,
                    "type": mf.get("type") or "single_line_text_field",
                    "value": "" if mf.get("value") is None else str(mf.get("value")),
                }
            )
        if not inputs:
            return {"metafields": [], "userErrors": []}
        query = (
            "mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {"
            " metafieldsSet(metafields: $metafields) {"
            "   metafields { id namespace key type value }"
            "   userErrors { field message code }"
            " }"
            "}"
        )
        data = admin.graphql(query, {"metafields": inputs})
        wrapper = data.get("metafieldsSet")
        if not isinstance(wrapper, dict):
            raise ShopifyAdminError("metafieldsSet response missing 'metafieldsSet' object")
        user_errors = wrapper.get("userErrors") or []
        if user_errors:
            # Treat userErrors as a soft failure: caller catches and logs, the
            # product itself is already created. Keep the diagnostics in body.
            raise ShopifyAdminError(f"metafieldsSet userErrors: {user_errors}")
        return {
            "metafields": wrapper.get("metafields") or [],
            "userErrors": [],
        }

    # ----------------------------------------------------------------- public

    def push(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        product_payload: dict,
        access_token: Optional[str] = None,
    ) -> dict:
        if self.dry_run:
            return self._push_dry_run(
                shop_domain=shop_domain,
                tenant_id=tenant_id,
                store_id=store_id,
                task_id=task_id,
                product_payload=product_payload,
            )
        # Resolve R2 media (if any) into base64 attachments BEFORE talking to
        # Shopify, so a failed download surfaces as 502 (R2FetchError) before
        # we even authenticate against Admin.
        prepared_payload, _keys = self._attach_r2_media(product_payload)
        # Track AS5: ``metafields`` is NOT part of Shopify's REST product create
        # body — strip it here and re-seed via GraphQL ``metafieldsSet`` after
        # the product exists. ``template_suffix`` is a normal product field
        # that Shopify accepts inline, so leave it on the payload.
        metafields_to_set = prepared_payload.pop("metafields", None) or []
        return self._push_real(
            shop_domain=shop_domain,
            tenant_id=tenant_id,
            store_id=store_id,
            task_id=task_id,
            product_payload=prepared_payload,
            access_token=access_token,
            metafields=metafields_to_set,
        )

    # ------------------------------------------------------------------ modes

    def _push_real(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        product_payload: dict,
        access_token: Optional[str],
        metafields: Optional[list[dict]] = None,
    ) -> dict:
        started_at = _now_iso()
        clock_start = time.perf_counter()
        requested_handle = product_payload.get("handle")

        # custom_app store: caller supplied access_token directly. Otherwise
        # fall back to shopify CLI cache (developer-style shpat_/shpca_).
        if access_token:
            token = access_token
        else:
            token = self.shopify_cli.get_token(shop_domain)

        admin = self.admin_factory(shop_domain, token)

        try:
            shopify_product = admin.create_product(product_payload)
        except ShopifyAdminValidationError as exc:
            completed_at = _now_iso()
            logger.warning(
                "product push VALIDATION shop=%s task=%s: %s",
                shop_domain,
                task_id,
                exc,
            )
            return {
                "task_id": task_id,
                "shopify_product_id": None,
                "shopify_handle": None,
                "shopify_admin_response": None,
                "conflict": {
                    "type": "VALIDATION",
                    "details": exc.body,
                },
                "error": str(exc),
                "started_at": started_at,
                "completed_at": completed_at,
                "dry_run": False,
            }

        actual_handle = shopify_product.get("handle")
        shopify_product_id = shopify_product.get("id")

        # Track AS5: re-seed product metafields via GraphQL metafieldsSet.
        # Best-effort — a failure here does NOT roll back the product create.
        # Surfaced in the response so callers can audit / retry.
        metafields_set_result: Optional[dict] = None
        if metafields and shopify_product_id is not None:
            try:
                metafields_set_result = self._set_metafields(
                    admin, str(shopify_product_id), metafields
                )
            except ShopifyAdminError as exc:
                logger.warning(
                    "metafieldsSet failed shop=%s task=%s product=%s: %s",
                    shop_domain,
                    task_id,
                    shopify_product_id,
                    exc,
                )
                metafields_set_result = {"error": str(exc)}

        completed_at = _now_iso()
        elapsed = round(time.perf_counter() - clock_start, 3)

        conflict: Optional[dict] = None
        if (
            isinstance(requested_handle, str)
            and requested_handle
            and isinstance(actual_handle, str)
            and actual_handle != requested_handle
        ):
            conflict = {
                "type": "HANDLE_RENAMED",
                "requested": requested_handle,
                "actual": actual_handle,
            }
            logger.info(
                "product push handle renamed shop=%s task=%s: %s -> %s",
                shop_domain,
                task_id,
                requested_handle,
                actual_handle,
            )

        logger.info(
            "product push done shop=%s task=%s shopify_product_id=%s elapsed=%ss",
            shop_domain,
            task_id,
            shopify_product_id,
            elapsed,
        )

        result = {
            "task_id": task_id,
            "shopify_product_id": str(shopify_product_id) if shopify_product_id is not None else None,
            "shopify_handle": actual_handle,
            "shopify_admin_response": shopify_product,
            "conflict": conflict,
            "started_at": started_at,
            "completed_at": completed_at,
            "dry_run": False,
        }
        if metafields_set_result is not None:
            result["metafields_set"] = metafields_set_result
        return result

    def _push_dry_run(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        product_payload: dict,
    ) -> dict:
        started_at = _now_iso()
        synthetic_id = _synthetic_shopify_id()
        requested_handle = product_payload.get("handle") or "dry-run-handle"
        # Track AS5: surface metafields in dry-run response so UI can verify
        # what would have been re-seeded on the target store.
        synthetic_metafields = list(product_payload.get("metafields") or [])

        # Synthesize attachments for any media_r2_keys without touching R2 —
        # so end-to-end UI work never blocks on missing R2 creds.
        media_keys = product_payload.get("media_r2_keys") or []
        existing_images = list(product_payload.get("images") or [])
        synthesized_images = list(existing_images)
        if isinstance(media_keys, list):
            for idx, key in enumerate(media_keys, start=1):
                fake_bytes = (
                    f"dry-run-image-{idx}-{key}".encode("utf-8")
                )
                synthesized_images.append(
                    {
                        "attachment": base64.b64encode(fake_bytes).decode("ascii"),
                        "filename": self._filename_for(
                            str(key), idx + len(existing_images)
                        ),
                    }
                )

        synthetic_response = {
            "id": int(synthetic_id),
            "handle": requested_handle,
            "title": product_payload.get("title", "Dry Run Product"),
            "status": product_payload.get("status", "active"),
            "variants": product_payload.get("variants", []),
            "images": synthesized_images,
        }

        logger.info(
            "product push DRY-RUN shop=%s task=%s synthetic_id=%s",
            shop_domain,
            task_id,
            synthetic_id,
        )

        result = {
            "task_id": task_id,
            "shopify_product_id": synthetic_id,
            "shopify_handle": requested_handle,
            "shopify_admin_response": synthetic_response,
            "conflict": None,
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": True,
        }
        if synthetic_metafields:
            result["metafields_set"] = {
                "metafields": [
                    {
                        "namespace": mf.get("namespace"),
                        "key": mf.get("key"),
                        "type": mf.get("type"),
                        "value": mf.get("value"),
                    }
                    for mf in synthetic_metafields
                    if mf.get("namespace") and mf.get("key")
                ],
                "userErrors": [],
            }
        return result
