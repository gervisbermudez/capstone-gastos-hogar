"""El canal de pensamiento no forma parte de la respuesta ni del JSON."""

import asyncio

from app.agents.bucle import correr_async
from app.texto import extraer_texto, objeto_json, separar_canal


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
