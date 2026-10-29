"""Lectura de la última respuesta y de las líneas de tool de un agente."""

from __future__ import annotations

from langchain_core.messages import AIMessage, ToolMessage

from ..texto import extraer_texto


def ultima_respuesta(mensajes: list) -> str:
    """Texto del último ``AIMessage``. Si no hay, el del último mensaje."""
    for mensaje in reversed(mensajes):
        if isinstance(mensaje, AIMessage):
            return extraer_texto(mensaje)
    return extraer_texto(mensajes[-1]) if mensajes else ""


def lineas_tool(mensajes: list, nombre: str | None) -> list[str]:
    """Textos de las tools con ese nombre. ``None`` toma todas."""
    lineas: list[str] = []
    for mensaje in mensajes:
        if isinstance(mensaje, ToolMessage) and (mensaje.name == nombre or nombre is None):
            texto = extraer_texto(mensaje)
            if texto:
                lineas.append(texto)
    return lineas
