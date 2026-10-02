"""Pro unlock (one-time, per project) with Razorpay Checkout.

1. POST /billing/orders   — the signed-in owner of a project gets a Razorpay order.
2. Razorpay Checkout runs in the browser.
3. POST /billing/verify   — the payment signature is checked here and the
   unlock recorded; the browser never decides that a payment succeeded.
"""
from __future__ import annotations

import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.api.deps import bearer, current_user
from app.core.config import settings
from app.core.supabase_auth import AuthUser
from app.services import razorpay, supabase_rest

router = APIRouter(prefix="/billing", tags=["billing"])


class OrderIn(BaseModel):
    project_id: uuid.UUID


class OrderOut(BaseModel):
    order_id: str
    amount: int
    currency: str
    key_id: str


class VerifyIn(BaseModel):
    project_id: uuid.UUID
    razorpay_order_id: str = Field(max_length=64)
    razorpay_payment_id: str = Field(max_length=64)
    razorpay_signature: str = Field(max_length=128)


def _require_billing() -> None:
    if not settings.billing_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Payments are not set up on this server")


@router.get("/config")
def config() -> dict:
    """Public: whether payments are on, the key id for Checkout, and the price."""
    return {"enabled": settings.billing_enabled, "key_id": settings.RAZORPAY_KEY_ID if settings.billing_enabled else None,
            "price_paise": settings.PRO_PRICE_PAISE}


@router.post("/orders", response_model=OrderOut)
def create_order(body: OrderIn, user: AuthUser = Depends(current_user),
                 creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> OrderOut:
    _require_billing()
    project_id = str(body.project_id)
    try:
        if not supabase_rest.user_owns_project(creds.credentials, project_id):  # type: ignore[union-attr]
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
        if supabase_rest.project_unlocked(project_id):
            raise HTTPException(status.HTTP_409_CONFLICT, "This project is already unlocked")
        order = razorpay.create_order(
            settings.PRO_PRICE_PAISE, receipt=f"pro-{project_id}",
            notes={"project_id": project_id, "user_id": user.id},
        )
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Payment provider unavailable, try again")
    return OrderOut(order_id=order["id"], amount=order["amount"], currency=order["currency"], key_id=settings.RAZORPAY_KEY_ID)


@router.post("/verify")
def verify(body: VerifyIn, user: AuthUser = Depends(current_user),
           creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    _require_billing()
    if not razorpay.signature_ok(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment could not be verified")
    project_id = str(body.project_id)
    try:
        # The order must be ours: created for this project and this user, for the Pro price.
        order = razorpay.fetch_order(body.razorpay_order_id)
        notes = order.get("notes") or {}
        if notes.get("project_id") != project_id or notes.get("user_id") != user.id or order.get("amount") != settings.PRO_PRICE_PAISE:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment does not match this project")
        if not supabase_rest.user_owns_project(creds.credentials, project_id):  # type: ignore[union-attr]
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
        supabase_rest.record_unlock(project_id, user.id, body.razorpay_order_id, body.razorpay_payment_id, order["amount"])
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not record the payment, contact support with your payment id")
    return {"unlocked": True}
