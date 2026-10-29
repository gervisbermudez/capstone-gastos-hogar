"""Criticidad y pausa humana, sin Redis ni LLM."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path
from types import SimpleNamespace

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from app.graph import enrutar
from app.hitl import es_critica_texto, nodo_aprobacion, nodo_ejecutar, nodo_evaluar_criticidad
from app.state import AgentState
from app.worker import extraer_interrupt

CONSULTA_LECTURA = (
    "Un empleado va a cumplir 12 años en TechCorp. "
    "¿Cuántos días de vacaciones acumuló en total en esos 12 años?"
)
CONSULTA_CRITICA = (
    "Calculá los días de vacaciones y, cuando tengas el total, "
    "registrá el ajuste en su legajo y notificá a RRHH."
)


def test_lectura_no_es_critica() -> None:
    critica, _motivo = es_critica_texto(CONSULTA_LECTURA)
    assert critica is False


def test_efecto_es_critico() -> None:
    critica, motivo = es_critica_texto(CONSULTA_CRITICA)
    assert critica is True
    assert "efecto" in motivo


def test_pago_alto_es_critico() -> None:
    critica, _motivo = es_critica_texto("Tenés que pagar 2500 USD al proveedor.")
    assert critica is True


def test_pago_chico_no_dispara_el_umbral() -> None:
    critica, _motivo = es_critica_texto("¿La política paga 20 USD de viático?")
    assert critica is False


def test_sin_decision_no_pide_aprobacion() -> None:
    estado = _estado("Asentá el pago de las expensas de marzo por 2500 USD")
    estado["respuesta_directa"] = "No pude resolver esa consulta."
    assert nodo_evaluar_criticidad(estado)["critica"] is False


def _grafo(avisos: Path):
    import app.hitl as hitl

    hitl.AVISOS = avisos

    def fin(state: AgentState) -> dict:
        return {}

    grafo: StateGraph = StateGraph(AgentState)
    grafo.add_node("evaluar_criticidad", nodo_evaluar_criticidad)
    grafo.add_node("aprobacion_humana", nodo_aprobacion)
    grafo.add_node("ejecutar", nodo_ejecutar)
    grafo.add_node("fin", fin)
    grafo.add_edge(START, "evaluar_criticidad")
    grafo.add_conditional_edges(
        "evaluar_criticidad",
        lambda state: "aprobacion_humana" if state.get("critica") else "fin",
        {"aprobacion_humana": "aprobacion_humana", "fin": "fin"},
    )
    grafo.add_edge("aprobacion_humana", "ejecutar")
    grafo.add_edge("ejecutar", "fin")
    grafo.add_edge("fin", END)
    return grafo.compile(checkpointer=MemorySaver())


def _estado(pregunta: str) -> dict:
    return {"messages": [HumanMessage(content=pregunta)]}


def test_lectura_termina_sin_pausa(tmp_path: Path) -> None:
    tmp = tmp_path
    app = _grafo(tmp / "rrhh.jsonl")
    config = {"configurable": {"thread_id": "lectura"}}
    app.invoke(_estado(CONSULTA_LECTURA), config)
    snap = app.get_state(config)
    assert snap.next == ()
    assert snap.values["critica"] is False
    assert not (tmp / "rrhh.jsonl").exists()


def test_critica_pausa_y_aprueba(tmp_path: Path) -> None:
    tmp = tmp_path
    avisos = tmp / "rrhh.jsonl"
    app = _grafo(avisos)
    config = {"configurable": {"thread_id": "critica-si"}}
    app.invoke(_estado(CONSULTA_CRITICA), config)
    snap = app.get_state(config)
    assert snap.next
    payload = extraer_interrupt(snap)
    assert payload is not None
    assert "aprob" in payload["pregunta"].lower()
    assert payload["efecto"] == "registro"
    assert payload.get("pedido")
    assert "motivo" in payload
    assert "datos" not in payload

    app.invoke(Command(resume="si"), config)
    final = app.get_state(config)
    assert final.next == ()
    assert final.values["aprobado"] is True
    assert "Acción registrada" in final.values["accion"]
    assert "RRHH" not in final.values["accion"]
    assert avisos.exists()


def test_critica_rechazada_no_avisa(tmp_path: Path) -> None:
    tmp = tmp_path
    avisos = tmp / "rechazo.jsonl"
    app = _grafo(avisos)
    config = {"configurable": {"thread_id": "critica-no"}}
    app.invoke(_estado(CONSULTA_CRITICA), config)
    app.invoke(Command(resume="no"), config)
    final = app.get_state(config)
    assert final.values["aprobado"] is False
    assert final.values["accion"].startswith("Rechazado")
    assert not avisos.exists()


def test_aprobar_un_pago_guarda_borrador(monkeypatch) -> None:
    llamadas: list[dict] = []

    async def guardar_borrador(*, user_id, texto, campos, advertencias) -> str:
        llamadas.append(
            {
                "user_id": user_id,
                "texto": texto,
                "campos": campos,
                "advertencias": advertencias,
            }
        )
        return "doc-1"

    async def asentar_pago(**kwargs):
        raise AssertionError("no se asienta el pago")

    monkeypatch.setattr("app.repositorio.guardar_borrador", guardar_borrador)
    monkeypatch.setattr("app.repositorio.asentar_pago", asentar_pago)
    estado = {
        "messages": [HumanMessage(content="Asentá el pago de expensas de 2026-03 por 18500.50")],
        "aprobado": True,
        "user_id": "usuario-1",
    }
    accion = nodo_ejecutar(estado)["accion"]
    assert accion == "Borrador: doc-1"
    assert llamadas[0]["user_id"] == "usuario-1"
    assert llamadas[0]["campos"]["categoria"] == "expensas"
    assert llamadas[0]["campos"]["periodo"] == "2026-03"
    assert llamadas[0]["campos"]["monto"] == "18500.50"
    assert llamadas[0]["advertencias"] == [
        "Este borrador salió del chat. Revisalo antes de confirmar."
    ]


def test_pago_incompleto_no_escribe_fila(monkeypatch) -> None:
    async def guardar_borrador(**kwargs):
        raise AssertionError("no debía guardar")

    monkeypatch.setattr("app.repositorio.guardar_borrador", guardar_borrador)
    estado = {
        "messages": [HumanMessage(content="Asentá el pago de expensas.")],
        "aprobado": True,
        "user_id": "usuario-1",
    }
    accion = nodo_ejecutar(estado)["accion"]
    assert accion.startswith("No se creó el borrador")
    assert "período" in accion
    assert "Borrador:" not in accion


def test_la_pausa_de_un_pago_trae_datos(tmp_path: Path) -> None:
    app = _grafo(tmp_path / "avisos.jsonl")
    config = {"configurable": {"thread_id": "pago"}}
    app.invoke(
        _estado("Asentá el pago de expensas de 2026-03 por 18500.50"),
        config,
    )
    payload = extraer_interrupt(app.get_state(config))
    assert payload is not None
    assert "aprob" in payload["pregunta"].lower()
    assert payload["efecto"] == "borrador"
    assert payload["datos"] == {
        "categoria": "expensas",
        "periodo": "2026-03",
        "monto": "18500.50",
    }


def test_texto_de_pausa_separa_borrador_y_registro() -> None:
    from app.worker import texto_de_pausa

    borrador = texto_de_pausa(
        {
            "efecto": "borrador",
            "motivo": "quiere un pago",
            "pedido": "Asentá el pago",
            "datos": {"categoria": "expensas", "periodo": "2026-03", "monto": "18500.50"},
        }
    )
    assert borrador.splitlines() == [
        "Acción: se va a crear un borrador para que lo revises antes de sumarlo a tus gastos.",
        "Motivo: quiere un pago",
        "Pedido: Asentá el pago",
        "Datos: Categoría expensas, período 2026-03, monto 18500.50",
    ]
    registro = texto_de_pausa({"efecto": "registro", "motivo": "efecto", "pedido": "avisá"})
    assert registro.splitlines()[0] == "Acción: queda registrada. No se suma a tus gastos."
    assert not any(linea.startswith("Datos:") for linea in registro.splitlines())
    incompleto = texto_de_pausa(
        {
            "efecto": "borrador",
            "motivo": "x",
            "pedido": "y",
            "datos": {"categoria": "expensas"},
        }
    )
    assert not any(linea.startswith("Datos:") for linea in incompleto.splitlines())


def test_enrutar_manda_el_cierre_a_criticidad() -> None:
    assert enrutar({"next_agent": "FINISH", "task_completed": True}) == "evaluar_criticidad"
    assert enrutar({"next_agent": "investigador"}) == "investigador"
    assert enrutar({"next_agent": "analista"}) == "analista"


def test_extraer_interrupt_desde_el_snapshot() -> None:
    interrupcion = SimpleNamespace(value={"pregunta": "¿La aprobás?", "motivo": "efecto"})
    snap = SimpleNamespace(next=("aprobacion_humana",), interrupts=(interrupcion,), tasks=())
    assert extraer_interrupt(snap)["motivo"] == "efecto"


def main() -> None:
    tmp = RAIZ / "avisos" / "test"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        test_lectura_no_es_critica()
        test_efecto_es_critico()
        test_pago_alto_es_critico()
        test_pago_chico_no_dispara_el_umbral()
        test_enrutar_manda_el_cierre_a_criticidad()
        test_extraer_interrupt_desde_el_snapshot()
        test_lectura_termina_sin_pausa(tmp)
        test_critica_pausa_y_aprueba(tmp)
        test_critica_rechazada_no_avisa(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("ok")


if __name__ == "__main__":
    main()
