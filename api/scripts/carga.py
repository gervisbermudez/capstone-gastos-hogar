#!/usr/bin/env python3
"""Cinco consultas de dos personas contra la API de gastos del hogar.

Registra a Ada y a Bea, confirma comprobantes por HTTP y manda:

1. Ada, totales de expensas (analista, SQL).
2. Ada, luz de enero contra febrero (analista y calculadora).
3. Ada, qué dice el alquiler sobre el ajuste (investigador, índice).
4. Bea, totales de expensas (el libro de Bea, no el de Ada).
5. Bea, el texto del alquiler (no tiene que ver el de Ada).

Después comprueba por HTTP que Ada no ve los gastos de Bea: el resumen no
trae el monto ni los id de la otra persona, y el GET cruzado responde 404.

No escribe capturas. Si falta api/.env, JWT_SECRET o el modelo, sale con
código 2 y nombra la variable. No imprime tokens ni valores de claves.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

import httpx

RAIZ_API = Path(__file__).resolve().parent.parent
ARCHIVO_ENV = RAIZ_API / ".env"

EMAIL_ADA = "ada.cierre@example.com"
EMAIL_BEA = "bea.cierre@example.com"
CLAVE_ADA = "una frase larga de ada para la prueba"
CLAVE_BEA = "una frase larga de bea para la prueba"

MONTO_ADA_EXPENSAS = "18500.50"
MONTO_ADA_LUZ_ENERO = "4100.00"
MONTO_ADA_LUZ_FEBRERO = "4300.00"
MONTO_ADA_ALQUILER = "250000.00"
MONTO_BEA_EXPENSAS = "77777.77"
FRASE_AJUSTE = "ajuste del veinticinco por ciento segun la clausula 7 del contrato de locacion"

ANIO = 2026
PERIODO_ENERO = f"{ANIO}-01"
PERIODO_FEBRERO = f"{ANIO}-02"
PERIODO_MARZO = f"{ANIO}-03"

PREGUNTAS = (
    ("ada", "¿Cuánto pagué de expensas en marzo?", "analista"),
    ("ada", "Compará la luz de enero contra febrero.", "analista"),
    ("ada", "¿Qué dice la factura de alquiler sobre el ajuste?", "investigador"),
    ("bea", "¿Cuánto pagué de expensas en marzo?", "analista"),
    ("bea", "¿Qué dice la factura de alquiler sobre el ajuste?", "investigador"),
)

TERMINALES = {"DONE", "FAILED", "AWAITING_APPROVAL"}


def pdf_con_texto(texto: str) -> bytes:
    """PDF mínimo con texto seleccionable. No usa PyMuPDF."""
    plano = texto.encode("latin-1", "replace")
    escapado = plano.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")
    stream = b"BT /F1 12 Tf 72 720 Td (" + escapado + b") Tj ET"
    objetos = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ),
        f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    salida = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for indice, objeto in enumerate(objetos, start=1):
        offsets.append(len(salida))
        salida.extend(f"{indice} 0 obj\n".encode())
        salida.extend(objeto)
        salida.extend(b"\nendobj\n")
    inicio_xref = len(salida)
    cantidad = len(objetos) + 1
    salida.extend(f"xref\n0 {cantidad}\n".encode())
    salida.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        salida.extend(f"{offset:010d} 00000 n \n".encode())
    salida.extend(
        (
            f"trailer\n<< /Size {cantidad} /Root 1 0 R >>\n"
            f"startxref\n{inicio_xref}\n%%EOF\n"
        ).encode()
    )
    return bytes(salida)


def _leer_env(ruta: Path) -> dict[str, str]:
    valores: dict[str, str] = {}
    if not ruta.is_file():
        return valores
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        limpia = linea.strip()
        if not limpia or limpia.startswith("#") or "=" not in limpia:
            continue
        clave, _, valor = limpia.partition("=")
        valores[clave.strip()] = valor.strip().strip('"').strip("'")
    return valores


def variables_faltantes() -> list[str]:
    """Nombres vacíos. No devuelve valores."""
    if not ARCHIVO_ENV.is_file():
        return [
            "api/.env (no existe: cp api/.env.example api/.env y completar JWT_SECRET, "
            "la clave del proveedor y el nombre del modelo)"
        ]
    valores = _leer_env(ARCHIVO_ENV)
    faltan: list[str] = []
    if not valores.get("JWT_SECRET"):
        faltan.append("JWT_SECRET")
    proveedor = (valores.get("LLM_PROVIDER") or "openai").strip().lower()
    if proveedor == "gemini":
        if not valores.get("GOOGLE_API_KEY"):
            faltan.append("GOOGLE_API_KEY")
        if not valores.get("GEMINI_MODEL"):
            faltan.append("GEMINI_MODEL")
    else:
        if not valores.get("OPENAI_API_KEY"):
            faltan.append("OPENAI_API_KEY")
        if not valores.get("OPENAI_MODEL"):
            faltan.append("OPENAI_MODEL")
    return faltan


def _detalle(respuesta: httpx.Response) -> str:
    try:
        cuerpo = respuesta.json()
    except Exception:
        return respuesta.text[:200]
    if isinstance(cuerpo, dict):
        detalle = cuerpo.get("detail")
        if isinstance(detalle, str):
            return detalle
    return str(cuerpo)[:200]


async def _entrar(client: httpx.AsyncClient, base: str, email: str, password: str) -> str:
    registro = await client.post(
        f"{base}/auth/registro",
        json={"email": email, "password": password},
    )
    if registro.status_code == 409:
        registro = await client.post(
            f"{base}/auth/login",
            json={"email": email, "password": password},
        )
        esperado = 200
    else:
        esperado = 201
    if registro.status_code != esperado:
        raise RuntimeError(
            f"No pude entrar como {email}: HTTP {registro.status_code} {_detalle(registro)}"
        )
    cuerpo = registro.json()
    token = cuerpo.get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError(f"La API no devolvió access_token para {email}")
    print(f"{email} user_id={cuerpo.get('user_id')} (token no se imprime)")
    return token


async def _confirmar_comprobante(
    client: httpx.AsyncClient,
    base: str,
    token: str,
    *,
    texto: str,
    nombre: str,
    proveedor: str,
    categoria: str,
    periodo: str,
    monto: str,
) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    subida = await client.post(
        f"{base}/documentos",
        headers=headers,
        files={"archivo": (nombre, pdf_con_texto(texto), "application/pdf")},
    )
    if subida.status_code != 201:
        raise RuntimeError(f"POST /documentos {nombre}: HTTP {subida.status_code} {_detalle(subida)}")
    documento_id = subida.json().get("id")
    if not isinstance(documento_id, str) or not documento_id:
        raise RuntimeError(f"POST /documentos {nombre} no devolvió id")
    confirmado = await client.post(
        f"{base}/documentos/{documento_id}/confirmar",
        headers={**headers, "Content-Type": "application/json"},
        json={
            "proveedor": proveedor,
            "categoria": categoria,
            "periodo": periodo,
            "monto": monto,
            "moneda": "ARS",
            "numero_comprobante": None,
        },
    )
    if confirmado.status_code != 200:
        raise RuntimeError(
            f"POST /documentos/{documento_id}/confirmar: HTTP {confirmado.status_code} {_detalle(confirmado)}"
        )
    print(f"confirmado {documento_id} {categoria} {periodo} {monto}")
    return documento_id


async def _esperar(
    client: httpx.AsyncClient,
    base: str,
    token: str,
    job_id: str,
    timeout: float,
) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    limite = time.perf_counter() + timeout
    ultimo: dict = {"job_id": job_id, "status": "PENDING"}
    while time.perf_counter() < limite:
        respuesta = await client.get(f"{base}/tasks/{job_id}", headers=headers)
        if respuesta.status_code != 200:
            raise RuntimeError(f"GET /tasks/{job_id}: HTTP {respuesta.status_code} {_detalle(respuesta)}")
        ultimo = respuesta.json()
        if ultimo.get("status") in TERMINALES:
            return ultimo
        await asyncio.sleep(2)
    ultimo["status"] = ultimo.get("status") or "PENDING"
    return ultimo


def _resumen_texto(cuerpo: object) -> str:
    return str(cuerpo)


async def _resumen(client: httpx.AsyncClient, base: str, token: str) -> dict:
    respuesta = await client.get(
        f"{base}/resumen",
        headers={"Authorization": f"Bearer {token}"},
        params={"desde": PERIODO_ENERO, "hasta": f"{ANIO}-12"},
    )
    if respuesta.status_code != 200:
        raise RuntimeError(f"GET /resumen: HTTP {respuesta.status_code} {_detalle(respuesta)}")
    cuerpo = respuesta.json()
    if not isinstance(cuerpo, dict):
        raise RuntimeError("GET /resumen no devolvió un objeto")
    return cuerpo


async def _exigir_404(client: httpx.AsyncClient, base: str, token: str, documento_id: str) -> None:
    respuesta = await client.get(
        f"{base}/documentos/{documento_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    if respuesta.status_code != 404:
        raise RuntimeError(
            f"GET /documentos/{documento_id} con el otro usuario respondió {respuesta.status_code}, se esperaba 404"
        )


async def main() -> int:
    parser = argparse.ArgumentParser(description="Cinco consultas y aislamiento de dos usuarios")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--timeout", type=float, default=240, help="Segundos por job")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    faltan = variables_faltantes()
    if faltan:
        print("No se pueden completar las cinco trazas. Falta:")
        for nombre in faltan:
            print(f"- {nombre}")
        print("Creá capstone/api/.env con: cp api/.env.example api/.env")
        print("No copies pre-entrega-7-api/.env. No se generaron capturas.")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                salud = await client.get(f"{base}/health")
            print(f"GET /health -> {salud.status_code} {salud.text[:80]}")
        except httpx.HTTPError as exc:
            print(f"La API en {base} no respondió: {type(exc).__name__}")
        return 2

    async with httpx.AsyncClient(timeout=120) as client:
        try:
            salud = await client.get(f"{base}/health")
        except httpx.HTTPError as exc:
            print(f"La API en {base} no respondió: {type(exc).__name__}")
            return 2
        if salud.status_code != 200:
            print(f"GET /health -> {salud.status_code}. La API no está lista.")
            return 2
        print(f"GET /health -> {salud.status_code}")

        token_ada = await _entrar(client, base, EMAIL_ADA, CLAVE_ADA)
        token_bea = await _entrar(client, base, EMAIL_BEA, CLAVE_BEA)
        tokens = {"ada": token_ada, "bea": token_bea}

        ids_ada: list[str] = []
        ids_bea: list[str] = []
        ids_ada.append(
            await _confirmar_comprobante(
                client,
                base,
                token_ada,
                texto=(
                    "Comprobante de expensas del consorcio del edificio. "
                    "Liquidacion mensual de marzo. No incluye clausula de ajuste."
                ),
                nombre="expensas-ada.pdf",
                proveedor="Consorcio del edificio",
                categoria="expensas",
                periodo=PERIODO_MARZO,
                monto=MONTO_ADA_EXPENSAS,
            )
        )
        ids_ada.append(
            await _confirmar_comprobante(
                client,
                base,
                token_ada,
                texto="Factura de luz de Edenor correspondiente a enero. Servicio electrico residencial.",
                nombre="luz-enero-ada.pdf",
                proveedor="Edenor",
                categoria="servicios",
                periodo=PERIODO_ENERO,
                monto=MONTO_ADA_LUZ_ENERO,
            )
        )
        ids_ada.append(
            await _confirmar_comprobante(
                client,
                base,
                token_ada,
                texto="Factura de luz de Edenor correspondiente a febrero. Servicio electrico residencial.",
                nombre="luz-febrero-ada.pdf",
                proveedor="Edenor",
                categoria="servicios",
                periodo=PERIODO_FEBRERO,
                monto=MONTO_ADA_LUZ_FEBRERO,
            )
        )
        ids_ada.append(
            await _confirmar_comprobante(
                client,
                base,
                token_ada,
                texto=(
                    "Contrato y factura de alquiler. "
                    f"El {FRASE_AJUSTE}. "
                    "Este texto es solo de Ada y no debe aparecerle a Bea."
                ),
                nombre="alquiler-ada.pdf",
                proveedor="Inmobiliaria del barrio",
                categoria="alquiler",
                periodo=PERIODO_MARZO,
                monto=MONTO_ADA_ALQUILER,
            )
        )
        ids_bea.append(
            await _confirmar_comprobante(
                client,
                base,
                token_bea,
                texto="Comprobante de expensas de Bea. Liquidacion de marzo de otro hogar. Sin clausula de alquiler.",
                nombre="expensas-bea.pdf",
                proveedor="Consorcio del otro edificio",
                categoria="expensas",
                periodo=PERIODO_MARZO,
                monto=MONTO_BEA_EXPENSAS,
            )
        )

        await _exigir_404(client, base, token_ada, ids_bea[0])
        await _exigir_404(client, base, token_bea, ids_ada[0])
        print("GET cruzado de documentos: 404")

        resumen_ada = await _resumen(client, base, token_ada)
        resumen_bea = await _resumen(client, base, token_bea)
        texto_ada = _resumen_texto(resumen_ada)
        texto_bea = _resumen_texto(resumen_bea)
        ids_en_ada = {item.get("id") for item in resumen_ada.get("comprobantes", []) if isinstance(item, dict)}
        ids_en_bea = {item.get("id") for item in resumen_bea.get("comprobantes", []) if isinstance(item, dict)}
        if MONTO_BEA_EXPENSAS in texto_ada or ids_en_ada.intersection(ids_bea):
            print("Fallo de aislamiento: el resumen de Ada incluye gastos de Bea.")
            return 1
        if MONTO_ADA_EXPENSAS in texto_bea or ids_en_bea.intersection(ids_ada):
            print("Fallo de aislamiento: el resumen de Bea incluye gastos de Ada.")
            return 1
        print("El resumen de Ada no incluye el monto ni los id de Bea, y al revés.")

        fallos = 0
        for quien, pregunta, especialista in PREGUNTAS:
            inicio = time.perf_counter()
            creada = await client.post(
                f"{base}/tasks",
                headers={"Authorization": f"Bearer {tokens[quien]}"},
                json={"query": pregunta, "thread_id": None},
            )
            if creada.status_code != 202:
                print(f"{quien} POST /tasks -> {creada.status_code} {_detalle(creada)}")
                fallos += 1
                continue
            cuerpo = creada.json()
            job_id = cuerpo.get("job_id")
            if not isinstance(job_id, str):
                print(f"{quien} no recibió job_id")
                fallos += 1
                continue
            print(
                f"{quien} POST /tasks 202 en {time.perf_counter() - inicio:.2f}s "
                f"job_id={job_id} especialista_esperado={especialista}"
            )
            estado = await _esperar(client, base, tokens[quien], job_id, args.timeout)
            resultado = estado.get("result")
            recorte = resultado if isinstance(resultado, str) else ""
            if len(recorte) > 400:
                recorte = recorte[:400] + "…"
            print(f"{job_id} {estado.get('status')} {recorte}")
            if estado.get("status") != "DONE":
                fallos += 1
                continue
            if quien == "bea" and "ajuste" in pregunta.lower() and FRASE_AJUSTE.casefold() in recorte.casefold():
                print("Bea vio la cláusula de ajuste de Ada.")
                fallos += 1

    print("Phoenix: proyecto gastos-hogar (http://localhost:6006, o el puerto que imprimió ./run.sh)")
    print("Este script no guarda capturas. Si las trazas se ven, van en capstone/screenshots/.")
    if fallos:
        print(f"{fallos} consulta(s) no terminaron en DONE.")
        return 1
    print("Cinco consultas en DONE y el aislamiento por HTTP se sostiene.")
    return 0


if __name__ == "__main__":
    try:
        codigo = asyncio.run(main())
    except RuntimeError as exc:
        print(exc)
        codigo = 1
    sys.exit(codigo)
