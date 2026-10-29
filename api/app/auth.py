"""Hash Argon2id y JWT HS256. El claim del usuario se llama ``sub``."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import repositorio

VIDA_TOKEN_SEGUNDOS = 900
_ALGORITMO = "HS256"
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, type=Type.ID)
_portador = HTTPBearer(auto_error=False)
_hash_falso: str | None = None
_NO_AUTENTICADO = {"WWW-Authenticate": "Bearer"}


def hashear(password: str) -> str:
    return _hasher.hash(password)


def hash_falso() -> str:
    """Hash fijo para verificar aunque el email no exista."""
    global _hash_falso
    if _hash_falso is None:
        _hash_falso = hashear("placeholder-no-es-una-contraseña")
    return _hash_falso


def verificar(password: str, password_hash: str) -> bool:
    try:
        return bool(_hasher.verify(password_hash, password))
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _secreto() -> str:
    secreto = os.getenv("JWT_SECRET", "").strip()
    if not secreto:
        raise RuntimeError("Falta JWT_SECRET")
    return secreto


def emitir_token(user_id: str) -> str:
    ahora = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": ahora,
        "exp": ahora + timedelta(seconds=VIDA_TOKEN_SEGUNDOS),
    }
    return jwt.encode(payload, _secreto(), algorithm=_ALGORITMO)


def usuario_de_saludo(crudo: str) -> str | None:
    """User id del primer mensaje del WebSocket. None si no es un token válido."""
    try:
        datos = json.loads(crudo)
    except json.JSONDecodeError:
        return None
    if not isinstance(datos, dict):
        return None
    token = datos.get("token")
    if not isinstance(token, str) or not token.strip():
        return None
    return leer_user_id(token.strip())


def leer_user_id(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token,
            _secreto(),
            algorithms=[_ALGORITMO],
            options={"require": ["sub", "exp"]},
        )
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        return None
    return sub


async def usuario_actual(
    credenciales: HTTPAuthorizationCredentials | None = Depends(_portador),
) -> dict:
    """Usuario del token, o 401. No responde 403."""
    if credenciales is None or credenciales.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="No autenticado", headers=_NO_AUTENTICADO)
    user_id = leer_user_id(credenciales.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="No autenticado", headers=_NO_AUTENTICADO)
    usuario = await repositorio.buscar_usuario_por_id(user_id)
    if usuario is None:
        raise HTTPException(status_code=401, detail="No autenticado", headers=_NO_AUTENTICADO)
    return {"user_id": usuario["user_id"], "email": usuario["email"]}
