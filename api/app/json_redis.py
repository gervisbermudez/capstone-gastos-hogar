"""JSON guardado en Redis. Un valor roto se trata como ausente."""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


def decodificar(crudo: object, *, contexto: str) -> dict | None:
    """Objeto JSON, o None si falta, no es texto o no es un objeto."""
    if crudo is None or crudo == "":
        return None
    if isinstance(crudo, bytes):
        try:
            crudo = crudo.decode()
        except UnicodeDecodeError:
            logger.warning("Valor de Redis ilegible en %s", contexto)
            return None
    if not isinstance(crudo, str):
        logger.warning("Valor de Redis ilegible en %s", contexto)
        return None
    try:
        dato = json.loads(crudo)
    except json.JSONDecodeError:
        logger.warning("JSON inválido en %s", contexto)
        return None
    if not isinstance(dato, dict):
        logger.warning("JSON que no es un objeto en %s", contexto)
        return None
    return dato
