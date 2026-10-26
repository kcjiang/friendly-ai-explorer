"""Fresh-install KDF isolation, authentication and root-key rotation."""

import unittest
from unittest.mock import patch

from cryptography.fernet import InvalidToken
from jose import JWTError, jwt
from pydantic import ValidationError

from app.config import Settings, settings
from app.middleware.auth import create_access_token
from app.security import credential_cipher, derive_key


class EncryptionTests(unittest.TestCase):
    def test_weak_root_is_rejected_without_exposing_its_value(self):
        with self.assertRaises(ValidationError) as raised:
            Settings(
                database_url="postgresql://unused",
                app_master_key="short-secret",
                _env_file=None,
            )
        self.assertNotIn("short-secret", str(raised.exception))

    def test_all_purposes_are_stable_and_separate(self):
        with patch.object(settings, "app_master_key", "a" * 64):
            keys = [
                derive_key(purpose) for purpose in ("jwt", "ai", "platform", "mail")
            ]
            self.assertEqual(len(set(keys)), 4)
            self.assertTrue(all(len(key) == 32 for key in keys))
            for purpose in ("ai", "platform", "mail"):
                token = credential_cipher(purpose).encrypt(b"test credential")
                self.assertEqual(
                    credential_cipher(purpose).decrypt(token), b"test credential"
                )
                for other in ("ai", "platform", "mail"):
                    if other != purpose:
                        with self.assertRaises(InvalidToken):
                            credential_cipher(other).decrypt(token)

    def test_rotation_rejects_old_ciphertext_and_tokens(self):
        with patch.object(settings, "app_master_key", "a" * 64):
            token = create_access_token({"sub": "test-user"})
            encrypted = credential_cipher("mail").encrypt(b"test credential")
            self.assertEqual(
                jwt.decode(
                    token, derive_key("jwt"), algorithms=[settings.jwt_algorithm]
                )["sub"],
                "test-user",
            )
            with self.assertRaises(JWTError):
                jwt.decode(
                    token, settings.app_master_key, algorithms=[settings.jwt_algorithm]
                )
        with patch.object(settings, "app_master_key", "b" * 64):
            with self.assertRaises(InvalidToken):
                credential_cipher("mail").decrypt(encrypted)
            with self.assertRaises(JWTError):
                jwt.decode(
                    token, derive_key("jwt"), algorithms=[settings.jwt_algorithm]
                )

    def test_encryption_is_randomized_and_authenticated(self):
        token = credential_cipher("ai").encrypt(b"test credential")
        self.assertNotEqual(token, credential_cipher("ai").encrypt(b"test credential"))
        with self.assertRaises(InvalidToken):
            credential_cipher("ai").decrypt(token[:-8] + b"AAAAAAAA")
