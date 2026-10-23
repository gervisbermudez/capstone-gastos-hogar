"""Contrato HTTP congelado, en Pydantic.

Las rutas no están acá. Datos, ingesta y agentes importan estos modelos
como body o ``response_model``. ``user_id`` no es campo de entrada: en las
entradas, ``extra="forbid"`` lo rechaza. En las salidas, ``extra="ignore"``
deja afuera claves que no son del contrato.

OpenAPI muestra un modelo cuando alguna ruta lo referencia.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer

CAMPO_ARCHIVO = "archivo"
TIPOS_ARCHIVO = ("jpeg", "png", "webp", "pdf")

Categoria = Literal["servicios", "expensas", "alquiler"]
EstadoDocumento = Literal["borrador", "confirmado"]
EstadoTarea = Literal["PENDING", "RUNNING", "AWAITING_APPROVAL", "FAILED", "DONE"]
Indexado = Literal["ok", "error", "omitido"]
RolMensaje = Literal["persona", "asistente", "nota"]

_PERIODO = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_MONTO = re.compile(r"^\d+\.\d{2}$")
_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class _Entrada(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Salida(BaseModel):
    model_config = ConfigDict(extra="ignore")


def _periodo(valor: object) -> str:
    if not isinstance(valor, str) or _PERIODO.fullmatch(valor) is None:
        raise ValueError("El período tiene que ser YYYY-MM")
    return valor


def _periodo_opcional(valor: object) -> str | None:
    if valor is None:
        return None
    return _periodo(valor)


def _monto(valor: object) -> str:
    if not isinstance(valor, str) or _MONTO.fullmatch(valor) is None:
        raise ValueError("El monto tiene que ser un string con dos decimales")
    return valor


def _monto_opcional(valor: object) -> str | None:
    if valor is None:
        return None
    return _monto(valor)


def _fecha(valor: object) -> str | None:
    if valor is None:
        return None
    if not isinstance(valor, str) or _FECHA.fullmatch(valor) is None:
        raise ValueError("La fecha tiene que ser YYYY-MM-DD")
    try:
        date.fromisoformat(valor)
    except ValueError as exc:
        raise ValueError("La fecha tiene que ser YYYY-MM-DD") from exc
    return valor


class Credenciales(_Entrada):
    """Body de ``POST /auth/registro`` y ``POST /auth/login``."""

    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_presente(cls, valor: str) -> str:
        texto = valor.strip()
        if not texto:
            raise ValueError("Falta el email")
        return texto

    @field_validator("password")
    @classmethod
    def password_presente(cls, valor: str) -> str:
        if valor == "":
            raise ValueError("Falta la contraseña")
        return valor


class Token(_Salida):
    """Registro ``201`` y login ``200``. ``token_type`` es ``bearer``."""

    access_token: str = Field(min_length=1)
    token_type: Literal["bearer"]
    user_id: str = Field(min_length=1)


class UsuarioActual(_Salida):
    """``GET /auth/me`` → ``200``."""

    user_id: str = Field(min_length=1)
    email: str


class Factura(_Entrada):
    """Body de ``POST /documentos/{id}/confirmar``.

    Faltan proveedor, período o monto → 422. ``categoria`` también es
    obligatoria: la tabla del contrato no la marca opcional.
    """

    proveedor: str
    categoria: Categoria
    periodo: str
    monto: str
    moneda: str = "ARS"
    vencimiento: str | None = None
    numero_comprobante: str | None = None

    @field_validator("proveedor", "moneda")
    @classmethod
    def texto_presente(cls, valor: str) -> str:
        texto = valor.strip()
        if not texto:
            raise ValueError("El campo está vacío")
        return texto

    @field_validator("periodo")
    @classmethod
    def periodo_ok(cls, valor: str) -> str:
        return _periodo(valor)

    @field_validator("monto")
    @classmethod
    def monto_ok(cls, valor: str) -> str:
        return _monto(valor)

    @field_validator("vencimiento")
    @classmethod
    def fecha_ok(cls, valor: str | None) -> str | None:
        return _fecha(valor)


class CamposDocumento(_Salida):
    """Objeto ``campos``. Puede ser ``{}``. Las claves en null no se emiten."""

    proveedor: str | None = None
    categoria: Categoria | None = None
    periodo: str | None = None
    monto: str | None = None
    moneda: str | None = None
    vencimiento: str | None = None
    numero_comprobante: str | None = None

    @field_validator("periodo")
    @classmethod
    def periodo_ok(cls, valor: str | None) -> str | None:
        return _periodo_opcional(valor)

    @field_validator("monto")
    @classmethod
    def monto_ok(cls, valor: str | None) -> str | None:
        return _monto_opcional(valor)

    @field_validator("vencimiento")
    @classmethod
    def fecha_ok(cls, valor: str | None) -> str | None:
        return _fecha(valor)

    @model_serializer(mode="wrap")
    def _sin_nulos(self, serializer, _info):
        datos = serializer(self)
        if isinstance(datos, dict):
            return {clave: valor for clave, valor in datos.items() if valor is not None}
        return datos


class DocumentoBorrador(_Salida):
    """``POST /documentos`` → ``201``. El monto todavía no entra al libro."""

    id: str = Field(min_length=1)
    estado: Literal["borrador"]
    campos: CamposDocumento = Field(default_factory=CamposDocumento)
    texto: str
    advertencias: list[str] = Field(default_factory=list)


class Cambio(_Salida):
    """Un campo que difiere entre lo extraído y lo que quedó en el libro."""

    campo: str
    antes: str | None = None
    despues: str | None = None


class DocumentoConfirmado(_Salida):
    """``POST /documentos/{id}/confirmar`` → ``200``.

    ``anulado``, ``indexado`` y ``cambios`` tienen default para no romper
    respuestas que todavía no los mandan.
    """

    id: str = Field(min_length=1)
    estado: Literal["confirmado"]
    campos: CamposDocumento = Field(default_factory=CamposDocumento)
    anulado: bool = False
    indexado: Indexado | None = None
    cambios: list[Cambio] = Field(default_factory=list)


class DocumentoListado(_Salida):
    """Borrador en ``GET /documentos``. No trae ``texto`` ni ``advertencias``."""

    id: str = Field(min_length=1)
    estado: Literal["borrador"]
    campos: CamposDocumento = Field(default_factory=CamposDocumento)


class DocumentoListadoConfirmado(_Salida):
    """Confirmado en el listado. ``cambios`` puede ir vacía."""

    id: str = Field(min_length=1)
    estado: Literal["confirmado"]
    campos: CamposDocumento = Field(default_factory=CamposDocumento)
    anulado: bool = False
    indexado: Indexado | None = None
    cambios: list[Cambio] = Field(default_factory=list)


DocumentoListadoItem = Annotated[
    DocumentoListado | DocumentoListadoConfirmado,
    Field(discriminator="estado"),
]


class ListaDocumentos(_Salida):
    """``GET /documentos`` → ``200``."""

    items: list[DocumentoListadoItem]


# GET /documentos/{id}. 404 si no existe o si es de otra persona.
DocumentoDetalle = Annotated[
    DocumentoBorrador | DocumentoConfirmado,
    Field(discriminator="estado"),
]


class TotalMes(_Salida):
    periodo: str
    total: str

    @field_validator("periodo")
    @classmethod
    def periodo_ok(cls, valor: str) -> str:
        return _periodo(valor)

    @field_validator("total")
    @classmethod
    def total_ok(cls, valor: str) -> str:
        return _monto(valor)


class TotalCategoria(_Salida):
    categoria: Categoria
    total: str

    @field_validator("total")
    @classmethod
    def total_ok(cls, valor: str) -> str:
        return _monto(valor)


class Resumen(_Salida):
    """``GET /resumen`` → ``200``. Solo comprobantes confirmados del token."""

    por_mes: list[TotalMes]
    por_categoria: list[TotalCategoria]
    comprobantes: list[DocumentoConfirmado]


class RangoResumen(_Entrada):
    """Query de ``GET /resumen``, no body.

    En la ruta: ``rango: Annotated[RangoResumen, Query()]``.
    """

    desde: str
    hasta: str

    @field_validator("desde", "hasta")
    @classmethod
    def periodo_ok(cls, valor: str) -> str:
        return _periodo(valor)


class ConsultaTarea(_Entrada):
    """Body de ``POST /tasks``. ``thread_id`` null empieza un hilo."""

    query: str
    thread_id: str | None = None

    @field_validator("query")
    @classmethod
    def consulta_presente(cls, valor: str) -> str:
        texto = valor.strip()
        if not texto:
            raise ValueError("La consulta está vacía")
        return texto

    @field_validator("thread_id")
    @classmethod
    def hilo_presente(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        texto = valor.strip()
        if not texto:
            raise ValueError("thread_id vacío")
        return texto


class TareaCreada(_Salida):
    """``POST /tasks`` → ``202``. No espera al modelo."""

    job_id: str = Field(min_length=1)
    status: Literal["PENDING"]
    thread_id: str = Field(min_length=1)


class TareaEstado(_Salida):
    """``GET /tasks/{job_id}`` → ``200``.

    El ejemplo de la fuente es el caso ``DONE``. En otros estados ``result``
    puede ser null. No hay clave ``error`` ni ``user_id``.
    """

    job_id: str = Field(min_length=1)
    status: EstadoTarea
    thread_id: str = Field(min_length=1)
    result: str | None = None


class Aprobacion(_Entrada):
    """Body de ``POST /tasks/{job_id}/approve``.

    La fuente fija el ``202`` si el job estaba en ``AWAITING_APPROVAL``.
    No fija el JSON de la respuesta.
    """

    aprobado: bool


class MensajeHilo(_Salida):
    """Una línea de ``GET /hilos/{thread_id}``."""

    rol: RolMensaje
    texto: str
    creado_en: str


class HiloDetalle(_Salida):
    """``GET /hilos/{thread_id}`` → ``200``."""

    thread_id: str = Field(min_length=1)
    mensajes: list[MensajeHilo]


class HiloResumen(_Salida):
    """Item de ``GET /hilos``."""

    thread_id: str = Field(min_length=1)
    titulo: str
    actualizado_en: str


class ListaHilos(_Salida):
    """``GET /hilos`` → ``200``. Como máximo 30 hilos de esa persona."""

    items: list[HiloResumen]


class Salud(_Salida):
    """``GET /health`` → ``200`` cuando Redis responde."""

    status: Literal["ok"]
