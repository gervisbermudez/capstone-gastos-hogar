"""Contrato HTTP congelado, en Pydantic.

Las rutas no están acá. Datos, ingesta y agentes importan estos modelos
como body o ``response_model``. ``user_id`` no es campo de entrada: en las
entradas, ``extra="forbid"`` lo rechaza. En las salidas, ``extra="ignore"``
deja afuera claves que no son del contrato.

OpenAPI muestra un modelo cuando alguna ruta lo referencia.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer, model_validator

from .periodo import PERIODO as _PERIODO

CAMPO_ARCHIVO = "archivo"
TIPOS_ARCHIVO = ("jpeg", "png", "webp", "pdf")

# Las tres fijas siguen siendo servicios, expensas y alquiler. También vale
# el nombre de una categoría del catálogo de esa persona: el repositorio
# lo resuelve al confirmar o corregir.
Categoria = str
EstadoDocumento = Literal["borrador", "confirmado"]
EstadoTarea = Literal["PENDING", "RUNNING", "AWAITING_APPROVAL", "FAILED", "DONE"]
Indexado = Literal["ok", "error", "omitido"]
RolMensaje = Literal["persona", "asistente", "nota"]

_MONTO = re.compile(r"^\d+\.\d{2}$")


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


def _categoria_obligatoria(valor: object) -> str:
    if not isinstance(valor, str):
        raise ValueError("Falta la categoría")
    texto = valor.strip()
    if not texto:
        raise ValueError("Falta la categoría")
    if len(texto) > 80:
        raise ValueError("La categoría supera los 80 caracteres")
    return texto


def _categoria_opcional(valor: object) -> str | None:
    if valor is None:
        return None
    return _categoria_obligatoria(valor)


def _monto(valor: object) -> str:
    if not isinstance(valor, str) or _MONTO.fullmatch(valor) is None:
        raise ValueError("El monto tiene que ser un string con dos decimales")
    return valor


def _monto_opcional(valor: object) -> str | None:
    if valor is None:
        return None
    return _monto(valor)


_ALIAS_SUELTOS = {" ", "_", "-"}


def _caracter_alias(caracter: str) -> bool:
    return caracter.isalpha() or caracter.isdecimal() or caracter in _ALIAS_SUELTOS


_MAX_PASSWORD = 128
_MIN_PASSWORD_NUEVA = 8
_MAX_CONSULTA = 2000


def _email_presente(valor: str) -> str:
    texto = valor.strip()
    if not texto:
        raise ValueError("Falta el email")
    return texto


def _password_hasta(valor: str) -> str:
    """Clave ya guardada: no vacía y con tope, para no hashear un payload enorme."""
    if valor == "":
        raise ValueError("Falta la contraseña")
    if len(valor) > _MAX_PASSWORD:
        raise ValueError("La contraseña supera los 128 caracteres")
    return valor


def _password_nueva(valor: str) -> str:
    """Clave que se va a guardar. Pide un mínimo además del tope."""
    texto = _password_hasta(valor)
    if len(texto) < _MIN_PASSWORD_NUEVA:
        raise ValueError("La contraseña tiene que tener al menos 8 caracteres")
    return texto


class Credenciales(_Entrada):
    """Body de ``POST /auth/login``. La clave actual puede ser más corta que 8."""

    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_presente(cls, valor: str) -> str:
        return _email_presente(valor)

    @field_validator("password")
    @classmethod
    def password_presente(cls, valor: str) -> str:
        return _password_hasta(valor)


class Registro(Credenciales):
    """Body de ``POST /auth/registro``. Misma forma que el login, con clave nueva."""

    @field_validator("password")
    @classmethod
    def password_nueva(cls, valor: str) -> str:
        return _password_nueva(valor)


class CambioNombre(_Entrada):
    """Body de ``POST /auth/nombre``. No pide contraseña.

    ``None``, vacío o solo espacios borra el alias. Si no, se recorta.
    Máximo 40 caracteres. Letras Unicode, números, espacios, ``_`` y ``-``.
    """

    nombre: str | None

    @field_validator("nombre")
    @classmethod
    def alias_opcional(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        texto = valor.strip()
        if not texto:
            return None
        if len(texto) > 40:
            raise ValueError("El nombre supera los 40 caracteres")
        if any(not _caracter_alias(caracter) for caracter in texto):
            raise ValueError("El nombre solo admite letras, números, espacios, _ y -")
        return texto


class CambioEmail(_Entrada):
    """Body de ``POST /auth/email``. ``password`` es la contraseña actual."""

    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_presente(cls, valor: str) -> str:
        return _email_presente(valor)

    @field_validator("password")
    @classmethod
    def password_presente(cls, valor: str) -> str:
        return _password_hasta(valor)


class CambioPassword(_Entrada):
    """Body de ``POST /auth/password``."""

    password_actual: str
    password_nueva: str

    @field_validator("password_actual")
    @classmethod
    def actual_presente(cls, valor: str) -> str:
        return _password_hasta(valor)

    @field_validator("password_nueva")
    @classmethod
    def nueva_presente(cls, valor: str) -> str:
        return _password_nueva(valor)


class BajaCuenta(_Entrada):
    """Body de ``DELETE /auth/cuenta``. ``password`` es la contraseña actual."""

    password: str

    @field_validator("password")
    @classmethod
    def password_presente(cls, valor: str) -> str:
        return _password_hasta(valor)


class Token(_Salida):
    """Registro ``201`` y login ``200``. ``token_type`` es ``bearer``."""

    access_token: str = Field(min_length=1)
    token_type: Literal["bearer"]
    user_id: str = Field(min_length=1)


class UsuarioActual(_Salida):
    """``GET /auth/me``, ``POST /auth/email`` y ``POST /auth/nombre``.

    ``nombre`` es el alias. La clave se emite también cuando es null.
    """

    user_id: str = Field(min_length=1)
    email: str
    nombre: str | None


class ModeloActivo(_Salida):
    """``GET /auth/modelo`` → ``200``. No incluye claves ni arma el cliente."""

    proveedor: Literal["openai", "gemini"]
    modelo: str | None


class Factura(_Entrada):
    """Body de ``POST /documentos/{id}/confirmar``.

    Faltan proveedor, período o monto → 422. ``categoria`` también es
    obligatoria: la tabla del contrato no la marca opcional. Puede ser
    una fija o el nombre de una categoría propia.
    """

    proveedor: str
    categoria: Categoria
    periodo: str
    monto: str
    moneda: str = "ARS"
    numero_comprobante: str | None = None

    @field_validator("categoria")
    @classmethod
    def categoria_ok(cls, valor: str) -> str:
        return _categoria_obligatoria(valor)

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


class CamposDocumento(_Salida):
    """Objeto ``campos``. Puede ser ``{}``. Las claves en null no se emiten."""

    proveedor: str | None = None
    categoria: Categoria | None = None
    periodo: str | None = None
    monto: str | None = None
    moneda: str | None = None
    numero_comprobante: str | None = None

    @field_validator("categoria")
    @classmethod
    def categoria_ok(cls, valor: str | None) -> str | None:
        return _categoria_opcional(valor)

    @field_validator("periodo")
    @classmethod
    def periodo_ok(cls, valor: str | None) -> str | None:
        return _periodo_opcional(valor)

    @field_validator("monto")
    @classmethod
    def monto_ok(cls, valor: str | None) -> str | None:
        return _monto_opcional(valor)

    @model_serializer(mode="wrap")
    def _sin_nulos(self, serializer, _info):
        datos = serializer(self)
        if isinstance(datos, dict):
            return {clave: valor for clave, valor in datos.items() if valor is not None}
        return datos


class DocumentoBorrador(_Salida):
    """Detalle de un borrador en ``GET /documentos/{id}``.

    ``POST /documentos`` responde 202 con ``CargaAceptada``. El monto todavía
    no entra al libro. ``creado_en`` es opcional y solo aparece en el detalle.
    """

    id: str = Field(min_length=1)
    estado: Literal["borrador"]
    campos: CamposDocumento = Field(default_factory=CamposDocumento)
    texto: str
    advertencias: list[str] = Field(default_factory=list)
    creado_en: str | None = None


class Cambio(_Salida):
    """Un campo que difiere entre lo extraído y lo que quedó en el libro."""

    campo: str
    antes: str | None = None
    despues: str | None = None


class DocumentoConfirmado(_Salida):
    """``POST /documentos/{id}/confirmar`` → ``200``.

    ``anulado``, ``indexado`` y ``cambios`` tienen default para no romper
    respuestas que todavía no los mandan. ``confirmado_en`` es opcional y
    solo aparece en el detalle.
    """

    id: str = Field(min_length=1)
    estado: Literal["confirmado"]
    campos: CamposDocumento = Field(default_factory=CamposDocumento)
    anulado: bool = False
    indexado: Indexado | None = None
    cambios: list[Cambio] = Field(default_factory=list)
    confirmado_en: str | None = None


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

    @field_validator("categoria")
    @classmethod
    def categoria_ok(cls, valor: str) -> str:
        return _categoria_obligatoria(valor)

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

    @model_validator(mode="after")
    def rango_ordenado(self) -> RangoResumen:
        if self.desde > self.hasta:
            raise ValueError("desde tiene que ser anterior o igual a hasta")
        return self


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
        if len(texto) > _MAX_CONSULTA:
            raise ValueError("La consulta supera los 2000 caracteres")
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
    La salida es ``TareaReanudada``.
    """

    aprobado: bool


class TareaReanudada(_Salida):
    """``POST /tasks/{job_id}/approve`` → ``202``. El job vuelve a la cola.

    Solo ``job_id`` y ``status``. No trae ``thread_id``.
    """

    job_id: str = Field(min_length=1)
    status: Literal["PENDING"]


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


class CategoriaCatalogo(_Entrada):
    """Body de ``POST /categorias`` y ``PATCH /categorias/{id}``.

    ``nombre`` se recorta y no puede quedar vacío. ``descripcion`` vacía
    o ausente queda en null. Un ``PATCH`` sin descripción la borra.
    """

    nombre: str
    descripcion: str | None = None

    @field_validator("nombre")
    @classmethod
    def nombre_presente(cls, valor: str) -> str:
        texto = valor.strip()
        if not texto:
            raise ValueError("Falta el nombre")
        if len(texto) > 80:
            raise ValueError("El nombre supera los 80 caracteres")
        return texto

    @field_validator("descripcion")
    @classmethod
    def descripcion_opcional(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        texto = valor.strip()
        if not texto:
            return None
        if len(texto) > 280:
            raise ValueError("La descripción supera los 280 caracteres")
        return texto


class CategoriaItem(_Salida):
    """Una fila del catálogo. ``descripcion`` null se emite."""

    id: str = Field(min_length=1)
    nombre: str
    descripcion: str | None = None


class ListaCategorias(_Salida):
    """``GET /categorias`` → ``200``."""

    items: list[CategoriaItem]


class AccionNotificacion(_Salida):
    """Botón que manda el servidor. La ruta es del frontend."""

    etiqueta: str = Field(min_length=1)
    ruta: str = Field(min_length=1)


class RecursoEvento(_Salida):
    """A qué cosa apunta el evento. ``clase`` la elige el módulo."""

    clase: str = Field(min_length=1)
    id: str = Field(min_length=1)


class NotificacionItem(_Salida):
    """Una fila de ``GET /notificaciones``."""

    id: str = Field(min_length=1)
    tipo: str = Field(min_length=1)
    titulo: str
    cuerpo: str
    accion: AccionNotificacion | None = None
    recurso: RecursoEvento | None = None
    leida: bool
    creada_en: str


class ListaNotificaciones(_Salida):
    """``GET /notificaciones`` → ``200``."""

    items: list[NotificacionItem]
    no_leidas: int


class CargaAceptada(_Salida):
    """``POST /documentos`` → ``202``. La extracción corre después."""

    job_id: str = Field(min_length=1)
    status: Literal["PENDING"]


class CargaEstado(_Salida):
    """``GET /cargas/{job_id}``. ``documento_id`` llega con la fase ``lista``."""

    job_id: str = Field(min_length=1)
    fase: Literal["recibida", "extrayendo", "lista", "falla"]
    documento_id: str | None = None
    mensaje: str | None = None
