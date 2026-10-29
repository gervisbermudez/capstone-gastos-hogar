"""Analista: lee el libro de montos y calcula. No busca en el texto de la factura.

La calculadora recorre un árbol sintáctico. No llama a eval ni a exec.
"""

from __future__ import annotations

import ast
import logging
import operator as op
from datetime import datetime
from typing import Literal

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..periodo import PERIODO as _PERIODO
from ..state import AgentState, contexto_turno, pregunta_actual
from ..supervisor import es_comparacion
from .bucle import correr_async, hogar_del_turno, usuario_del_turno
from .libro import consultar_gastos_usuario, formatear_gastos
from .mensajes import lineas_tool, ultima_respuesta

logger = logging.getLogger(__name__)

_OPERADORES = {
    ast.Add: op.add,
    ast.Sub: op.sub,
    ast.Mult: op.mul,
    ast.Div: op.truediv,
    ast.USub: op.neg,
}

_reemplazo = None

_MESES = (
    "enero=01, febrero=02, marzo=03, abril=04, mayo=05, junio=06, "
    "julio=07, agosto=08, septiembre=09, octubre=10, noviembre=11, diciembre=12"
)


def _evaluar_nodo(nodo: ast.AST):
    if isinstance(nodo, ast.Constant) and isinstance(nodo.value, (int, float)):
        return nodo.value
    if isinstance(nodo, ast.BinOp) and type(nodo.op) in _OPERADORES:
        return _OPERADORES[type(nodo.op)](
            _evaluar_nodo(nodo.left),
            _evaluar_nodo(nodo.right),
        )
    if isinstance(nodo, ast.UnaryOp) and type(nodo.op) in _OPERADORES:
        return _OPERADORES[type(nodo.op)](_evaluar_nodo(nodo.operand))
    raise ValueError("Expresión no permitida")


class Expresion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expresion: str = Field(description="Aritmética con + - * / y paréntesis. No es código.")


class ResultadoGastos(BaseModel):
    """Lo que la tool le muestra al modelo. El ``user_id`` no está."""

    model_config = ConfigDict(extra="ignore")

    total: str
    promedio: str
    cantidad: int
    texto: str


class ConsultaGastosInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    categoria: Literal["servicios", "expensas", "alquiler"] | None = None
    periodo_desde: str | None = Field(default=None, description="YYYY-MM inclusive, o vacío")
    periodo_hasta: str | None = Field(default=None, description="YYYY-MM inclusive, o vacío")
    proveedor: str | None = None

    @field_validator("periodo_desde", "periodo_hasta")
    @classmethod
    def periodo_ok(cls, valor: str | None) -> str | None:
        if valor is None or valor == "":
            return None
        if _PERIODO.fullmatch(valor) is None:
            raise ValueError("El período tiene que ser YYYY-MM")
        return valor


@tool(args_schema=Expresion)
def calculadora(expresion: str) -> str:
    """Evalúa una expresión aritmética (+, -, *, /, paréntesis).
    Ejemplo: '22000.00 - 18000.00'. No ejecuta código ni potencias."""
    try:
        arbol = ast.parse(expresion, mode="eval")
        resultado = _evaluar_nodo(arbol.body)
        return f"Resultado: {resultado}"
    except Exception as exc:
        return f"Error al calcular '{expresion}': {exc}"


@tool(args_schema=ConsultaGastosInput)
async def consultar_gastos(
    categoria: str | None = None,
    periodo_desde: str | None = None,
    periodo_hasta: str | None = None,
    proveedor: str | None = None,
) -> str:
    """Suma y promedio de los comprobantes confirmados de este hogar.
    Sirve para cuánto pagó y para comparar períodos. No lee el texto de la factura.
    El usuario y el hogar ya están fijados: no los pases."""
    user_id = usuario_del_turno.get()
    if not user_id:
        return "Error al consultar el libro de gastos."
    try:
        datos = await consultar_gastos_usuario(
            user_id=user_id,
            hogar_id=hogar_del_turno.get(),
            categoria=categoria,
            periodo_desde=periodo_desde,
            periodo_hasta=periodo_hasta,
            proveedor=proveedor,
        )
        texto = formatear_gastos(datos)
        modelo = ResultadoGastos(
            total=str(datos.get("total", "0.00")),
            promedio=str(datos.get("promedio", "0.00")),
            cantidad=int(datos.get("cantidad") or 0),
            texto=texto,
        )
        return modelo.texto
    except Exception as exc:
        logger.warning("consultar_gastos falló (%s).", type(exc).__name__)
        return "Error al consultar el libro de gastos."


def _instruccion() -> str:
    anio = datetime.now().year
    return (
        f"Año si la pregunta no lo trae: {anio}. Meses: {_MESES}. "
        "Consultá el libro con consultar_gastos. No busques el texto de la factura "
        "y no pases user_id ni hogar_id. Categorías: servicios, expensas, alquiler. "
        "Luz, gas, agua, internet y teléfono son servicios: no uses proveedor 'luz'. "
        "Expensas es expensas. Alquiler es alquiler. "
        "Un mes se consulta con periodo_desde y periodo_hasta en ese YYYY-MM. "
        "Para comparar dos períodos, un consultar_gastos con el rango y después "
        "la calculadora con la resta. La calculadora solo acepta aritmética. "
        "Incluí la línea Total: del libro y, si restaste, la línea Resultado:."
    )


def _agente_analista():
    """Un agente nuevo por llamada.

    El loop del hilo queda abierto entre nodos. Un cliente HTTP no debe
    sobrevivir a un loop cerrado. Los tests pueden dejar un doble en
    ``_reemplazo``; en producción queda en None.
    """
    if _reemplazo is not None:
        return _reemplazo
    from ..llm import armar_llm

    return create_agent(
        model=armar_llm(),
        tools=[consultar_gastos, calculadora],
        system_prompt=(
            "Sos el analista de gastos del hogar. Consultás el libro de montos "
            "con consultar_gastos y, si hay que restar o sumar, la calculadora. "
            "NO leés el texto de las facturas y NO inventás cifras que la tool "
            "no haya devuelto. El user_id y el hogar_id no son argumentos. "
            "La respuesta tiene que incluir la línea Total: y, si calculaste, "
            "la línea Resultado:."
        ),
    )


def nodo_analista(state: AgentState) -> dict:
    """Consulta el libro de este hogar y, si hace falta, resta con la calculadora."""

    async def _correr() -> dict:
        token = usuario_del_turno.set(state.get("user_id") or "")
        token_hogar = hogar_del_turno.set(str(state.get("hogar_id") or ""))
        try:
            tarea = contexto_turno(state, _instruccion())
            return await _agente_analista().ainvoke({"messages": [HumanMessage(content=tarea)]})
        finally:
            hogar_del_turno.reset(token_hogar)
            usuario_del_turno.reset(token)

    resultado = correr_async(_correr())
    mensajes = resultado["messages"]
    respuesta = ultima_respuesta(mensajes)
    for nombre in ("consultar_gastos", "calculadora"):
        for linea in lineas_tool(mensajes, nombre):
            if linea not in respuesta:
                respuesta = respuesta.rstrip() + "\n" + linea
    if "total:" not in respuesta.lower():
        respuesta = respuesta.rstrip() + "\nNo llamó a consultar_gastos."
    if es_comparacion(pregunta_actual(state)) and "resultado:" not in respuesta.lower():
        respuesta = respuesta.rstrip() + "\nNo llamó a la calculadora."
    return {
        "messages": [AIMessage(content=respuesta, name="analista")],
        "contribuciones": [{"agente": "analista", "aporte": respuesta}],
        "pasos": state.get("pasos", 0) + 1,
    }
