"""Ruteo del supervisor con herramientas simuladas.

No abre Redis, Pinecone ni el modelo. El libro de montos es un doble.
"""

from __future__ import annotations

import asyncio
import inspect
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from langchain_core.documents import Document
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.errors import GraphInterrupt
from langgraph.types import Command
from pydantic import ValidationError
from unittest.mock import patch

import app.agents.analyst_agent as analista
import app.agents.libro as libro
import app.agents.research_agent as investigador
import app.hitl as hitl
import app.rag as rag
from app.agents.analyst_agent import ConsultaGastosInput, calculadora, consultar_gastos
from app.agents.bucle import usuario_del_turno
from app.agents.research_agent import BusquedaComprobantes, buscar_comprobantes
from app.esquemas import ConsultaTarea
from app.graph import config_hilo, construir_grafo, enrutar, estado_inicial
from app.hitl import es_critica_texto
from app.indexacion import indexar_comprobante
from app.rag import filtro_pinecone, fusionar
from app.supervisor import (
    RESPUESTA_SIN_DECISION,
    aplicar_decision,
    clasificar_pregunta,
    es_comparacion,
    nodo_sintesis,
    nodo_supervisor,
)
from app.texto import extraer_texto
from app.worker import HiloInvalido, es_del_usuario, reclamar_hilo

PREGUNTA_MONTOS = "¿Cuánto pagó de expensas en marzo?"
PREGUNTA_PAGUE = "¿Cuánto pagué de expensas en marzo?"
PREGUNTA_LUZ = "Compará la luz de enero contra febrero."
PREGUNTA_TEXTO = "¿Qué dice la factura de alquiler sobre el ajuste?"
PREGUNTA_PAGO = "Asentá el pago de las expensas de marzo."
USUARIO = "usuario-a"
HOGAR = "hogar-a"
HOGAR_B = "hogar-b"


class RedisFalso:
    def __init__(self) -> None:
        self.datos: dict[str, str] = {}

    async def set(self, clave: str, valor: str, nx: bool = False):
        if nx and clave in self.datos:
            return None
        self.datos[clave] = valor
        return True

    async def get(self, clave: str):
        return self.datos.get(clave)


class ModeloSintesis:
    async def ainvoke(self, prompt):
        return AIMessage(content="Síntesis de prueba.")

    def with_structured_output(self, esquema):
        raise AssertionError("estas preguntas no tienen que consultar al modelo para rutear")


def _pregunta_del_turno(payload: dict) -> str:
    texto = payload["messages"][0].content
    marca = "Tarea original:\n"
    if marca not in texto:
        return texto
    return texto.split(marca, 1)[1].split("\n\n", 1)[0]


class InvestigadorSimulado:
    def __init__(self, llamadas: list) -> None:
        self.llamadas = llamadas

    async def ainvoke(self, payload: dict) -> dict:
        pregunta = _pregunta_del_turno(payload).lower()
        categoria = "alquiler" if "alquiler" in pregunta else None
        args = {"consulta": "ajuste", "categoria": categoria, "periodo": None, "proveedor": None}
        self.llamadas.append(("buscar", args, usuario_del_turno.get()))
        datos = await buscar_comprobantes.ainvoke(args)
        return {"messages": [AIMessage(content=str(datos))]}


class AnalistaSimulado:
    def __init__(self, llamadas: list) -> None:
        self.llamadas = llamadas

    async def ainvoke(self, payload: dict) -> dict:
        pregunta = _pregunta_del_turno(payload).lower()
        anio = datetime.now().year
        if "compar" in pregunta or "contra" in pregunta:
            args = {
                "categoria": "servicios",
                "periodo_desde": f"{anio}-01",
                "periodo_hasta": f"{anio}-02",
                "proveedor": None,
            }
            datos = await consultar_gastos.ainvoke(args)
            cuenta = calculadora.invoke({"expresion": "22000.00 - 18000.00"})
            self.llamadas.append(("consultar", args, usuario_del_turno.get()))
            self.llamadas.append(("calculadora", "22000.00 - 18000.00", usuario_del_turno.get()))
            return {
                "messages": [
                    ToolMessage(content=str(datos), name="consultar_gastos", tool_call_id="sim-1"),
                    ToolMessage(content=str(cuenta), name="calculadora", tool_call_id="sim-2"),
                    AIMessage(content=f"{datos}\n{cuenta}"),
                ]
            }
        args = {
            "categoria": "expensas",
            "periodo_desde": f"{anio}-03",
            "periodo_hasta": f"{anio}-03",
            "proveedor": None,
        }
        datos = await consultar_gastos.ainvoke(args)
        self.llamadas.append(("consultar", args, usuario_del_turno.get()))
        return {
            "messages": [
                ToolMessage(content=str(datos), name="consultar_gastos", tool_call_id="sim-1"),
                AIMessage(content=str(datos)),
            ]
        }


def _consulta_falsa(
    *,
    user_id: str,
    categoria: str | None = None,
    periodo_desde: str | None = None,
    periodo_hasta: str | None = None,
    proveedor: str | None = None,
) -> dict:
    if periodo_desde and str(periodo_desde).endswith("-01"):
        return {
            "total": "40000.00",
            "promedio": "20000.00",
            "cantidad": 2,
            "por_mes": [
                {"periodo": periodo_desde, "total": "18000.00", "promedio": "18000.00", "cantidad": 1},
                {"periodo": periodo_hasta, "total": "22000.00", "promedio": "22000.00", "cantidad": 1},
            ],
            "por_categoria": [],
            "por_proveedor": [],
        }
    return {
        "total": "18500.50",
        "promedio": "18500.50",
        "cantidad": 1,
        "por_mes": [
            {
                "periodo": periodo_desde,
                "total": "18500.50",
                "promedio": "18500.50",
                "cantidad": 1,
            }
        ],
        "por_categoria": [],
        "por_proveedor": [],
    }


def _invocar(app, entrada, config) -> None:
    try:
        app.invoke(entrada, config)
    except GraphInterrupt:
        pass


def _estado(pregunta: str) -> dict:
    return {
        "messages": [HumanMessage(content=pregunta)],
        "contribuciones": [],
        "pasos": 0,
    }


def test_clasificacion() -> None:
    assert clasificar_pregunta(PREGUNTA_MONTOS) == "montos"
    assert clasificar_pregunta(PREGUNTA_PAGUE) == "montos"
    assert clasificar_pregunta(PREGUNTA_LUZ) == "montos"
    assert clasificar_pregunta(PREGUNTA_TEXTO) == "texto"
    assert es_comparacion(PREGUNTA_LUZ) is True
    assert es_comparacion(PREGUNTA_MONTOS) is False
    assert (
        clasificar_pregunta("¿Qué dice la factura y cuánto pagué en marzo?") == "ambos"
    )


def test_la_cita_no_cambia_la_clase() -> None:
    cita = (
        "[comprobante 041dc593-9b56-4b6e-bb9c-6e39b2bbb48f | Pago Fácil | servicios | 2024-01]"
    )
    assert clasificar_pregunta(f"{cita}\n{PREGUNTA_TEXTO}") == "texto"
    assert clasificar_pregunta(f"{cita}\n{PREGUNTA_MONTOS}") == "montos"
    assert clasificar_pregunta(f"{cita}\n{PREGUNTA_LUZ}") == "montos"
    assert es_comparacion(f"{cita}\n{PREGUNTA_LUZ}") is True
    assert es_comparacion(f"{cita}\n{PREGUNTA_MONTOS}") is False
    cita_contra = (
        "[comprobante 041dc593-9b56-4b6e-bb9c-6e39b2bbb48f | contra reloj | expensas | 2024-01]"
    )
    assert es_comparacion(f"{cita_contra}\n{PREGUNTA_MONTOS}") is False
    assert es_critica_texto(f"{cita}\n{PREGUNTA_TEXTO}")[0] is False
    cita_pago = (
        "[comprobante 041dc593-9b56-4b6e-bb9c-6e39b2bbb48f | pago de 5000 USD | servicios | 2024-01]"
    )
    assert es_critica_texto(f"{cita_pago}\n{PREGUNTA_TEXTO}")[0] is False
    from app.hitl import _datos_pago
    from app.repositorio import _titulo

    datos = _datos_pago(f"{cita}\nAsentá el pago de las expensas de marzo por 1200.00")
    assert datos is not None
    assert datos["categoria"] == "expensas"
    assert datos["periodo"] == f"{datetime.now().year}-03"
    assert datos["monto"] == "1200.00"
    assert _titulo(f"{cita}\n{PREGUNTA_TEXTO}") == PREGUNTA_TEXTO


def test_la_rubrica_corrige_al_modelo() -> None:
    texto = _estado(PREGUNTA_TEXTO)
    assert aplicar_decision(texto, "analista", "me equivoqué")[0] == "investigador"

    montos = _estado(PREGUNTA_MONTOS)
    assert aplicar_decision(montos, "investigador", "mal")[0] == "analista"

    luz = _estado(PREGUNTA_LUZ)
    assert aplicar_decision(luz, "investigador", "mal")[0] == "analista"

    con_libro = _estado(PREGUNTA_MONTOS)
    con_libro["contribuciones"] = [
        {"agente": "analista", "aporte": "Total: 18500.50\nCantidad: 1"}
    ]
    assert aplicar_decision(con_libro, "analista", "otra vez")[0] == "FINISH"

    sin_resta = _estado(PREGUNTA_LUZ)
    sin_resta["contribuciones"] = [{"agente": "analista", "aporte": "Total: 40000.00"}]
    assert aplicar_decision(sin_resta, "FINISH", "")[0] == "analista"

    con_resta = _estado(PREGUNTA_LUZ)
    con_resta["contribuciones"] = [
        {"agente": "analista", "aporte": "Total: 40000.00\nResultado: 4000.0"}
    ]
    assert aplicar_decision(con_resta, "investigador", "")[0] == "FINISH"

    vacio = "No se encontró información relevante en los comprobantes."
    agotado = _estado(PREGUNTA_TEXTO)
    agotado["contribuciones"] = [
        {"agente": "investigador", "aporte": vacio},
        {"agente": "investigador", "aporte": vacio},
    ]
    assert aplicar_decision(agotado, "investigador", "")[0] == "FINISH"


def test_tope_de_pasos() -> None:
    decision = nodo_supervisor({"pasos": 6, "messages": [], "contribuciones": []})
    assert decision["next_agent"] == "FINISH"
    assert decision["task_completed"] is True


class _DecisionVacia:
    def with_structured_output(self, esquema):
        return self

    async def ainvoke(self, mensajes):
        return None


class _DecisionInvalida:
    def with_structured_output(self, esquema):
        return self

    async def ainvoke(self, mensajes):
        raise ValueError("La respuesta no trae un objeto JSON")


class _SintesisQueNoDebeCorrer:
    async def ainvoke(self, prompt):
        raise AssertionError("la respuesta directa no vuelve a llamar al modelo")


def test_sin_decision_el_supervisor_cierra(monkeypatch) -> None:
    monkeypatch.setattr("app.llm.armar_llm", lambda: _DecisionVacia())
    decision = nodo_supervisor(
        {
            "messages": [HumanMessage(content="Hola funcionas")],
            "contribuciones": [],
            "pasos": 0,
        }
    )
    assert decision["next_agent"] == "FINISH"
    assert decision["task_completed"] is True
    assert decision["respuesta_directa"] == RESPUESTA_SIN_DECISION


def test_json_ausente_tambien_cierra(monkeypatch) -> None:
    monkeypatch.setattr("app.llm.armar_llm", lambda: _DecisionInvalida())
    decision = nodo_supervisor(
        {
            "messages": [HumanMessage(content="Hola funcionas")],
            "contribuciones": [],
            "pasos": 0,
        }
    )
    assert decision["respuesta_directa"] == RESPUESTA_SIN_DECISION


def test_la_sintesis_entrega_la_respuesta_directa(monkeypatch) -> None:
    monkeypatch.setattr("app.llm.armar_llm", lambda: _SintesisQueNoDebeCorrer())
    salida = nodo_sintesis(
        {
            "messages": [HumanMessage(content="Hola funcionas")],
            "contribuciones": [],
            "respuesta_directa": RESPUESTA_SIN_DECISION,
        }
    )
    assert extraer_texto(salida["messages"][0]) == RESPUESTA_SIN_DECISION
    assert salida["respuesta_directa"] == ""


def test_enrutar_el_cierre_pasa_por_la_pausa() -> None:
    assert enrutar({"next_agent": "FINISH", "task_completed": True}) == "evaluar_criticidad"
    assert enrutar({"next_agent": "investigador"}) == "investigador"
    assert enrutar({"next_agent": "analista"}) == "analista"


def test_lectura_no_pausa_y_el_pago_si() -> None:
    for pregunta in (PREGUNTA_MONTOS, PREGUNTA_PAGUE, PREGUNTA_LUZ, PREGUNTA_TEXTO):
        assert es_critica_texto(pregunta)[0] is False
    critica, motivo = es_critica_texto(PREGUNTA_PAGO)
    assert critica is True
    assert "efecto" in motivo
    lectura, _ = es_critica_texto(
        "Un empleado va a cumplir 12 años en TechCorp. "
        "¿Cuántos días de vacaciones acumuló en total en esos 12 años?"
    )
    assert lectura is False


def test_calculadora_sin_eval() -> None:
    assert "eval" not in analista._evaluar_nodo.__code__.co_names
    assert "exec" not in analista._evaluar_nodo.__code__.co_names
    assert calculadora.invoke({"expresion": "(2+3)*4"}) == "Resultado: 20"
    potencia = calculadora.invoke({"expresion": "2**100"})
    assert str(potencia).startswith("Error al calcular")
    malo = calculadora.invoke({"expresion": "__import__('os').system('ls')"})
    assert str(malo).startswith("Error al calcular")


def test_las_tools_no_reciben_user_id() -> None:
    for schema in (
        BusquedaComprobantes,
        ConsultaGastosInput,
        buscar_comprobantes.args_schema,
        consultar_gastos.args_schema,
        calculadora.args_schema,
    ):
        assert "user_id" not in schema.model_fields
        assert "hogar_id" not in schema.model_fields
    try:
        BusquedaComprobantes.model_validate({"consulta": "ajuste", "user_id": "otro"})
        raise AssertionError("la búsqueda aceptó user_id")
    except ValidationError:
        pass
    try:
        BusquedaComprobantes.model_validate({"consulta": "ajuste", "hogar_id": "otro"})
        raise AssertionError("la búsqueda aceptó hogar_id")
    except ValidationError:
        pass
    try:
        ConsultaGastosInput.model_validate({"hogar_id": "otro"})
        raise AssertionError("el libro aceptó hogar_id")
    except ValidationError:
        pass
    try:
        ConsultaTarea.model_validate({"query": "hola", "user_id": "otro"})
        raise AssertionError("el body de /tasks aceptó user_id")
    except ValidationError:
        pass
    try:
        ConsultaTarea.model_validate({"query": "hola", "hogar_id": "otro"})
        raise AssertionError("el body de /tasks aceptó hogar_id")
    except ValidationError:
        pass


def test_firma_de_indexar() -> None:
    firma = inspect.signature(indexar_comprobante)
    assert list(firma.parameters) == [
        "user_id",
        "documento_id",
        "texto",
        "categoria",
        "periodo",
        "proveedor",
        "hogar_id",
    ]
    assert firma.parameters["hogar_id"].default is None
    assert all(
        parametro.kind is inspect.Parameter.KEYWORD_ONLY
        for parametro in firma.parameters.values()
    )
    assert inspect.iscoroutinefunction(indexar_comprobante)
    try:
        asyncio.run(
            indexar_comprobante("u", "d", "texto", "expensas", "2026-03", "X")  # type: ignore[misc]
        )
        raise AssertionError("aceptó argumentos posicionales")
    except TypeError:
        pass


def test_hilo_atado_al_usuario() -> None:
    redis = RedisFalso()

    async def _correr() -> None:
        hilo = await reclamar_hilo(redis, "usuario-a", None)
        assert hilo
        assert await reclamar_hilo(redis, "usuario-a", hilo) == hilo
        assert await reclamar_hilo(redis, "usuario-b", hilo) is None
        try:
            await reclamar_hilo(redis, "usuario-a", "con espacios")
            raise AssertionError("aceptó un thread_id inválido")
        except HiloInvalido:
            pass

    asyncio.run(_correr())
    assert es_del_usuario({"user_id": "usuario-a"}, "usuario-a")
    assert not es_del_usuario({"user_id": "usuario-a"}, "usuario-b")
    assert not es_del_usuario(None, "usuario-a")


def test_main_alinea_el_contrato() -> None:
    texto = (RAIZ / "app" / "main.py").read_text(encoding="utf-8")
    assert "ConsultaTarea" in texto
    assert "TareaCreada" in texto
    assert "TareaEstado" in texto
    assert "Aprobacion" in texto
    assert "TareaReanudada" in texto
    assert "usuario_actual" in texto
    assert texto.count("status_code=202") >= 2
    assert '_montar_router(".rutas_auth")' in texto
    assert '_montar_router(".rutas_documentos")' in texto
    assert "FRONTEND_ORIGIN" in texto
    assert "RedisSaver" in texto
    assert "worker_loop" in texto
    rag_texto = (RAIZ / "app" / "rag.py").read_text(encoding="utf-8")
    assert "techcorp-rag-hibrido" not in rag_texto
    assert 'os.getenv("INDEX_NAME"' in rag_texto


def test_filtro_de_pinecone_lleva_el_hogar() -> None:
    filtro = filtro_pinecone(
        user_id="usuario-a",
        hogar_id="hogar-a",
        categoria="alquiler",
        periodo="2026-03",
    )
    assert filtro["hogar_id"] == "hogar-a"
    assert "user_id" not in filtro
    assert "proveedor" not in filtro
    uno = Document(
        page_content="uno",
        metadata={"documento_id": "1", "chunk_id": "0", "user_id": "usuario-a"},
    )
    dos = Document(
        page_content="dos",
        metadata={"documento_id": "2", "chunk_id": "0", "user_id": "usuario-a"},
    )
    orden = fusionar([uno, dos], [dos], 2)
    assert orden[0].metadata["documento_id"] == "2"


def test_indice_aislado_y_ruteo(tmp_path: Path) -> None:
    tmp = tmp_path
    indice_anterior = rag.INDICE_LOCAL
    docs_anteriores = rag._documentos
    pinecone_anterior = rag._usar_pinecone
    store_anterior = rag._store_pinecone
    avisos_anteriores = hitl.AVISOS
    agente_inv = investigador._reemplazo
    agente_ana = analista._reemplazo
    rag.preparar_indice_local(tmp / "comprobantes.jsonl")
    rag._usar_pinecone = False

    def _pinecone_prohibido():
        raise AssertionError("el test no tiene que llamar a Pinecone")

    rag._store_pinecone = _pinecone_prohibido
    hitl.AVISOS = tmp / "avisos.jsonl"
    llamadas: list = []
    investigador._reemplazo = InvestigadorSimulado(llamadas)
    analista._reemplazo = AnalistaSimulado(llamadas)
    libro.usar_consulta(_consulta_falsa)
    try:
        asyncio.run(
            indexar_comprobante(
                user_id=USUARIO,
                documento_id="alquiler-a",
                texto=(
                    "Contrato de alquiler. El ajuste anual del canon es del "
                    "25 por ciento segun la cláusula cuarta."
                ),
                categoria="alquiler",
                periodo="2026-03",
                proveedor="Inmobiliaria Sur",
                hogar_id=HOGAR,
            )
        )
        asyncio.run(
            indexar_comprobante(
                user_id="usuario-b",
                documento_id="alquiler-b",
                texto="Secreto ajeno del ajuste: el inquilino de B paga otro canon.",
                categoria="alquiler",
                periodo="2026-03",
                proveedor="Otra",
                hogar_id=HOGAR_B,
            )
        )
        asyncio.run(
            indexar_comprobante(
                user_id=USUARIO,
                documento_id="luz-enero",
                texto="Factura de luz de enero de Edenor, consumo del medidor.",
                categoria="servicios",
                periodo=f"{datetime.now().year}-01",
                proveedor="Edenor",
                hogar_id=HOGAR,
            )
        )
        asyncio.run(
            indexar_comprobante(
                user_id=USUARIO,
                documento_id="luz-febrero",
                texto="Factura de febrero de Edesur, otro medidor.",
                categoria="servicios",
                periodo=f"{datetime.now().year}-02",
                proveedor="Edesur",
                hogar_id=HOGAR,
            )
        )

        propios = rag.buscar_sync(
            consulta="ajuste",
            user_id=USUARIO,
            hogar_id=HOGAR,
            categoria="alquiler",
        )
        assert propios
        assert all(fila["hogar_id"] == HOGAR for fila in propios)
        assert "25 por ciento" in propios[0]["contenido"]
        assert "Secreto ajeno" not in " ".join(fila["contenido"] for fila in propios)
        ajenos = rag.buscar_sync(
            consulta="ajuste",
            user_id="usuario-b",
            hogar_id=HOGAR_B,
            categoria="alquiler",
        )
        assert ajenos and all(fila["hogar_id"] == HOGAR_B for fila in ajenos)
        assert "25 por ciento" not in " ".join(fila["contenido"] for fila in ajenos)
        assert rag.buscar_sync(consulta="ajuste", user_id="", hogar_id=HOGAR, categoria="alquiler") == []
        assert rag.buscar_sync(consulta="ajuste", user_id=USUARIO, hogar_id="", categoria="alquiler") == []
        del_hogar = rag.buscar_sync(
            consulta="ajuste",
            user_id="usuario-b",
            hogar_id=HOGAR,
            categoria="alquiler",
        )
        assert del_hogar and all(fila["hogar_id"] == HOGAR for fila in del_hogar)
        assert "Secreto ajeno" not in " ".join(fila["contenido"] for fila in del_hogar)

        edenor = rag.buscar_sync(
            consulta="medidor",
            user_id=USUARIO,
            hogar_id=HOGAR,
            proveedor="edenor",
        )
        assert len(edenor) == 1
        assert edenor[0]["proveedor"] == "Edenor"
        enero = rag.buscar_sync(
            consulta="factura",
            user_id=USUARIO,
            hogar_id=HOGAR,
            periodo=f"{datetime.now().year}-01",
        )
        assert len(enero) == 1
        assert enero[0]["documento_id"] == "luz-enero"

        lineas = (tmp / "comprobantes.jsonl").read_text(encoding="utf-8").strip().splitlines()
        assert len(lineas) == 4
        asyncio.run(
            indexar_comprobante(
                user_id=USUARIO,
                documento_id="alquiler-a",
                texto="Contrato de alquiler. El ajuste anual del canon es del 25 por ciento segun la cláusula cuarta.",
                categoria="alquiler",
                periodo="2026-03",
                proveedor="Inmobiliaria Sur",
                hogar_id=HOGAR,
            )
        )
        lineas = (tmp / "comprobantes.jsonl").read_text(encoding="utf-8").strip().splitlines()
        assert len(lineas) == 4

        try:
            asyncio.run(
                indexar_comprobante(
                    user_id=USUARIO,
                    documento_id="mal",
                    texto="hola",
                    categoria="x" * 81,
                    periodo="2026-03",
                    proveedor="X",
                    hogar_id=HOGAR,
                )
            )
            raise AssertionError("indexó una categoría inválida")
        except ValueError:
            pass

        token = usuario_del_turno.set("")
        try:
            vacio = asyncio.run(
                buscar_comprobantes.ainvoke({"consulta": "ajuste", "categoria": "alquiler"})
            )
        finally:
            usuario_del_turno.reset(token)
        assert "25 por ciento" not in str(vacio)
        assert "Secreto ajeno" not in str(vacio)

        app = construir_grafo(MemorySaver())
        with patch("app.llm.armar_llm", return_value=ModeloSintesis()):
            _correr_grafo(app, llamadas)
    finally:
        rag.INDICE_LOCAL = indice_anterior
        rag._documentos = docs_anteriores
        rag._usar_pinecone = pinecone_anterior
        rag._store_pinecone = store_anterior
        hitl.AVISOS = avisos_anteriores
        investigador._reemplazo = agente_inv
        analista._reemplazo = agente_ana
        libro.usar_consulta(None)


def _correr_grafo(app, llamadas: list) -> None:
    anio = datetime.now().year

    def _humanos(valores: dict) -> list:
        return [m for m in valores.get("messages") or [] if getattr(m, "type", "") == "human"]

    def _agentes(valores: dict) -> list[str]:
        return [
            c["agente"]
            for c in valores.get("contribuciones") or []
            if c.get("agente") != "__reset__"
        ]

    config = config_hilo("hilo-montos", job_id="job-montos")
    _invocar(app, estado_inicial(PREGUNTA_MONTOS, USUARIO, hogar_id=HOGAR), config)
    snap = app.get_state(config)
    assert snap.next == ()
    assert snap.values["critica"] is False
    assert snap.values["user_id"] == USUARIO
    assert snap.values["hogar_id"] == HOGAR
    assert _agentes(snap.values) == ["analista"]
    assert extraer_texto(snap.values["messages"][-1]) == "Síntesis de prueba."
    consultas = [item for item in llamadas if item[0] == "consultar"]
    assert len(consultas) == 1
    assert consultas[0][2] == USUARIO
    assert consultas[0][1]["categoria"] == "expensas"
    assert consultas[0][1]["periodo_desde"] == f"{anio}-03"
    assert "user_id" not in consultas[0][1]
    assert "hogar_id" not in consultas[0][1]
    assert not any(item[0] == "buscar" for item in llamadas)

    _invocar(app, estado_inicial(PREGUNTA_PAGUE, USUARIO, hogar_id=HOGAR), config)
    snap = app.get_state(config)
    assert _agentes(snap.values) == ["analista"]
    assert len(_humanos(snap.values)) == 2
    assert snap.values["pasos"] == 1
    assert len([item for item in llamadas if item[0] == "consultar"]) == 2

    llamadas.clear()
    config_luz = config_hilo("hilo-luz", job_id="job-luz")
    _invocar(app, estado_inicial(PREGUNTA_LUZ, USUARIO, hogar_id=HOGAR), config_luz)
    snap = app.get_state(config_luz)
    assert snap.next == ()
    assert snap.values["critica"] is False
    assert _agentes(snap.values) == ["analista"]
    assert [item[0] for item in llamadas] == ["consultar", "calculadora"]
    args = llamadas[0][1]
    assert args["categoria"] == "servicios"
    assert args["proveedor"] is None
    assert args["periodo_desde"] == f"{anio}-01"
    assert args["periodo_hasta"] == f"{anio}-02"
    assert llamadas[0][2] == USUARIO
    assert "user_id" not in args
    assert "hogar_id" not in args

    llamadas.clear()
    config_texto = config_hilo("hilo-texto", job_id="job-texto")
    _invocar(app, estado_inicial(PREGUNTA_TEXTO, USUARIO, hogar_id=HOGAR), config_texto)
    snap = app.get_state(config_texto)
    assert snap.next == ()
    assert _agentes(snap.values) == ["investigador"]
    assert llamadas and llamadas[0][0] == "buscar"
    assert llamadas[0][1]["categoria"] == "alquiler"
    assert llamadas[0][2] == USUARIO
    assert "user_id" not in llamadas[0][1]
    assert "hogar_id" not in llamadas[0][1]
    aporte = snap.values["contribuciones"][-1]["aporte"]
    assert "25 por ciento" in aporte
    assert "Secreto ajeno" not in aporte
    assert not any(item[0] == "consultar" for item in llamadas)

    llamadas.clear()
    config_pago = config_hilo("hilo-pago", job_id="job-pago")
    _invocar(app, estado_inicial(PREGUNTA_PAGO, USUARIO, hogar_id=HOGAR), config_pago)
    snap = app.get_state(config_pago)
    assert snap.next
    assert snap.values["critica"] is True
    assert any(item[0] == "consultar" for item in llamadas)
    assert not (tmp_aviso := hitl.AVISOS).exists()
    _invocar(app, Command(resume="si"), config_pago)
    final = app.get_state(config_pago)
    assert final.next == ()
    assert final.values["aprobado"] is True
    assert final.values["accion"].startswith("No se creó el borrador")
    assert "monto" in final.values["accion"]
    assert "Borrador:" not in final.values["accion"]
    assert not tmp_aviso.exists()

    config_no = config_hilo("hilo-no", job_id="job-no")
    avisos = hitl.AVISOS
    hitl.AVISOS = avisos.with_name("rechazo.jsonl")
    try:
        _invocar(app, estado_inicial(PREGUNTA_PAGO, USUARIO, hogar_id=HOGAR), config_no)
        _invocar(app, Command(resume="no"), config_no)
        rechazado = app.get_state(config_no)
        assert rechazado.values["aprobado"] is False
        assert rechazado.values["accion"].startswith("Rechazado")
        assert "pago" in rechazado.values["accion"]
        assert not hitl.AVISOS.exists()
    finally:
        hitl.AVISOS = avisos


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="ruteo-"))
    try:
        test_clasificacion()
        test_la_rubrica_corrige_al_modelo()
        test_tope_de_pasos()
        test_enrutar_el_cierre_pasa_por_la_pausa()
        test_lectura_no_pausa_y_el_pago_si()
        test_calculadora_sin_eval()
        test_las_tools_no_reciben_user_id()
        test_firma_de_indexar()
        test_hilo_atado_al_usuario()
        test_main_alinea_el_contrato()
        test_filtro_de_pinecone_lleva_el_usuario()
        test_indice_aislado_y_ruteo(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("ok")


if __name__ == "__main__":
    main()
