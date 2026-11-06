"""Grafo con checkpointer y pausa humana.

El supervisor elige investigador, analista o cierre. Los especialistas
vuelven al supervisor: no se hablan entre sí. El cierre pasa por
``evaluar_criticidad`` para pausar antes de un borrador o un aviso.
"""

from __future__ import annotations

from typing import Literal

from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from .agents.analyst_agent import nodo_analista
from .agents.research_agent import nodo_investigador
from .hitl import nodo_aprobacion, nodo_ejecutar, nodo_evaluar_criticidad
from .state import AgentState
from .supervisor import nodo_sintesis, nodo_supervisor


def enrutar(state: AgentState) -> Literal["investigador", "analista", "evaluar_criticidad"]:
    """Especialista o cierre. ``FINISH`` y un paso desconocido van a criticidad."""
    if state.get("next_agent") == "FINISH" or state.get("task_completed"):
        return "evaluar_criticidad"
    destino = state.get("next_agent")
    if destino in {"investigador", "analista"}:
        return destino
    return "evaluar_criticidad"


def enrutar_tras_criticidad(state: AgentState) -> Literal["aprobacion_humana", "sintesis"]:
    """Una acción con efecto pausa. Una lectura sigue a la síntesis."""
    if state.get("critica"):
        return "aprobacion_humana"
    return "sintesis"


def construir_grafo(checkpointer) -> CompiledStateGraph:
    """Compila el grafo con el checkpointer que le pasan.

    En producción es ``AsyncRedisSaver``. Un test puede pasar otro saver
    y seguir llamando ``invoke``.
    """
    grafo: StateGraph = StateGraph(AgentState)
    grafo.add_node("supervisor", nodo_supervisor)
    grafo.add_node("investigador", nodo_investigador)
    grafo.add_node("analista", nodo_analista)
    grafo.add_node("evaluar_criticidad", nodo_evaluar_criticidad)
    grafo.add_node("aprobacion_humana", nodo_aprobacion)
    grafo.add_node("ejecutar", nodo_ejecutar)
    grafo.add_node("sintesis", nodo_sintesis)

    grafo.add_edge(START, "supervisor")
    grafo.add_conditional_edges(
        "supervisor",
        enrutar,
        {
            "investigador": "investigador",
            "analista": "analista",
            "evaluar_criticidad": "evaluar_criticidad",
        },
    )
    grafo.add_edge("investigador", "supervisor")
    grafo.add_edge("analista", "supervisor")
    grafo.add_conditional_edges(
        "evaluar_criticidad",
        enrutar_tras_criticidad,
        {
            "aprobacion_humana": "aprobacion_humana",
            "sintesis": "sintesis",
        },
    )
    grafo.add_edge("aprobacion_humana", "ejecutar")
    grafo.add_edge("ejecutar", "sintesis")
    grafo.add_edge("sintesis", END)
    return grafo.compile(checkpointer=checkpointer)


def estado_inicial(pregunta: str, user_id: str, hogar_id: str = "") -> AgentState:
    """Estado de un turno nuevo. El usuario y el hogar los pone el sistema."""
    return {
        "messages": [HumanMessage(content=pregunta)],
        "next_agent": None,
        "contribuciones": [{"agente": "__reset__", "aporte": ""}],
        "pasos": 0,
        "task_completed": False,
        "razon": "",
        "critica": False,
        "motivo_critico": "",
        "aprobado": None,
        "accion": "",
        "user_id": user_id,
        "hogar_id": hogar_id,
    }


def config_hilo(thread_id: str, *, job_id: str | None = None) -> dict:
    """El checkpointer usa el hilo de la conversación, no el id del job."""
    return {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": 25,
        "metadata": {"job_id": job_id or thread_id},
    }
