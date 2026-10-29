import { Alert, Box, CloseButton, Drawer, Flex, Portal, Stack } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import type { DocumentoDetalle, Hilo, TareaEstado } from "../api/tipos"
import {
  TOPE_TRANSCRIPTO,
  guardarConsultaPendiente,
  guardarContextoChat,
  guardarHilo,
  guardarJobPendiente,
  guardarTranscripto,
  leerContextoChat,
  leerConsultaPendiente,
  leerHilo,
  leerJobAplicado,
  leerJobPendiente,
  leerTranscripto,
  olvidarConsultaPendiente,
  olvidarContextoChat,
  olvidarHilo,
  olvidarJobPendiente,
  olvidarTranscripto,
  type MensajeGuardado,
} from "../almacen"
import { canalConectado, marcarLeidasDeRecurso, seguirJob, suscribirEventos, tareaDeEvento } from "../canalBus"
import { citaComprobante, esTituloCita, fotoDesdeCita, textoVisible, tituloVisible } from "../chat/contexto"
import {
  Compositor,
  DialogoEliminarConversacion,
  EncabezadoChat,
  EstadoVacio,
  MensajeChat,
  fotoDeAdjunto,
} from "../componentes/chat/Conversacion"
import { ListaConversaciones, type VistaConversaciones } from "../componentes/chat/ListaConversaciones"
import { EsqueletoHilo } from "../componentes/esqueleto"
import { PuntosEspera, entrada, useMovimientoReducido } from "../movimiento"

type Mensaje = MensajeGuardado

type AccionesChat = {
  observarHilo: (threadId: string) => void
  aplicar: (estado: TareaEstado) => void
  reponerPersona: () => void
}

function nuevoId(): string {
  return crypto.randomUUID()
}

function mensajeDesdeServidor(rol: "persona" | "asistente" | "nota", texto: string): Mensaje {
  if (rol === "persona") {
    const adjunto = fotoDesdeCita(texto)
    const visible = textoVisible(texto)
    return adjunto
      ? { id: nuevoId(), tipo: "persona", texto: visible, adjunto }
      : { id: nuevoId(), tipo: "persona", texto: visible }
  }
  if (rol === "asistente") return { id: nuevoId(), tipo: "asistente", texto }
  return { id: nuevoId(), tipo: "nota", texto }
}

function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new DOMException("aborted", "AbortError"))
      },
      { once: true },
    )
  })
}

function anotarEstado(
  estado: TareaEstado,
  puedePararEnAprobacion: boolean,
  alHilo?: (threadId: string) => void,
): { puedePararEnAprobacion: boolean; listo: boolean } {
  guardarHilo(estado.thread_id)
  alHilo?.(estado.thread_id)
  if (estado.status === "DONE" || estado.status === "FAILED") {
    return { puedePararEnAprobacion, listo: true }
  }
  if (estado.status === "AWAITING_APPROVAL" && puedePararEnAprobacion) {
    return { puedePararEnAprobacion, listo: true }
  }
  return {
    puedePararEnAprobacion: estado.status === "AWAITING_APPROVAL" ? puedePararEnAprobacion : true,
    listo: false,
  }
}

async function seguir(
  jobId: string,
  signal: AbortSignal,
  saltarAprobacionActual: boolean,
  alHilo?: (threadId: string) => void,
): Promise<TareaEstado> {
  // El canal de la sesión trae chat.estado. Si la cola sigue vacía, se vuelve al GET.
  const soltarJob = seguirJob(jobId)
  const cola: TareaEstado[] = []
  let despertar: (() => void) | null = null
  const soltar = suscribirEventos((evento) => {
    const estado = tareaDeEvento(evento, jobId)
    if (!estado) return
    cola.push(estado)
    const fn = despertar
    despertar = null
    fn?.()
  })
  let puedePararEnAprobacion = !saltarAprobacionActual

  const tomar = (): TareaEstado | null => {
    const estado = cola.shift()
    if (!estado) return null
    const paso = anotarEstado(estado, puedePararEnAprobacion, alHilo)
    puedePararEnAprobacion = paso.puedePararEnAprobacion
    return paso.listo ? estado : null
  }

  const esperarAviso = () =>
    new Promise<void>((resolve, reject) => {
      const alAbortar = () => {
        clearTimeout(timer)
        reject(new DOMException("aborted", "AbortError"))
      }
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", alAbortar)
        resolve()
      }, 1000)
      signal.addEventListener("abort", alAbortar, { once: true })
      despertar = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", alAbortar)
        resolve()
      }
    })

  try {
    const actual = await cliente.verTarea(jobId, signal)
    const paso = anotarEstado(actual, puedePararEnAprobacion, alHilo)
    puedePararEnAprobacion = paso.puedePararEnAprobacion
    if (paso.listo) return actual
    for (;;) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError")
      const deCola = tomar()
      if (deCola) return deCola
      if (cola.length > 0) continue
      if (!canalConectado()) {
        const estado = await cliente.verTarea(jobId, signal)
        const sondeo = anotarEstado(estado, puedePararEnAprobacion, alHilo)
        puedePararEnAprobacion = sondeo.puedePararEnAprobacion
        if (sondeo.listo) return estado
        await esperar(1000, signal)
        continue
      }
      await esperarAviso()
      if (cola.length > 0) continue
      const estado = await cliente.verTarea(jobId, signal)
      const sondeo = anotarEstado(estado, puedePararEnAprobacion, alHilo)
      puedePararEnAprobacion = sondeo.puedePararEnAprobacion
      if (sondeo.listo) return estado
    }
  } finally {
    soltar()
    soltarJob()
  }
}

function personaYaRegistrada(mensajes: readonly Mensaje[], texto: string): boolean {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const mensaje = mensajes[i]
    if (mensaje?.tipo === "persona") return textoVisible(mensaje.texto) === texto
  }
  return false
}

function tituloLocal(mensajes: readonly Mensaje[]): string {
  const persona = mensajes.find((mensaje) => mensaje.tipo === "persona")
  if (persona?.tipo !== "persona" || !persona.texto.trim() || esTituloCita(persona.texto)) return ""
  return tituloVisible(persona.texto)
}

function tituloDe(hilos: Hilo[] | null, activo: string | null, mensajes: readonly Mensaje[]): string {
  if (!activo) return "Nueva conversación"
  const guardado = hilos?.find((hilo) => hilo.thread_id === activo)?.titulo.trim() ?? ""
  if (guardado && !esTituloCita(guardado)) return tituloVisible(guardado)
  return tituloLocal(mensajes) || (guardado ? tituloVisible(guardado) : "Conversación")
}

function hilosConActual(
  hilos: Hilo[] | null,
  activo: string | null,
  mensajes: readonly Mensaje[],
  archivados: ReadonlySet<string>,
): Hilo[] | null {
  if (!hilos || !activo || archivados.has(activo) || hilos.some((hilo) => hilo.thread_id === activo)) return hilos
  const persona = mensajes.find((mensaje) => mensaje.tipo === "persona")
  const titulo = persona?.tipo === "persona" && persona.texto.trim() ? persona.texto.trim() : "Nueva conversación"
  return [{ thread_id: activo, titulo, actualizado_en: new Date().toISOString() }, ...hilos]
}

const AVISO_CONSULTA_ABIERTA =
  "Hay una consulta sin terminar. No abrí un chat nuevo sobre este comprobante."

type EntradaChat = {
  hilo: string | null
  mensajes: Mensaje[]
  contextoId: string | null
  avisoNuevo: string | null
}

function idNuevo(state: unknown): string | null {
  if (!state || typeof state !== "object" || !("nuevoComprobante" in state)) return null
  const valor = (state as { nuevoComprobante?: unknown }).nuevoComprobante
  return typeof valor === "string" && valor !== "" ? valor : null
}

function aprobacionAbierta(hilo: string | null): boolean {
  if (!hilo) return false
  return leerTranscripto(hilo).some((mensaje) => mensaje.tipo === "aprobacion" && mensaje.resuelta === null)
}

function aprobacionDe(mensajes: readonly Mensaje[], jobId: string): Mensaje | null {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const mensaje = mensajes[i]
    if (mensaje?.tipo === "aprobacion" && mensaje.jobId === jobId && mensaje.resuelta === null) return mensaje
  }
  return null
}

function conAprobacion(mensajes: Mensaje[], jobId: string | null, origen: readonly Mensaje[]): Mensaje[] {
  if (!jobId) return mensajes
  const carta = aprobacionDe(origen, jobId)
  if (!carta) return mensajes
  return [...mensajes.filter((mensaje) => !(mensaje.tipo === "aprobacion" && mensaje.jobId === jobId)), carta]
}

function soloAprobacion(mensajes: readonly Mensaje[], jobId: string): boolean {
  return mensajes.length > 0 && mensajes.every((mensaje) => mensaje.tipo === "aprobacion" && mensaje.jobId === jobId)
}

function prepararEntrada(comprobanteId: string | null, iniciarNuevo: boolean): EntradaChat {
  const hiloActual = leerHilo()
  const bloqueado = leerJobPendiente() !== null || aprobacionAbierta(hiloActual)
  if (comprobanteId && iniciarNuevo) {
    if (bloqueado) {
      return {
        hilo: hiloActual,
        mensajes: hiloActual ? leerTranscripto(hiloActual) : [],
        contextoId: null,
        avisoNuevo: AVISO_CONSULTA_ABIERTA,
      }
    }
    olvidarHilo()
    guardarContextoChat({ comprobanteId, threadId: null })
    return { hilo: null, mensajes: [], contextoId: comprobanteId, avisoNuevo: null }
  }
  const guardado = leerContextoChat()
  if (comprobanteId && guardado?.comprobanteId === comprobanteId) {
    if (guardado.threadId) {
      guardarHilo(guardado.threadId)
      return {
        hilo: guardado.threadId,
        mensajes: leerTranscripto(guardado.threadId),
        contextoId: comprobanteId,
        avisoNuevo: null,
      }
    }
    return { hilo: null, mensajes: [], contextoId: comprobanteId, avisoNuevo: null }
  }
  return {
    hilo: hiloActual,
    mensajes: hiloActual ? leerTranscripto(hiloActual) : [],
    contextoId: null,
    avisoNuevo: null,
  }
}

function useMensajesNuevos(hiloId: string | null, mensajes: readonly Mensaje[]): ReadonlySet<string> {
  const firma = useRef<string | null | undefined>(undefined)
  const vistos = useRef<Set<string>>(new Set())
  const animados = useRef<Set<string>>(new Set())

  if (firma.current !== hiloId) {
    const primera = firma.current === undefined
    const ids = mensajes.map((mensaje) => mensaje.id)
    const actuales = new Set(ids)
    const agregados = ids.filter((id) => !vistos.current.has(id))
    const siguen = [...vistos.current].every((id) => actuales.has(id))
    const continuo = !primera && siguen && agregados.length <= 2
    firma.current = hiloId
    if (!continuo) animados.current = new Set()
    else {
      for (const id of agregados) animados.current.add(id)
    }
    vistos.current = actuales
  } else {
    const agregados = mensajes.filter((mensaje) => !vistos.current.has(mensaje.id))
    if (agregados.length > 0 && agregados.length <= 2) {
      for (const mensaje of agregados) animados.current.add(mensaje.id)
    }
    for (const mensaje of agregados) vistos.current.add(mensaje.id)
  }

  return animados.current
}

function hilosLimpios(hilos: Hilo[] | null, activo: string | null, mensajes: readonly Mensaje[]): Hilo[] | null {
  if (!hilos) return null
  return hilos.map((hilo) => {
    let titulo = tituloVisible(hilo.titulo)
    if (esTituloCita(hilo.titulo)) {
      const local = tituloLocal(hilo.thread_id === activo ? mensajes : leerTranscripto(hilo.thread_id))
      if (local) titulo = local
    }
    if (titulo === hilo.titulo) return hilo
    return { ...hilo, titulo }
  })
}

export function Chat() {
  const [params, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const comprobanteParam = params.get("comprobante")
  const hiloParam = params.get("hilo")
  const jobParam = params.get("job")
  const iniciarNuevo = !hiloParam && idNuevo(location.state) === comprobanteParam && comprobanteParam !== null
  const [inicial] = useState(() => prepararEntrada(comprobanteParam, iniciarNuevo))
  const hiloRef = useRef(inicial.hilo)
  const [hiloActivo, setHiloActivo] = useState<string | null>(inicial.hilo)
  const [contextoId, setContextoId] = useState<string | null>(inicial.contextoId)
  const contextoIdRef = useRef(inicial.contextoId)
  const [ficha, setFicha] = useState<DocumentoDetalle | null>(null)
  const fichaRef = useRef<DocumentoDetalle | null>(null)
  const [cargandoFicha, setCargandoFicha] = useState(() => Boolean(inicial.contextoId))
  const [fallaFicha, setFallaFicha] = useState(false)
  const [avisoNuevo, setAvisoNuevo] = useState<string | null>(inicial.avisoNuevo)
  const [hilos, setHilos] = useState<Hilo[] | null>(null)
  const [hilosArchivados, setHilosArchivados] = useState<Hilo[] | null>(null)
  const [idsArchivados, setIdsArchivados] = useState<ReadonlySet<string>>(() => new Set())
  const [errorHilos, setErrorHilos] = useState<string | null>(null)
  const [errorArchivados, setErrorArchivados] = useState<string | null>(null)
  const [vista, setVista] = useState<VistaConversaciones>("activas")
  const [versionHilos, setVersionHilos] = useState(0)
  const [gestionando, setGestionando] = useState(false)
  const [baja, setBaja] = useState<{ id: string; titulo: string } | null>(null)
  const [errorBaja, setErrorBaja] = useState<string | null>(null)
  const [cargandoHilo, setCargandoHilo] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>(inicial.mensajes)
  const mensajesRef = useRef(inicial.mensajes)
  const [borrador, setBorrador] = useState("")
  const [ocupado, setOcupado] = useState(() => leerJobPendiente() !== null)
  const [fase, setFase] = useState<"consulta" | "decision" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historialAbierto, setHistorialAbierto] = useState(false)
  const abortar = useRef<AbortController | null>(null)
  const cargaHilo = useRef<AbortController | null>(null)
  const vivo = useRef(true)
  const pegado = useRef(true)
  const lista = useRef<HTMLDivElement>(null)
  const reducido = useMovimientoReducido()
  const mensajesNuevos = useMensajesNuevos(hiloActivo, mensajes)
  const acciones = useRef<AccionesChat | null>(null)
  const hayPendiente = mensajes.some((mensaje) => mensaje.tipo === "aprobacion" && mensaje.resuelta === null)

  function publicar(listaMensajes: Mensaje[], jobAplicado?: string) {
    const recortados = listaMensajes.slice(-TOPE_TRANSCRIPTO)
    mensajesRef.current = recortados
    setMensajes(recortados)
    const hilo = hiloRef.current
    if (hilo) guardarTranscripto(hilo, recortados, jobAplicado)
  }

  contextoIdRef.current = contextoId

  function recordarContexto(threadId: string) {
    const id = contextoIdRef.current
    if (!id || !threadId) return
    const actual = leerContextoChat()
    if (actual?.comprobanteId === id && actual.threadId === threadId) return
    guardarContextoChat({ comprobanteId: id, threadId })
  }

  function soltarContexto() {
    contextoIdRef.current = null
    setContextoId(null)
    fichaRef.current = null
    setFicha(null)
    setFallaFicha(false)
    setCargandoFicha(false)
    olvidarContextoChat()
    setAvisoNuevo(null)
    setSearchParams(
      (actuales) => {
        if (!actuales.has("comprobante")) return actuales
        const siguientes = new URLSearchParams(actuales)
        siguientes.delete("comprobante")
        return siguientes
      },
      { replace: true },
    )
  }

  function observarHilo(threadId: string) {
    if (!threadId) return
    recordarContexto(threadId)
    const anterior = hiloRef.current
    if (anterior === threadId) return
    if (anterior) {
      guardarTranscripto(anterior, mensajesRef.current)
      hiloRef.current = threadId
      setHiloActivo(threadId)
      guardarHilo(threadId)
      const cargados = leerTranscripto(threadId)
      mensajesRef.current = cargados
      setMensajes(cargados)
      return
    }
    hiloRef.current = threadId
    setHiloActivo(threadId)
    guardarHilo(threadId)
    if (mensajesRef.current.length > 0) {
      guardarTranscripto(threadId, mensajesRef.current)
      return
    }
    const guardados = leerTranscripto(threadId)
    if (guardados.length === 0) return
    mensajesRef.current = guardados
    setMensajes(guardados)
  }

  function reponerPersona() {
    const consulta = leerConsultaPendiente()
    if (!consulta || personaYaRegistrada(mensajesRef.current, consulta)) return
    publicar([...mensajesRef.current, { id: nuevoId(), tipo: "persona", texto: consulta }])
  }

  function cerrarJob() {
    olvidarJobPendiente()
    olvidarConsultaPendiente()
  }

  function aplicar(estado: TareaEstado) {
    observarHilo(estado.thread_id)
    if (estado.status === "DONE" || estado.status === "FAILED" || estado.status === "AWAITING_APPROVAL") {
      marcarLeidasDeRecurso("job", estado.job_id)
    }
    if (estado.status === "DONE" || estado.status === "FAILED") {
      const hilo = hiloRef.current
      if (hilo && leerJobAplicado(hilo) === estado.job_id) {
        cerrarJob()
        return
      }
      const texto =
        estado.result ?? (estado.status === "DONE" ? "Listo, sin texto de respuesta." : "La consulta no se pudo completar.")
      publicar(
        [
          ...mensajesRef.current,
          { id: nuevoId(), tipo: estado.status === "DONE" ? "asistente" : "nota", texto },
        ],
        estado.job_id,
      )
      cerrarJob()
      setVersionHilos((valor) => valor + 1)
      return
    }
    if (estado.status === "AWAITING_APPROVAL") {
      guardarJobPendiente(estado.job_id)
      const ya = mensajesRef.current.some((mensaje) => mensaje.tipo === "aprobacion" && mensaje.jobId === estado.job_id)
      if (ya) return
      publicar([
        ...mensajesRef.current,
        {
          id: nuevoId(),
          tipo: "aprobacion",
          jobId: estado.job_id,
          texto: estado.result ?? "Hay una acción pendiente de tu decisión.",
          resuelta: null,
        },
      ])
    }
  }

  acciones.current = { observarHilo, aplicar, reponerPersona }

  const entradaInicial = useRef({
    iniciarNuevo,
    comprobanteId: comprobanteParam,
    aviso: inicial.avisoNuevo,
  })

  useEffect(() => {
    const entrada = entradaInicial.current
    if (!entrada.iniciarNuevo) return
    if (entrada.aviso || !entrada.comprobanteId) {
      navigate("/chat", { replace: true, state: null })
      return
    }
    navigate(
      { pathname: "/chat", search: `?comprobante=${encodeURIComponent(entrada.comprobanteId)}` },
      { replace: true, state: null },
    )
  }, [navigate])

  useEffect(() => {
    if (!contextoId) {
      fichaRef.current = null
      setFicha(null)
      setFallaFicha(false)
      setCargandoFicha(false)
      return
    }
    const ctrl = new AbortController()
    setCargandoFicha(true)
    setFallaFicha(false)
    cliente
      .verDocumento(contextoId, ctrl.signal)
      .then((dato) => {
        fichaRef.current = dato
        setFicha(dato)
        setFallaFicha(false)
      })
      .catch((falla: unknown) => {
        if (esAbort(falla)) return
        fichaRef.current = null
        setFicha(null)
        setFallaFicha(true)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargandoFicha(false)
      })
    return () => ctrl.abort()
  }, [contextoId])

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelado = false
    void (async () => {
      const [activas, archivadas] = await Promise.allSettled([
        cliente.listarHilos(ctrl.signal),
        cliente.listarHilosArchivados(ctrl.signal),
      ])
      if (cancelado) return
      if (activas.status === "fulfilled") {
        setHilos(activas.value.items)
        setErrorHilos(null)
      } else if (!esAbort(activas.reason)) {
        setErrorHilos(
          activas.reason instanceof ErrorApi ? activas.reason.message : "No se pudieron cargar las conversaciones.",
        )
      }
      if (archivadas.status === "fulfilled") {
        const idsActivos =
          activas.status === "fulfilled" ? new Set(activas.value.items.map((hilo) => hilo.thread_id)) : null
        const soloArchivados = idsActivos
          ? archivadas.value.items.filter((hilo) => !idsActivos.has(hilo.thread_id))
          : archivadas.value.items
        setHilosArchivados(soloArchivados)
        setIdsArchivados(new Set(soloArchivados.map((hilo) => hilo.thread_id)))
        setErrorArchivados(null)
      } else if (!esAbort(archivadas.reason)) {
        setErrorArchivados(
          archivadas.reason instanceof ErrorApi
            ? archivadas.reason.message
            : "No se pudieron cargar las conversaciones archivadas.",
        )
      }
    })()
    return () => {
      cancelado = true
      ctrl.abort()
    }
  }, [versionHilos])

  useEffect(() => () => cargaHilo.current?.abort(), [])

  useEffect(() => {
    vivo.current = true
    const jobId = leerJobPendiente()
    if (!jobId) {
      return () => {
        vivo.current = false
        abortar.current?.abort()
      }
    }
    const ctrl = new AbortController()
    abortar.current = ctrl
    let cancelado = false
    void (async () => {
      try {
        const estado = await cliente.verTarea(jobId, ctrl.signal)
        if (cancelado || !vivo.current) return
        acciones.current?.observarHilo(estado.thread_id)
        if (estado.status === "PENDING" || estado.status === "RUNNING") {
          acciones.current?.reponerPersona()
          setFase("consulta")
          const final = await seguir(jobId, ctrl.signal, false, (threadId) => {
            acciones.current?.observarHilo(threadId)
          })
          if (cancelado || !vivo.current) return
          acciones.current?.aplicar(final)
          return
        }
        acciones.current?.aplicar(estado)
      } catch (falla: unknown) {
        if (cancelado || !vivo.current || esAbort(falla)) return
        setError(falla instanceof ErrorApi ? falla.message : "No se pudo retomar la consulta.")
      } finally {
        if (!cancelado) {
          setOcupado(false)
          setFase(null)
        }
      }
    })()
    return () => {
      cancelado = true
      vivo.current = false
      ctrl.abort()
      abortar.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!pegado.current) return
    lista.current?.scrollTo({
      top: lista.current.scrollHeight,
      behavior: reducido ? "auto" : "smooth",
    })
  }, [mensajes, ocupado, cargandoHilo, reducido])

  function alDesplazar() {
    const nodo = lista.current
    if (!nodo) return
    pegado.current = nodo.scrollHeight - nodo.scrollTop - nodo.clientHeight < 80
  }

  async function enviar(texto: string) {
    const query = texto.trim()
    if (!query || ocupado || hayPendiente || gestionando) return
    pegado.current = true
    const idContexto = contextoIdRef.current
    const documento = fichaRef.current
    const adjunto = idContexto
      ? fotoDeAdjunto({
          id: idContexto,
          documento,
          cargando: documento ? false : cargandoFicha,
          falla: documento ? false : fallaFicha,
        })
      : undefined
    const queryApi = idContexto ? `${citaComprobante(idContexto, documento?.campos)}\n${query}` : query
    setBorrador("")
    setError(null)
    if (idContexto) soltarContexto()
    guardarConsultaPendiente(query)
    publicar([
      ...mensajesRef.current,
      adjunto
        ? { id: nuevoId(), tipo: "persona", texto: query, adjunto }
        : { id: nuevoId(), tipo: "persona", texto: query },
    ])
    setOcupado(true)
    setFase("consulta")
    abortar.current?.abort()
    const ctrl = new AbortController()
    abortar.current = ctrl
    let conJob = false
    try {
      const creada = await cliente.crearTarea({ query: queryApi, thread_id: hiloRef.current })
      guardarJobPendiente(creada.job_id)
      conJob = true
      if (idsArchivados.has(creada.thread_id)) recordarActiva(creada.thread_id)
      observarHilo(creada.thread_id)
      if (!vivo.current) return
      const estado = await seguir(creada.job_id, ctrl.signal, false, observarHilo)
      if (!vivo.current) return
      aplicar(estado)
    } catch (falla) {
      if (!vivo.current || esAbort(falla)) return
      if (!conJob) olvidarConsultaPendiente()
      setError(falla instanceof ErrorApi ? falla.message : "No se pudo enviar la consulta.")
    } finally {
      if (vivo.current) {
        setOcupado(false)
        setFase(null)
      }
    }
  }

  async function decidir(jobId: string, aprobado: boolean) {
    if (ocupado) return
    setOcupado(true)
    setFase("decision")
    setError(null)
    abortar.current?.abort()
    const ctrl = new AbortController()
    abortar.current = ctrl
    try {
      await cliente.aprobar(jobId, aprobado)
      if (!vivo.current) return
      publicar(
        mensajesRef.current.map((mensaje) =>
          mensaje.tipo === "aprobacion" && mensaje.jobId === jobId
            ? { ...mensaje, resuelta: aprobado ? "si" : "no" }
            : mensaje,
        ),
      )
      const estado = await seguir(jobId, ctrl.signal, true, observarHilo)
      if (!vivo.current) return
      aplicar(estado)
    } catch (falla) {
      if (!vivo.current || esAbort(falla)) return
      setError(falla instanceof ErrorApi ? falla.message : "No se pudo registrar la decisión.")
    } finally {
      if (vivo.current) {
        setOcupado(false)
        setFase(null)
      }
    }
  }

  async function abrirHilo(threadId: string, jobId: string | null = null) {
    if (ocupado || hayPendiente) return
    const origen = mensajesRef.current
    const tieneCarta = jobId !== null && aprobacionDe(origen, jobId) !== null
    const hayHistoria = origen.some((mensaje) => mensaje.tipo !== "aprobacion")
    if (threadId === hiloRef.current && origen.length > 0 && (jobId === null || (tieneCarta && hayHistoria))) return
    const dejarContexto = Boolean(contextoIdRef.current && leerContextoChat()?.threadId !== threadId)
    pegado.current = true
    cargaHilo.current?.abort()
    const anterior = hiloRef.current
    if (anterior && anterior !== threadId) guardarTranscripto(anterior, mensajesRef.current)
    hiloRef.current = threadId
    setHiloActivo(threadId)
    guardarHilo(threadId)
    setError(null)
    const local = leerTranscripto(threadId)
    if (local.length > 0 && !(jobId !== null && soloAprobacion(local, jobId))) {
      if (dejarContexto) soltarContexto()
      else recordarContexto(threadId)
      const mostrados = conAprobacion(local, jobId, origen)
      if (mostrados !== local) guardarTranscripto(threadId, mostrados)
      mensajesRef.current = mostrados
      setMensajes(mostrados)
      setCargandoHilo(false)
      return
    }
    const ctrl = new AbortController()
    cargaHilo.current = ctrl
    const espera = conAprobacion([], jobId, origen)
    mensajesRef.current = espera
    setMensajes(espera)
    setCargandoHilo(true)
    try {
      const detalle = await cliente.verHilo(threadId, ctrl.signal)
      if (!vivo.current || hiloRef.current !== threadId) return
      if (dejarContexto) soltarContexto()
      else recordarContexto(threadId)
      const traidos = detalle.mensajes
        .slice(-TOPE_TRANSCRIPTO)
        .map((mensaje) => mensajeDesdeServidor(mensaje.rol, mensaje.texto))
      const mostrados = conAprobacion(traidos, jobId, origen)
      if (mostrados.length > 0) guardarTranscripto(threadId, mostrados)
      mensajesRef.current = mostrados
      setMensajes(mostrados)
    } catch (falla: unknown) {
      if (!vivo.current || esAbort(falla) || hiloRef.current !== threadId) return
      if (anterior) {
        hiloRef.current = anterior
        setHiloActivo(anterior)
        guardarHilo(anterior)
        const previos = conAprobacion(leerTranscripto(anterior), anterior === threadId ? jobId : null, origen)
        mensajesRef.current = previos
        setMensajes(previos)
      } else if (!leerJobPendiente()) {
        hiloRef.current = null
        setHiloActivo(null)
        mensajesRef.current = []
        setMensajes([])
        olvidarHilo()
      }
      setCargandoHilo(false)
      setError(falla instanceof ErrorApi ? falla.message : "No se pudo abrir la conversación.")
    } finally {
      if (vivo.current && hiloRef.current === threadId) setCargandoHilo(false)
    }
  }

  function nueva() {
    if (ocupado || hayPendiente) return
    abortar.current?.abort()
    cargaHilo.current?.abort()
    pegado.current = true
    const hilo = hiloRef.current
    if (hilo && mensajesRef.current.length > 0) guardarTranscripto(hilo, mensajesRef.current)
    hiloRef.current = null
    setHiloActivo(null)
    mensajesRef.current = []
    setMensajes([])
    setCargandoHilo(false)
    setError(null)
    setBorrador("")
    olvidarHilo()
    soltarContexto()
  }

  function reintentarHilos() {
    setErrorHilos(null)
    setErrorArchivados(null)
    setVersionHilos((valor) => valor + 1)
  }

  function mensajeGestion(falla: unknown, accion: string): string {
    if (falla instanceof ErrorApi) return falla.message
    return `No se pudo ${accion} la conversación.`
  }

  function fichaDe(threadId: string): Hilo {
    return (
      hilos?.find((hilo) => hilo.thread_id === threadId) ??
      hilosArchivados?.find((hilo) => hilo.thread_id === threadId) ?? {
        thread_id: threadId,
        titulo:
          tituloLocal(threadId === hiloRef.current ? mensajesRef.current : leerTranscripto(threadId)) || "Conversación",
        actualizado_en: new Date().toISOString(),
      }
    )
  }

  function recordarArchivada(threadId: string) {
    const item = fichaDe(threadId)
    setIdsArchivados((prev) => {
      const next = new Set(prev)
      next.add(threadId)
      return next
    })
    setHilos((prev) => prev?.filter((hilo) => hilo.thread_id !== threadId) ?? prev)
    setHilosArchivados((prev) => {
      if (!prev || prev.some((hilo) => hilo.thread_id === threadId)) return prev
      return [item, ...prev]
    })
  }

  function recordarActiva(threadId: string) {
    const item = hilosArchivados?.find((hilo) => hilo.thread_id === threadId) ?? fichaDe(threadId)
    setIdsArchivados((prev) => {
      if (!prev.has(threadId)) return prev
      const next = new Set(prev)
      next.delete(threadId)
      return next
    })
    setHilosArchivados((prev) => prev?.filter((hilo) => hilo.thread_id !== threadId) ?? prev)
    setHilos((prev) => {
      if (!prev || prev.some((hilo) => hilo.thread_id === threadId)) return prev
      return [item, ...prev]
    })
  }

  function quitarDeListas(threadId: string) {
    setIdsArchivados((prev) => {
      if (!prev.has(threadId)) return prev
      const next = new Set(prev)
      next.delete(threadId)
      return next
    })
    setHilos((prev) => prev?.filter((hilo) => hilo.thread_id !== threadId) ?? prev)
    setHilosArchivados((prev) => prev?.filter((hilo) => hilo.thread_id !== threadId) ?? prev)
  }

  function olvidarConversacion(threadId: string) {
    olvidarTranscripto(threadId)
    const contexto = leerContextoChat()
    if (hiloRef.current !== threadId) {
      if (contexto?.threadId === threadId) olvidarContextoChat()
      return
    }
    cargaHilo.current?.abort()
    hiloRef.current = null
    setHiloActivo(null)
    mensajesRef.current = []
    setMensajes([])
    setCargandoHilo(false)
    setBorrador("")
    setError(null)
    olvidarHilo()
    soltarContexto()
  }

  function ocupadoEnGestion(): boolean {
    return ocupado || hayPendiente || gestionando
  }

  async function archivar(threadId: string) {
    if (ocupadoEnGestion()) return
    setGestionando(true)
    setError(null)
    try {
      await cliente.archivarHilo(threadId)
      recordarArchivada(threadId)
      setVersionHilos((valor) => valor + 1)
    } catch (falla: unknown) {
      setError(mensajeGestion(falla, "archivar"))
    } finally {
      setGestionando(false)
    }
  }

  async function restaurar(threadId: string) {
    if (ocupadoEnGestion()) return
    setGestionando(true)
    setError(null)
    try {
      await cliente.restaurarHilo(threadId)
      recordarActiva(threadId)
      setVersionHilos((valor) => valor + 1)
    } catch (falla: unknown) {
      setError(mensajeGestion(falla, "restaurar"))
    } finally {
      setGestionando(false)
    }
  }

  function pedirEliminar(threadId: string) {
    if (ocupadoEnGestion()) return
    const texto = fichaDe(threadId).titulo.trim() || "esta conversación"
    setErrorBaja(null)
    setBaja({ id: threadId, titulo: texto })
  }

  function cerrarBaja() {
    if (gestionando) return
    setBaja(null)
    setErrorBaja(null)
  }

  async function confirmarEliminar() {
    if (!baja || gestionando) return
    const threadId = baja.id
    setGestionando(true)
    setErrorBaja(null)
    try {
      await cliente.eliminarHilo(threadId)
      olvidarConversacion(threadId)
      quitarDeListas(threadId)
      setBaja(null)
      setVersionHilos((valor) => valor + 1)
    } catch (falla: unknown) {
      setErrorBaja(mensajeGestion(falla, "eliminar"))
    } finally {
      setGestionando(false)
    }
  }

  function empezarNueva() {
    setHistorialAbierto(false)
    nueva()
  }

  function elegirHilo(threadId: string) {
    setHistorialAbierto(false)
    void abrirHilo(threadId)
  }

  const abrirDesdeEnlace = useRef(abrirHilo)
  abrirDesdeEnlace.current = abrirHilo

  useEffect(() => {
    if (!hiloParam && !jobParam) return
    if (ocupado || hayPendiente) {
      if (jobParam || !hiloParam || hiloActivo !== hiloParam || mensajes.length === 0) return
      setSearchParams(
        (actuales) => {
          if (!actuales.has("hilo")) return actuales
          const siguientes = new URLSearchParams(actuales)
          siguientes.delete("hilo")
          return siguientes
        },
        { replace: true },
      )
      return
    }
    const ctrl = new AbortController()
    let cancelado = false
    void (async () => {
      let errorEnlace: string | null = null
      let cartaJob: string | null = null
      if (jobParam) {
        try {
          const estado = await cliente.verTarea(jobParam, ctrl.signal)
          if (cancelado) return
          const listo =
            estado.status === "DONE" || estado.status === "FAILED" || estado.status === "AWAITING_APPROVAL"
          if (listo) {
            acciones.current?.aplicar(estado)
            if (estado.status === "AWAITING_APPROVAL") cartaJob = estado.job_id
          }
        } catch (falla: unknown) {
          if (cancelado || esAbort(falla)) return
          errorEnlace =
            falla instanceof ErrorApi && falla.status !== 404 ? falla.message : "No se pudo retomar la consulta."
        }
      }
      if (cancelado) return
      const apertura = hiloParam ? abrirDesdeEnlace.current(hiloParam, cartaJob) : null
      if (errorEnlace) setError(errorEnlace)
      setSearchParams(
        (actuales) => {
          if (!actuales.has("hilo") && !actuales.has("job")) return actuales
          const siguientes = new URLSearchParams(actuales)
          siguientes.delete("hilo")
          siguientes.delete("job")
          return siguientes
        },
        { replace: true },
      )
      if (apertura) await apertura
    })()
    return () => {
      cancelado = true
      ctrl.abort()
    }
  }, [hiloParam, jobParam, ocupado, hayPendiente, hiloActivo, mensajes.length, setSearchParams])

  const bloqueado = ocupado || hayPendiente
  const bloqueadoLista = bloqueado || gestionando
  const archivada = hiloActivo !== null && idsArchivados.has(hiloActivo)
  const titulo = tituloDe(
    hilos === null && hilosArchivados === null ? null : [...(hilos ?? []), ...(hilosArchivados ?? [])],
    hiloActivo,
    mensajes,
  )
  const activasVisibles = hilos === null ? null : hilos.filter((hilo) => !idsArchivados.has(hilo.thread_id))
  const fuente = vista === "archivadas" ? hilosArchivados : activasVisibles
  const historial = hilosLimpios(
    vista === "activas" ? hilosConActual(fuente, hiloActivo, mensajes, idsArchivados) : fuente,
    hiloActivo,
    mensajes,
  )
  const errorLista =
    vista === "archivadas" ? (hilosArchivados === null ? errorArchivados : null) : hilos === null ? errorHilos : null
  const accionesLista = {
    hilos: historial,
    error: errorLista,
    activoId: hiloActivo,
    bloqueado: bloqueadoLista,
    modo: vista,
    onModo: setVista,
    onNueva: empezarNueva,
    onAbrir: elegirHilo,
    onArchivar: (threadId: string) => void archivar(threadId),
    onRestaurar: (threadId: string) => void restaurar(threadId),
    onEliminar: pedirEliminar,
    onReintentar: reintentarHilos,
  }

  return (
    <Drawer.Root placement="start" open={historialAbierto} onOpenChange={(detalle) => setHistorialAbierto(detalle.open)}>
      <Flex flex="1" minH={0} minW={0} bg="transparent">
        <Box
          display={{ base: "none", lg: "flex" }}
          flexDirection="column"
          w="280px"
          flexShrink={0}
          minH={0}
          bg="bg.subtle"
          borderRightWidth="1px"
          borderColor="borde"
        >
          <ListaConversaciones {...accionesLista} />
        </Box>
        <Flex direction="column" flex="1" minW={0} minH={0}>
          <EncabezadoChat
            titulo={titulo}
            archivada={archivada}
            puedeGestionar={hiloActivo !== null}
            bloqueado={bloqueadoLista}
            onAbrirHistorial={() => setHistorialAbierto(true)}
            onArchivar={() => {
              if (hiloActivo) void archivar(hiloActivo)
            }}
            onRestaurar={() => {
              if (hiloActivo) void restaurar(hiloActivo)
            }}
            onEliminar={() => {
              if (hiloActivo) pedirEliminar(hiloActivo)
            }}
          />
          {avisoNuevo ? (
            <Box px={{ base: 4, md: 6 }} pt={3}>
              <Alert.Root status="warning">
                <Alert.Indicator />
                <Alert.Description>{avisoNuevo}</Alert.Description>
              </Alert.Root>
            </Box>
          ) : null}
          <Box ref={lista} aria-live="polite" flex="1" minH={0} overflowY="auto" px={{ base: 4, md: 6 }} py={4} onScroll={alDesplazar}>
            {cargandoHilo && mensajes.length === 0 ? (
              <EsqueletoHilo />
            ) : mensajes.length === 0 && !ocupado ? (
              <Flex align="center" justify="center" minH="100%">
                <EstadoVacio bloqueado={bloqueado} onElegir={(texto) => void enviar(texto)} />
              </Flex>
            ) : (
              <Stack gap={3}>
                {mensajes.map((mensaje) => (
                  <Box key={mensaje.id} css={mensajesNuevos.has(mensaje.id) ? entrada : undefined}>
                    <MensajeChat
                      mensaje={mensaje}
                      ocupado={ocupado}
                      onDecidir={(jobId, aprobado) => void decidir(jobId, aprobado)}
                    />
                  </Box>
                ))}
                {ocupado ? (
                  <PuntosEspera texto={fase === "decision" ? "Aplicando la decisión…" : "Consultando…"} />
                ) : null}
              </Stack>
            )}
          </Box>
          <Box flexShrink={0} px={{ base: 4, md: 6 }} pt={3} pb={4} borderTopWidth="1px" borderColor="borde">
            {error ? (
              <Alert.Root status="error" mb={3}>
                <Alert.Indicator />
                <Alert.Description>{error}</Alert.Description>
              </Alert.Root>
            ) : null}
            <Compositor
              valor={borrador}
              ocupado={ocupado}
              bloqueado={hayPendiente}
              adjunto={
                contextoId
                  ? { id: contextoId, documento: ficha, cargando: cargandoFicha, falla: fallaFicha }
                  : null
              }
              onQuitarAdjunto={soltarContexto}
              onCambio={setBorrador}
              onEnviar={() => void enviar(borrador)}
            />
          </Box>
        </Flex>
      </Flex>
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content bg="bg.subtle" color="fg" w="300px" maxW="85vw" h="100dvh">
            <Drawer.Title srOnly>Conversaciones</Drawer.Title>
            <Drawer.Body p={0} flex="1" minH={0} display="flex" flexDirection="column" overflow="hidden">
              <ListaConversaciones {...accionesLista} conCierre />
            </Drawer.Body>
            <Drawer.CloseTrigger asChild>
              <CloseButton aria-label="Cerrar" color="fg" />
            </Drawer.CloseTrigger>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
      <DialogoEliminarConversacion
        titulo={baja?.titulo ?? "esta conversación"}
        abierto={baja !== null}
        ocupado={gestionando}
        error={errorBaja}
        onCerrar={cerrarBaja}
        onConfirmar={() => void confirmarEliminar()}
      />
    </Drawer.Root>
  )
}
