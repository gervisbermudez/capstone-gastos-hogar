"""Investigador: lee el texto de los comprobantes. No calcula ni abre el libro."""

from __future__ import annotations

from typing import Literal

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..periodo import PERIODO as _PERIODO
from ..rag import buscar
from ..state import AgentState, contexto_turno
from .bucle import correr_async, usuario_del_turno
from .mensajes import lineas_tool, ultima_respuesta

_reemplazo = None

_INSTRUCCION = (
    "Buscá en el texto de los comprobantes con buscar_comprobantes. "
    "No calcules totales y no pases user_id: el sistema ya filtra por la persona. "
    "Alquiler es categoria alquiler. Expensas es expensas. "
    "Luz, gas, agua, internet o teléfono es categoria servicios. "
    "Si la pregunta nombra un período, pasalo como YYYY-MM. "
    "Citá el fragmento con la marca [comprobante] que devuelve la herramienta. "
    "Si no hay fragmento, decí que no se encontró y no inventes cláusulas."
)


class Fragmento(BaseModel):
    model_config = ConfigDict(extra="ignore")

    contenido: str
    documento_id: str
    categoria: str
    periodo: str
    proveedor: str


class ResultadoBusqueda(BaseModel):
    """Resultado de la tool. No incluye ``user_id``: el modelo no lo ve."""

    model_config = ConfigDict(extra="forbid")

    fragmentos: list[Fragmento]

    def como_texto(self) -> str:
        if not self.fragmentos:
            return "No se encontró información relevante en los comprobantes."
        partes = []
        for frag in self.fragmentos:
            partes.append(
                f"[comprobante {frag.documento_id} | {frag.proveedor} | "
                f"{frag.categoria} | {frag.periodo}]\n{frag.contenido}"
            )
        return "\n\n".join(partes)


class BusquedaComprobantes(BaseModel):
    model_config = ConfigDict(extra="forbid")

    consulta: str = Field(min_length=1, description="Qué buscar en el texto del comprobante")
    categoria: Literal["servicios", "expensas", "alquiler"] | None = None
    periodo: str | None = Field(default=None, description="YYYY-MM, o vacío si no hay un mes")
    proveedor: str | None = None

    @field_validator("periodo")
    @classmethod
    def periodo_ok(cls, valor: str | None) -> str | None:
        if valor is None or valor == "":
            return None
        if _PERIODO.fullmatch(valor) is None:
            raise ValueError("El período tiene que ser YYYY-MM")
        return valor


@tool(args_schema=BusquedaComprobantes)
async def buscar_comprobantes(
    consulta: str,
    categoria: str | None = None,
    periodo: str | None = None,
    proveedor: str | None = None,
) -> str:
    """Busca en el texto de los comprobantes de esta persona (factura, contrato, cláusula).
    No calcula totales. El usuario ya está fijado: no lo pases."""
    user_id = usuario_del_turno.get()
    if not user_id:
        return "No se encontró información relevante en los comprobantes."
    encontrados = await buscar(
        consulta=consulta,
        user_id=user_id,
        categoria=categoria,
        periodo=periodo,
        proveedor=proveedor,
    )
    propios = [fila for fila in encontrados if fila.get("user_id") == user_id]
    resultado = ResultadoBusqueda(
        fragmentos=[
            Fragmento(
                contenido=fila["contenido"],
                documento_id=fila["documento_id"],
                categoria=fila["categoria"],
                periodo=fila["periodo"],
                proveedor=fila["proveedor"],
            )
            for fila in propios
            if fila.get("contenido")
        ]
    )
    return resultado.como_texto()


def _agente_investigador():
    """Un agente nuevo por llamada. El loop del hilo sí se reutiliza entre nodos."""
    if _reemplazo is not None:
        return _reemplazo
    from ..llm import armar_llm

    return create_agent(
        model=armar_llm(),
        tools=[buscar_comprobantes],
        system_prompt=(
            "Sos el investigador de comprobantes del hogar. Tu única función "
            "es buscar en el texto indexado con buscar_comprobantes. "
            "NO calcules totales, NO consultes el libro de montos y NO inventes "
            "cláusulas. El user_id no es un argumento. Cerrá con el fragmento "
            "y la marca [comprobante] que devuelve la herramienta."
        ),
    )


def nodo_investigador(state: AgentState) -> dict:
    """Busca el texto del comprobante. El ``user_id`` sale del estado, no del modelo."""

    async def _correr() -> dict:
        token = usuario_del_turno.set(state.get("user_id") or "")
        try:
            tarea = contexto_turno(state, _INSTRUCCION)
            return await _agente_investigador().ainvoke(
                {"messages": [HumanMessage(content=tarea)]}
            )
        finally:
            usuario_del_turno.reset(token)

    resultado = correr_async(_correr())
    mensajes = resultado["messages"]
    respuesta = ultima_respuesta(mensajes)
    for linea in lineas_tool(mensajes, "buscar_comprobantes"):
        if linea not in respuesta:
            respuesta = respuesta.rstrip() + "\n" + linea
    if "[comprobante" not in respuesta.lower() and "no se encontró" not in respuesta.lower():
        respuesta = respuesta.rstrip() + "\nNo se encontró información relevante en los comprobantes."
    return {
        "messages": [AIMessage(content=respuesta, name="investigador")],
        "contribuciones": [{"agente": "investigador", "aporte": respuesta}],
        "pasos": state.get("pasos", 0) + 1,
    }
