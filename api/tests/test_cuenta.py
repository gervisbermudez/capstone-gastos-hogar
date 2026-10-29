"""Cambio de email, contraseña y baja. No usa Redis ni la red."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from app import archivos, auth, rag, repositorio

from app.rutas_auth import router

FACTURA_A = {
    "proveedor": "Edenor",
    "categoria": "servicios",
    "periodo": "2026-03",
    "monto": "10.10",
    "moneda": "ARS",
}
FACTURA_B = {
    "proveedor": "Consorcio",
    "categoria": "expensas",
    "periodo": "2026-03",
    "monto": "0.20",
    "moneda": "ARS",
}
CLAVE = "una frase larga"
CLAVE_NUEVA = "otra frase distinta"
DETALLE_CLAVE = "La contraseña no coincide."


def _entorno(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "gastos.db"))
    monkeypatch.setenv("JWT_SECRET", "secreto-de-test-aislado-con-32-bytes")


def _cliente() -> TestClient:
    aplicacion = FastAPI()
    aplicacion.include_router(router)
    return TestClient(aplicacion)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _baja(cliente: TestClient, token: str | None, password: str, extra: dict | None = None):
    cuerpo = {"password": password}
    if extra:
        cuerpo.update(extra)
    headers = _bearer(token) if token else None
    return cliente.request("DELETE", "/auth/cuenta", json=cuerpo, headers=headers)


async def _hash(user_id: str) -> str:
    fila = await repositorio.buscar_usuario_por_id(user_id)
    assert fila is not None
    return fila["password_hash"]


def _registrar(cliente: TestClient, email: str, password: str = CLAVE) -> dict:
    respuesta = cliente.post("/auth/registro", json={"email": email, "password": password})
    assert respuesta.status_code == 201
    return respuesta.json()


def test_registro_rechaza_clave_corta_y_el_login_acepta_una_ya_guardada(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        corta = cliente.post("/auth/registro", json={"email": "corta@example.com", "password": "abc"})
        assert corta.status_code == 422
        enorme = cliente.post(
            "/auth/registro",
            json={"email": "enorme@example.com", "password": "a" * 129},
        )
        assert enorme.status_code == 422

        async def alta() -> None:
            await repositorio.crear_usuario("vieja@example.com", auth.hashear("abc"))

        asyncio.run(alta())
        login = cliente.post("/auth/login", json={"email": "vieja@example.com", "password": "abc"})
        assert login.status_code == 200
        token = login.json()["access_token"]
        rango = cliente.get(
            "/resumen",
            params={"desde": "2026-12", "hasta": "2026-01"},
            headers=_bearer(token),
        )
        assert rango.status_code == 422


def test_consulta_demasiado_larga() -> None:
    from pydantic import ValidationError

    from app.esquemas import ConsultaTarea

    ConsultaTarea(query="a" * 2000)
    try:
        ConsultaTarea(query="a" * 2001)
    except ValidationError:
        return
    raise AssertionError("una consulta de 2001 caracteres tenía que ser inválida")


def test_cambiar_email_normaliza_y_el_token_sigue(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        alta = _registrar(cliente, "Ada@Example.com")
        user_id = alta["user_id"]
        token = alta["access_token"]
        headers = _bearer(token)
        antes = asyncio.run(_hash(user_id))

        cambio = cliente.post(
            "/auth/email",
            json={"email": "  Nueva@Example.com ", "password": CLAVE},
            headers=headers,
        )
        assert cambio.status_code == 200
        assert cambio.json() == {"user_id": user_id, "email": "nueva@example.com", "nombre": None}
        assert "password_hash" not in cambio.json()

        yo = cliente.get("/auth/me", headers=headers)
        assert yo.status_code == 200
        assert yo.json() == {"user_id": user_id, "email": "nueva@example.com", "nombre": None}

        login = cliente.post(
            "/auth/login",
            json={"email": "Nueva@Example.com", "password": CLAVE},
        )
        assert login.status_code == 200
        assert login.json()["user_id"] == user_id
        viejo = cliente.post(
            "/auth/login",
            json={"email": "ada@example.com", "password": CLAVE},
        )
        assert viejo.status_code == 401

        mismo = cliente.post(
            "/auth/email",
            json={"email": "NUEVA@example.com", "password": CLAVE},
            headers=headers,
        )
        assert mismo.status_code == 200
        assert mismo.json() == {"user_id": user_id, "email": "nueva@example.com", "nombre": None}
        assert asyncio.run(_hash(user_id)) == antes


def test_email_de_otra_cuenta_es_409(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada = _registrar(cliente, "ada@example.com")
        grace = _registrar(cliente, "grace@example.com", "clave-de-grace-larga")
        headers = _bearer(ada["access_token"])
        antes = asyncio.run(_hash(ada["user_id"]))

        tomado = cliente.post(
            "/auth/email",
            json={"email": "Grace@Example.com", "password": CLAVE},
            headers=headers,
        )
        assert tomado.status_code == 409
        assert tomado.json()["detail"] == "Ese email ya está registrado"

        yo = cliente.get("/auth/me", headers=headers)
        assert yo.status_code == 200
        assert yo.json() == {"user_id": ada["user_id"], "email": "ada@example.com", "nombre": None}
        assert asyncio.run(_hash(ada["user_id"])) == antes
        sigue = cliente.post(
            "/auth/login",
            json={"email": "ada@example.com", "password": CLAVE},
        )
        assert sigue.status_code == 200
        ajena = cliente.post(
            "/auth/login",
            json={"email": "grace@example.com", "password": "clave-de-grace-larga"},
        )
        assert ajena.status_code == 200
        assert ajena.json()["user_id"] == grace["user_id"]


def test_clave_incorrecta_no_cambia_nada(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        alta = _registrar(cliente, "ada@example.com")
        user_id = alta["user_id"]
        headers = _bearer(alta["access_token"])

        async def sembrar() -> str:
            documento = await repositorio.guardar_borrador(
                user_id=user_id,
                texto="factura privada de ada",
                campos={"proveedor": "Edenor"},
                advertencias=[],
            )
            await repositorio.confirmar_documento(
                user_id=user_id,
                documento_id=documento,
                campos=FACTURA_A,
            )
            await repositorio.anotar_mensaje(
                user_id=user_id,
                thread_id="hilo-ada",
                rol="persona",
                texto="mensaje que tiene que seguir",
            )
            await archivos.guardar_archivo(
                user_id=user_id,
                documento_id=documento,
                datos=b"bytes-de-ada",
            )
            return documento

        documento = asyncio.run(sembrar())
        antes = asyncio.run(_hash(user_id))
        mal = "no es esa frase"

        email = cliente.post(
            "/auth/email",
            json={"email": "otra@example.com", "password": mal},
            headers=headers,
        )
        clave = cliente.post(
            "/auth/password",
            json={"password_actual": mal, "password_nueva": CLAVE_NUEVA},
            headers=headers,
        )
        baja = _baja(cliente, alta["access_token"], mal)
        for respuesta in (email, clave, baja):
            assert respuesta.status_code == 401
            assert respuesta.json()["detail"] == DETALLE_CLAVE

        assert asyncio.run(_hash(user_id)) == antes
        yo = cliente.get("/auth/me", headers=headers)
        assert yo.status_code == 200
        assert yo.json()["email"] == "ada@example.com"
        assert cliente.post(
            "/auth/login",
            json={"email": "ada@example.com", "password": CLAVE},
        ).status_code == 200
        assert cliente.post(
            "/auth/login",
            json={"email": "ada@example.com", "password": CLAVE_NUEVA},
        ).status_code == 401

        async def sigue() -> None:
            guardado = await repositorio.obtener_documento(user_id=user_id, documento_id=documento)
            assert guardado is not None
            assert guardado["estado"] == "confirmado"
            assert guardado["campos"]["proveedor"] == "Edenor"
            hilo = await repositorio.obtener_hilo(user_id=user_id, thread_id="hilo-ada")
            assert hilo is not None
            assert hilo["mensajes"][0]["texto"] == "mensaje que tiene que seguir"
            leido = await archivos.leer_archivo(user_id, documento)
            assert leido is not None
            assert leido[0] == b"bytes-de-ada"

        asyncio.run(sigue())


def test_cambiar_password_y_el_token_sigue(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        alta = _registrar(cliente, "ada@example.com")
        user_id = alta["user_id"]
        headers = _bearer(alta["access_token"])
        antes = asyncio.run(_hash(user_id))

        falta = cliente.post(
            "/auth/password",
            json={"password_actual": CLAVE},
            headers=headers,
        )
        vacia = cliente.post(
            "/auth/password",
            json={"password_actual": CLAVE, "password_nueva": ""},
            headers=headers,
        )
        assert falta.status_code == 422
        assert vacia.status_code == 422
        assert asyncio.run(_hash(user_id)) == antes

        cambio = cliente.post(
            "/auth/password",
            json={"password_actual": CLAVE, "password_nueva": CLAVE_NUEVA},
            headers=headers,
        )
        assert cambio.status_code == 204
        assert cambio.content == b""
        assert asyncio.run(_hash(user_id)) != antes

        yo = cliente.get("/auth/me", headers=headers)
        assert yo.status_code == 200
        assert yo.json()["email"] == "ada@example.com"
        vieja = cliente.post(
            "/auth/login",
            json={"email": "ada@example.com", "password": CLAVE},
        )
        assert vieja.status_code == 401
        nueva = cliente.post(
            "/auth/login",
            json={"email": "Ada@example.com", "password": CLAVE_NUEVA},
        )
        assert nueva.status_code == 200
        assert nueva.json()["user_id"] == user_id


def test_user_id_en_el_body_es_422(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        alta = _registrar(cliente, "ada@example.com")
        headers = _bearer(alta["access_token"])
        antes = asyncio.run(_hash(alta["user_id"]))
        pedido = {"user_id": alta["user_id"]}

        email = cliente.post(
            "/auth/email",
            json={"email": "otra@example.com", "password": CLAVE, **pedido},
            headers=headers,
        )
        clave = cliente.post(
            "/auth/password",
            json={"password_actual": CLAVE, "password_nueva": CLAVE_NUEVA, **pedido},
            headers=headers,
        )
        baja = _baja(cliente, alta["access_token"], CLAVE, pedido)
        assert email.status_code == 422
        assert clave.status_code == 422
        assert baja.status_code == 422
        assert asyncio.run(_hash(alta["user_id"])) == antes
        yo = cliente.get("/auth/me", headers=headers)
        assert yo.status_code == 200
        assert yo.json()["email"] == "ada@example.com"

        sin_token = cliente.get("/auth/me")
        for respuesta in (
            cliente.post(
                "/auth/email",
                json={"email": "otra@example.com", "password": CLAVE},
            ),
            cliente.post(
                "/auth/password",
                json={"password_actual": CLAVE, "password_nueva": CLAVE_NUEVA},
            ),
            _baja(cliente, None, CLAVE),
        ):
            assert respuesta.status_code == 401
            assert respuesta.json()["detail"] == sin_token.json()["detail"]


class _IndiceRemoto:
    def __init__(self, error: Exception | None = None) -> None:
        self.llamadas: list[dict] = []
        self._error = error

    def delete(self, **kwargs) -> None:
        self.llamadas.append(dict(kwargs))
        if self._error is not None:
            raise self._error


def _estado_rag() -> tuple:
    return (rag.INDICE_LOCAL, rag._documentos, rag._usar_pinecone)


def _restaurar_rag(estado: tuple) -> None:
    rag.INDICE_LOCAL, rag._documentos, rag._usar_pinecone = estado


async def _sembrar_dos() -> dict:
    ana = await repositorio.crear_usuario("ana@example.com", auth.hashear("clave-de-ana-larga"))
    beto = await repositorio.crear_usuario("beto@example.com", auth.hashear("clave-de-beto-larga"))
    doc_ana = await repositorio.guardar_borrador(
        user_id=ana,
        texto="factura privada de ana",
        campos={"proveedor": "Edenor"},
        advertencias=[],
    )
    await repositorio.confirmar_documento(user_id=ana, documento_id=doc_ana, campos=FACTURA_A)
    draft_ana = await repositorio.guardar_borrador(
        user_id=ana,
        texto="borrador de ana",
        campos={},
        advertencias=[],
    )
    await repositorio.anotar_mensaje(
        user_id=ana,
        thread_id="hilo-ana",
        rol="persona",
        texto="mensaje privado de ana",
    )
    await repositorio.crear_categoria(user_id=ana, nombre="Colegio", descripcion=None)
    doc_beto = await repositorio.guardar_borrador(
        user_id=beto,
        texto="factura privada de beto",
        campos={"proveedor": "Consorcio"},
        advertencias=[],
    )
    await repositorio.confirmar_documento(user_id=beto, documento_id=doc_beto, campos=FACTURA_B)
    draft_beto = await repositorio.guardar_borrador(
        user_id=beto,
        texto="borrador de beto",
        campos={},
        advertencias=[],
    )
    await repositorio.anotar_mensaje(
        user_id=beto,
        thread_id="hilo-beto",
        rol="persona",
        texto="mensaje privado de beto",
    )
    await repositorio.crear_categoria(user_id=beto, nombre="Colegio", descripcion=None)
    await archivos.guardar_archivo(user_id=ana, documento_id=doc_ana, datos=b"bytes-de-ana")
    await archivos.guardar_archivo(user_id=beto, documento_id=doc_beto, datos=b"bytes-de-beto")
    return {
        "ana": ana,
        "beto": beto,
        "doc_ana": doc_ana,
        "doc_beto": doc_beto,
        "draft_ana": draft_ana,
        "draft_beto": draft_beto,
    }


def _indexar(tmp_path: Path, datos: dict) -> Path:
    ruta = tmp_path / "comprobantes.jsonl"
    rag._usar_pinecone = False
    rag.preparar_indice_local(ruta)
    rag.indexar_sync(
        user_id=datos["ana"],
        documento_id=datos["doc_ana"],
        texto="factura privada de ana",
        categoria="servicios",
        periodo="2026-03",
        proveedor="Edenor",
    )
    rag.indexar_sync(
        user_id=datos["beto"],
        documento_id=datos["doc_beto"],
        texto="factura privada de beto",
        categoria="expensas",
        periodo="2026-03",
        proveedor="Consorcio",
    )
    return ruta


def _filas_indice(ruta: Path) -> list[dict]:
    texto = ruta.read_text(encoding="utf-8")
    return [json.loads(linea) for linea in texto.splitlines() if linea.strip()]


async def _ajeno_intacto(datos: dict) -> None:
    ana = datos["ana"]
    beto = datos["beto"]
    assert await repositorio.buscar_usuario_por_id(ana) is None
    assert await repositorio.obtener_documento(user_id=ana, documento_id=datos["doc_ana"]) is None
    assert await repositorio.obtener_documento(user_id=ana, documento_id=datos["draft_ana"]) is None
    assert await repositorio.obtener_hilo(user_id=ana, thread_id="hilo-ana") is None
    assert await repositorio.listar_categorias(user_id=ana) == []
    assert await archivos.leer_archivo(ana, datos["doc_ana"]) is None

    confirmado = await repositorio.obtener_documento(user_id=beto, documento_id=datos["doc_beto"])
    assert confirmado is not None
    assert confirmado["estado"] == "confirmado"
    assert confirmado["campos"]["proveedor"] == "Consorcio"
    borrador = await repositorio.obtener_documento(user_id=beto, documento_id=datos["draft_beto"])
    assert borrador is not None
    assert borrador["estado"] == "borrador"
    assert borrador["texto"] == "borrador de beto"
    hilo = await repositorio.obtener_hilo(user_id=beto, thread_id="hilo-beto")
    assert hilo is not None
    assert hilo["mensajes"][0]["texto"] == "mensaje privado de beto"
    assert [item["nombre"] for item in await repositorio.listar_categorias(user_id=beto)] == ["Colegio"]
    leido = await archivos.leer_archivo(beto, datos["doc_beto"])
    assert leido is not None
    assert leido[0] == b"bytes-de-beto"
    raiz = archivos.directorio_archivos().resolve()
    assert raiz.is_dir()
    assert (raiz / beto).is_dir()
    assert not (raiz / ana).exists()


def _indice_ajeno(ruta: Path, datos: dict) -> None:
    filas = _filas_indice(ruta)
    assert filas
    assert {fila["user_id"] for fila in filas} == {datos["beto"]}
    assert any(fila["documento_id"] == datos["doc_beto"] for fila in filas)
    assert all("privada de ana" not in str(fila.get("texto")) for fila in filas)


def test_baja_no_toca_datos_ajenos(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    anterior = _estado_rag()
    remoto = _IndiceRemoto()
    monkeypatch.setattr(rag, "_store_pinecone", lambda: remoto)
    try:
        datos = asyncio.run(_sembrar_dos())
        ruta = _indexar(tmp_path, datos)
        with _cliente() as cliente:
            token = auth.emitir_token(datos["ana"])
            baja = _baja(cliente, token, "clave-de-ana-larga")
            assert baja.status_code == 204
            assert baja.content == b""
            yo = cliente.get("/auth/me", headers=_bearer(token))
            assert yo.status_code == 401
            sin_token = cliente.get("/auth/me")
            assert yo.json()["detail"] == sin_token.json()["detail"]
            beto = cliente.get("/auth/me", headers=_bearer(auth.emitir_token(datos["beto"])))
            assert beto.status_code == 200
            assert beto.json() == {
                "user_id": datos["beto"],
                "email": "beto@example.com",
                "nombre": None,
            }
        assert remoto.llamadas == [
            {"filter": {"user_id": datos["ana"]}, "namespace": "comprobantes"}
        ]
        _indice_ajeno(ruta, datos)
        asyncio.run(_ajeno_intacto(datos))
    finally:
        _restaurar_rag(anterior)


def test_baja_responde_204_si_pinecone_falla(tmp_path, monkeypatch, caplog) -> None:
    _entorno(monkeypatch, tmp_path)
    anterior = _estado_rag()
    remoto = _IndiceRemoto(RuntimeError("secreto-de-pinecone"))
    monkeypatch.setattr(rag, "_store_pinecone", lambda: remoto)
    try:
        datos = asyncio.run(_sembrar_dos())
        ruta = _indexar(tmp_path, datos)
        with _cliente() as cliente:
            token = auth.emitir_token(datos["ana"])
            baja = _baja(cliente, token, "clave-de-ana-larga")
            assert baja.status_code == 204
            assert baja.content == b""
            assert "secreto-de-pinecone" not in baja.text
            yo = cliente.get("/auth/me", headers=_bearer(token))
            assert yo.status_code == 401
        assert remoto.llamadas == [
            {"filter": {"user_id": datos["ana"]}, "namespace": "comprobantes"}
        ]
        assert "RuntimeError" in caplog.text
        assert "secreto-de-pinecone" not in caplog.text
        _indice_ajeno(ruta, datos)
        asyncio.run(_ajeno_intacto(datos))
    finally:
        _restaurar_rag(anterior)


def _alta(cliente: TestClient, email: str = "ada@example.com") -> tuple[str, dict[str, str]]:
    alta = _registrar(cliente, email)
    return alta["user_id"], _bearer(alta["access_token"])


def _claves_de_prueba(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-no-sale")
    monkeypatch.setenv("GEMINI_API_KEY", "sk-gemini-no-sale")

    def explotar():
        raise RuntimeError("no hay que armar el cliente")

    monkeypatch.setattr("app.llm.armar_llm", explotar)


def _assert_sin_claves(respuesta) -> None:
    assert set(respuesta.json()) == {"proveedor", "modelo"}
    texto = respuesta.text.lower()
    assert "api_key" not in texto
    assert "openai_api_key" not in texto
    assert "gemini_api_key" not in texto
    assert "sk-openai-no-sale" not in respuesta.text
    assert "sk-gemini-no-sale" not in respuesta.text


def test_guardar_nombre_y_me_lo_devuelve(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        user_id, headers = _alta(cliente)
        cambio = cliente.post("/auth/nombre", json={"nombre": "Ada"}, headers=headers)
        assert cambio.status_code == 200
        assert cambio.json() == {
            "user_id": user_id,
            "email": "ada@example.com",
            "nombre": "Ada",
        }
        yo = cliente.get("/auth/me", headers=headers)
        assert yo.status_code == 200
        assert yo.json() == cambio.json()


def test_nombre_recorta_espacios(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        user_id, headers = _alta(cliente)
        cambio = cliente.post(
            "/auth/nombre",
            json={"nombre": "  Ana María_2-b  "},
            headers=headers,
        )
        assert cambio.status_code == 200
        assert cambio.json() == {
            "user_id": user_id,
            "email": "ada@example.com",
            "nombre": "Ana María_2-b",
        }
        yo = cliente.get("/auth/me", headers=headers)
        assert yo.json()["nombre"] == "Ana María_2-b"


def test_vacio_y_null_borran_el_nombre(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        user_id, headers = _alta(cliente)
        esperado = {"user_id": user_id, "email": "ada@example.com", "nombre": None}
        for valor in ("", "   ", " " * 41, None):
            puesto = cliente.post("/auth/nombre", json={"nombre": "Ada"}, headers=headers)
            assert puesto.status_code == 200
            assert puesto.json()["nombre"] == "Ada"
            borrado = cliente.post("/auth/nombre", json={"nombre": valor}, headers=headers)
            assert borrado.status_code == 200
            assert borrado.json() == esperado
            yo = cliente.get("/auth/me", headers=headers)
            assert yo.json() == esperado


def test_nombre_de_41_caracteres_es_422(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        user_id, headers = _alta(cliente)
        puesto = cliente.post("/auth/nombre", json={"nombre": "Ada"}, headers=headers)
        assert puesto.status_code == 200
        largo = cliente.post("/auth/nombre", json={"nombre": "á" * 41}, headers=headers)
        assert largo.status_code == 422
        yo = cliente.get("/auth/me", headers=headers)
        assert yo.json()["nombre"] == "Ada"
        justo = cliente.post(
            "/auth/nombre",
            json={"nombre": f"  {'á' * 40}  "},
            headers=headers,
        )
        assert justo.status_code == 200
        assert justo.json() == {
            "user_id": user_id,
            "email": "ada@example.com",
            "nombre": "á" * 40,
        }


def test_nombre_con_caracteres_invalidos_es_422(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        _, headers = _alta(cliente)
        puesto = cliente.post("/auth/nombre", json={"nombre": "Ada"}, headers=headers)
        assert puesto.status_code == 200
        for valor in ("Ada@", "hola!", "a/b", "Ada😀"):
            malo = cliente.post("/auth/nombre", json={"nombre": valor}, headers=headers)
            assert malo.status_code == 422
            yo = cliente.get("/auth/me", headers=headers)
            assert yo.json()["nombre"] == "Ada"


def test_nombre_no_pide_contrasena(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        user_id, headers = _alta(cliente)
        antes = asyncio.run(_hash(user_id))
        cambio = cliente.post("/auth/nombre", json={"nombre": "Ada"}, headers=headers)
        assert cambio.status_code == 200
        assert cambio.json()["nombre"] == "Ada"
        assert "password" not in cambio.json()
        assert asyncio.run(_hash(user_id)) == antes
        con_clave = cliente.post(
            "/auth/nombre",
            json={"nombre": "Otra", "password": CLAVE},
            headers=headers,
        )
        assert con_clave.status_code == 422
        yo = cliente.get("/auth/me", headers=headers)
        assert yo.json()["nombre"] == "Ada"
        assert asyncio.run(_hash(user_id)) == antes


def test_dos_usuarios_pueden_repetir_el_nombre(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        ada_id, ada = _alta(cliente, "ada@example.com")
        grace_id, grace = _alta(cliente, "grace@example.com")
        for headers in (ada, grace):
            cambio = cliente.post("/auth/nombre", json={"nombre": "Casa"}, headers=headers)
            assert cambio.status_code == 200
            assert cambio.json()["nombre"] == "Casa"
        yo_ada = cliente.get("/auth/me", headers=ada)
        yo_grace = cliente.get("/auth/me", headers=grace)
        assert yo_ada.json() == {
            "user_id": ada_id,
            "email": "ada@example.com",
            "nombre": "Casa",
        }
        assert yo_grace.json() == {
            "user_id": grace_id,
            "email": "grace@example.com",
            "nombre": "Casa",
        }
        assert ada_id != grace_id


def test_nombre_sin_token_es_401(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        sin_token = cliente.post("/auth/nombre", json={"nombre": "Ada"})
        assert sin_token.status_code == 401
        me = cliente.get("/auth/me")
        assert sin_token.json()["detail"] == me.json()["detail"]


def test_cambiar_email_conserva_el_nombre(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        user_id, headers = _alta(cliente)
        puesto = cliente.post(
            "/auth/nombre",
            json={"nombre": "Ada Lovelace"},
            headers=headers,
        )
        assert puesto.status_code == 200
        cambio = cliente.post(
            "/auth/email",
            json={"email": "  Nueva@Example.com ", "password": CLAVE},
            headers=headers,
        )
        assert cambio.status_code == 200
        assert cambio.json() == {
            "user_id": user_id,
            "email": "nueva@example.com",
            "nombre": "Ada Lovelace",
        }
        yo = cliente.get("/auth/me", headers=headers)
        assert yo.json() == cambio.json()


def test_modelo_sin_token_es_401(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    with _cliente() as cliente:
        sin_token = cliente.get("/auth/modelo")
        assert sin_token.status_code == 401
        me = cliente.get("/auth/me")
        assert sin_token.json()["detail"] == me.json()["detail"]


def test_modelo_openai(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    _claves_de_prueba(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-prueba")
    monkeypatch.setenv("GEMINI_MODEL", "no-es-este")
    with _cliente() as cliente:
        _, headers = _alta(cliente)
        respuesta = cliente.get("/auth/modelo", headers=headers)
        assert respuesta.status_code == 200
        assert respuesta.json() == {"proveedor": "openai", "modelo": "gpt-prueba"}
        _assert_sin_claves(respuesta)

        monkeypatch.setenv("LLM_PROVIDER", "  OpenAI ")
        monkeypatch.setenv("OPENAI_MODEL", "  gpt-recortado  ")
        recortado = cliente.get("/auth/modelo", headers=headers)
        assert recortado.status_code == 200
        assert recortado.json() == {"proveedor": "openai", "modelo": "gpt-recortado"}

        monkeypatch.setenv("LLM_PROVIDER", "anthropic")
        monkeypatch.setenv("OPENAI_MODEL", "gpt-fallback")
        otro = cliente.get("/auth/modelo", headers=headers)
        assert otro.status_code == 200
        assert otro.json() == {"proveedor": "openai", "modelo": "gpt-fallback"}
        _assert_sin_claves(otro)


def test_modelo_gemini(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    _claves_de_prueba(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-prueba")
    monkeypatch.setenv("OPENAI_MODEL", "no-es-este")
    with _cliente() as cliente:
        _, headers = _alta(cliente)
        respuesta = cliente.get("/auth/modelo", headers=headers)
        assert respuesta.status_code == 200
        assert respuesta.json() == {"proveedor": "gemini", "modelo": "gemini-prueba"}
        _assert_sin_claves(respuesta)

        monkeypatch.setenv("LLM_PROVIDER", "  GEMINI  ")
        monkeypatch.setenv("GEMINI_MODEL", "  gemini-recortado  ")
        recortado = cliente.get("/auth/modelo", headers=headers)
        assert recortado.status_code == 200
        assert recortado.json() == {"proveedor": "gemini", "modelo": "gemini-recortado"}
        _assert_sin_claves(recortado)


def test_modelo_ausente_es_null(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)
    _claves_de_prueba(monkeypatch)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    with _cliente() as cliente:
        _, headers = _alta(cliente)
        respuesta = cliente.get("/auth/modelo", headers=headers)
        assert respuesta.status_code == 200
        assert respuesta.json() == {"proveedor": "openai", "modelo": None}
        _assert_sin_claves(respuesta)

        monkeypatch.setenv("OPENAI_MODEL", "   ")
        vacio = cliente.get("/auth/modelo", headers=headers)
        assert vacio.status_code == 200
        assert vacio.json() == {"proveedor": "openai", "modelo": None}

        monkeypatch.setenv("LLM_PROVIDER", "gemini")
        monkeypatch.delenv("GEMINI_MODEL", raising=False)
        monkeypatch.setenv("OPENAI_MODEL", "gpt-presente")
        gemini = cliente.get("/auth/modelo", headers=headers)
        assert gemini.status_code == 200
        assert gemini.json() == {"proveedor": "gemini", "modelo": None}
        _assert_sin_claves(gemini)
