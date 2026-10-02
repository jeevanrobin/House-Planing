"""Razorpay Orders API and payment-signature check.

The key secret never leaves this service: the browser only gets the order
id and the public key id, and payments count only after their signature
(HMAC-SHA256 of "<order_id>|<payment_id>" with the key secret) checks out.
"""
from __future__ import annotations

import hashlib
import hmac

import httpx

from app.core.config import settings

API = "https://api.razorpay.com/v1"


def create_order(amount_paise: int, receipt: str, notes: dict[str, str]) -> dict:
    resp = httpx.post(
        f"{API}/orders",
        auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
        json={"amount": amount_paise, "currency": "INR", "receipt": receipt[:40], "notes": notes},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_order(order_id: str) -> dict:
    resp = httpx.get(f"{API}/orders/{order_id}", auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET), timeout=10)
    resp.raise_for_status()
    return resp.json()


def signature_ok(order_id: str, payment_id: str, signature: str, secret: str | None = None) -> bool:
    key = (secret if secret is not None else settings.RAZORPAY_KEY_SECRET).encode()
    expected = hmac.new(key, f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
