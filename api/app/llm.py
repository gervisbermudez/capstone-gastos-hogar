"""Modelo de chat. OpenAI por defecto; Gemini si ``LLM_PROVIDER=gemini``."""

from __future__ import annotations

import os
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.outputs import ChatResult
from pydantic import BaseModel

from .texto import extraer_texto, objeto_json


def _nombre_modelo(variable: str) -> str:
    nombre = os.getenv(variable, "").strip()
    if not nombre:
        raise RuntimeError(f"Falta {variable} en el entorno.")
    return nombre


def _es_modelo(schema: object) -> bool:
    return isinstance(schema, type) and issubclass(schema, BaseModel)


def _formato_sin_parseo(schema: type[BaseModel]) -> dict[str, Any]:
    """Dict de JSON Schema. El SDK no valida el texto si el formato no es una clase.

    ``with_structured_output`` manda la clase y el cliente hace
    ``model_validate_json`` sobre el contenido crudo. Un modelo local que
    antepone ``<|channel>thought`` rompe ese parseo antes de que lleguemos
    al JSON.
    """
    from langchain_core.utils.function_calling import convert_to_openai_function

    funcion = convert_to_openai_function(schema)
    funcion["schema"] = funcion.pop("parameters")
    return {"type": "json_schema", "json_schema": funcion}


def _limpiar_resultado(resultado: ChatResult, schema: object) -> ChatResult:
    mensaje = resultado.generations[0].message
    visible = extraer_texto(mensaje)
    if _es_modelo(schema):
        modelo = schema
        assert isinstance(modelo, type)
        json_texto = objeto_json(visible)
        mensaje.additional_kwargs["parsed"] = modelo.model_validate_json(json_texto)
        mensaje.content = json_texto
    elif isinstance(mensaje.content, str) and mensaje.content != visible:
        mensaje.content = visible
    return resultado


def armar_llm() -> BaseChatModel:
    proveedor = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if proveedor == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=_nombre_modelo("GEMINI_MODEL"), temperature=0)

    import httpx
    from langchain_openai import ChatOpenAI

    if _ChatOpenAI is None:
        _crear_chat(ChatOpenAI)
    assert _ChatOpenAI is not None
    # El cliente async por defecto de LangChain es un singleton. La extracción
    # lo usa en el loop de FastAPI y el worker, en otro hilo, hereda ese pool:
    # el primer job falla con "bound to a different event loop".
    return _ChatOpenAI(
        model=_nombre_modelo("OPENAI_MODEL"),
        temperature=0,
        http_async_client=httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)),
    )


_ChatOpenAI = None


def _crear_chat(base: type) -> None:
    global _ChatOpenAI

    class ChatConCanal(base):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            schema = kwargs.get("response_format")
            if _es_modelo(schema):
                kwargs = {**kwargs, "response_format": _formato_sin_parseo(schema)}
            return _limpiar_resultado(
                super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs),
                schema,
            )

        async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
            schema = kwargs.get("response_format")
            if _es_modelo(schema):
                kwargs = {**kwargs, "response_format": _formato_sin_parseo(schema)}
            return _limpiar_resultado(
                await super()._agenerate(
                    messages, stop=stop, run_manager=run_manager, **kwargs
                ),
                schema,
            )

    _ChatOpenAI = ChatConCanal
