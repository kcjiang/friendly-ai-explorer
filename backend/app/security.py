"""Domain-separated keys for tokens and encrypted credentials on fresh installs."""

import base64
from typing import Literal

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings

Purpose = Literal["jwt", "ai", "platform", "mail"]


def derive_key(purpose: Purpose) -> bytes:
    if purpose not in ("jwt", "ai", "platform", "mail"):
        raise ValueError("Unknown encryption purpose")
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"friendly-ai-explorer/key-derivation/v1",
        info=("fae/v1/" + purpose).encode(),
    ).derive(settings.app_master_key.encode())


def credential_cipher(purpose: Literal["ai", "platform", "mail"]) -> Fernet:
    if purpose == "jwt":
        raise ValueError("JWT signing keys cannot encrypt credentials")
    return Fernet(base64.urlsafe_b64encode(derive_key(purpose)))


def encrypt_credential(value: str, purpose: Literal["ai", "platform", "mail"]) -> str:
    return credential_cipher(purpose).encrypt(value.encode()).decode()


def decrypt_credential(value: str, purpose: Literal["ai", "platform", "mail"]) -> str:
    return credential_cipher(purpose).decrypt(value.encode()).decode()
