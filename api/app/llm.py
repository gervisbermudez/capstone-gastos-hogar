"""Modelo de chat. OpenAI por defecto; Gemini si ``LLM_PROVIDER=gemini``."""

from __future__ import annotations

import os

from langchain_core.language_models.chat_models import BaseChatModel


def _nombre_modelo(variable: str) -> str:
    nombre = os.getenv(variable, "").strip()
    if not nombre:
        raise RuntimeError(f"Falta {variable} en el entorno.")
    return nombre


def armar_llm() -> BaseChatModel:
    proveedor = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if proveedor == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=_nombre_modelo("GEMINI_MODEL"), temperature=0)

    from langchain_openai import ChatOpenAI

    return ChatOpenAI(model=_nombre_modelo("OPENAI_MODEL"), temperature=0)
