"""Ingesta de foto y PDF, sin red y sin Redis.

El PDF se genera en el test. El modelo es un doble con ``ainvoke``.
La app de prueba monta solo el router de documentos y pisa ``usuario_actual``.
Si ``app.repositorio`` importa, la base es un SQLite temporal. Si no, un doble
con las mismas firmas.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import sys
import types
import uuid
from pathlib import Path

import pymupdf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

_FIRMAS = (
    "guardar_borrador",
    "obtener_documento",
    "listar_documentos",
    "confirmar_documento",
)

FRASE = "Factura Edenor periodo 2026-03 monto 18500.50 servicio de luz"
MARCA_VISION = "NO-USAR-COMO-TEXTO"
WEBP = bytes.fromhex(
    "5249464634000000574542505650382028000000"
    "7001009d012a0800080003805a25a00274017500"
    "00feebde2d717364451ffc6f1fe4bbfb77d94000"
)
FACTURA = {
    "proveedor": "Edenor",
    "categoria": "servicios",
    "periodo": "2026-03",
    "monto": "18500.50",
}


def _instalar_falso():
    modulo = types.ModuleType("app.repositorio")
    docs: dict[str, dict] = {}
    modulo._docs = docs
    modulo.confirmados = []

    async def guardar_borrador(*, user_id, texto, campos, advertencias) -> str:
        if not isinstance(advertencias, list) or any(not isinstance(item, str) for item in advertencias):
            raise ValueError("advertencias")
        documento_id = str(uuid.uuid4())
        docs[documento_id] = {
            "user_id": user_id,
            "texto": texto,
            "campos": {clave: valor for clave, valor in dict(campos).items() if valor is not None},
            "advertencias": list(advertencias),
            "estado": "borrador",
            "orden": len(docs) + 1,
        }
        return documento_id

    async def obtener_documento(*, user_id, documento_id):
        doc = docs.get(documento_id)
        if doc is None or doc["user_id"] != user_id:
            return None
        if doc["estado"] == "confirmado":
            return {"id": documento_id, "estado": "confirmado", "campos": doc["campos"]}
        return {
            "id": documento_id,
            "estado": "borrador",
            "campos": doc["campos"],
            "texto": doc["texto"],
            "advertencias": doc["advertencias"],
        }

    async def listar_documentos(*, user_id):
        propios = [(documento_id, doc) for documento_id, doc in docs.items() if doc["user_id"] == user_id]
        propios.sort(key=lambda par: par[1]["orden"], reverse=True)
        return [
            {"id": documento_id, "estado": doc["estado"], "campos": doc["campos"]}
            for documento_id, doc in propios
        ]

    async def confirmar_documento(*, user_id, documento_id, campos):
        doc = docs.get(documento_id)
        if doc is None or doc["user_id"] != user_id:
            return None
        if doc["estado"] != "confirmado":
            for clave in ("proveedor", "categoria", "periodo", "monto"):
                if not campos.get(clave):
                    raise ValueError(clave)
            doc["estado"] = "confirmado"
            doc["campos"] = {
                clave: valor for clave, valor in dict(campos).items() if valor is not None
            }
            modulo.confirmados.append({"id": documento_id, "user_id": user_id})
        return {
            "id": documento_id,
            "estado": "confirmado",
            "campos": doc["campos"],
            "texto": doc["texto"],
        }

    modulo.guardar_borrador = guardar_borrador
    modulo.obtener_documento = obtener_documento
    modulo.listar_documentos = listar_documentos
    modulo.confirmar_documento = confirmar_documento
    sys.modules["app.repositorio"] = modulo
    return modulo


def _elegir_repo():
    try:
        import app.repositorio as repo
    except ModuleNotFoundError:
        return _instalar_falso(), False
    if all(callable(getattr(repo, nombre, None)) for nombre in _FIRMAS):
        return repo, True
    return _instalar_falso(), False


REPO, REPO_REAL = _elegir_repo()

from app.auth import usuario_actual
from app.extraccion import (
    LecturaFactura,
    detectar_tipo,
    extraer,
    normalizar_fecha,
    normalizar_monto,
    normalizar_periodo,
)
from app.ingesta import TAMANO_MAXIMO_BYTES
from app.rutas_documentos import router


class Doble:
    """Reemplaza al modelo. ``invoke`` sincrónico falla el test."""

    def __init__(self, lectura: LecturaFactura) -> None:
        self.lectura = lectura
        self.esquema = None
        self.mensajes = None

    def with_structured_output(self, esquema):
        self.esquema = esquema
        return self

    async def ainvoke(self, mensajes):
        self.mensajes = mensajes
        return self.lectura

    def invoke(self, *args, **kwargs):
        raise AssertionError("la llamada al modelo no puede ser sincrónica")


class Roto:
    def __init__(self, mensaje: str) -> None:
        self.mensaje = mensaje

    def with_structured_output(self, esquema):
        return self

    async def ainvoke(self, mensajes):
        raise RuntimeError(self.mensaje)

    def invoke(self, *args, **kwargs):
        raise AssertionError("la llamada al modelo no puede ser sincrónica")


def lectura_completa(**cambios) -> LecturaFactura:
    datos = {
        "proveedor": "Edenor",
        "categoria": "servicios",
        "periodo": "2026-03",
        "monto": "18500.50",
        "moneda": "ARS",
        "transcripcion": MARCA_VISION,
    }
    datos.update(cambios)
    return LecturaFactura(**datos)


def pdf_con_frase(frase: str = FRASE) -> bytes:
    documento = pymupdf.open()
    try:
        pagina = documento.new_page()
        pagina.insert_text((72, 72), frase, fontsize=12, fontname="helv")
        return documento.tobytes()
    finally:
        documento.close()


def pdf_sin_texto(paginas: int = 3) -> bytes:
    documento = pymupdf.open()
    try:
        for _ in range(paginas):
            documento.new_page()
        return documento.tobytes()
    finally:
        documento.close()


def png_minimo() -> bytes:
    documento = pymupdf.open()
    try:
        pagina = documento.new_page(width=24, height=24)
        return pagina.get_pixmap(alpha=False).tobytes("png")
    finally:
        documento.close()


def jpeg_minimo() -> bytes:
    documento = pymupdf.open()
    try:
        pagina = documento.new_page(width=24, height=24)
        return pagina.get_pixmap(alpha=False).tobytes("jpeg")
    finally:
        documento.close()


def _bloques(mensajes) -> list:
    bloques = []
    for mensaje in mensajes:
        contenido = mensaje.content
        if isinstance(contenido, str):
            bloques.append(contenido)
        elif isinstance(contenido, list):
            bloques.extend(contenido)
    return bloques


def _texto_de_mensajes(mensajes) -> str:
    partes = []
    for bloque in _bloques(mensajes):
        if isinstance(bloque, str):
            partes.append(bloque)
        elif isinstance(bloque, dict) and bloque.get("type") == "text":
            partes.append(str(bloque.get("text") or ""))
    return "\n".join(partes)


def _urls(mensajes) -> list[str]:
    urls = []
    for bloque in _bloques(mensajes):
        if isinstance(bloque, dict) and bloque.get("type") == "image_url":
            imagen = bloque.get("image_url") or {}
            urls.append(imagen.get("url") or "")
    return urls


def cliente_de(user_id: str, email: str) -> TestClient:
    aplicacion = FastAPI()
    aplicacion.include_router(router)
    aplicacion.dependency_overrides[usuario_actual] = lambda: {
        "user_id": user_id,
        "email": email,
    }
    return TestClient(aplicacion)


def subir(cliente: TestClient, datos: bytes, nombre: str, content_type: str = "application/octet-stream"):
    return cliente.post(
        "/documentos",
        files={"archivo": (nombre, datos, content_type)},
    )


def libro(user_id: str) -> dict | list:
    if REPO_REAL:
        return asyncio.run(REPO.resumen(user_id=user_id, desde="2020-01", hasta="2030-12"))
    return [item for item in REPO.confirmados if item["user_id"] == user_id]


def assert_libro_vacio(user_id: str) -> None:
    if REPO_REAL:
        datos = libro(user_id)
        assert datos["comprobantes"] == []
        assert datos["por_mes"] == []
        return
    assert libro(user_id) == []


@pytest.fixture(autouse=True)
def base_temporal(tmp_path, monkeypatch):
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "gastos.db"))
    if not REPO_REAL:
        REPO._docs.clear()
        REPO.confirmados.clear()


@pytest.fixture(autouse=True)
def doble(monkeypatch):
    modelo = Doble(lectura_completa())
    monkeypatch.setattr("app.extraccion.armar_llm", lambda: modelo)
    return modelo


@pytest.fixture
def cuentas(base_temporal):
    if not REPO_REAL:
        return {"ada": "ada", "grace": "grace"}
    ada = asyncio.run(REPO.crear_usuario("ada@example.com", "hash-de-test"))
    grace = asyncio.run(REPO.crear_usuario("grace@example.com", "hash-de-test"))
    return {"ada": ada, "grace": grace}


def test_detectar_tipo_por_cabecera():
    assert detectar_tipo(b"%PDF-1.7") == "pdf"
    assert detectar_tipo(b"\x89PNG\r\n\x1a\n") == "png"
    assert detectar_tipo(b"\xff\xd8\xff\x00") == "jpeg"
    assert detectar_tipo(b"RIFF\x00\x00\x00\x00WEBP") == "webp"
    assert detectar_tipo(b"GIF89a") is None
    assert detectar_tipo(b"") is None


@pytest.mark.parametrize(
    ("crudo", "esperado"),
    [
        ("18500.50", "18500.50"),
        ("18500.5", "18500.50"),
        ("18500", "18500.00"),
        ("18.500,50", "18500.50"),
        ("$ 18.500,50", "18500.50"),
        ("ARS 18,500.50", "18500.50"),
        ("18500,5", "18500.50"),
        ("18500.505", None),
        ("-10.00", None),
    ],
)
def test_normalizar_monto(crudo, esperado):
    assert normalizar_monto(crudo) == esperado


@pytest.mark.parametrize(
    ("crudo", "esperado"),
    [
        ("2026-03", "2026-03"),
        ("2026/03", "2026-03"),
        ("03/2026", "2026-03"),
        ("marzo de 2026", "2026-03"),
        ("Marzo 2026", "2026-03"),
        ("2026-13", None),
    ],
)
def test_normalizar_periodo(crudo, esperado):
    assert normalizar_periodo(crudo) == esperado


def test_normalizar_fecha():
    assert normalizar_fecha("2026-03-15") == "2026-03-15"
    assert normalizar_fecha("15/03/2026") == "2026-03-15"
    assert normalizar_fecha("31/02/2026") is None


def test_preparacion_fuera_del_event_loop(monkeypatch, doble):
    vistos: list[str] = []
    real = asyncio.to_thread

    async def espia(funcion, /, *args, **kwargs):
        vistos.append(funcion.__name__)
        return await real(funcion, *args, **kwargs)

    monkeypatch.setattr("app.extraccion.asyncio.to_thread", espia)
    asyncio.run(extraer(pdf_con_frase()))
    assert "_preparar_pdf" in vistos
    assert doble.esquema is LecturaFactura
    assert _urls(doble.mensajes) == []
    assert "18500.50" in _texto_de_mensajes(doble.mensajes)

    vistos.clear()
    asyncio.run(extraer(png_minimo()))
    assert "_preparar_imagen" in vistos
    assert doble.esquema is LecturaFactura
    assert len(_urls(doble.mensajes)) == 1


def test_pdf_con_texto_no_usa_la_transcripcion(cuentas, doble, caplog):
    caplog.set_level(logging.INFO, logger="app.extraccion")
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        respuesta = subir(ada, pdf_con_frase(), "foto.jpg", "image/jpeg")
        assert respuesta.status_code == 201
        cuerpo = respuesta.json()
        assert cuerpo["estado"] == "borrador"
        assert "18500.50" in cuerpo["texto"]
        assert "Edenor" in cuerpo["texto"]
        assert MARCA_VISION not in cuerpo["texto"]
        assert cuerpo["campos"]["proveedor"] == "Edenor"
        assert cuerpo["campos"]["monto"] == "18500.50"
        assert "vencimiento" not in cuerpo["campos"]
        assert _urls(doble.mensajes) == []
        assert FRASE not in caplog.text
        assert_libro_vacio(cuentas["ada"])
        detalle = ada.get(f"/documentos/{cuerpo['id']}")
        assert detalle.status_code == 200
        assert detalle.json()["texto"] == cuerpo["texto"]
        lista = ada.get("/documentos")
        assert lista.status_code == 200
        assert lista.json()["items"] == [
            {"id": cuerpo["id"], "estado": "borrador", "campos": cuerpo["campos"]}
        ]
        assert "texto" not in lista.json()["items"][0]


def test_pdf_de_tres_paginas_manda_dos_imagenes(cuentas, doble):
    doble.lectura = lectura_completa(transcripcion="ajuste anual del alquiler")
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        respuesta = subir(ada, pdf_sin_texto(3), "escaneo.pdf", "application/pdf")
    assert respuesta.status_code == 201
    assert respuesta.json()["texto"] == "ajuste anual del alquiler"
    urls = _urls(doble.mensajes)
    assert len(urls) == 2
    assert all(url.startswith("data:image/png;base64,") for url in urls)
    assert doble.esquema is LecturaFactura


def test_webp_y_jpeg_van_por_vision(cuentas, doble):
    doble.lectura = lectura_completa(transcripcion="foto del comprobante")
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        webp = subir(ada, WEBP, "nota.pdf", "application/pdf")
        assert webp.status_code == 201
        assert webp.json()["texto"] == "foto del comprobante"
        assert _urls(doble.mensajes) == [
            "data:image/webp;base64," + base64.b64encode(WEBP).decode("ascii")
        ]
        jpeg = subir(ada, jpeg_minimo(), "comprobante.png", "image/png")
    assert jpeg.status_code == 201
    assert _urls(doble.mensajes)[0].startswith("data:image/jpeg;base64,")


def test_lectura_desprolija_se_normaliza_y_lo_invalido_se_advierte(cuentas, doble):
    doble.lectura = lectura_completa(
        categoria="Servicios",
        periodo="marzo de 2026",
        monto="$ 18.500,50",
        vencimiento="15/03/2026",
        transcripcion=MARCA_VISION,
    )
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        bien = subir(ada, pdf_con_frase(), "a.pdf")
    assert bien.status_code == 201
    campos = bien.json()["campos"]
    assert campos["categoria"] == "servicios"
    assert campos["periodo"] == "2026-03"
    assert campos["monto"] == "18500.50"
    assert campos["vencimiento"] == "2026-03-15"
    assert bien.json()["advertencias"] == []

    doble.lectura = lectura_completa(monto="18500.505", categoria="luz", proveedor="")
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        mal = subir(ada, pdf_con_frase(), "b.pdf")
    assert mal.status_code == 201
    assert "monto" not in mal.json()["campos"]
    assert "categoria" not in mal.json()["campos"]
    assert "proveedor" not in mal.json()["campos"]
    texto = " ".join(mal.json()["advertencias"])
    assert "monto" in texto
    assert "categoría" in texto
    assert "proveedor" in texto


def test_tipo_invalido_truncado_vacio_y_de_mas_no_llaman_al_modelo(cuentas, doble):
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        gif = subir(ada, b"GIF89a" + b"\x00" * 16, "foto.pdf", "application/pdf")
        assert gif.status_code == 415
        assert gif.json()["detail"] == "El archivo no es jpeg, png, webp ni pdf."
        webp_roto = subir(ada, WEBP[:20], "a.webp")
        assert webp_roto.status_code == 415
        jpeg_roto = subir(ada, b"\xff\xd8\xff\x00\x11", "a.jpg")
        assert jpeg_roto.status_code == 415
        pdf_roto = subir(ada, b"%PDF-1.4 esto no es un pdf", "a.pdf")
        assert pdf_roto.status_code == 422
        assert pdf_roto.json()["detail"] == "No se pudo abrir el PDF."
        assert "Traceback" not in pdf_roto.text
        vacio = subir(ada, b"", "vacio.pdf")
        assert vacio.status_code == 422
        assert vacio.json()["detail"] == "Falta el archivo."
        falta = ada.post("/documentos")
        assert falta.status_code == 422
        otro = ada.post(
            "/documentos",
            files={"otro": ("a.pdf", pdf_con_frase(), "application/pdf")},
        )
        assert otro.status_code == 422
        assert otro.json()["detail"] == "Se acepta un solo archivo."
        doble_archivo = ada.post(
            "/documentos",
            files=[
                ("archivo", ("a.pdf", pdf_con_frase(), "application/pdf")),
                ("archivo", ("b.pdf", pdf_con_frase(), "application/pdf")),
            ],
        )
        assert doble_archivo.status_code == 422
        gordo = ada.post(
            "/documentos",
            files={
                "archivo": (
                    "grande.bin",
                    b"x" * (TAMANO_MAXIMO_BYTES + 1),
                    "application/octet-stream",
                )
            },
        )
        assert gordo.status_code == 413
        assert gordo.json()["detail"] == "El archivo supera el tamaño máximo."
        assert ada.get("/documentos").json()["items"] == []
    assert doble.mensajes is None


def test_fallo_de_modelo_es_502_sin_fuga(cuentas, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="app.extraccion")
    monkeypatch.setattr(
        "app.extraccion.armar_llm",
        lambda: Roto(f"Bearer sk-secret %PDF {FRASE}"),
    )
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        respuesta = subir(ada, pdf_con_frase(), "a.pdf")
        assert respuesta.status_code == 502
        assert respuesta.json() == {"detail": "No se pudo leer el comprobante."}
        assert "Traceback" not in respuesta.text
        assert "sk-secret" not in respuesta.text
        assert FRASE not in respuesta.text
        assert ada.get("/documentos").json()["items"] == []
    assert "extracción falló: RuntimeError" in caplog.text
    assert "sk-secret" not in caplog.text
    assert FRASE not in caplog.text
    assert "%PDF" not in caplog.text
    assert_libro_vacio(cuentas["ada"])


def test_confirmar_indexa_y_recien_ahi_entra_al_libro(cuentas, doble, monkeypatch):
    llamadas: list[dict] = []
    modulo = types.ModuleType("app.indexacion")

    async def indexar_comprobante(*, user_id, documento_id, texto, categoria, periodo, proveedor):
        llamadas.append(
            {
                "user_id": user_id,
                "documento_id": documento_id,
                "texto": texto,
                "categoria": categoria,
                "periodo": periodo,
                "proveedor": proveedor,
            }
        )

    modulo.indexar_comprobante = indexar_comprobante
    monkeypatch.setitem(sys.modules, "app.indexacion", modulo)
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        creado = subir(ada, pdf_con_frase(), "a.pdf")
        assert creado.status_code == 201
        documento_id = creado.json()["id"]
        assert_libro_vacio(cuentas["ada"])
        intruso = ada.post(
            f"/documentos/{documento_id}/confirmar",
            json={**FACTURA, "proveedor": "Edenor SA", "user_id": "intruso"},
        )
        assert intruso.status_code == 422
        assert llamadas == []
        confirmado = ada.post(
            f"/documentos/{documento_id}/confirmar",
            json={**FACTURA, "proveedor": "Edenor SA"},
        )
        assert confirmado.status_code == 200
    cuerpo = confirmado.json()
    assert cuerpo["estado"] == "confirmado"
    assert cuerpo["campos"]["proveedor"] == "Edenor SA"
    assert cuerpo["campos"]["monto"] == "18500.50"
    assert "texto" not in cuerpo
    assert len(llamadas) == 1
    assert llamadas[0]["user_id"] == cuentas["ada"]
    assert llamadas[0]["documento_id"] == documento_id
    assert llamadas[0]["proveedor"] == "Edenor SA"
    assert llamadas[0]["categoria"] == "servicios"
    assert llamadas[0]["periodo"] == "2026-03"
    assert "18500.50" in llamadas[0]["texto"]
    assert MARCA_VISION not in llamadas[0]["texto"]
    if REPO_REAL:
        datos = libro(cuentas["ada"])
        assert datos["por_mes"] == [{"periodo": "2026-03", "total": "18500.50"}]
        assert len(datos["comprobantes"]) == 1


def test_sin_indexacion_la_confirmacion_igual_persiste(cuentas, monkeypatch):
    monkeypatch.setitem(sys.modules, "app.indexacion", None)
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        documento_id = subir(ada, pdf_con_frase(), "a.pdf").json()["id"]
        respuesta = ada.post(f"/documentos/{documento_id}/confirmar", json=FACTURA)
        assert respuesta.status_code == 200
        assert respuesta.json()["estado"] == "confirmado"
        assert respuesta.json()["indexado"] == "omitido"
        visto = ada.get(f"/documentos/{documento_id}")
        assert visto.status_code == 200
        assert visto.json()["estado"] == "confirmado"
        assert visto.json()["indexado"] == "omitido"
        assert "texto" not in visto.json()
    if REPO_REAL:
        assert len(libro(cuentas["ada"])["comprobantes"]) == 1


def test_indexar_que_falla_deja_el_borrador(cuentas, caplog, monkeypatch):
    caplog.set_level(logging.WARNING, logger="app.ingesta")
    modulo = types.ModuleType("app.indexacion")

    async def indexar_comprobante(*, user_id, documento_id, texto, categoria, periodo, proveedor):
        raise RuntimeError("sk-secret")

    modulo.indexar_comprobante = indexar_comprobante
    monkeypatch.setitem(sys.modules, "app.indexacion", modulo)
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        documento_id = subir(ada, pdf_con_frase(), "a.pdf").json()["id"]
        respuesta = ada.post(f"/documentos/{documento_id}/confirmar", json=FACTURA)
        assert respuesta.status_code == 200
        cuerpo = respuesta.json()
        assert cuerpo["estado"] == "confirmado"
        assert cuerpo["indexado"] == "error"
        assert "sk-secret" not in respuesta.text
        assert "error" not in cuerpo
        visto = ada.get(f"/documentos/{documento_id}")
        assert visto.status_code == 200
        assert visto.json()["estado"] == "confirmado"
        assert visto.json()["indexado"] == "error"
    assert "sk-secret" not in caplog.text
    assert "RuntimeError" in caplog.text
    assert documento_id in caplog.text
    if REPO_REAL:
        datos = libro(cuentas["ada"])
        assert len(datos["comprobantes"]) == 1
        assert datos["comprobantes"][0]["id"] == documento_id
        assert "sk-secret" not in str(datos)


def test_documento_ajeno_es_404_y_confirmar_incompleto_422(cuentas, doble):
    with (
        cliente_de(cuentas["ada"], "ada@example.com") as ada,
        cliente_de(cuentas["grace"], "grace@example.com") as grace,
    ):
        documento_id = subir(ada, pdf_con_frase(), "a.pdf").json()["id"]
        ajeno = grace.get(f"/documentos/{documento_id}")
        assert ajeno.status_code == 404
        assert ajeno.json()["detail"] == "No existe ese documento."
        assert grace.get("/documentos").json()["items"] == []
        robado = grace.post(f"/documentos/{documento_id}/confirmar", json=FACTURA)
        assert robado.status_code == 404
        assert robado.json()["detail"] == ajeno.json()["detail"]
        assert ada.get(f"/documentos/{documento_id}").json()["estado"] == "borrador"
        incompleto = ada.post(
            f"/documentos/{documento_id}/confirmar",
            json={"proveedor": "Edenor", "categoria": "servicios", "periodo": "2026-03"},
        )
        assert incompleto.status_code == 422
        blanco = ada.post(
            f"/documentos/{documento_id}/confirmar",
            json={**FACTURA, "proveedor": "   "},
        )
        assert blanco.status_code == 422
        inexistente = ada.post("/documentos/no-existe/confirmar", json=FACTURA)
        assert inexistente.status_code == 404
        assert_libro_vacio(cuentas["ada"])
        assert_libro_vacio(cuentas["grace"])


def test_sin_token_es_401(cuentas):
    aplicacion = FastAPI()
    aplicacion.include_router(router)
    with TestClient(aplicacion) as cliente:
        respuesta = cliente.get("/documentos")
    assert respuesta.status_code == 401
    assert respuesta.json()["detail"] == "No autenticado"


def test_openapi_muestra_el_contrato():
    aplicacion = FastAPI()
    aplicacion.include_router(router)
    esquema = aplicacion.openapi()
    rutas = esquema["paths"]
    assert "post" in rutas["/documentos"]
    assert "get" in rutas["/documentos"]
    assert "get" in rutas["/documentos/{id}"]
    assert "post" in rutas["/documentos/{id}/confirmar"]
    assert "delete" in rutas["/documentos/{id}"]
    assert "get" in rutas["/documentos/{id}/archivo"]
    assert "post" in rutas["/documentos/{id}/anular"]
    assert "post" in rutas["/documentos/{id}/corregir"]
    assert "get" in rutas["/export"]
    assert "201" in rutas["/documentos"]["post"]["responses"]
    nombres = esquema["components"]["schemas"]
    assert "Factura" in nombres
    assert "DocumentoBorrador" in nombres
    assert "DocumentoConfirmado" in nombres
    assert "ListaDocumentos" in nombres
    assert "user_id" not in nombres["Factura"]["properties"]


def _sin_indice(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "app.indexacion", None)


def test_descarte_ajeno_es_404(cuentas, monkeypatch):
    _sin_indice(monkeypatch)
    pdf = pdf_con_frase()
    with (
        cliente_de(cuentas["ada"], "ada@example.com") as ada,
        cliente_de(cuentas["grace"], "grace@example.com") as grace,
    ):
        documento_id = subir(ada, pdf, "a.pdf").json()["id"]
        assert grace.delete(f"/documentos/{documento_id}").status_code == 404
        assert grace.get(f"/documentos/{documento_id}/archivo").status_code == 404
        archivo = ada.get(f"/documentos/{documento_id}/archivo")
        assert archivo.status_code == 200
        assert archivo.content == pdf
        assert archivo.headers["content-type"].startswith("application/pdf")
        assert ada.get(f"/documentos/{documento_id}").json()["estado"] == "borrador"
        assert ada.delete(f"/documentos/{documento_id}").status_code == 204
        assert ada.get(f"/documentos/{documento_id}").status_code == 404
        assert ada.get(f"/documentos/{documento_id}/archivo").status_code == 404

        confirmado = subir(ada, pdf, "b.pdf").json()["id"]
        assert ada.post(f"/documentos/{confirmado}/confirmar", json=FACTURA).status_code == 200
        assert ada.delete(f"/documentos/{confirmado}").status_code == 404
        sigue = ada.get(f"/documentos/{confirmado}/archivo")
        assert sigue.status_code == 200
        assert sigue.content == pdf


def test_anulado_queda_fuera_del_resumen(cuentas, monkeypatch):
    _sin_indice(monkeypatch)
    with (
        cliente_de(cuentas["ada"], "ada@example.com") as ada,
        cliente_de(cuentas["grace"], "grace@example.com") as grace,
    ):
        documento_id = subir(ada, pdf_con_frase(), "a.pdf").json()["id"]
        assert ada.post(f"/documentos/{documento_id}/confirmar", json=FACTURA).status_code == 200
        assert grace.post(f"/documentos/{documento_id}/anular").status_code == 404
        borrador = subir(ada, pdf_con_frase(), "b.pdf").json()["id"]
        assert ada.post(f"/documentos/{borrador}/anular").status_code == 404
        anulado = ada.post(f"/documentos/{documento_id}/anular")
        assert anulado.status_code == 200
        assert anulado.json()["anulado"] is True
        assert anulado.json()["estado"] == "confirmado"
        assert ada.get(f"/documentos/{documento_id}").json()["anulado"] is True
    if REPO_REAL:
        datos = libro(cuentas["ada"])
        assert datos["comprobantes"] == []
        assert datos["por_mes"] == []
        gastos = asyncio.run(REPO.consultar_gastos(user_id=cuentas["ada"]))
        assert gastos["cantidad"] == 0
        assert gastos["total"] == "0.00"


def test_export_incluye_el_proveedor(cuentas, monkeypatch):
    _sin_indice(monkeypatch)
    with cliente_de(cuentas["ada"], "ada@example.com") as ada:
        primero = subir(ada, pdf_con_frase(), "a.pdf").json()["id"]
        assert ada.post(f"/documentos/{primero}/confirmar", json=FACTURA).status_code == 200
        segundo = subir(ada, pdf_con_frase(), "b.pdf").json()["id"]
        assert (
            ada.post(
                f"/documentos/{segundo}/confirmar",
                json={**FACTURA, "proveedor": "Metrogas", "monto": "10.00"},
            ).status_code
            == 200
        )
        assert ada.post(f"/documentos/{segundo}/anular").status_code == 200
        respuesta = ada.get("/export", params={"desde": "2026-01", "hasta": "2026-12"})
        assert respuesta.status_code == 200
        assert "text/csv" in respuesta.headers["content-type"]
        texto = respuesta.content.decode("utf-8")
        assert (
            texto.splitlines()[0]
            == "id,proveedor,categoria,periodo,monto,moneda,vencimiento,numero_comprobante"
        )
        assert "Edenor" in texto
        assert primero in texto
        assert "Metrogas" not in texto
        invalido = ada.get("/export", params={"desde": "marzo", "hasta": "2026-12"})
        assert invalido.status_code == 422


def test_corregir_suma_el_cambio_y_el_borrador_es_404(cuentas, monkeypatch):
    _sin_indice(monkeypatch)
    with (
        cliente_de(cuentas["ada"], "ada@example.com") as ada,
        cliente_de(cuentas["grace"], "grace@example.com") as grace,
    ):
        documento_id = subir(ada, pdf_con_frase(), "a.pdf").json()["id"]
        assert ada.post(f"/documentos/{documento_id}/corregir", json=FACTURA).status_code == 404
        assert ada.post(f"/documentos/{documento_id}/confirmar", json=FACTURA).status_code == 200
        assert grace.post(
            f"/documentos/{documento_id}/corregir",
            json={**FACTURA, "monto": "10.00"},
        ).status_code == 404
        corregido = ada.post(
            f"/documentos/{documento_id}/corregir",
            json={**FACTURA, "monto": "10.00"},
        )
        assert corregido.status_code == 200
        assert corregido.json()["campos"]["monto"] == "10.00"
        assert any(
            item["campo"] == "monto" and item["antes"] == "18500.50" and item["despues"] == "10.00"
            for item in corregido.json()["cambios"]
        )


class _RedisCuenta:
    def __init__(self) -> None:
        self.valores: dict[str, int] = {}
        self.expira: dict[str, int] = {}

    async def incr(self, clave: str) -> int:
        self.valores[clave] = self.valores.get(clave, 0) + 1
        return self.valores[clave]

    async def expire(self, clave: str, segundos: int) -> bool:
        self.expira[clave] = segundos
        return True


def _cliente_con_redis(user_id: str, email: str, redis):
    aplicacion = FastAPI()
    aplicacion.include_router(router)
    aplicacion.dependency_overrides[usuario_actual] = lambda: {"user_id": user_id, "email": email}
    aplicacion.state.redis = redis
    return TestClient(aplicacion)


def test_tope_de_cargas_responde_429(cuentas, doble, monkeypatch):
    monkeypatch.setenv("MAX_CARGAS_DIA", "1")
    llamadas = {"n": 0}
    original = doble.ainvoke

    async def contar(mensajes):
        llamadas["n"] += 1
        return await original(mensajes)

    doble.ainvoke = contar
    redis = _RedisCuenta()
    with _cliente_con_redis(cuentas["ada"], "ada@example.com", redis) as ada:
        assert subir(ada, pdf_con_frase(), "a.pdf").status_code == 201
        segundo = subir(ada, pdf_con_frase(), "b.pdf")
        assert segundo.status_code == 429
        assert segundo.json()["detail"] == "Llegaste al tope de cargas de hoy."
    assert llamadas["n"] == 1
    assert redis.expira


def test_si_redis_no_cuenta_la_carga_sigue(cuentas, caplog):
    caplog.set_level(logging.WARNING, logger="app.cupo")

    class Roto:
        async def incr(self, clave):
            raise RuntimeError("sk-secret")

    with _cliente_con_redis(cuentas["ada"], "ada@example.com", Roto()) as ada:
        respuesta = subir(ada, pdf_con_frase(), "a.pdf")
        assert respuesta.status_code == 201
        assert "sk-secret" not in respuesta.text
    assert "sk-secret" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_tope_de_consultas(monkeypatch):
    from fastapi import HTTPException

    from app.cupo import exigir_cupo

    monkeypatch.setenv("MAX_CONSULTAS_DIA", "1")
    redis = _RedisCuenta()

    async def caso() -> None:
        await exigir_cupo(redis, "ana", "consultas")
        await exigir_cupo(redis, "beto", "consultas")
        try:
            await exigir_cupo(redis, "ana", "consultas")
        except HTTPException as exc:
            assert exc.status_code == 429
            assert exc.detail == "Llegaste al tope de consultas de hoy."
        else:
            raise AssertionError("tenía que cortar la segunda consulta")
        await exigir_cupo(None, "ana", "consultas")

    asyncio.run(caso())
