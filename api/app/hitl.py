"""Pausa humana antes de una acción con efecto.

Una consulta de solo lectura (cuánto se pagó, comparar meses, qué dice una
factura) termina sola. Un pago arma un borrador para revisar. El resto de
los efectos se anota en el jsonl de avisos. Nada de eso corre antes del
``interrupt``.
"""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from langgraph.types import interrupt

from .agents.bucle import correr_async
from .state import AgentState, pregunta_actual

UMBRAL_MONTO = 1000
AVISOS = Path(__file__).resolve().parent.parent / "avisos" / "rrhh.jsonl"
_candado_avisos = threading.Lock()
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

# Frases que piden un efecto fuera del grafo. Una pregunta de lectura
# ("¿cuánto pagué de expensas?") no las contiene.
_EFECTOS = (
    "notific",
    "avisá a",
    "avisa a",
    "avisar a",
    "registrá",
    "registra el",
    "registrar el",
    "enviá",
    "envia un",
    "enviar un",
    "aplicá el ajuste",
    "aplica el ajuste",
    "aplicar el ajuste",
    "ejecutá",
    "ejecuta el",
    "ejecutar el",
    "mandá un correo",
    "manda un correo",
    "enviar un correo",
    "reembolso",
    "debitá",
    "debita",
    "transferí",
    "transferi",
    "cargá en el legajo",
    "carga en el legajo",
    "cargar en el legajo",
    "costo muy alto",
    "tarea crítica",
    "tarea critica",
    "asentá",
    "asentar",
    "asenta el",
    "registrá el pago",
    "registra el pago",
    "registrar el pago",
)

_MONEDA = ("usd", "u$s", "$", "dolar", "dólar", "dolares", "dólares", "peso")
_PAGOS = ("pagar", "pagá", "paga ", "pago de", "abonar", "aboná")


def es_critica_texto(pregunta: str) -> tuple[bool, str]:
    """Decide si el pedido necesita un humano antes de actuar."""
    texto = (pregunta or "").lower()
    if any(frase in texto for frase in _EFECTOS):
        return True, "La tarea pide una acción con efecto o un costo muy alto."
    if any(frase in texto for frase in _PAGOS) and _hay_monto_alto(texto):
        return (
            True,
            f"La tarea pide un pago de {UMBRAL_MONTO} USD o más.",
        )
    return False, "Consulta de solo lectura: no requiere aprobación."


def es_critica(state: AgentState) -> tuple[bool, str]:
    return es_critica_texto(pregunta_actual(state))


def nodo_evaluar_criticidad(state: AgentState) -> dict:
    critica, motivo = es_critica(state)
    return {"critica": critica, "motivo_critico": motivo, "aprobado": None}


def _payload_pausa(state: AgentState) -> dict:
    pregunta = pregunta_actual(state)
    payload = {
        "pregunta": (
            "Esta tarea quiere ejecutar una acción con efecto. "
            "¿La aprobás?"
        ),
        "motivo": state.get("motivo_critico") or "",
        "pedido": (pregunta or "")[:500],
        "efecto": "borrador" if _es_pago(pregunta) else "registro",
    }
    datos = _datos_pago(pregunta)
    if datos:
        payload["datos"] = {
            "categoria": datos["categoria"],
            "periodo": datos["periodo"],
            "monto": datos["monto"],
        }
    return payload


def nodo_aprobacion(state: AgentState) -> dict:
    """Pausa el grafo. Al reanudar, ``interrupt`` devuelve la decisión.

    No hay efectos antes de esta llamada: el borrador o el aviso viven en
    el nodo siguiente, porque al reanudar este nodo vuelve a empezar.
    """
    decision = interrupt(_payload_pausa(state))
    return {"aprobado": decision_aprobada(decision)}


def _es_pago(pregunta: str) -> bool:
    texto = (pregunta or "").lower()
    return (
        "asent" in texto
        or "registrá el pago" in texto
        or "registra el pago" in texto
        or "registrar el pago" in texto
    )


_ADVERTENCIA_BORRADOR = "Este borrador salió del chat. Revisalo antes de confirmar."


def nodo_ejecutar(state: AgentState) -> dict:
    """Corre el efecto recién cuando el humano ya aprobó."""
    pregunta = pregunta_actual(state)
    user_id = str(state.get("user_id") or "").strip()
    if not state.get("aprobado"):
        if _es_pago(pregunta):
            return {"accion": "Rechazado por el revisor. No se creó el borrador del pago."}
        return {"accion": "Rechazado por el revisor. No se registró la acción."}
    if _es_pago(pregunta):
        return _crear_borrador(pregunta, user_id)
    mensaje = _armar_aviso(state)
    registrar_aviso(mensaje, user_id=user_id)
    return {"accion": f"Acción registrada. {mensaje}"}


def _crear_borrador(pregunta: str, user_id: str) -> dict:
    datos = _datos_pago(pregunta)
    if datos is None:
        return {"accion": "No se creó el borrador: faltan categoría, período o monto."}
    if not user_id:
        return {"accion": "No se creó el borrador."}
    from .repositorio import guardar_borrador

    async def _guardar() -> str:
        return await guardar_borrador(
            user_id=user_id,
            texto=(pregunta or "")[:500],
            campos={
                "proveedor": datos["proveedor"],
                "categoria": datos["categoria"],
                "periodo": datos["periodo"],
                "monto": datos["monto"],
            },
            advertencias=[_ADVERTENCIA_BORRADOR],
        )

    documento_id = correr_async(_guardar())
    return {"accion": f"Borrador: {documento_id}"}


def decision_aprobada(decision: object) -> bool:
    if isinstance(decision, bool):
        return decision
    if isinstance(decision, dict):
        return bool(decision.get("aprobado"))
    texto = str(decision).strip().lower()
    return texto in {"si", "sí", "true", "1", "aprobar", "aprobado", "yes", "ok"}


def registrar_aviso(mensaje: str, *, user_id: str = "") -> Path:
    AVISOS.parent.mkdir(parents=True, exist_ok=True)
    linea = json.dumps(
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "user_id": user_id,
            "mensaje": mensaje,
        },
        ensure_ascii=False,
    )
    with _candado_avisos:
        with AVISOS.open("a", encoding="utf-8") as archivo:
            archivo.write(linea + "\n")
    return AVISOS


def _datos_pago(pregunta: str) -> dict[str, str] | None:
    texto = (pregunta or "").lower()
    if "expensa" in texto:
        categoria = "expensas"
    elif "alquiler" in texto:
        categoria = "alquiler"
    elif any(marca in texto for marca in ("luz", "gas", "agua", "internet", "servicio")):
        categoria = "servicios"
    else:
        return None
    periodo = None
    hallado = re.search(r"\d{4}-(0[1-9]|1[0-2])", texto)
    if hallado:
        periodo = hallado.group(0)
    else:
        anio = datetime.now().year
        for nombre, mes in _MESES.items():
            if nombre in texto:
                periodo = f"{anio}-{mes}"
                break
    monto = None
    cifras = re.findall(r"\d+\.\d{2}", pregunta or "")
    if cifras:
        monto = cifras[-1]
    if not periodo or not monto:
        return None
    return {
        "proveedor": "Asiento",
        "categoria": categoria,
        "periodo": periodo,
        "monto": monto,
    }


def _armar_aviso(state: AgentState) -> str:
    aportes = [
        c
        for c in (state.get("contribuciones") or [])
        if isinstance(c, dict) and c.get("agente") != "__reset__"
    ]
    resumen = " | ".join(f"{c.get('agente')}: {c.get('aporte', '')[:180]}" for c in aportes)
    return resumen or "Acción sin detalle de aportes."


def _hay_monto_alto(texto: str) -> bool:
    if not any(moneda in texto for moneda in _MONEDA):
        return False
    for crudo in re.findall(r"\d+", texto):
        if int(crudo) >= UMBRAL_MONTO:
            return True
    return False
