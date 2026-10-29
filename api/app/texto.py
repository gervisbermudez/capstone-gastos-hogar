"""Texto plano para mensajes y el contexto que ve cada especialista."""

from __future__ import annotations

import re
from typing import Any

from langchain_core.messages import BaseMessage

from .state import AgentState

_CITA_COMPROBANTE = re.compile(
    r"^\[comprobante [0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    r"(?:\s*\|[^\]]*)?\]\s*",
    re.IGNORECASE,
)


def sin_cita_comprobante(texto: str) -> str:
    """Saca la ficha que el chat antepone a la pregunta. El resto queda igual."""
    return _CITA_COMPROBANTE.sub("", texto or "", count=1)


def separar_canal(texto: str) -> str:
    """Saca el razonamiento que algunos modelos locales anteponen a la respuesta.

    Gemma, vía un servidor compatible con OpenAI, escribe
    ``<|channel>thought...`` y cierra con ``<channel|>`` antes del JSON
    o del texto que hay que usar. Sin esa marca, el texto vuelve igual.
    """
    if "<|channel>thought" not in texto and "<channel|>" not in texto:
        return texto
    if "<channel|>" in texto:
        return texto.split("<channel|>")[-1].strip()
    return ""


def objeto_json(texto: str) -> str:
    """El primer objeto JSON balanceado. Tolera texto antes o después."""
    inicio = texto.find("{")
    if inicio < 0:
        raise ValueError("La respuesta no trae un objeto JSON")
    profundidad = 0
    en_cadena = False
    escape = False
    for indice, caracter in enumerate(texto[inicio:], start=inicio):
        if en_cadena:
            if escape:
                escape = False
            elif caracter == "\\":
                escape = True
            elif caracter == '"':
                en_cadena = False
            continue
        if caracter == '"':
            en_cadena = True
        elif caracter == "{":
            profundidad += 1
        elif caracter == "}":
            profundidad -= 1
            if profundidad == 0:
                return texto[inicio : indice + 1]
    raise ValueError("La respuesta no trae un objeto JSON cerrado")


def extraer_texto(contenido: Any) -> str:
    """Gemini a veces devuelve una lista de bloques en vez de un string."""
    if contenido is None:
        return ""
    if isinstance(contenido, BaseMessage):
        return extraer_texto(contenido.content)
    if isinstance(contenido, str):
        return separar_canal(contenido)
    if isinstance(contenido, list):
        partes: list[str] = []
        for bloque in contenido:
            if isinstance(bloque, str):
                partes.append(bloque)
            elif isinstance(bloque, dict):
                partes.append(str(bloque.get("text") or ""))
        return separar_canal("".join(partes).strip())
    return separar_canal(str(contenido).strip())


def contexto_acotado(state: AgentState, instruccion: str) -> str:
    """Pasa la tarea y los aportes ya hechos. No pasa metadata del grafo.

    El especialista no ve ``pasos``, ``next_agent`` ni el historial crudo.
    """
    mensajes = state.get("messages") or []
    pregunta = extraer_texto(mensajes[0]) if mensajes else ""
    bloques = [f"Tarea original:\n{pregunta}"]

    aportes = state.get("contribuciones") or []
    if aportes:
        lineas = [f"- [{c['agente']}] {c['aporte']}" for c in aportes]
        bloques.append("Aportes ya registrados:\n" + "\n".join(lineas))

    bloques.append(f"Tu instrucción:\n{instruccion}")
    return "\n\n".join(bloques)
