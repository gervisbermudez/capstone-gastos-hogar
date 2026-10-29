"""Lectura de un comprobante: texto de PDF o visión, mismo esquema.

No usa Tesseract ni otro OCR. No loguea el archivo, el base64 ni el texto.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .esquemas import CamposDocumento
from .llm import armar_llm

try:
    import pymupdf
except ModuleNotFoundError as exc:
    # main.py se traga ModuleNotFoundError al montar el router. Si pymupdf
    # falta, un RuntimeError deja el fallo a la vista en vez de ocultar /documentos.
    raise RuntimeError("Falta el paquete pymupdf. Está en requirements.txt.") from exc

logger = logging.getLogger(__name__)

UMBRAL_TEXTO = 40
PAGINAS_VISION = 2
DPI_RASTER = 150

DETALLE_TIPO = "El archivo no es jpeg, png, webp ni pdf."
DETALLE_PDF = "No se pudo abrir el PDF."
DETALLE_MODELO = "No se pudo leer el comprobante."

_MIME = {"jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
_FILETYPES = {"jpeg": ("jpeg", "jpg"), "png": ("png",)}
_MARCAS_PROHIBIDAS = (
    "bearer",
    "sk-",
    "api_key",
    "token",
    "password",
    "data:image",
    "%pdf",
)
_MESES = {
    "enero": "01",
    "febrero": "02",
    "marzo": "03",
    "abril": "04",
    "mayo": "05",
    "junio": "06",
    "julio": "07",
    "agosto": "08",
    "septiembre": "09",
    "setiembre": "09",
    "octubre": "10",
    "noviembre": "11",
    "diciembre": "12",
}
_MONEDA = re.compile(r"(?i)\b(?:ars|usd|eur)\b")


class ErrorDeModelo(Exception):
    """El proveedor no completó la lectura. La ruta responde 502."""


class ArchivoRechazado(Exception):
    """El archivo no se procesa. ``status`` es el HTTP de la ruta."""

    def __init__(self, status: int, detail: str) -> None:
        self.status = status
        self.detail = detail
        super().__init__(detail)


class LecturaFactura(BaseModel):
    """Mismos campos que ``Factura``, todos opcionales.

    Un borrador puede ir incompleto. Confirmar es el que exige proveedor,
    período y monto. ``transcripcion`` no sale en el JSON: llena ``texto``
    cuando el comprobante no tiene capa de texto.
    """

    model_config = ConfigDict(extra="ignore")

    proveedor: str | None = Field(default=None, description="Quien emite el comprobante")
    categoria: str | None = Field(
        default=None, description="servicios, expensas o alquiler"
    )
    periodo: str | None = Field(default=None, description="YYYY-MM")
    monto: str | None = Field(
        default=None, description="String con dos decimales, sin símbolo, como 18500.50"
    )
    moneda: str | None = Field(default=None, description="ARS si no figura otra")
    numero_comprobante: str | None = Field(default=None, description="Número impreso, o null")
    transcripcion: str | None = Field(
        default=None,
        description="Texto visible literal. Null si la entrada ya es texto.",
    )


@dataclass(frozen=True)
class ResultadoExtraccion:
    texto: str
    campos: dict
    advertencias: list[str]
    camino: str


@dataclass(frozen=True)
class _PdfListo:
    texto: str
    data_urls: tuple[str, ...]


_SISTEMA_COMUN = (
    "Completás una factura de gastos del hogar. "
    "No inventes datos que no estén en el comprobante: si no se lee, null. "
    "categoria es servicios, expensas o alquiler. "
    "periodo es YYYY-MM. monto es un string con dos decimales, sin símbolo, como 18500.50. "
    "moneda es ARS si no figura otra. "
    "numero_comprobante es el número impreso o null."
)
_SISTEMA_TEXTO = _SISTEMA_COMUN + " El texto ya fue extraído del PDF. Dejá transcripcion en null."
_SISTEMA_VISION = (
    _SISTEMA_COMUN
    + " Transcribí en transcripcion el texto visible, fiel y completo, sin resumir. "
    "Si no hay texto legible, transcripcion es null."
)


def detectar_tipo(datos: bytes) -> str | None:
    """jpeg, png, webp o pdf según la cabecera. La extensión no participa."""
    if datos.startswith(b"%PDF"):
        return "pdf"
    if datos.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if datos.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if len(datos) >= 12 and datos[:4] == b"RIFF" and datos[8:12] == b"WEBP":
        return "webp"
    return None


def normalizar_monto(valor: object) -> str | None:
    """Lleva un monto leído al formato con dos decimales. Más de dos decimales se descarta."""
    if not isinstance(valor, str):
        return None
    limpio = _MONEDA.sub("", valor).replace("$", "").replace(" ", "").replace("\u00a0", "")
    if not limpio:
        return None
    if re.fullmatch(r"\d+\.\d{2}", limpio):
        return limpio
    if re.fullmatch(r"\d+", limpio):
        return f"{limpio}.00"
    if re.fullmatch(r"\d+\.\d", limpio):
        return f"{limpio}0"
    miles_punto = re.fullmatch(r"(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?", limpio)
    if miles_punto:
        return _con_decimales(miles_punto.group(1).replace(".", ""), miles_punto.group(2) or "")
    miles_coma = re.fullmatch(r"(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?", limpio)
    if miles_coma:
        return _con_decimales(miles_coma.group(1).replace(",", ""), miles_coma.group(2) or "")
    decimal_coma = re.fullmatch(r"(\d+),(\d{1,2})", limpio)
    if decimal_coma:
        return _con_decimales(decimal_coma.group(1), decimal_coma.group(2))
    return None


def normalizar_periodo(valor: object) -> str | None:
    """Acepta YYYY-MM, YYYY/MM, MM/YYYY o el mes en español más el año."""
    if not isinstance(valor, str):
        return None
    texto = " ".join(valor.strip().lower().split())
    if re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", texto):
        return texto
    anio_mes = re.fullmatch(r"(\d{4})[/-](0[1-9]|1[0-2])", texto)
    if anio_mes:
        return f"{anio_mes.group(1)}-{anio_mes.group(2)}"
    mes_anio = re.fullmatch(r"(0[1-9]|1[0-2])[/-](\d{4})", texto)
    if mes_anio:
        return f"{mes_anio.group(2)}-{mes_anio.group(1)}"
    nombre = re.fullmatch(r"([a-záéíóúñ]+)(?: de)? (\d{4})", texto)
    if nombre and nombre.group(1) in _MESES:
        return f"{nombre.group(2)}-{_MESES[nombre.group(1)]}"
    return None


async def extraer(datos: bytes) -> ResultadoExtraccion:
    """Elige texto o visión y devuelve el mismo resultado para los dos."""
    tipo = detectar_tipo(datos)
    if tipo is None:
        raise ArchivoRechazado(415, DETALLE_TIPO)
    if tipo == "pdf":
        preparado = await asyncio.to_thread(_preparar_pdf, datos)
        if preparado.data_urls:
            return await _desde_vision(preparado.texto, preparado.data_urls)
        return await _desde_texto(preparado.texto)
    data_url = await asyncio.to_thread(_preparar_imagen, datos, tipo)
    return await _desde_vision("", (data_url,))


def _con_decimales(entero: str, fraccion: str) -> str | None:
    if not entero.isdigit() or (fraccion and not fraccion.isdigit()) or len(fraccion) > 2:
        return None
    return f"{int(entero)}.{(fraccion + '00')[:2]}"


def _es_poco(texto: str) -> bool:
    return len(" ".join(texto.split())) < UMBRAL_TEXTO


def _texto_limpio(valor: object) -> str:
    if not isinstance(valor, str):
        return ""
    return valor.strip()


def _detalle_seguro(exc: BaseException) -> str:
    nombre = type(exc).__name__
    mensaje = str(exc)
    if len(mensaje) > 300:
        return nombre
    bajada = mensaje.lower()
    if any(marca in bajada for marca in _MARCAS_PROHIBIDAS):
        return nombre
    if not mensaje:
        return nombre
    return f"{nombre}: {mensaje}"


def _log_modelo(exc: BaseException) -> None:
    logger.warning("extracción falló: %s", _detalle_seguro(exc))


def _data_url(contenido: bytes, mime: str) -> str:
    codificado = base64.b64encode(contenido).decode("ascii")
    return f"data:{mime};base64,{codificado}"


def _pide_clave(documento) -> bool:
    marca = getattr(documento, "needs_pass", 0)
    if callable(marca):
        marca = marca()
    return bool(marca)


def _preparar_pdf(datos: bytes) -> _PdfListo:
    """Texto seleccionable, o como máximo las dos primeras páginas en PNG."""
    documento = None
    try:
        documento = pymupdf.open(stream=datos, filetype="pdf")
        if _pide_clave(documento) or documento.page_count < 1:
            raise ArchivoRechazado(422, DETALLE_PDF)
        texto = "\n".join(pagina.get_text() for pagina in documento)
        if not _es_poco(texto):
            return _PdfListo(texto=texto, data_urls=())
        cantidad = min(PAGINAS_VISION, documento.page_count)
        urls = tuple(
            _data_url(_png(documento[indice]), "image/png") for indice in range(cantidad)
        )
        if not urls:
            raise ArchivoRechazado(422, DETALLE_PDF)
        return _PdfListo(texto=texto, data_urls=urls)
    except ArchivoRechazado:
        raise
    except Exception as exc:
        logger.warning("no se pudo abrir el PDF: %s", type(exc).__name__)
        raise ArchivoRechazado(422, DETALLE_PDF) from exc
    finally:
        if documento is not None:
            documento.close()


def _png(pagina) -> bytes:
    pixmap = pagina.get_pixmap(dpi=DPI_RASTER, alpha=False)
    return pixmap.tobytes("png")


def _preparar_imagen(datos: bytes, tipo: str) -> str:
    try:
        if tipo == "webp":
            # Este wheel de MuPDF no tiene handler webp. El contenedor RIFF
            # (chunk VP8, VP8L o VP8X, con tamaños que entran en el archivo)
            # es la comprobación del tipo real. Al modelo va el original.
            if not _webp_valido(datos):
                raise ArchivoRechazado(415, DETALLE_TIPO)
        else:
            _abrir_imagen(datos, tipo)
    except ArchivoRechazado:
        raise
    except Exception as exc:
        logger.warning("no se pudo abrir la imagen: %s", type(exc).__name__)
        raise ArchivoRechazado(415, DETALLE_TIPO) from exc
    return _data_url(datos, _MIME[tipo])


def _webp_valido(datos: bytes) -> bool:
    if len(datos) < 20 or datos[:4] != b"RIFF" or datos[8:12] != b"WEBP":
        return False
    declarado = int.from_bytes(datos[4:8], "little")
    if declarado + 8 != len(datos) or declarado < 12:
        return False
    if datos[12:16] not in {b"VP8 ", b"VP8L", b"VP8X"}:
        return False
    chunk = int.from_bytes(datos[16:20], "little")
    return chunk > 0 and 20 + chunk <= len(datos)


def _abrir_imagen(datos: bytes, tipo: str) -> None:
    ultimo: Exception | None = None
    for filetype in _FILETYPES[tipo]:
        documento = None
        try:
            documento = pymupdf.open(stream=datos, filetype=filetype)
            if documento.page_count < 1:
                raise ArchivoRechazado(415, DETALLE_TIPO)
            # Abrir el contenedor no alcanza: un JPEG truncado igual reporta
            # una página. Renderizar fuerza el decode y rechaza el archivo roto.
            pixmap = documento[0].get_pixmap(alpha=False)
            if pixmap.width < 1 or pixmap.height < 1:
                raise ArchivoRechazado(415, DETALLE_TIPO)
            return
        except ArchivoRechazado:
            raise
        except Exception as exc:
            ultimo = exc
        finally:
            if documento is not None:
                documento.close()
    raise ArchivoRechazado(415, DETALLE_TIPO) from ultimo


def _mensajes_texto(texto: str) -> list:
    from langchain_core.messages import HumanMessage, SystemMessage

    return [SystemMessage(content=_SISTEMA_TEXTO), HumanMessage(content=texto)]


def _mensajes_vision(urls: tuple[str, ...]) -> list:
    from langchain_core.messages import HumanMessage, SystemMessage

    bloques: list = [{"type": "text", "text": "Leé este comprobante."}]
    for url in urls:
        bloques.append({"type": "image_url", "image_url": {"url": url}})
    return [SystemMessage(content=_SISTEMA_VISION), HumanMessage(content=bloques)]


async def _completar(mensajes: list) -> LecturaFactura:
    try:
        modelo = armar_llm()
        crudo = await modelo.with_structured_output(LecturaFactura).ainvoke(mensajes)
    except Exception as exc:
        _log_modelo(exc)
        raise ErrorDeModelo from exc
    if isinstance(crudo, LecturaFactura):
        return crudo
    if isinstance(crudo, dict):
        try:
            return LecturaFactura.model_validate(crudo)
        except ValidationError as exc:
            _log_modelo(exc)
            raise ErrorDeModelo from exc
    _log_modelo(ErrorDeModelo())
    raise ErrorDeModelo


async def _desde_texto(texto: str) -> ResultadoExtraccion:
    lectura = await _completar(_mensajes_texto(texto))
    campos, advertencias = _campos_desde_lectura(lectura)
    logger.info("extracción por texto")
    return ResultadoExtraccion(
        texto=texto,
        campos=campos,
        advertencias=advertencias,
        camino="texto",
    )


async def _desde_vision(respaldo: str, urls: tuple[str, ...]) -> ResultadoExtraccion:
    lectura = await _completar(_mensajes_vision(urls))
    campos, advertencias = _campos_desde_lectura(lectura)
    texto = _texto_de_vision(lectura, respaldo, advertencias)
    logger.info("extracción por visión, páginas=%s", len(urls))
    return ResultadoExtraccion(
        texto=texto,
        campos=campos,
        advertencias=advertencias,
        camino="vision",
    )


def _texto_de_vision(lectura: LecturaFactura, respaldo: str, advertencias: list[str]) -> str:
    transcripcion = _texto_limpio(lectura.transcripcion)
    if transcripcion:
        return transcripcion
    advertencias.append("No se pudo transcribir el comprobante.")
    return respaldo.strip() if isinstance(respaldo, str) else ""


def _campos_desde_lectura(lectura: LecturaFactura) -> tuple[dict, list[str]]:
    advertencias: list[str] = []
    bruto: dict = {}

    proveedor = _texto_limpio(lectura.proveedor)
    if proveedor:
        bruto["proveedor"] = proveedor
    else:
        advertencias.append("Falta el proveedor. Completalo antes de confirmar.")

    categoria = _texto_limpio(lectura.categoria).lower()
    if not categoria:
        advertencias.append("Falta la categoría. Completala antes de confirmar.")
    elif categoria not in {"servicios", "expensas", "alquiler"}:
        advertencias.append(
            "Se descartó la categoría porque no es servicios, expensas ni alquiler."
        )
    else:
        bruto["categoria"] = categoria

    periodo_crudo = _texto_limpio(lectura.periodo)
    periodo = normalizar_periodo(periodo_crudo) if periodo_crudo else None
    if not periodo_crudo:
        advertencias.append("Falta el período. Completalo antes de confirmar.")
    elif periodo is None:
        advertencias.append("Se descartó el período porque no cumple YYYY-MM.")
    else:
        bruto["periodo"] = periodo

    monto_crudo = _texto_limpio(lectura.monto)
    monto = normalizar_monto(monto_crudo) if monto_crudo else None
    if not monto_crudo:
        advertencias.append("Falta el monto. Completalo antes de confirmar.")
    elif monto is None:
        advertencias.append("Se descartó el monto porque no tiene dos decimales.")
    else:
        bruto["monto"] = monto

    bruto["moneda"] = _texto_limpio(lectura.moneda) or "ARS"

    numero = _texto_limpio(lectura.numero_comprobante)
    if numero:
        bruto["numero_comprobante"] = numero

    try:
        modelo = CamposDocumento.model_validate(bruto)
    except ValidationError:
        return _campos_uno_por_uno(bruto, advertencias)
    return _sin_nulos(modelo.model_dump()), advertencias


def _campos_uno_por_uno(bruto: dict, advertencias: list[str]) -> tuple[dict, list[str]]:
    publicos: dict = {}
    for clave, valor in bruto.items():
        try:
            uno = CamposDocumento.model_validate({clave: valor})
        except ValidationError:
            advertencias.append(f"Se descartó {clave} porque no cumple el formato.")
            continue
        dato = getattr(uno, clave)
        if dato is not None:
            publicos[clave] = dato
    return publicos, advertencias


def _sin_nulos(datos: dict) -> dict:
    return {clave: valor for clave, valor in datos.items() if valor is not None}
