"""Estado compartido del orquestador.

``contribuciones`` suma aportes. Si el turno nuevo trae ``__reset__``,
olvida los de la pregunta anterior: si no, el supervisor creería que el
libro ya contestó. ``messages`` lo hereda de ``MessagesState``.
"""

from __future__ import annotations

from typing import Annotated, NotRequired

from langgraph.graph import MessagesState


def reducir_contribuciones(actual: list | None, nueva: list | None) -> list:
    """Suma aportes. Un ``__reset__`` deja solo lo que venga después."""
    base = list(actual or [])
    extra = list(nueva or [])
    if any(isinstance(item, dict) and item.get("agente") == "__reset__" for item in extra):
        base = []
        extra = [
            item
            for item in extra
            if not (isinstance(item, dict) and item.get("agente") == "__reset__")
        ]
    return base + extra


class AgentState(MessagesState):
    """Hereda ``messages`` y suma los campos del supervisor, el HITL y el usuario."""

    next_agent: NotRequired[str | None]
    contribuciones: Annotated[list[dict[str, str]], reducir_contribuciones]
    pasos: NotRequired[int]
    task_completed: NotRequired[bool]
    razon: NotRequired[str]
    respuesta_directa: NotRequired[str]
    critica: NotRequired[bool]
    motivo_critico: NotRequired[str]
    aprobado: NotRequired[bool | None]
    accion: NotRequired[str]
    user_id: NotRequired[str]
    hogar_id: NotRequired[str]


def pregunta_actual(state: dict) -> str:
    """Último mensaje de la persona. El hilo acumula; el primero ya no es la tarea."""
    from .texto import extraer_texto

    mensajes = state.get("messages") or []
    elegido = None
    for mensaje in mensajes:
        if getattr(mensaje, "type", "") == "human":
            elegido = mensaje
    if elegido is None and mensajes:
        elegido = mensajes[-1]
    if elegido is None:
        return ""
    return extraer_texto(elegido)


def aportes_del_turno(state: dict) -> list[dict]:
    return [
        aporte
        for aporte in (state.get("contribuciones") or [])
        if isinstance(aporte, dict) and aporte.get("agente") != "__reset__"
    ]


def contexto_turno(state: dict, instruccion: str) -> str:
    """Tarea de este turno, un poco de charla previa y los aportes de ahora.

    Usa el último mensaje humano del turno, no el primero del hilo.
    """
    from .texto import extraer_texto

    pregunta = pregunta_actual(state)
    bloques = [f"Tarea original:\n{pregunta}"]
    previos = _turnos_previos(state)
    if previos:
        bloques.append("Turnos anteriores:\n" + previos)
    aportes = aportes_del_turno(state)
    if aportes:
        lineas = [f"- [{c.get('agente', '?')}] {c.get('aporte', '')}" for c in aportes]
        bloques.append("Aportes ya registrados:\n" + "\n".join(lineas))
    bloques.append(f"Tu instrucción:\n{instruccion}")
    return "\n\n".join(bloques)


def _turnos_previos(state: dict) -> str:
    from .texto import extraer_texto

    mensajes = list(state.get("messages") or [])
    ultimo = None
    for indice, mensaje in enumerate(mensajes):
        if getattr(mensaje, "type", "") == "human":
            ultimo = indice
    if not ultimo:
        return ""
    lineas: list[str] = []
    for mensaje in mensajes[:ultimo][-4:]:
        texto = extraer_texto(mensaje).strip()
        if not texto:
            continue
        quien = "persona" if getattr(mensaje, "type", "") == "human" else "asistente"
        lineas.append(f"- {quien}: {texto[:400]}")
    return "\n".join(lineas)
