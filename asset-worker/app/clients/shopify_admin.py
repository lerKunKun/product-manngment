"""
Shopify Admin REST API client.

Thin synchronous httpx wrapper sufficient to enumerate themes / theme
assets and pull individual asset bodies. Only the surface needed by the
``/pull/theme`` worker endpoint is implemented; richer GraphQL coverage
arrives in later waves.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_SECONDS = 30.0


class ShopifyAdminError(Exception):
    """Raised on non-2xx responses or transport errors from Shopify Admin."""


class ShopifyAdminValidationError(ShopifyAdminError):
    """Raised specifically for 422 Unprocessable Entity from Shopify Admin.

    Carries the parsed response body (if any) so callers can inspect the
    per-field validation errors and translate them into application-level
    conflict records (e.g. ``HANDLE_TAKEN`` / ``SKU_DUPLICATE``).
    """

    def __init__(self, message: str, body: Any | None = None) -> None:
        super().__init__(message)
        self.body = body


def download_url(url: str, timeout_seconds: float = 30.0) -> tuple[bytes, str]:
    """Fetch a public URL (e.g. ``cdn.shopify.com``) and return ``(body, content_type)``.

    Used for product image media: the Shopify CDN is unauthenticated, so no
    Admin auth header is sent. A fresh ``httpx.Client`` is created per call;
    callers that need batching can layer their own pool.
    """
    try:
        with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
            response = client.get(url)
    except httpx.HTTPError as exc:
        logger.error("download_url transport error on %s: %s", url, exc)
        raise ShopifyAdminError(f"transport error downloading {url}: {exc}") from exc

    if response.status_code >= 400:
        snippet = (response.text or "")[:500]
        logger.error("download_url %s -> %s: %s", url, response.status_code, snippet)
        raise ShopifyAdminError(
            f"{url} returned {response.status_code}: {snippet}"
        )

    content_type = response.headers.get("Content-Type", "application/octet-stream")
    return response.content, content_type


class ShopifyAdminClient:
    """Synchronous Shopify Admin REST client."""

    def __init__(
        self,
        shop_domain: str,
        access_token: str,
        api_version: str = "2024-10",
    ) -> None:
        self.shop_domain = shop_domain
        self.access_token = access_token
        self.api_version = api_version
        self._base_url = f"https://{shop_domain}/admin/api/{api_version}"
        self._client = httpx.Client(
            base_url=self._base_url,
            timeout=_DEFAULT_TIMEOUT_SECONDS,
            headers={
                "X-Shopify-Access-Token": access_token,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )

    # ------------------------------------------------------------------ helpers

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict:
        try:
            response = self._client.get(path, params=params)
        except httpx.HTTPError as exc:
            logger.error("shopify admin transport error on %s: %s", path, exc)
            raise ShopifyAdminError(f"transport error calling {path}: {exc}") from exc

        if response.status_code >= 400:
            snippet = (response.text or "")[:500]
            logger.error(
                "shopify admin %s -> %s: %s",
                path,
                response.status_code,
                snippet,
            )
            raise ShopifyAdminError(
                f"{path} returned {response.status_code}: {snippet}"
            )

        try:
            return response.json()
        except ValueError as exc:
            raise ShopifyAdminError(f"non-JSON response from {path}: {exc}") from exc

    def _put(self, path: str, json_body: dict[str, Any]) -> dict:
        try:
            response = self._client.put(path, json=json_body)
        except httpx.HTTPError as exc:
            logger.error("shopify admin transport error on %s: %s", path, exc)
            raise ShopifyAdminError(f"transport error calling {path}: {exc}") from exc

        if response.status_code >= 400:
            snippet = (response.text or "")[:500]
            logger.error(
                "shopify admin %s -> %s: %s",
                path,
                response.status_code,
                snippet,
            )
            raise ShopifyAdminError(
                f"{path} returned {response.status_code}: {snippet}"
            )

        try:
            return response.json()
        except ValueError as exc:
            raise ShopifyAdminError(f"non-JSON response from {path}: {exc}") from exc

    def _post(self, path: str, json_body: dict[str, Any]) -> dict:
        try:
            response = self._client.post(path, json=json_body)
        except httpx.HTTPError as exc:
            logger.error("shopify admin transport error on %s: %s", path, exc)
            raise ShopifyAdminError(f"transport error calling {path}: {exc}") from exc

        if response.status_code >= 400:
            snippet = (response.text or "")[:500]
            logger.error(
                "shopify admin %s -> %s: %s",
                path,
                response.status_code,
                snippet,
            )
            if response.status_code == 422:
                # Try to parse body for structured validation details; fall
                # back to the raw snippet if the body isn't valid JSON.
                parsed_body: Any
                try:
                    parsed_body = response.json()
                except ValueError:
                    parsed_body = {"raw": snippet}
                raise ShopifyAdminValidationError(
                    f"{path} returned 422: {snippet}",
                    body=parsed_body,
                )
            raise ShopifyAdminError(
                f"{path} returned {response.status_code}: {snippet}"
            )

        try:
            return response.json()
        except ValueError as exc:
            raise ShopifyAdminError(f"non-JSON response from {path}: {exc}") from exc

    def close(self) -> None:
        self._client.close()

    # -------------------------------------------------------------------- public

    def get_themes(self) -> list[dict]:
        """Return the list of themes for the shop."""
        data = self._get("/themes.json")
        themes = data.get("themes", [])
        if not isinstance(themes, list):
            raise ShopifyAdminError("themes response missing 'themes' list")
        return themes

    def get_assets(self, theme_id: int) -> list[dict]:
        """Return metadata for every asset in ``theme_id``."""
        data = self._get(f"/themes/{theme_id}/assets.json")
        assets = data.get("assets", [])
        if not isinstance(assets, list):
            raise ShopifyAdminError("assets response missing 'assets' list")
        return assets

    def get_asset(self, theme_id: int, key: str) -> dict:
        """Return a single asset's full payload (with ``value`` or ``attachment``)."""
        data = self._get(
            f"/themes/{theme_id}/assets.json",
            params={"asset[key]": key},
        )
        asset = data.get("asset")
        if not isinstance(asset, dict):
            raise ShopifyAdminError(f"asset {key!r} not found in response")
        return asset

    # ------------------------------------------------------------------ graphql

    def graphql(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
    ) -> dict:
        """Issue a GraphQL Admin API call. Returns the ``data`` field.

        Raises ``ShopifyAdminError`` if the response carries top-level
        ``errors`` or if any required structure is missing.
        """
        body: dict[str, Any] = {"query": query}
        if variables is not None:
            body["variables"] = variables
        response = self._post("/graphql.json", body)
        errors = response.get("errors")
        if errors:
            raise ShopifyAdminError(f"graphql errors: {errors}")
        data = response.get("data")
        if not isinstance(data, dict):
            raise ShopifyAdminError("graphql response missing 'data' object")
        return data

    # --------------------------------------------------------------- policies

    def get_policies(self) -> list[dict]:
        """Return the shop's storefront policies (privacy / refund / terms / ...)."""
        data = self._get("/policies.json")
        policies = data.get("policies", [])
        if not isinstance(policies, list):
            raise ShopifyAdminError("policies response missing 'policies' list")
        return policies

    # ------------------------------------------------------------------ menus

    def get_menus(self) -> list[dict]:
        """Return navigation menus via GraphQL (REST has no menus endpoint)."""
        query = (
            "{ menus(first: 50) { nodes { id title handle "
            "items { title url type resourceId } } } }"
        )
        data = self.graphql(query)
        menus_root = data.get("menus")
        if not isinstance(menus_root, dict):
            raise ShopifyAdminError("graphql menus response missing 'menus'")
        nodes = menus_root.get("nodes", [])
        if not isinstance(nodes, list):
            raise ShopifyAdminError("graphql menus response missing 'nodes' list")
        return nodes

    # ------------------------------------------------------------ collections

    def get_custom_collections(self) -> list[dict]:
        """Return manually-curated collections."""
        data = self._get("/custom_collections.json")
        collections = data.get("custom_collections", [])
        if not isinstance(collections, list):
            raise ShopifyAdminError(
                "custom_collections response missing 'custom_collections' list"
            )
        return collections

    def get_smart_collections(self) -> list[dict]:
        """Return rule-based / automated collections."""
        data = self._get("/smart_collections.json")
        collections = data.get("smart_collections", [])
        if not isinstance(collections, list):
            raise ShopifyAdminError(
                "smart_collections response missing 'smart_collections' list"
            )
        return collections

    # ------------------------------------------------------------------- products

    def get_product(self, product_id: int) -> dict:
        """Return the full product object (unwrapped from Shopify's ``{"product": ...}``).

        The response carries variants, options, images metadata and the basic
        catalog fields. Image binaries are NOT included; callers download each
        ``images[].src`` URL separately via :func:`download_url`.
        """
        data = self._get(f"/products/{product_id}.json")
        product = data.get("product")
        if not isinstance(product, dict):
            raise ShopifyAdminError(
                f"product {product_id} response missing 'product' object"
            )
        return product

    def create_product(self, product_payload: dict) -> dict:
        """Create a Shopify product via REST ``POST /products.json``.

        ``product_payload`` is the inner product object; this method wraps
        it in ``{"product": ...}`` before posting. Returns the unwrapped
        product dict from Shopify's response.

        Raises :class:`ShopifyAdminValidationError` on 422 with the parsed
        body attached, and :class:`ShopifyAdminError` on any other failure.
        """
        data = self._post("/products.json", {"product": product_payload})
        product = data.get("product")
        if not isinstance(product, dict):
            raise ShopifyAdminError(
                "create_product response missing 'product' object"
            )
        return product

    # ----------------------------------------------------------------- files

    def file_create(self, files: list[dict]) -> list[dict]:
        """Create Shopify files via GraphQL ``fileCreate``.

        ``files`` is a list of ``FileCreateInput`` dicts, e.g.
        ``{"originalSource": "data:image/jpeg;base64,...", "contentType": "IMAGE", "alt": "..."}``.
        Returns a list of created file dicts (only ``MediaImage`` typed
        results are populated; other types come back with just ``id`` /
        ``alt`` and no ``image`` key).

        Surfaces top-level ``userErrors`` as :class:`ShopifyAdminError`
        so callers can map them to per-input failures upstream.
        """
        query = (
            "mutation fileCreate($files: [FileCreateInput!]!) {"
            " fileCreate(files: $files) {"
            "   files { ... on MediaImage { id alt image { url } } "
            "           ... on GenericFile { id alt url } "
            "           ... on Video { id alt } }"
            "   userErrors { field message }"
            " }"
            "}"
        )
        data = self.graphql(query, {"files": files})
        wrapper = data.get("fileCreate")
        if not isinstance(wrapper, dict):
            raise ShopifyAdminError("fileCreate response missing 'fileCreate' object")
        user_errors = wrapper.get("userErrors") or []
        if user_errors:
            raise ShopifyAdminError(f"fileCreate userErrors: {user_errors}")
        created = wrapper.get("files")
        if not isinstance(created, list):
            raise ShopifyAdminError("fileCreate response missing 'files' list")
        return created

    # --------------------------------------------------------------- themes

    def theme_get_main(self) -> dict | None:
        """Return the theme whose role is ``main``, or ``None`` if absent.

        Used by callers that want to seed an unpublished preview theme from
        the live storefront. Lookup is REST-based (``GET /themes.json``) for
        symmetry with :meth:`get_themes`.
        """
        themes = self.get_themes()
        for theme in themes:
            if isinstance(theme, dict) and theme.get("role") == "main":
                return theme
        return None

    def theme_create_from_src(
        self,
        name: str,
        src_url: str,
        role: str = "unpublished",
    ) -> dict:
        """Install a theme by asking Shopify to fetch a zip from ``src_url``.

        Uses the REST ``POST /admin/api/{ver}/themes.json`` endpoint with a
        ``src`` body field — Shopify pulls and extracts the zip server-side.
        Returns the theme dict (``{"id", "name", "role", "processing", ...}``).
        Note: ``processing=true`` initially; for Day 5 we don't poll — callers
        either trust eventual consistency or run a follow-up status check.

        Raises :class:`ShopifyAdminError` on non-2xx or malformed response.
        """
        payload = {
            "theme": {
                "name": name,
                "src": src_url,
                "role": role,
            }
        }
        data = self._post("/themes.json", payload)
        theme = data.get("theme")
        if not isinstance(theme, dict):
            raise ShopifyAdminError(
                "theme_create_from_src response missing 'theme' object"
            )
        return theme

    def theme_publish(self, theme_id: int | str) -> dict:
        """Promote ``theme_id`` to ``role=main`` (publish) via REST PUT.

        Returns the updated theme dict. Raises :class:`ShopifyAdminError` on
        non-2xx or malformed response.
        """
        # Strip gid prefix if a GraphQL-style id slipped through (defensive).
        numeric: str
        if isinstance(theme_id, str) and "/" in theme_id:
            numeric = theme_id.rsplit("/", 1)[-1]
        else:
            numeric = str(theme_id)
        payload = {"theme": {"id": numeric, "role": "main"}}
        data = self._put(f"/themes/{numeric}.json", payload)
        theme = data.get("theme")
        if not isinstance(theme, dict):
            raise ShopifyAdminError(
                "theme_publish response missing 'theme' object"
            )
        return theme

    def theme_create_unpublished(self, name: str) -> dict:
        """Create an unpublished theme via GraphQL ``themeCreate``.

        Returns the theme dict (``{"id": "...", "name": "...", "role": ...}``).
        Raises :class:`ShopifyAdminError` if the mutation reports
        ``userErrors`` or the response is structurally malformed.
        """
        query = (
            "mutation themeCreate($name: String!, $role: ThemeRole!) {"
            " themeCreate(input: {name: $name, role: $role}) {"
            "   theme { id name role }"
            "   userErrors { field message }"
            " }"
            "}"
        )
        data = self.graphql(query, {"name": name, "role": "UNPUBLISHED"})
        wrapper = data.get("themeCreate")
        if not isinstance(wrapper, dict):
            raise ShopifyAdminError("themeCreate response missing 'themeCreate' object")
        user_errors = wrapper.get("userErrors") or []
        if user_errors:
            raise ShopifyAdminError(f"themeCreate userErrors: {user_errors}")
        theme = wrapper.get("theme")
        if not isinstance(theme, dict):
            raise ShopifyAdminError("themeCreate response missing 'theme' object")
        return theme

    # ---------------------------------------------------------- collections

    def create_custom_collection(self, payload: dict) -> dict:
        """Create a manually-curated collection via REST.

        ``payload`` is the inner ``custom_collection`` object (handle, title,
        body_html, sort_order, etc.). This method wraps it in
        ``{"custom_collection": ...}`` before posting. Returns the unwrapped
        collection dict.
        """
        data = self._post(
            "/custom_collections.json",
            {"custom_collection": payload},
        )
        collection = data.get("custom_collection")
        if not isinstance(collection, dict):
            raise ShopifyAdminError(
                "create_custom_collection response missing 'custom_collection' object"
            )
        return collection
