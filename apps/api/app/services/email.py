"""Outbound email for OTP codes.

`get_email_sender()` picks the transport from settings:
  * SMTP_HOST set   -> SmtpEmailSender (STARTTLS by default)
  * development     -> ConsoleEmailSender (logs the message; nothing leaves the box)
  * otherwise       -> None: callers must refuse rather than pretend to send.
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from typing import Protocol

from starlette.concurrency import run_in_threadpool

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, body: str) -> None: ...


class ConsoleEmailSender:
    async def send(self, to: str, subject: str, body: str) -> None:
        logger.warning("DEV EMAIL to=%s subject=%r\n%s", to, subject, body)


class SmtpEmailSender:
    def _send_sync(self, msg: EmailMessage) -> None:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
            if settings.SMTP_STARTTLS:
                smtp.starttls()
            if settings.SMTP_USER:
                smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            smtp.send_message(msg)

    async def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        await run_in_threadpool(self._send_sync, msg)


def get_email_sender() -> EmailSender | None:
    if settings.SMTP_HOST:
        return SmtpEmailSender()
    if settings.is_dev:
        return ConsoleEmailSender()
    return None


def otp_email(code: str, purpose: str) -> tuple[str, str]:
    action = {"login": "sign in", "verify_email": "verify your email", "reset": "reset your password"}
    subject = f"Your AI Plot Planner code: {code}"
    body = (
        f"Use this code to {action.get(purpose, 'continue')}: {code}\n\n"
        f"It expires in {settings.OTP_TTL_MIN} minutes. If you didn't request it, ignore this email."
    )
    return subject, body
