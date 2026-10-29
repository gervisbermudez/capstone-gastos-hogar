"""Supervisor: elige el próximo nodo y no hace el trabajo de los especialistas.

Una pregunta de montos va al analista. Una pregunta sobre el texto de una
factura va al investigador. No se exigen los dos si con uno alcanza.
"""

from __future__ import annotations

import re
from typing import Literal

from langchain_core.messages import AIMessage
from pydantic import BaseModel, Field

from .agents.bucle import correr_async
from .state import AgentState, aportes_del_turno, pregunta_actual
from .texto import extraer_texto, sin_cita_comprobante

MAX_PASOS = 6
MAX_POR_AGENTE = 2

_TEXTO = (
    "qué dice",
    "que dice",
    "qué figura",
    "que figura",
    "qué aclara",
    "que aclara",
    "sobre el ajuste",
    "cláusula",
    "clausula",
    "dice la factura",
    "dice el comprobante",
    "según la factura",
    "segun la factura",
    "texto de la factura",
    "texto del comprobante",
    "letra del",
)
_MONTOS = (
    "cuánto",
    "cuanto",
    "pagué",
    "pague",
    "pagó",
    "compará",
    "compara",
    "comparar",
    "contra",
    "versus",
    "promedio",
    "diferencia",
    "total",
    "suma",
    "gasté",
    "gaste",
    "gastó",
)
_PAGO = re.compile(r"\bpago\b")
_COMPARACION = ("compará", "compara", "comparar", "contra", "versus", " vs ", "diferencia")


class DecisionSupervisor(BaseModel):
    next: Literal["investigador", "analista", "FINISH"] = Field(
        description="Próximo agente, o FINISH si la tarea ya está completa"
    )
    razon: str = Field(description="Breve justificación de la decisión")


SUPERVISOR_PROMPT = """Sos el supervisor de un asistente de gastos del hogar.
- investigador: lee el texto de facturas y contratos. No calcula.
- analista: consulta el libro de montos y calcula. No lee el texto.

Elegí un solo próximo paso:
- investigador si preguntan qué dice un comprobante, una cláusula o un ajuste.
- analista si preguntan un total, una comparación o cuánto se pagó.
- FINISH si el aporte que hace falta ya está.

No mandes a los dos si con uno alcanza. No inventes cifras.

Contribuciones hasta ahora:
{contribuciones}
"""


def clasificar_pregunta(pregunta: str) -> str:
    """``texto``, ``montos``, ``ambos`` o ``ambiguo``. Las tres preguntas de la fuente no caen en ambiguo."""
    texto = sin_cita_comprobante(pregunta or "").lower()
    pide_texto = any(frase in texto for frase in _TEXTO)
    pide_montos = any(frase in texto for frase in _MONTOS) or _PAGO.search(texto) is not None
    if pide_texto and pide_montos:
        return "ambos"
    if pide_texto:
        return "texto"
    if pide_montos:
        return "montos"
    return "ambiguo"


def es_comparacion(pregunta: str) -> bool:
    texto = sin_cita_comprobante(pregunta or "").lower()
    return any(marca in texto for marca in _COMPARACION)


def _ultimo(contribuciones: list[dict], agente: str) -> str:
    textos = [c.get("aporte", "") for c in contribuciones if c.get("agente") == agente]
    return textos[-1] if textos else ""


def _investigador_ok(aporte: str) -> bool:
    texto = (aporte or "").lower()
    if "no se encontró" in texto or "no se encontro" in texto:
        return False
    if "[comprobante" not in texto:
        return False
    return len(aporte.strip()) >= 20


def _analista_ok(aporte: str, *, comparacion: bool) -> bool:
    texto = (aporte or "").lower()
    if "no llamó a consultar_gastos" in texto or "no llamo a consultar_gastos" in texto:
        return False
    if "error al consultar" in texto:
        return False
    if "total:" not in texto or not any(caracter.isdigit() for caracter in aporte):
        return False
    if not comparacion:
        return True
    if "resultado:" not in texto:
        return False
    if "error al calcular" in texto or "no llamó a la calculadora" in texto:
        return False
    return True


def aplicar_decision(state: AgentState, elegido: str, razon: str) -> tuple[str, str]:
    """Corrige al modelo. Montos no van al índice y el texto de una factura no va a SQL."""
    contribuciones = aportes_del_turno(state)
    conteo = {
        "investigador": sum(1 for c in contribuciones if c.get("agente") == "investigador"),
        "analista": sum(1 for c in contribuciones if c.get("agente") == "analista"),
    }
    pregunta = pregunta_actual(state)
    intent = clasificar_pregunta(pregunta)
    comparacion = es_comparacion(pregunta)
    inv_ok = _investigador_ok(_ultimo(contribuciones, "investigador"))
    ana_ok = _analista_ok(_ultimo(contribuciones, "analista"), comparacion=comparacion)

    if intent == "texto":
        if not inv_ok and conteo["investigador"] < MAX_POR_AGENTE:
            return "investigador", razon or "La pregunta es sobre el texto de un comprobante."
        if inv_ok:
            return "FINISH", "El índice ya aportó el texto del comprobante."
        return "FINISH", "El investigador no tiene más intentos. Se cierra con lo que hay."

    if intent == "montos":
        if not ana_ok and conteo["analista"] < MAX_POR_AGENTE:
            return "analista", razon or "La pregunta se responde con el libro de montos."
        if ana_ok:
            return "FINISH", "El libro de montos ya contestó."
        return "FINISH", "El analista no tiene más intentos. Se cierra con lo que hay."

    if intent == "ambos":
        if not inv_ok and conteo["investigador"] < MAX_POR_AGENTE:
            return "investigador", "Hace falta el texto del comprobante antes del cálculo."
        if not ana_ok and conteo["analista"] < MAX_POR_AGENTE:
            return "analista", "El texto ya está. Falta el libro de montos."
        return "FINISH", "Texto y montos ya están, o no quedan intentos."

    if elegido not in {"investigador", "analista", "FINISH"}:
        elegido = "investigador"
    if elegido in {"investigador", "analista"} and conteo[elegido] >= MAX_POR_AGENTE:
        return "FINISH", "Ese especialista no tiene más intentos."
    if elegido == "FINISH" and conteo["investigador"] + conteo["analista"] == 0:
        return "investigador", "No hay aportes todavía."
    return elegido, razon


def nodo_supervisor(state: AgentState) -> dict:
    return correr_async(_decidir(state))


async def _decidir(state: AgentState) -> dict:
    if state.get("pasos", 0) >= MAX_PASOS:
        return {
            "next_agent": "FINISH",
            "task_completed": True,
            "razon": "Se alcanzó el máximo de pasos.",
        }

    pregunta = pregunta_actual(state)
    intent = clasificar_pregunta(pregunta)
    if intent == "ambiguo":
        contribuciones = aportes_del_turno(state)
        contribuciones_texto = (
            "\n".join(f"- {c.get('agente')}: {c.get('aporte', '')[:200]}" for c in contribuciones)
            or "(ninguna todavía)"
        )
        prompt = SUPERVISOR_PROMPT.replace("{contribuciones}", contribuciones_texto)
        from .llm import armar_llm

        decision = await (
            armar_llm()
            .with_structured_output(DecisionSupervisor)
            .ainvoke(
                [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": f"Tarea original: {pregunta}"},
                ]
            )
        )
        siguiente, razon = aplicar_decision(state, decision.next, decision.razon)
        if siguiente != decision.next:
            razon = f"El modelo eligió {decision.next}. {razon}"
    else:
        siguiente, razon = aplicar_decision(state, "FINISH", "")

    return {
        "next_agent": siguiente,
        "task_completed": siguiente == "FINISH",
        "razon": razon,
    }


def nodo_sintesis(state: AgentState) -> dict:
    return correr_async(_sintetizar(state))


async def _sintetizar(state: AgentState) -> dict:
    """Arma la respuesta final. No llama herramientas ni vuelve a delegar."""
    contribuciones = aportes_del_turno(state)
    contribuciones_texto = (
        "\n".join(f"- [{c.get('agente')}] {c.get('aporte', '')}" for c in contribuciones)
        or "(sin aportes)"
    )
    pregunta = pregunta_actual(state)
    cierre = ""
    if state.get("critica"):
        decision = "aprobada" if state.get("aprobado") else "rechazada"
        cierre = (
            f"\n\nLa tarea se marcó como crítica ({state.get('motivo_critico', '')}). "
            f"Decisión humana: {decision}. "
            f"Acción: {state.get('accion') or 'sin acción registrada'}."
        )
    prompt = (
        f"Pregunta original: {pregunta}\n\n"
        f"Aportes del equipo:\n{contribuciones_texto}"
        f"{cierre}\n\n"
        "Redactá una respuesta final clara y breve en español, sobre los gastos del hogar. "
        "Usá solo cifras y cláusulas que aparezcan en los aportes. "
        "Si falta el dato, decilo en vez de inventarlo. "
        "Si hubo una decisión humana, incluila en la respuesta."
    )
    from .llm import armar_llm

    respuesta = await armar_llm().ainvoke(prompt)
    return {"messages": [AIMessage(content=extraer_texto(respuesta), name="supervisor")]}
