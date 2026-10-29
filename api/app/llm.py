"""Modelo de chat. OpenAI por defecto; Gemini si ``LLM_PROVIDER=gemini``."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.outputs import ChatResult
from pydantic import BaseModel

from .texto import extraer_texto, objeto_json

logger = logging.getLogger(__name__)

# ``with_structured_output`` fuerza una herramienta concreta. ``auto`` y
# ``required`` son modos del agente, no el nombre de un esquema.
_MODOS_TOOL = {"auto", "none", "required", "any"}


def describir_modelo() -> dict[str, str | None]:
    """Proveedor y modelo del entorno. No arma el cliente ni lee claves.

    ``LLM_PROVIDER`` vale ``gemini`` solo en ese caso. Cualquier otro valor,
    incluido el default, usa ``OPENAI_MODEL``. El modelo vacío queda en null.
    """
    crudo = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if crudo == "gemini":
        proveedor = "gemini"
        variable = "GEMINI_MODEL"
    else:
        proveedor = "openai"
        variable = "OPENAI_MODEL"
    modelo = os.getenv(variable, "").strip()
    return {"proveedor": proveedor, "modelo": modelo or None}


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


def _nombre_tool(tool_choice: object) -> str:
    """Nombre de la herramienta forzada. Un modo genérico no cuenta."""
    if isinstance(tool_choice, str):
        return "" if tool_choice in _MODOS_TOOL else tool_choice
    if isinstance(tool_choice, dict):
        funcion = tool_choice.get("function")
        if isinstance(funcion, dict) and isinstance(funcion.get("name"), str):
            nombre = funcion["name"]
            return "" if nombre in _MODOS_TOOL else nombre
    return ""


def _preparar_pedido(kwargs: dict) -> tuple[object, dict, str]:
    """Saca el esquema del pedido para parsearlo acá, no en el SDK."""
    schema = kwargs.get("response_format")
    tool = _nombre_tool(kwargs.get("tool_choice"))
    if not _es_modelo(schema):
        return None, kwargs, tool
    return schema, {**kwargs, "response_format": _formato_sin_parseo(schema)}, tool


def _sin_json(resultado: ChatResult) -> bool:
    """No hay tool call ni un objeto JSON después de sacar el pensamiento."""
    mensaje = resultado.generations[0].message
    if getattr(mensaje, "tool_calls", None):
        return False
    try:
        objeto_json(extraer_texto(mensaje))
    except ValueError:
        return True
    return False


def _debe_reintentar(resultado: ChatResult, schema: object, tool: str) -> bool:
    if schema is None and not tool:
        return False
    return _sin_json(resultado)


def _volcar_json(resultado: ChatResult, tool: str) -> None:
    """Si el JSON quedó en el texto, lo deja como tool call para el parser."""
    mensaje = resultado.generations[0].message
    if getattr(mensaje, "tool_calls", None):
        return
    try:
        texto = objeto_json(extraer_texto(mensaje))
        datos = json.loads(texto)
    except (ValueError, json.JSONDecodeError):
        return
    if not isinstance(datos, dict):
        return
    mensaje.tool_calls = [
        {"name": tool, "args": datos, "id": "canal-json", "type": "tool_call"}
    ]


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


def _cerrar_resultado(resultado: ChatResult, schema: object, tool: str) -> ChatResult:
    resultado = _limpiar_resultado(resultado, schema)
    if tool:
        _volcar_json(resultado, tool)
    return resultado


def _anotar_reintento(resultado: ChatResult, schema: object, tool: str) -> bool:
    if not _debe_reintentar(resultado, schema, tool):
        return False
    logger.warning("El modelo no devolvió JSON. Se reintenta una vez.")
    return True


def armar_llm() -> BaseChatModel:
    """Cliente del proveedor de ``LLM_PROVIDER``.

    OpenAI arma un ``httpx.AsyncClient`` propio. El singleton de LangChain
    queda atado al loop de FastAPI y el worker, en otro hilo, hereda ese pool.
    """
    proveedor = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if proveedor == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=_nombre_modelo("GEMINI_MODEL"), temperature=0)

    import httpx
    from langchain_openai import ChatOpenAI

    if _ChatOpenAI is None:
        _crear_chat(ChatOpenAI)
    assert _ChatOpenAI is not None
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
            schema, pedido, tool = _preparar_pedido(kwargs)

            def pedir():
                return super(ChatConCanal, self)._generate(
                    messages, stop=stop, run_manager=run_manager, **pedido
                )

            resultado = pedir()
            if _anotar_reintento(resultado, schema, tool):
                resultado = pedir()
            return _cerrar_resultado(resultado, schema, tool)

        async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
            schema, pedido, tool = _preparar_pedido(kwargs)

            async def pedir():
                return await super(ChatConCanal, self)._agenerate(
                    messages, stop=stop, run_manager=run_manager, **pedido
                )

            resultado = await pedir()
            if _anotar_reintento(resultado, schema, tool):
                resultado = await pedir()
            return _cerrar_resultado(resultado, schema, tool)

    _ChatOpenAI = ChatConCanal
