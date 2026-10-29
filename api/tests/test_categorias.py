"""ABM del catálogo de categorías. No usa Redis ni el lifespan de main."""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from app.rutas_auth import router as router_auth
from app.rutas_categorias import router as router_categorias

_NOMBRE_REPETIDO = "Ya existe una categoría con ese nombre"
_NO_ENCONTRADA = "No existe esa categoría"


def _entorno(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "gastos.db"))
    monkeypatch.setenv("JWT_SECRET", "secreto-de-test-categorias-32-bytes")


def _cliente() -> TestClient:
    aplicacion = FastAPI()
    aplicacion.include_router(router_auth)
    aplicacion.include_router(router_categorias)
    return TestClient(aplicacion)


def _registrar(cliente: TestClient, email: str) -> dict[str, str]:
    respuesta = cliente.post(
        "/auth/registro",
        json={"email": email, "password": "una frase larga"},
    )
    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    token = cuerpo["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _claves_de_item(item: dict) -> None:
    assert set(item) == {"id", "nombre", "descripcion"}
    assert item["id"]


def test_alta_listado_edicion_y_baja(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        headers = _registrar(cliente, "ana@example.com")
        vacio = cliente.get("/categorias", headers=headers)
        assert vacio.status_code == 200
        assert vacio.json() == {"items": []}

        zeta = cliente.post(
            "/categorias",
            json={"nombre": "zeta", "descripcion": "la última"},
            headers=headers,
        )
        assert zeta.status_code == 201
        agua = cliente.post(
            "/categorias",
            json={"nombre": "  Agua  ", "descripcion": "  del edificio  "},
            headers=headers,
        )
        assert agua.status_code == 201
        item_agua = agua.json()
        item_zeta = zeta.json()
        _claves_de_item(item_agua)
        _claves_de_item(item_zeta)
        assert item_agua["nombre"] == "Agua"
        assert item_agua["descripcion"] == "del edificio"
        assert item_zeta["nombre"] == "zeta"

        lista = cliente.get("/categorias", headers=headers)
        assert lista.status_code == 200
        assert [item["nombre"] for item in lista.json()["items"]] == ["Agua", "zeta"]
        assert lista.json()["items"][0]["id"] == item_agua["id"]

        editada = cliente.patch(
            f"/categorias/{item_agua['id']}",
            json={"nombre": "Expensas", "descripcion": "mensuales"},
            headers=headers,
        )
        assert editada.status_code == 200
        assert editada.json() == {
            "id": item_agua["id"],
            "nombre": "Expensas",
            "descripcion": "mensuales",
        }

        baja = cliente.delete(f"/categorias/{item_agua['id']}", headers=headers)
        assert baja.status_code == 204
        assert baja.content == b""

        queda = cliente.get("/categorias", headers=headers)
        assert queda.status_code == 200
        assert [item["id"] for item in queda.json()["items"]] == [item_zeta["id"]]
        assert "Expensas" not in str(queda.json())
        assert "Agua" not in str(queda.json())


def test_nombre_y_descripcion_invalidos_422(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        headers = _registrar(cliente, "ana@example.com")
        for nombre in ("", "   ", "n" * 81):
            alta = cliente.post(
                "/categorias",
                json={"nombre": nombre},
                headers=headers,
            )
            assert alta.status_code == 422
            parche = cliente.patch(
                "/categorias/no-importa",
                json={"nombre": nombre},
                headers=headers,
            )
            assert parche.status_code == 422

        larga = cliente.post(
            "/categorias",
            json={"nombre": "Luz", "descripcion": "d" * 281},
            headers=headers,
        )
        assert larga.status_code == 422
        parche_largo = cliente.patch(
            "/categorias/no-importa",
            json={"nombre": "Luz", "descripcion": "d" * 281},
            headers=headers,
        )
        assert parche_largo.status_code == 422

        de_mas = cliente.post(
            "/categorias",
            json={"nombre": "Luz", "user_id": "ajeno"},
            headers=headers,
        )
        assert de_mas.status_code == 422

        justo = cliente.post(
            "/categorias",
            json={"nombre": f"  {'n' * 80}  ", "descripcion": f"  {'d' * 280}  "},
            headers=headers,
        )
        assert justo.status_code == 201
        assert justo.json()["nombre"] == "n" * 80
        assert justo.json()["descripcion"] == "d" * 280
        assert cliente.get("/categorias", headers=headers).json()["items"] == [justo.json()]


def test_nombre_duplicado_409(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        headers = _registrar(cliente, "ana@example.com")
        luz = cliente.post("/categorias", json={"nombre": "Luz"}, headers=headers)
        assert luz.status_code == 201
        luz_id = luz.json()["id"]

        repetida = cliente.post("/categorias", json={"nombre": "luz"}, headers=headers)
        assert repetida.status_code == 409
        assert repetida.json()["detail"] == _NOMBRE_REPETIDO
        con_espacios = cliente.post(
            "/categorias",
            json={"nombre": "  LUZ  "},
            headers=headers,
        )
        assert con_espacios.status_code == 409

        agua = cliente.post("/categorias", json={"nombre": "Agua"}, headers=headers)
        assert agua.status_code == 201
        agua_id = agua.json()["id"]

        choque = cliente.patch(
            f"/categorias/{luz_id}",
            json={"nombre": "agua"},
            headers=headers,
        )
        assert choque.status_code == 409
        assert choque.json()["detail"] == _NOMBRE_REPETIDO
        sigue = cliente.get("/categorias", headers=headers)
        assert {item["id"]: item["nombre"] for item in sigue.json()["items"]} == {
            luz_id: "Luz",
            agua_id: "Agua",
        }

        misma = cliente.patch(
            f"/categorias/{luz_id}",
            json={"nombre": "luz", "descripcion": "mensual"},
            headers=headers,
        )
        assert misma.status_code == 200
        assert misma.json() == {"id": luz_id, "nombre": "luz", "descripcion": "mensual"}
        sin_cambio = cliente.patch(
            f"/categorias/{luz_id}",
            json={"nombre": "luz", "descripcion": "mensual"},
            headers=headers,
        )
        assert sin_cambio.status_code == 200
        assert sin_cambio.json() == misma.json()
        otra_vez = cliente.post("/categorias", json={"nombre": "LUZ"}, headers=headers)
        assert otra_vez.status_code == 409
        assert cliente.get("/categorias", headers=headers).json()["items"][0]["nombre"] == "Agua"


def test_otro_usuario_no_ve_ni_cambia_la_fila(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ana = _registrar(cliente, "ana@example.com")
        beto = _registrar(cliente, "beto@example.com")
        alta = cliente.post(
            "/categorias",
            json={"nombre": "Luz", "descripcion": "de ana"},
            headers=ana,
        )
        assert alta.status_code == 201
        categoria_id = alta.json()["id"]

        lista_b = cliente.get("/categorias", headers=beto)
        assert lista_b.status_code == 200
        assert lista_b.json() == {"items": []}
        assert "de ana" not in str(lista_b.json())

        parche = cliente.patch(
            f"/categorias/{categoria_id}",
            json={"nombre": "Robada"},
            headers=beto,
        )
        assert parche.status_code == 404
        assert parche.json()["detail"] == _NO_ENCONTRADA
        baja = cliente.delete(f"/categorias/{categoria_id}", headers=beto)
        assert baja.status_code == 404
        assert baja.json()["detail"] == _NO_ENCONTRADA

        de_ana = cliente.get("/categorias", headers=ana)
        assert de_ana.json()["items"] == [alta.json()]

        propia = cliente.post("/categorias", json={"nombre": "Luz"}, headers=beto)
        assert propia.status_code == 201
        assert propia.json()["id"] != categoria_id
        assert cliente.get("/categorias", headers=beto).json()["items"] == [propia.json()]
        assert cliente.get("/categorias", headers=ana).json()["items"] == [alta.json()]


def test_sin_autorizacion_401(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        respuestas = [
            cliente.get("/categorias"),
            cliente.post("/categorias", json={"nombre": "Luz"}),
            cliente.patch("/categorias/alguna", json={"nombre": "Luz"}),
            cliente.delete("/categorias/alguna"),
        ]
        for respuesta in respuestas:
            assert respuesta.status_code == 401
            assert respuesta.json()["detail"] == "No autenticado"


def test_descripcion_vacia_se_guarda_como_null(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        headers = _registrar(cliente, "ana@example.com")
        vacia = cliente.post(
            "/categorias",
            json={"nombre": "Luz", "descripcion": ""},
            headers=headers,
        )
        assert vacia.status_code == 201
        assert vacia.json()["descripcion"] is None
        assert "descripcion" in vacia.json()

        espacios = cliente.post(
            "/categorias",
            json={"nombre": "Agua", "descripcion": "   "},
            headers=headers,
        )
        assert espacios.status_code == 201
        assert espacios.json()["descripcion"] is None

        ausente = cliente.post("/categorias", json={"nombre": "Gas"}, headers=headers)
        assert ausente.status_code == 201
        assert ausente.json()["descripcion"] is None

        nula = cliente.post(
            "/categorias",
            json={"nombre": "Expensas", "descripcion": None},
            headers=headers,
        )
        assert nula.status_code == 201
        assert nula.json()["descripcion"] is None

        lista = cliente.get("/categorias", headers=headers)
        assert all(item["descripcion"] is None for item in lista.json()["items"])

        con_texto = cliente.patch(
            f"/categorias/{ausente.json()['id']}",
            json={"nombre": "Gas", "descripcion": "del mes"},
            headers=headers,
        )
        assert con_texto.status_code == 200
        assert con_texto.json()["descripcion"] == "del mes"

        limpia = cliente.patch(
            f"/categorias/{ausente.json()['id']}",
            json={"nombre": "Gas"},
            headers=headers,
        )
        assert limpia.status_code == 200
        assert limpia.json() == {
            "id": ausente.json()["id"],
            "nombre": "Gas",
            "descripcion": None,
        }
        assert (
            cliente.get("/categorias", headers=headers).json()["items"][2]["descripcion"] is None
        )
