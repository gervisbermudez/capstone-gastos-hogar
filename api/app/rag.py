"""Retriever híbrido de comprobantes del hogar.

Pinecone si ``INDEX_NAME`` y ``PINECONE_API_KEY`` están y el servicio
responde. Si no, BM25 sobre los chunks locales. El nombre del índice no
tiene default: la fuente lo quiere solo en el entorno.

El modelo de embeddings sale de ``EMBEDDING_MODEL``. Si falta, Pinecone
no se usa y la búsqueda sigue en BM25.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
from pathlib import Path

from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INDICE_LOCAL = DATA_DIR / "comprobantes.jsonl"
NAMESPACE = "comprobantes"
EMBEDDING_DIM = 384
TOP_K = 5

_CATEGORIAS = {"servicios", "expensas", "alquiler"}
_PERIODO = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

_candado = threading.Lock()
_documentos: list[dict] | None = None
_usar_pinecone = True
_store = None
_motivo_config: str | None = None
_embeddings = None


class PineconeNoConfigurado(RuntimeError):
    """Falta el índice, la clave o la dimensión. No se reintenta en cada query."""


def preparar_indice_local(ruta: Path) -> None:
    """Apunta el corpus local a ``ruta`` y olvida lo que había en memoria."""
    global INDICE_LOCAL, _documentos
    with _candado:
        INDICE_LOCAL = ruta
        _documentos = []


def filtro_pinecone(
    *,
    user_id: str,
    categoria: str | None = None,
    periodo: str | None = None,
) -> dict[str, str]:
    """Filtro de metadata. El proveedor no va: Pinecone compara con mayúsculas."""
    filtro = {"user_id": user_id}
    if categoria:
        filtro["categoria"] = categoria
    if periodo:
        filtro["periodo"] = periodo
    return filtro


def fusionar(primera: list[Document], segunda: list[Document], k: int = TOP_K) -> list[Document]:
    """Rank recíproco. Un documento que está en las dos listas sube."""
    if not segunda:
        return primera[:k]
    if not primera:
        return segunda[:k]
    puntajes: dict[tuple[str, str], list] = {}
    for lista in (primera, segunda):
        for indice, doc in enumerate(lista):
            meta = doc.metadata or {}
            clave = (str(meta.get("documento_id", "")), str(meta.get("chunk_id", indice)))
            if clave not in puntajes:
                puntajes[clave] = [0.0, doc]
            puntajes[clave][0] += 1.0 / (60 + indice)
    ordenados = sorted(puntajes.values(), key=lambda par: par[0], reverse=True)
    return [doc for _puntaje, doc in ordenados[:k]]


def indexar_sync(
    *,
    user_id: str,
    documento_id: str,
    texto: str,
    categoria: str,
    periodo: str,
    proveedor: str,
) -> None:
    user_id = user_id.strip()
    documento_id = documento_id.strip()
    categoria = categoria.strip()
    periodo = periodo.strip()
    proveedor = proveedor.strip()
    if not user_id or not documento_id:
        raise ValueError("Faltan user_id o documento_id")
    if categoria not in _CATEGORIAS:
        raise ValueError("Categoría inválida")
    if _PERIODO.fullmatch(periodo) is None:
        raise ValueError("El período tiene que ser YYYY-MM")
    if not proveedor:
        raise ValueError("Falta el proveedor")
    limpio = texto.strip()
    if not limpio:
        logger.warning("El comprobante %s no tiene texto para indexar.", documento_id)
        return

    partes = _partir(limpio)
    nuevos = [
        {
            "user_id": user_id,
            "documento_id": documento_id,
            "categoria": categoria,
            "periodo": periodo,
            "proveedor": proveedor,
            "chunk_id": str(indice),
            "texto": parte,
        }
        for indice, parte in enumerate(partes)
    ]
    with _candado:
        actual = [
            fila
            for fila in _cargar_bloqueado()
            if not (
                fila.get("user_id") == user_id and fila.get("documento_id") == documento_id
            )
        ]
        actual.extend(nuevos)
        _documentos_global(actual)
        _escribir(actual)

    if not _usar_pinecone:
        return
    try:
        _upsert_pinecone(nuevos, user_id=user_id, documento_id=documento_id)
    except PineconeNoConfigurado:
        return
    except Exception as exc:
        logger.warning(
            "Pinecone no indexó %s (%s). Quedó el índice local.",
            documento_id,
            type(exc).__name__,
        )


def buscar_sync(
    *,
    consulta: str,
    user_id: str,
    categoria: str | None = None,
    periodo: str | None = None,
    proveedor: str | None = None,
) -> list[dict[str, str]]:
    """Chunks de ese usuario. Sin ``user_id`` no busca: no hay resultado cruzado."""
    user_id = (user_id or "").strip()
    consulta = (consulta or "").strip()
    if not user_id or not consulta:
        return []
    categoria = categoria or None
    periodo = periodo or None
    proveedor = proveedor or None

    locales = _filtrar_docs(
        _buscar_bm25(
            consulta,
            user_id=user_id,
            categoria=categoria,
            periodo=periodo,
            proveedor=proveedor,
        ),
        user_id=user_id,
        categoria=categoria,
        periodo=periodo,
        proveedor=proveedor,
    )
    vectoriales: list[Document] = []
    if _usar_pinecone:
        try:
            vectoriales = _filtrar_docs(
                _buscar_pinecone(
                    consulta,
                    user_id=user_id,
                    categoria=categoria,
                    periodo=periodo,
                ),
                user_id=user_id,
                categoria=categoria,
                periodo=periodo,
                proveedor=proveedor,
            )
        except PineconeNoConfigurado:
            vectoriales = []
        except Exception as exc:
            logger.warning("Pinecone no respondió (%s). Sigue BM25.", type(exc).__name__)
            vectoriales = []
    return [_publico(doc) for doc in fusionar(locales, vectoriales, TOP_K)]


async def indexar_texto(
    *,
    user_id: str,
    documento_id: str,
    texto: str,
    categoria: str,
    periodo: str,
    proveedor: str,
) -> None:
    await asyncio.to_thread(
        indexar_sync,
        user_id=user_id,
        documento_id=documento_id,
        texto=texto,
        categoria=categoria,
        periodo=periodo,
        proveedor=proveedor,
    )


def olvidar_usuario(user_id: str) -> None:
    """Saca los chunks de esa cuenta del jsonl y, si se puede, de Pinecone."""
    with _candado:
        restantes = [
            fila
            for fila in _cargar_bloqueado()
            if not (isinstance(fila, dict) and fila.get("user_id") == user_id)
        ]
        _documentos_global(restantes)
        _escribir(restantes)
    try:
        store = _store_pinecone()
        store.delete(filter={"user_id": user_id}, namespace=NAMESPACE)
    except Exception as exc:
        logger.warning("No se pudo borrar el índice remoto (%s).", type(exc).__name__)


async def buscar(
    *,
    consulta: str,
    user_id: str,
    categoria: str | None = None,
    periodo: str | None = None,
    proveedor: str | None = None,
) -> list[dict[str, str]]:
    return await asyncio.to_thread(
        buscar_sync,
        consulta=consulta,
        user_id=user_id,
        categoria=categoria,
        periodo=periodo,
        proveedor=proveedor,
    )


def _partir(texto: str) -> list[str]:
    # Sin tiktoken: el encoder se baja de la red la primera vez.
    partes = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=80).split_text(texto)
    return partes or [texto]


def _cargar_bloqueado() -> list[dict]:
    global _documentos
    if _documentos is not None:
        return _documentos
    if not INDICE_LOCAL.exists():
        _documentos = []
        return _documentos
    filas: list[dict] = []
    for linea in INDICE_LOCAL.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea:
            continue
        try:
            filas.append(json.loads(linea))
        except json.JSONDecodeError:
            logger.warning("Línea ilegible en el índice local. Se omite.")
    _documentos = filas
    return _documentos


def _documentos_global(filas: list[dict]) -> None:
    global _documentos
    _documentos = filas


def _escribir(filas: list[dict]) -> None:
    INDICE_LOCAL.parent.mkdir(parents=True, exist_ok=True)
    temporal = INDICE_LOCAL.with_suffix(INDICE_LOCAL.suffix + ".tmp")
    cuerpo = "".join(json.dumps(fila, ensure_ascii=False) + "\n" for fila in filas)
    temporal.write_text(cuerpo, encoding="utf-8")
    os.replace(temporal, INDICE_LOCAL)


def _a_document(fila: dict) -> Document:
    return Document(
        page_content=str(fila.get("texto") or ""),
        metadata={
            "user_id": str(fila.get("user_id") or ""),
            "documento_id": str(fila.get("documento_id") or ""),
            "categoria": str(fila.get("categoria") or ""),
            "periodo": str(fila.get("periodo") or ""),
            "proveedor": str(fila.get("proveedor") or ""),
            "chunk_id": str(fila.get("chunk_id") or "0"),
        },
    )


def _publico(doc: Document) -> dict[str, str]:
    meta = doc.metadata or {}
    return {
        "contenido": doc.page_content,
        "documento_id": str(meta.get("documento_id", "")),
        "categoria": str(meta.get("categoria", "")),
        "periodo": str(meta.get("periodo", "")),
        "proveedor": str(meta.get("proveedor", "")),
        "user_id": str(meta.get("user_id", "")),
    }


def _coincide(meta: dict, *, user_id: str, categoria, periodo, proveedor) -> bool:
    if str(meta.get("user_id", "")) != user_id:
        return False
    if categoria and meta.get("categoria") != categoria:
        return False
    if periodo and meta.get("periodo") != periodo:
        return False
    if proveedor and str(meta.get("proveedor", "")).casefold() != proveedor.strip().casefold():
        return False
    return True


def _filtrar_docs(docs: list[Document], **criterios) -> list[Document]:
    return [doc for doc in docs if _coincide(doc.metadata or {}, **criterios)]


def _buscar_bm25(consulta: str, **criterios) -> list[Document]:
    with _candado:
        filas = list(_cargar_bloqueado())
    docs = [_a_document(fila) for fila in filas if _coincide(fila, **criterios)]
    if not docs:
        return []
    retriever = BM25Retriever.from_documents(docs)
    retriever.k = min(TOP_K, len(docs))
    return list(retriever.invoke(consulta))


def _nombre_indice() -> str:
    nombre = os.getenv("INDEX_NAME", "").strip()
    if not nombre:
        raise PineconeNoConfigurado("Falta INDEX_NAME")
    return nombre


def _modelo_embedding() -> str:
    nombre = os.getenv("EMBEDDING_MODEL", "").strip()
    if not nombre:
        raise PineconeNoConfigurado("Falta EMBEDDING_MODEL")
    return nombre


def _embeddings_locales():
    global _embeddings
    if _embeddings is None:
        os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
        os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
        from langchain_huggingface import HuggingFaceEmbeddings

        _embeddings = HuggingFaceEmbeddings(model_name=_modelo_embedding())
    return _embeddings


def _store_pinecone():
    global _store, _motivo_config
    if _motivo_config:
        raise PineconeNoConfigurado(_motivo_config)
    if _store is not None:
        return _store
    try:
        store = _conectar_pinecone()
    except PineconeNoConfigurado as exc:
        _motivo_config = str(exc)
        raise
    _store = store
    return store


def _conectar_pinecone():
    clave = os.getenv("PINECONE_API_KEY", "").strip()
    if not clave or clave.startswith("tu_clave"):
        raise PineconeNoConfigurado("Falta PINECONE_API_KEY")
    indice = _nombre_indice()
    from pinecone import Pinecone

    pc = Pinecone(api_key=clave)
    nombres = [item["name"] for item in pc.list_indexes()]
    if indice not in nombres:
        raise PineconeNoConfigurado(f"No existe el índice {indice}")
    dimension = int(pc.describe_index(indice).dimension)
    if dimension != EMBEDDING_DIM:
        raise PineconeNoConfigurado(
            f"El índice {indice} tiene dimensión {dimension} y el embedding usa {EMBEDDING_DIM}"
        )
    from langchain_pinecone import PineconeVectorStore

    return PineconeVectorStore(
        index_name=indice,
        embedding=_embeddings_locales(),
        namespace=NAMESPACE,
    )


def _buscar_pinecone(consulta: str, *, user_id: str, categoria, periodo) -> list[Document]:
    store = _store_pinecone()
    return list(
        store.similarity_search(
            consulta,
            k=TOP_K,
            filter=filtro_pinecone(user_id=user_id, categoria=categoria, periodo=periodo),
            namespace=NAMESPACE,
        )
    )


def _upsert_pinecone(filas: list[dict], *, user_id: str, documento_id: str) -> None:
    store = _store_pinecone()
    try:
        store.delete(
            filter={"user_id": user_id, "documento_id": documento_id},
            namespace=NAMESPACE,
        )
    except Exception as exc:
        logger.warning("No pude borrar chunks viejos en Pinecone (%s).", type(exc).__name__)
    documentos = [_a_document(fila) for fila in filas]
    ids = [f"{user_id}:{documento_id}:{fila['chunk_id']}" for fila in filas]
    store.add_documents(documentos, ids=ids, namespace=NAMESPACE)
