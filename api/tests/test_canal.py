"""El canal de pensamiento no forma parte de la respuesta ni del JSON."""

import asyncio

from langchain_core.messages import AIMessage
from langchain_core.output_parsers.openai_tools import PydanticToolsParser
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import BaseModel

from app.agents.bucle import correr_async
from app.llm import _anotar_reintento, _cerrar_resultado, _debe_reintentar, _nombre_tool
from app.supervisor import DecisionSupervisor
from app.texto import extraer_texto, objeto_json, separar_canal

_PENSAMIENTO = "<|channel>thoughtwaiting for a<channel|>"


class _Mini(BaseModel):
    next: str


def _resultado(texto: str, tools: list | None = None) -> ChatResult:
    mensaje = AIMessage(content=texto, tool_calls=tools or [])
    return ChatResult(generations=[ChatGeneration(message=mensaje)])


def test_texto_sin_canal_queda_igual() -> None:
    assert separar_canal("Hola") == "Hola"


def test_separa_el_json_del_pensamiento() -> None:
    crudo = (
        '<|channel>thoughtThe user wants JSON.<channel|>{\n'
        '  "monto": "18500.50",\n'
        '  "transcripcion": null\n'
        "}"
    )
    visible = separar_canal(crudo)
    assert visible.startswith("{")
    assert objeto_json(visible) == visible.strip()
    assert "18500.50" in objeto_json(visible)


def test_pensamiento_sin_cierre_no_se_muestra() -> None:
    assert separar_canal("<|channel>thoughtsolo razonamiento") == ""


def test_extraer_texto_descarta_el_canal() -> None:
    assert extraer_texto('<|channel>thoughtx<channel|>listo') == "listo"


def test_el_loop_del_hilo_sigue_abierto() -> None:
    vistos: list[asyncio.AbstractEventLoop] = []

    async def marcar() -> None:
        vistos.append(asyncio.get_running_loop())
        await asyncio.sleep(0)

    correr_async(marcar())
    correr_async(marcar())
    assert vistos[0] is vistos[1]
    assert not vistos[0].is_closed()


def test_objeto_json_ignora_llaves_dentro_de_un_string() -> None:
    texto = 'antes {"nota": "tiene } adentro", "monto": "1.00"} despues'
    assert objeto_json(texto) == '{"nota": "tiene } adentro", "monto": "1.00"}'


def test_reintenta_solo_si_faltaba_una_decision() -> None:
    assert _nombre_tool("auto") == ""
    assert _nombre_tool("DecisionSupervisor") == "DecisionSupervisor"
    assert _anotar_reintento(_resultado(_PENSAMIENTO), None, "DecisionSupervisor") is True
    assert _debe_reintentar(_resultado("Hola, estoy."), None, "") is False
    con_tool = _resultado(
        _PENSAMIENTO,
        [
            {
                "name": "DecisionSupervisor",
                "args": {"next": "FINISH", "razon": "ok"},
                "id": "1",
                "type": "tool_call",
            }
        ],
    )
    assert _debe_reintentar(con_tool, None, "DecisionSupervisor") is False


def test_el_json_despues_del_canal_queda_como_tool_call() -> None:
    crudo = '<|channel>thoughtx<channel|>{"next": "FINISH", "razon": "saludo"}'
    resultado = _cerrar_resultado(_resultado(crudo), None, "DecisionSupervisor")
    parser = PydanticToolsParser(tools=[DecisionSupervisor], first_tool_only=True)
    decision = parser.parse_result(resultado.generations)
    assert decision is not None
    assert decision.next == "FINISH"
    assert decision.razon == "saludo"


def test_el_esquema_parsea_el_json_despues_del_canal() -> None:
    crudo = '<|channel>thoughtx<channel|>{"next": "FINISH"}'
    resultado = _cerrar_resultado(_resultado(crudo), _Mini, "")
    assert resultado.generations[0].message.additional_kwargs["parsed"].next == "FINISH"
