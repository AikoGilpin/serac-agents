"""
Serac Agent SDK — Main Entry Point
Sovereign E2EE cloud storage for AI agents — Python edition

Usage:
    from serac_mcp import SeracAgent, generate_agent_key_material

    # Generate key material
    keys = generate_agent_key_material()

    # Self-register
    result = SeracAgent.register(
        agent_name="my-agent",
        ed25519_public_key=keys["signing"]["public_key_b64"],
        x25519_public_key=keys["encryption"]["public_key_b64"],
        encrypted_master_key=keys["encrypted_master_key"],
        key_commitment=keys["key_commitment"],
    )
    agent = result["agent"]

    # Store data
    agent.store("memory", "user:prefs", base64_data)

    # Retrieve data
    data = agent.retrieve("memory", "user:prefs")
"""

from __future__ import annotations

import base64
import json
from typing import Any, Optional

from .client import HttpClient, SeracError
from .crypto import (
    generate_agent_key_material as _gen_key_material,
    generate_ed25519_keypair,
    generate_x25519_keypair,
    encrypt_aes256_gcm,
    decrypt_aes256_gcm,
    derive_namespace_key,
    seal_with_public_key,
    unseal_with_private_key,
    sign_ed25519,
    verify_ed25519,
    sha256_hash,
    b64_to_b64url,
    b64url_to_b64,
)


DEFAULT_BASE_URL = "https://serac.cloud/api/agent"


class SeracAgent:
    """
    Serac Agent SDK client.

    Two ways to initialize:
    1. SeracAgent.from_api_key(key) — for agents with a pre-existing API key
    2. SeracAgent.register(opts) — for autonomous agents that self-register
    """

    def __init__(
        self,
        api_key: str,
        base_url: str | None = None,
        timeout: int = 30,
        max_retries: int = 3,
    ):
        self._client = HttpClient(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
        )
        self._vault_id: str | None = None

    # ─── Factory Methods ─────────────────────────────────────────────────────

    @classmethod
    def from_api_key(
        cls,
        api_key: str,
        base_url: str | None = None,
        timeout: int = 30,
        max_retries: int = 3,
    ) -> "SeracAgent":
        """Initialize from an existing API key."""
        return cls(api_key, base_url=base_url, timeout=timeout, max_retries=max_retries)

    @classmethod
    def register(
        cls,
        agent_name: str,
        ed25519_public_key: str,
        x25519_public_key: str,
        encrypted_master_key: str,
        master_key_nonce: str,
        key_commitment: str,
        tier: str = "agent_free",
        agent_type: str | None = None,
        webhook_url: str | None = None,
        x402_wallet_address: str | None = None,
        x402_spending_limit_cents: int | None = None,
        base_url: str | None = None,
        timeout: int = 30,
        max_retries: int = 3,
    ) -> dict:
        """
        Self-register as an autonomous agent.
        Creates a new vault with namespace "memory" and returns the agent instance
        ready to use. The API key is shown ONCE — caller must save it.

        Returns:
            dict with keys: agent (SeracAgent), api_key (str), vault_id (str)
        """
        client = HttpClient(
            api_key="",  # No auth for registration
            base_url=base_url or DEFAULT_BASE_URL,
            timeout=timeout,
            max_retries=max_retries,
        )

        body = {
            "agent_name": agent_name,
            "ed25519_public_key": ed25519_public_key,
            "x25519_public_key": x25519_public_key,
            "encrypted_master_key": encrypted_master_key,
            "master_key_nonce": master_key_nonce,
            "key_commitment": key_commitment,
            "tier": tier,
        }
        if agent_type:
            body["agent_type"] = agent_type
        if webhook_url:
            body["webhook_url"] = webhook_url
        if x402_wallet_address:
            body["x402_wallet_address"] = x402_wallet_address
        if x402_spending_limit_cents:
            body["x402_spending_limit_cents"] = x402_spending_limit_cents

        result = client.post("/register", body)

        agent = cls(
            api_key=result["apiKey"],
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
        )
        agent._vault_id = result.get("vaultId")
        agent._client.jwt = result.get("accessToken")
        agent._client.jwt_expiry = (
            time.time() + result.get("expiresIn", 3600) - 30
        )

        return {
            "agent": agent,
            "api_key": result["apiKey"],
            "vault_id": result.get("vaultId", ""),
        }

    # ─── V1 Tools ─────────────────────────────────────────────────────────────

    def store(
        self,
        namespace: str,
        key: str,
        data: str,
        content_type: str | None = None,
        ttl: int | None = None,
    ) -> dict:
        """Store a small object directly via base64. Max 1 MB."""
        body: dict[str, Any] = {"namespace": namespace, "key": key, "data": data}
        if content_type:
            body["content_type"] = content_type
        if ttl is not None:
            body["ttl"] = ttl
        return self._client.post("/objects/store/direct", body)

    def store_presigned(
        self,
        namespace: str,
        key: str,
        size_bytes: int,
        content_type: str | None = None,
        ttl: int | None = None,
    ) -> dict:
        """Get a presigned upload URL for large objects (> 1 MB)."""
        body: dict[str, Any] = {
            "namespace": namespace,
            "key": key,
            "size_bytes": size_bytes,
        }
        if content_type:
            body["content_type"] = content_type
        if ttl is not None:
            body["ttl"] = ttl
        return self._client.post("/objects/store", body)

    def store_confirm(
        self,
        object_id: str,
        upload_token: str,
        size_bytes: int | None = None,
    ) -> dict:
        """Confirm that a presigned upload completed."""
        body: dict[str, Any] = {
            "object_id": object_id,
            "upload_token": upload_token,
        }
        if size_bytes is not None:
            body["size_bytes"] = size_bytes
        return self._client.post("/objects/confirm", body)

    def retrieve(self, namespace: str, key: str) -> dict:
        """Retrieve an object — returns a presigned download URL."""
        return self._client.get("/objects/retrieve", {"namespace": namespace, "key": key})

    def retrieve_data(self, namespace: str, key: str) -> str:
        """Retrieve an object and decode the response automatically."""
        result = self.retrieve(namespace, key)
        download_url = result["downloadUrl"]

        import urllib.request
        ctx = urllib.request.ssl.create_default_context()
        with urllib.request.urlopen(download_url, timeout=self._client.timeout, context=ctx) as resp:
            data = resp.read()
            return base64.b64encode(data).decode()

    def list(
        self,
        namespace: str,
        prefix: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> dict:
        """List keys in a namespace with optional prefix filter."""
        params: dict[str, Any] = {"namespace": namespace}
        if prefix:
            params["prefix"] = prefix
        if limit:
            params["limit"] = limit
        if cursor:
            params["cursor"] = cursor
        return self._client.get("/objects/list", params)

    def delete(self, namespace: str, key: str) -> dict:
        """Delete an object (soft delete by default, 30-day grace)."""
        return self._client.delete("/objects/delete", {"namespace": namespace, "key": key})

    def quota(self) -> dict:
        """Check storage usage and plan limits."""
        return self._client.get("/quota")

    # ─── V2 Tools ─────────────────────────────────────────────────────────────

    def share(
        self,
        namespace: str,
        key: str,
        target_pubkey: str,
        permission: str = "read",
        ttl: int | None = None,
    ) -> dict:
        """Share an object with another agent via X25519 sealed-box re-encryption."""
        body: dict[str, Any] = {
            "namespace": namespace,
            "key": key,
            "target_agent_pubkey": target_pubkey,
            "permission": permission,
        }
        if ttl is not None:
            body["ttl"] = ttl
        return self._client.post("/objects/share", body)

    def list_shared(
        self,
        permission: str | None = None,
        active_only: bool | None = None,
        limit: int | None = None,
    ) -> dict:
        """List shares received by the authenticated agent."""
        params: dict[str, Any] = {}
        if permission and permission != "all":
            params["permission"] = permission
        if active_only is not None:
            params["active_only"] = str(active_only).lower()
        if limit:
            params["limit"] = limit
        return self._client.get("/objects/shared", params)

    def get_shared(self, share_id: str) -> dict:
        """Get details and download URL for a received share."""
        return self._client.get(f"/objects/shared/{share_id}")

    def revoke_share(self, share_id: str) -> dict:
        """Revoke a share. Only the sharer can revoke."""
        return self._client.delete(f"/objects/share/{share_id}")

    def attest(self, namespace: str, key: str) -> dict:
        """Get a cryptographic attestation for a stored object."""
        return self._client.get(
            f"/objects/{urllib.parse.quote(key, safe='')}/attest",
            {"namespace": namespace},
        )

    def archive(self, namespace: str, key: str) -> dict:
        """Archive an object to cold storage (Glacier)."""
        return self._client.post(
            f"/objects/{urllib.parse.quote(key, safe='')}/archive",
            {"namespace": namespace},
        )

    def restore(self, namespace: str, key: str) -> dict:
        """Request restoration of an archived object."""
        return self._client.post(
            f"/objects/{urllib.parse.quote(key, safe='')}/restore",
            {"namespace": namespace},
        )

    # ─── Utility ──────────────────────────────────────────────────────────────

    @property
    def vault_id(self) -> str | None:
        """Get the vault ID (available after registration)."""
        return self._vault_id

    def reauthenticate(self) -> dict:
        """Re-authenticate manually (rarely needed, SDK auto-renews)."""
        return self._client.refresh_auth()


# ─── Public API ────────────────────────────────────────────────────────────

# Time import needed for register()
import time
import urllib.parse

__all__ = [
    # Main class
    "SeracAgent",
    # Errors
    "SeracError",
    # Crypto — key generation (requires 'cryptography' package)
    "generate_ed25519_keypair",
    "generate_x25519_keypair",
    "generate_agent_key_material",
    # Crypto — symmetric encryption
    "encrypt_aes256_gcm",
    "decrypt_aes256_gcm",
    "derive_namespace_key",
    # Crypto — sealed box
    "seal_with_public_key",
    "unseal_with_private_key",
    # Crypto — Ed25519 sign/verify
    "sign_ed25519",
    "verify_ed25519",
    # Crypto — utility
    "sha256_hash",
    "b64_to_b64url",
    "b64url_to_b64",
    # Types
    "KeyPair",
    "AgentKeyMaterial",
    "EncryptedData",
    "SealedBoxResult",
]

# Re-export types from crypto
from .crypto import KeyPair, AgentKeyMaterial, EncryptedData, SealedBoxResult

# Aliasing internal name to public name
generate_agent_key_material = _gen_key_material