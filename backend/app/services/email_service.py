"""
Email service — verification and password reset emails via Gmail SMTP.

Sending is always done through FastAPI BackgroundTasks so the calling
endpoint returns immediately regardless of email delivery latency.
All SMTP errors are caught and logged server-side only; the user never
sees an SMTP failure message.
"""

import logging
from fastapi_mail import FastMail, MessageSchema, MessageType, ConnectionConfig
from app.config import settings

logger = logging.getLogger(__name__)

_mail_config = ConnectionConfig(
    MAIL_USERNAME=settings.SMTP_USERNAME,
    MAIL_PASSWORD=settings.SMTP_PASSWORD,
    MAIL_FROM=settings.SMTP_FROM_EMAIL,
    MAIL_PORT=settings.SMTP_PORT,
    MAIL_SERVER=settings.SMTP_HOST,
    MAIL_FROM_NAME=settings.SMTP_FROM_NAME,
    MAIL_STARTTLS=settings.SMTP_TLS,
    MAIL_SSL_TLS=settings.SMTP_SSL,
    USE_CREDENTIALS=True,
    VALIDATE_CERTS=True,
)

_fast_mail = FastMail(_mail_config)


# ---------------------------------------------------------------------------
# HTML templates
# ---------------------------------------------------------------------------

_BASE_STYLE = """
  body { margin:0; padding:0; background:#0A0A0F; font-family: 'Courier New', Courier, monospace; color:#F0F0F0; }
  .wrap { max-width:520px; margin:40px auto; background:#12121A; border:1px solid #FF4500; padding:40px; }
  .logo { font-size:22px; font-weight:bold; color:#FF4500; letter-spacing:6px; margin-bottom:4px; }
  .sub  { font-size:11px; color:#6B6B80; letter-spacing:4px; margin-bottom:32px; }
  .label{ font-size:11px; color:#6B6B80; letter-spacing:3px; margin-bottom:4px; }
  .call { font-size:16px; color:#F0F0F0; margin-bottom:24px; }
  .body { font-size:13px; color:#C0C0C8; line-height:1.7; margin-bottom:28px; }
  .btn  { display:inline-block; background:#FF4500; color:#F0F0F0; text-decoration:none;
          font-weight:bold; letter-spacing:2px; font-size:13px; padding:14px 28px; }
  .note { font-size:11px; color:#6B6B80; margin-top:28px; line-height:1.6; }
  .sig  { margin-top:32px; font-size:11px; color:#6B6B80; letter-spacing:3px; border-top:1px solid #2A2A3A; padding-top:16px; }
"""


def _verification_html(callsign: str, verify_url: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{_BASE_STYLE}</style></head>
<body>
  <div class="wrap">
    <div class="logo">DEADNET</div>
    <div class="sub">OPERATOR VERIFICATION</div>
    <div class="label">CALLSIGN</div>
    <div class="call">{callsign}</div>
    <div class="body">
      Your enlistment has been received.<br>
      Click below to verify your identity and activate your operator account.
    </div>
    <a class="btn" href="{verify_url}">VERIFY OPERATOR ACCOUNT</a>
    <div class="note">
      This link expires in <strong>24 hours</strong>.<br>
      Single use only.<br><br>
      If you did not register for DEADNET, ignore this message.
    </div>
    <div class="sig">— DEADNET S.Y.S</div>
  </div>
</body>
</html>"""


def _verification_text(callsign: str, verify_url: str) -> str:
    return (
        f"DEADNET — OPERATOR VERIFICATION\n\n"
        f"Callsign: {callsign}\n\n"
        f"Your enlistment has been received.\n"
        f"Click the link below to verify your identity and activate your account.\n\n"
        f"{verify_url}\n\n"
        f"This link expires in 24 hours. Single use only.\n\n"
        f"If you did not register for DEADNET, ignore this message.\n\n"
        f"— DEADNET S.Y.S"
    )


def _reset_html(callsign: str, reset_url: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{_BASE_STYLE}</style></head>
<body>
  <div class="wrap">
    <div class="logo">DEADNET</div>
    <div class="sub">PASS CODE RESET</div>
    <div class="label">CALLSIGN</div>
    <div class="call">{callsign}</div>
    <div class="body">
      A reset request was received for this operator account.
    </div>
    <a class="btn" href="{reset_url}">RESET PASS CODE</a>
    <div class="note">
      This link expires in <strong>1 hour</strong>.<br>
      Single use — cannot be reused.<br><br>
      If you did not request this reset, your account credentials may be
      compromised. Change your password immediately.
    </div>
    <div class="sig">— DEADNET S.Y.S</div>
  </div>
</body>
</html>"""


def _reset_text(callsign: str, reset_url: str) -> str:
    return (
        f"DEADNET — PASS CODE RESET\n\n"
        f"Callsign: {callsign}\n\n"
        f"A reset request was received for this operator account.\n\n"
        f"{reset_url}\n\n"
        f"This link expires in 1 hour. Single use — cannot be reused.\n\n"
        f"If you did not request this reset, your account may be compromised.\n\n"
        f"— DEADNET S.Y.S"
    )


def _already_registered_html(callsign: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{_BASE_STYLE}</style></head>
<body>
  <div class="wrap">
    <div class="logo">DEADNET</div>
    <div class="sub">REGISTRATION ATTEMPT DETECTED</div>
    <div class="label">CALLSIGN</div>
    <div class="call">{callsign}</div>
    <div class="body">
      Someone attempted to register a new account using your email address.<br>
      Your account already exists and was not modified.
    </div>
    <div class="note">
      If this was you, use the login page to access your account.<br>
      If this was not you, no action is required — your account is unchanged.
    </div>
    <div class="sig">— DEADNET S.Y.S</div>
  </div>
</body>
</html>"""


def _already_registered_text(callsign: str) -> str:
    return (
        f"DEADNET — REGISTRATION ATTEMPT DETECTED\n\n"
        f"Callsign: {callsign}\n\n"
        f"Someone attempted to register a new account using your email address.\n"
        f"Your account already exists and was not modified.\n\n"
        f"If this was you, use the login page to access your account.\n"
        f"If this was not you, no action is required.\n\n"
        f"— DEADNET S.Y.S"
    )


def _staff_verification_html(callsign: str, role: str, verify_url: str) -> str:
    role_label = role.capitalize()
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{_BASE_STYLE}</style></head>
<body>
  <div class="wrap">
    <div class="logo">DEADNET</div>
    <div class="sub">{role.upper()} ACCOUNT VERIFICATION</div>
    <div class="label">CALLSIGN</div>
    <div class="call">{callsign}</div>
    <div class="body">
      Your {role_label} account request has been received.<br>
      Click below to verify your email address and submit your request for admin approval.
    </div>
    <a class="btn" href="{verify_url}">VERIFY EMAIL ADDRESS</a>
    <div class="note">
      This link expires in <strong>24 hours</strong>.<br>
      After verification, your request will be reviewed by a DEADNET administrator.<br>
      You will receive an email notification once a decision has been made.
    </div>
    <div class="sig">— DEADNET S.Y.S</div>
  </div>
</body>
</html>"""


def _staff_verification_text(callsign: str, role: str, verify_url: str) -> str:
    return (
        f"DEADNET — {role.upper()} ACCOUNT VERIFICATION\n\n"
        f"Callsign: {callsign}\n\n"
        f"Your {role} account request has been received.\n"
        f"Click the link below to verify your email and submit your request.\n\n"
        f"{verify_url}\n\n"
        f"After verification, your request will be reviewed by an administrator.\n"
        f"You will be notified by email when a decision has been made.\n\n"
        f"This link expires in 24 hours.\n\n"
        f"— DEADNET S.Y.S"
    )


def _admin_notification_html(callsign: str, role: str, reason: str, email: str,
                             timestamp: str, console_url: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{_BASE_STYLE}</style></head>
<body>
  <div class="wrap">
    <div class="logo">DEADNET</div>
    <div class="sub">NEW REGISTRATION REQUEST</div>
    <div class="body">
      A new <strong>{role.upper()}</strong> registration request requires your approval.
    </div>
    <div class="label">CALLSIGN</div>
    <div class="call">{callsign}</div>
    <div class="label">EMAIL</div>
    <div class="call" style="font-size:13px">{email}</div>
    <div class="label">ROLE REQUESTED</div>
    <div class="call">{role.upper()}</div>
    <div class="label">REASON</div>
    <div class="body">"{reason}"</div>
    <div class="label">SUBMITTED</div>
    <div class="call" style="font-size:13px">{timestamp}</div>
    <a class="btn" href="{console_url}">REVIEW REQUEST</a>
    <div class="note">
      Log in to the DEADNET Admin Console to approve or deny this request.<br>
      Link directs to the COMMS tab.
    </div>
    <div class="sig">— DEADNET S.Y.S</div>
  </div>
</body>
</html>"""


def _admin_notification_text(callsign: str, role: str, reason: str, email: str,
                             timestamp: str, console_url: str) -> str:
    return (
        f"DEADNET — NEW {role.upper()} REGISTRATION REQUEST\n\n"
        f"A new {role} registration request requires your approval.\n\n"
        f"Callsign: {callsign}\n"
        f"Email: {email}\n"
        f"Role Requested: {role.upper()}\n"
        f"Reason: {reason}\n"
        f"Submitted: {timestamp}\n\n"
        f"Review request: {console_url}\n\n"
        f"Log in to the DEADNET Admin Console to approve or deny this request.\n\n"
        f"— DEADNET S.Y.S"
    )


def _approval_html(callsign: str, role: str, admin_response: str, login_url: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{_BASE_STYLE}</style></head>
<body>
  <div class="wrap">
    <div class="logo">DEADNET</div>
    <div class="sub">REGISTRATION APPROVED</div>
    <div class="label">CALLSIGN</div>
    <div class="call">{callsign}</div>
    <div class="body">
      Your <strong>{role.upper()}</strong> account has been approved.<br>
      You may now log in and complete your operator profile.
    </div>
    <div class="label">MESSAGE FROM ADMIN</div>
    <div class="body">"{admin_response}"</div>
    <a class="btn" href="{login_url}">ACCESS DEADNET</a>
    <div class="sig">— DEADNET S.Y.S</div>
  </div>
</body>
</html>"""


def _approval_text(callsign: str, role: str, admin_response: str, login_url: str) -> str:
    return (
        f"DEADNET — REGISTRATION APPROVED\n\n"
        f"Callsign: {callsign}\n\n"
        f"Your {role.upper()} account has been approved.\n"
        f"You may now log in and complete your operator profile.\n\n"
        f"Message from Admin: {admin_response}\n\n"
        f"Access DEADNET: {login_url}\n\n"
        f"— DEADNET S.Y.S"
    )


def _denial_html(callsign: str, role: str, admin_response: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{_BASE_STYLE}</style></head>
<body>
  <div class="wrap">
    <div class="logo">DEADNET</div>
    <div class="sub">REGISTRATION REQUEST DENIED</div>
    <div class="label">CALLSIGN</div>
    <div class="call">{callsign}</div>
    <div class="body">
      Your <strong>{role.upper()}</strong> registration request was not approved.
    </div>
    <div class="label">REASON</div>
    <div class="body">"{admin_response}"</div>
    <div class="note">
      If you believe this is an error, please contact your administrator directly.<br>
      This account has been scheduled for deletion.
    </div>
    <div class="sig">— DEADNET S.Y.S</div>
  </div>
</body>
</html>"""


def _denial_text(callsign: str, role: str, admin_response: str) -> str:
    return (
        f"DEADNET — REGISTRATION REQUEST DENIED\n\n"
        f"Callsign: {callsign}\n\n"
        f"Your {role.upper()} registration request was not approved.\n\n"
        f"Reason: {admin_response}\n\n"
        f"If you believe this is an error, please contact your administrator directly.\n"
        f"This account has been scheduled for deletion.\n\n"
        f"— DEADNET S.Y.S"
    )


# ---------------------------------------------------------------------------
# Public send functions (call inside BackgroundTasks)
# ---------------------------------------------------------------------------

async def send_verification_email(email: str, callsign: str, token: str) -> None:
    """Send account verification email. Errors are logged, never raised."""
    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    message = MessageSchema(
        subject="DEADNET — Verify Your Operator Account",
        recipients=[email],
        body=_verification_html(callsign, verify_url),
        subtype=MessageType.html,
        alternative_body=_verification_text(callsign, verify_url),
    )
    try:
        await _fast_mail.send_message(message)
    except Exception:
        logger.exception("Failed to send verification email to %s", email)


async def send_password_reset_email(email: str, callsign: str, token: str) -> None:
    """Send password reset email. Errors are logged, never raised."""
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    message = MessageSchema(
        subject="DEADNET — Pass Code Reset Request",
        recipients=[email],
        body=_reset_html(callsign, reset_url),
        subtype=MessageType.html,
        alternative_body=_reset_text(callsign, reset_url),
    )
    try:
        await _fast_mail.send_message(message)
    except Exception:
        logger.exception("Failed to send password reset email to %s", email)


async def send_staff_verification_email(email: str, callsign: str, role: str, token: str) -> None:
    """Send email verification for CONTRACTOR/HANDLER registration requests."""
    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    message = MessageSchema(
        subject=f"DEADNET — Verify your {role.capitalize()} Account Request",
        recipients=[email],
        body=_staff_verification_html(callsign, role, verify_url),
        subtype=MessageType.html,
        alternative_body=_staff_verification_text(callsign, role, verify_url),
    )
    try:
        await _fast_mail.send_message(message)
    except Exception:
        logger.exception("Failed to send staff verification email to %s", email)


async def send_admin_notification_email(admin_email: str, callsign: str, role: str,
                                        reason: str, email: str, timestamp: str) -> None:
    """Notify an admin of a new CONTRACTOR/HANDLER registration request."""
    console_url = f"{settings.FRONTEND_URL}/admin/dashboard?tab=comms"
    message = MessageSchema(
        subject=f"DEADNET — New {role.capitalize()} Registration Request",
        recipients=[admin_email],
        body=_admin_notification_html(callsign, role, reason, email, timestamp, console_url),
        subtype=MessageType.html,
        alternative_body=_admin_notification_text(callsign, role, reason, email, timestamp, console_url),
    )
    try:
        await _fast_mail.send_message(message)
    except Exception:
        logger.exception("Failed to send admin notification email to %s", admin_email)


async def send_approval_email(email: str, callsign: str, role: str, admin_response: str) -> None:
    """Notify CONTRACTOR/HANDLER their registration was approved."""
    login_url = f"{settings.FRONTEND_URL}/login"
    message = MessageSchema(
        subject="DEADNET — Registration Approved",
        recipients=[email],
        body=_approval_html(callsign, role, admin_response, login_url),
        subtype=MessageType.html,
        alternative_body=_approval_text(callsign, role, admin_response, login_url),
    )
    try:
        await _fast_mail.send_message(message)
    except Exception:
        logger.exception("Failed to send approval email to %s", email)


async def send_denial_email(email: str, callsign: str, role: str, admin_response: str) -> None:
    """Notify CONTRACTOR/HANDLER their registration was denied."""
    message = MessageSchema(
        subject="DEADNET — Registration Request Denied",
        recipients=[email],
        body=_denial_html(callsign, role, admin_response),
        subtype=MessageType.html,
        alternative_body=_denial_text(callsign, role, admin_response),
    )
    try:
        await _fast_mail.send_message(message)
    except Exception:
        logger.exception("Failed to send denial email to %s", email)


def _admin_invitation_html(callsign: str, organization_name: str, activate_url: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{_BASE_STYLE}</style></head>
<body>
  <div class="wrap">
    <div class="logo">DEADNET</div>
    <div class="sub">ADMIN ACCESS GRANTED</div>
    <div class="label">ORGANIZATION</div>
    <div class="call">{organization_name}</div>
    <div class="label">CALLSIGN</div>
    <div class="call">{callsign}</div>
    <div class="body">
      You have been granted administrator access to DEADNET for <strong>{organization_name}</strong>.<br>
      Click below to set your password and activate your account.
    </div>
    <a class="btn" href="{activate_url}">ACTIVATE ADMIN ACCOUNT</a>
    <div class="note">
      This link expires in <strong>72 hours</strong>.<br>
      Single use only.<br><br>
      Once activated you can log in at the DEADNET login page.
    </div>
    <div class="sig">— DEADNET SYSTEM / s0L</div>
  </div>
</body>
</html>"""


def _admin_invitation_text(callsign: str, organization_name: str, activate_url: str) -> str:
    return (
        f"DEADNET — ADMIN ACCESS GRANTED\n\n"
        f"Organization: {organization_name}\n"
        f"Callsign: {callsign}\n\n"
        f"You have been granted administrator access to DEADNET for {organization_name}.\n"
        f"Click the link below to set your password and activate your account.\n\n"
        f"{activate_url}\n\n"
        f"This link expires in 72 hours. Single use only.\n\n"
        f"— DEADNET SYSTEM / s0L"
    )


async def send_admin_invitation_email(email: str, callsign: str, organization_name: str, token: str) -> None:
    """Send Admin account activation invitation (Architect-created accounts)."""
    from app.config import settings as _s
    activate_url = f"{_s.FRONTEND_URL}/admin/activate?token={token}"
    message = MessageSchema(
        subject=f"DEADNET — You have been granted Admin access for {organization_name}",
        recipients=[email],
        body=_admin_invitation_html(callsign, organization_name, activate_url),
        subtype=MessageType.html,
        alternative_body=_admin_invitation_text(callsign, organization_name, activate_url),
    )
    try:
        await _fast_mail.send_message(message)
    except Exception:
        logger.exception("Failed to send admin invitation email to %s", email)


async def send_test_email(to_email: str) -> bool:
    """Send a test email to verify SMTP configuration. Returns True on success, False on failure."""
    html = """<html><body style="margin:0;padding:40px;background:#0A0A0F;font-family:'Courier New',monospace;color:#F0F0F0">
<p style="color:#FF4500;font-size:22px;font-weight:bold;letter-spacing:6px">DEADNET</p>
<p style="color:#6B6B80;font-size:11px;letter-spacing:4px;margin-bottom:28px">SMTP TEST</p>
<p>This is a test email sent from the DEADNET Architect Console.</p>
<p>If you received this, your SMTP configuration is working correctly.</p>
<p style="color:#6B6B80;margin-top:28px;font-size:11px;letter-spacing:3px">— DEADNET SYSTEM / s0L</p>
</body></html>"""
    try:
        message = MessageSchema(
            subject="DEADNET — SMTP Test",
            recipients=[to_email],
            body=html,
            subtype=MessageType.html,
        )
        await _fast_mail.send_message(message)
        return True
    except Exception:
        logger.exception("Test email to %s failed", to_email)
        return False


async def send_already_registered_email(email: str, callsign: str) -> None:
    """Send enumeration-protection notice to existing account. Errors logged only."""
    message = MessageSchema(
        subject="DEADNET — Registration Attempt on Your Account",
        recipients=[email],
        body=_already_registered_html(callsign),
        subtype=MessageType.html,
        alternative_body=_already_registered_text(callsign),
    )
    try:
        await _fast_mail.send_message(message)
    except Exception:
        logger.exception("Failed to send already-registered email to %s", email)
