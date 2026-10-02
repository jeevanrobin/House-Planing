"""Supabase REST calls for billing.

Ownership is checked *as the user* (their access token + the publishable
key), so row-level security decides; the verified unlock is written with the
service-role key, which only this service holds.
"""
from __future__ import annotations

import httpx

from app.core.config import settings


def _rest(path: str) -> str:
    return f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/{path}"


def user_owns_project(access_token: str, project_id: str) -> bool:
    resp = httpx.get(
        _rest("projects"),
        params={"id": f"eq.{project_id}", "select": "id"},
        headers={"apikey": settings.SUPABASE_PUBLISHABLE_KEY, "Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    resp.raise_for_status()
    return len(resp.json()) == 1


def project_unlocked(project_id: str) -> bool:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    resp = httpx.get(
        _rest("project_unlocks"),
        params={"project_id": f"eq.{project_id}", "select": "id"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=10,
    )
    resp.raise_for_status()
    return len(resp.json()) > 0


def record_unlock(project_id: str, user_id: str, order_id: str, payment_id: str, amount_paise: int) -> None:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    resp = httpx.post(
        _rest("project_unlocks"),
        params={"on_conflict": "project_id"},
        json={
            "project_id": project_id, "user_id": user_id, "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id, "amount_paise": amount_paise, "currency": "INR",
        },
        headers={
            "apikey": key, "Authorization": f"Bearer {key}",
            # Paying twice for one project (two tabs) keeps the first unlock.
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
        timeout=10,
    )
    resp.raise_for_status()
