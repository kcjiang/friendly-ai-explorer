"""Terminal command catalogs are ordinary storage files."""

import hashlib
import io
import json
import uuid
from typing import Literal

from fastapi import HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationError, field_validator, model_validator

from app.i18n import message as system_message
from app.models.user import UserRole
from app.services import storage_service as storage


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    command: str = Field(min_length=1, max_length=100_000)
    group: str = Field(default="General", max_length=100)
    confirmBeforeRun: StrictBool = False


    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("Name cannot be blank")
        return value.strip()


class Catalog(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    transport: Literal["adb", "serial"]
    commands: list[Command] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [item.id for item in self.commands]
        if len(ids) != len(set(ids)):
            raise ValueError("Command IDs must be unique")
        return self


class SaveCatalog(BaseModel):
    catalog: Catalog
    revision: str
    space: Literal["public", "personal"] = "public"


def catalog_path(transport):
    if transport not in ("adb", "serial"):
        raise HTTPException(400, "Unsupported transport")
    folder = "ADB" if transport == "adb" else "Serial"
    return f"Commands/{folder}/{transport}_cmd_default.json"


def read_catalog(transport, space="public"):
    target = storage.disk_path(space, catalog_path(transport))
    if not target.exists():
        return Catalog(transport=transport), "missing"
    if not target.is_file() or target.stat().st_size > 2_000_000:
        raise HTTPException(422, system_message("errors.commandFileTooLarge"))
    raw = target.read_bytes()
    revision = hashlib.sha256(raw).hexdigest()
    try:
        data = json.loads(raw.decode("utf-8-sig"))
        catalog = Catalog.model_validate(data)
        if catalog.transport != transport:
            raise ValueError("transport: does not match the file path")
    except (UnicodeError, ValueError, TypeError, KeyError) as exc:
        if isinstance(exc, json.JSONDecodeError):
            reason = f"JSON: line {exc.lineno}, column {exc.colno}"
        elif isinstance(exc, ValidationError):
            reason = "; ".join(
                f"{'.'.join(map(str, item['loc'])) or 'catalog'}: {item['type']}"
                for item in exc.errors(include_input=False)[:5]
            )
            if "Command IDs must be unique" in str(exc):
                reason = "commands.id: duplicate IDs"
        else:
            reason = "UTF-8 required" if isinstance(exc, UnicodeError) else str(exc)
        raise HTTPException(422, system_message(
            "errors.commandFileDetail", path=catalog_path(transport), reason=reason
        )) from exc
    return catalog, revision


async def load(db, transport, user, space="public"):
    await storage.lock(db)
    catalog, revision = read_catalog(transport, storage.personal(user) if space == "personal" else "public")
    await db.commit()
    return {"catalog": catalog, "revision": revision, "exists": revision != "missing", "path": catalog_path(transport)}


async def save(db, user, body):
    if body.space == "public" and user.role != UserRole.developer:
        raise HTTPException(403, system_message("errors.onlyDevelopersCanEditPublicCommands"))
    space = storage.personal(user) if body.space == "personal" else "public"
    transport = body.catalog.transport
    await storage.lock(db)
    _, revision = read_catalog(transport, space)
    if body.revision != revision:
        raise HTTPException(409, system_message("errors.commandFileChanged"))
    value = (body.catalog.model_dump_json(indent=2) + "\n").encode("utf-8")
    if len(value) > 2_000_000:
        raise HTTPException(413, system_message("errors.commandFileTooLarge"))
    path = catalog_path(transport)
    target = storage.disk_path(space, path)
    if target.exists():
        entry = await storage.register(db, space, path, user)
        await storage.write_text(db, user, entry, value.decode("utf-8"))
    else:
        parent = ""
        for name in path.split("/")[:-1]:
            if not storage.disk_path(space, "/".join(filter(None, [parent, name]))).exists():
                await storage.create_folder(db, user, space, parent, name, "skip")
            parent = "/".join(filter(None, [parent, name]))
        staged, count, digest = await storage.stage_upload(
            UploadFile(filename=target.name, file=io.BytesIO(value)), db=db
        )
        created = None
        try:
            created = await storage.commit_upload(db, user, space, parent, target.name,
                                        staged, count, digest, "skip")
            await db.commit()
        except BaseException:
            # The file was published before the DB commit; undo failed publication.
            if created is not None:
                storage.disk_path(created.space, created.path).unlink(missing_ok=True)
            raise
        finally:
            staged.unlink(missing_ok=True)
    return {"catalog": body.catalog, "revision": hashlib.sha256(value).hexdigest()}
