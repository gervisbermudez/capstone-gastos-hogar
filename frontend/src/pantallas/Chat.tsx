import { Alert, Box, CloseButton, Drawer, Flex, HStack, Portal, Spinner, Stack, Text } from "@chakra-ui/react"
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
  type MensajeGuardado,
} from "../almacen"
import { citaComprobante, fotoDesdeCita, textoVisible, tituloVisible } from "../chat/contexto"
import { Compositor, EncabezadoChat, EstadoVacio, MensajeChat, fotoDeAdjunto } from "../componentes/chat/Conversacion"
import { ListaConversaciones } from "../componentes/chat/ListaConversaciones"

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

const REINTENTOS_SOCKET = 3

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
  // Un socket recibe cada cambio. Si no abre, se vuelve al GET cada 1 s.
  let puedePararEnAprobacion = !saltarAprobacionActual
  let usarSocket = true
  let cortes = 0
  for (;;) {
    if (!usarSocket) {
      const estado = await cliente.verTarea(jobId, signal)
      const paso = anotarEstado(estado, puedePararEnAprobacion, alHilo)
      puedePararEnAprobacion = paso.puedePararEnAprobacion
      if (paso.listo) return estado
      await esperar(1000, signal)
      continue
    }

    if (signal.aborted) throw new DOMException("aborted", "AbortError")
    let recibio = false
    let listo: TareaEstado | null = null
    try {
      for await (const estado of cliente.eventosTarea(jobId, signal)) {
        if (listo) continue
        recibio = true
        const paso = anotarEstado(estado, puedePararEnAprobacion, alHilo)
        puedePararEnAprobacion = paso.puedePararEnAprobacion
        if (paso.listo) listo = estado
      }
    } catch (error) {
      const conserva = listo !== null && !signal.aborted && !esAbort(error)
      if (!conserva) {
        if (esAbort(error) || signal.aborted) {
          throw esAbort(error) ? error : new DOMException("aborted", "AbortError")
        }
        if (error instanceof ErrorApi && error.status !== 0) throw error
      }
    }
    if (listo) return listo
    if (!recibio) {
      cortes += 1
      if (cortes >= REINTENTOS_SOCKET) usarSocket = false
    } else {
      cortes = 0
    }
    await esperar(1000, signal)
  }
}

function personaYaRegistrada(mensajes: readonly Mensaje[], texto: string): boolean {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const mensaje = mensajes[i]
    if (mensaje?.tipo === "persona") return textoVisible(mensaje.texto) === texto
  }
  return false
}

function tituloDe(hilos: Hilo[] | null, activo: string | null, mensajes: readonly Mensaje[]): string {
  if (!activo) return "Nueva conversación"
  const guardado = hilos?.find((hilo) => hilo.thread_id === activo)?.titulo.trim()
  if (guardado) return tituloVisible(guardado)
  const persona = mensajes.find((mensaje) => mensaje.tipo === "persona")
  if (persona?.tipo === "persona" && persona.texto.trim()) return tituloVisible(persona.texto)
  return "Conversación"
}

function hilosConActual(hilos: Hilo[] | null, activo: string | null, mensajes: readonly Mensaje[]): Hilo[] | null {
  if (!hilos || !activo || hilos.some((hilo) => hilo.thread_id === activo)) return hilos
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

function hilosLimpios(hilos: Hilo[] | null): Hilo[] | null {
  if (!hilos) return null
  return hilos.map((hilo) => {
    const titulo = tituloVisible(hilo.titulo)
    if (titulo === hilo.titulo) return hilo
    return { ...hilo, titulo }
  })
}

export function Chat() {
  const [params, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const comprobanteParam = params.get("comprobante")
  const iniciarNuevo = idNuevo(location.state) === comprobanteParam && comprobanteParam !== null
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
  const [errorHilos, setErrorHilos] = useState<string | null>(null)
  const [versionHilos, setVersionHilos] = useState(0)
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
      if (estado.status === "DONE") setVersionHilos((valor) => valor + 1)
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
    cliente
      .listarHilos(ctrl.signal)
      .then((lista) => {
        if (cancelado) return
        setHilos(lista.items)
        setErrorHilos(null)
      })
      .catch((falla: unknown) => {
        if (cancelado || esAbort(falla)) return
        setErrorHilos(falla instanceof ErrorApi ? falla.message : "No se pudieron cargar las conversaciones.")
      })
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
    lista.current?.scrollTo({ top: lista.current.scrollHeight })
  }, [mensajes, ocupado, cargandoHilo])

  function alDesplazar() {
    const nodo = lista.current
    if (!nodo) return
    pegado.current = nodo.scrollHeight - nodo.scrollTop - nodo.clientHeight < 80
  }

  async function enviar(texto: string) {
    const query = texto.trim()
    if (!query || ocupado || hayPendiente) return
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

  async function abrirHilo(threadId: string) {
    if (ocupado || hayPendiente) return
    if (threadId === hiloRef.current && mensajesRef.current.length > 0) return
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
    if (local.length > 0) {
      if (dejarContexto) soltarContexto()
      else recordarContexto(threadId)
      mensajesRef.current = local
      setMensajes(local)
      setCargandoHilo(false)
      return
    }
    const ctrl = new AbortController()
    cargaHilo.current = ctrl
    mensajesRef.current = []
    setMensajes([])
    setCargandoHilo(true)
    try {
      const detalle = await cliente.verHilo(threadId, ctrl.signal)
      if (!vivo.current || hiloRef.current !== threadId) return
      if (dejarContexto) soltarContexto()
      else recordarContexto(threadId)
      const traidos = detalle.mensajes
        .slice(-TOPE_TRANSCRIPTO)
        .map((mensaje) => mensajeDesdeServidor(mensaje.rol, mensaje.texto))
      if (traidos.length > 0) guardarTranscripto(threadId, traidos)
      mensajesRef.current = traidos
      setMensajes(traidos)
    } catch (falla: unknown) {
      if (!vivo.current || esAbort(falla) || hiloRef.current !== threadId) return
      if (anterior) {
        hiloRef.current = anterior
        setHiloActivo(anterior)
        guardarHilo(anterior)
        const previos = leerTranscripto(anterior)
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
    setVersionHilos((valor) => valor + 1)
  }

  function empezarNueva() {
    setHistorialAbierto(false)
    nueva()
  }

  function elegirHilo(threadId: string) {
    setHistorialAbierto(false)
    void abrirHilo(threadId)
  }

  const bloqueado = ocupado || hayPendiente
  const titulo = tituloDe(hilos, hiloActivo, mensajes)
  const historial = hilosLimpios(hilosConActual(hilos, hiloActivo, mensajes))

  return (
    <Drawer.Root placement="start" open={historialAbierto} onOpenChange={(detalle) => setHistorialAbierto(detalle.open)}>
      <Flex flex="1" minH={0} minW={0} bg="transparent">
        <Box
          display={{ base: "none", lg: "flex" }}
          flexDirection="column"
          w="280px"
          flexShrink={0}
          minH={0}
          bg="marca.alabastro"
          borderRightWidth="1px"
          borderColor="rgba(28, 28, 26, 0.08)"
        >
          <ListaConversaciones
            hilos={historial}
            error={hilos === null ? errorHilos : null}
            activoId={hiloActivo}
            bloqueado={bloqueado}
            onNueva={empezarNueva}
            onAbrir={elegirHilo}
            onReintentar={reintentarHilos}
          />
        </Box>
        <Flex direction="column" flex="1" minW={0} minH={0}>
          <EncabezadoChat titulo={titulo} onAbrirHistorial={() => setHistorialAbierto(true)} />
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
              <Flex align="center" justify="center" minH="100%">
                <HStack>
                  <Spinner size="sm" color="marca.carbon" />
                  <Text color="marca.carbon">Abriendo la conversación…</Text>
                </HStack>
              </Flex>
            ) : mensajes.length === 0 && !ocupado ? (
              <Flex align="center" justify="center" minH="100%">
                <EstadoVacio bloqueado={bloqueado} onElegir={(texto) => void enviar(texto)} />
              </Flex>
            ) : (
              <Stack gap={3}>
                {mensajes.map((mensaje) => (
                  <MensajeChat
                    key={mensaje.id}
                    mensaje={mensaje}
                    ocupado={ocupado}
                    onDecidir={(jobId, aprobado) => void decidir(jobId, aprobado)}
                  />
                ))}
                {ocupado ? (
                  <HStack>
                    <Spinner size="sm" color="marca.carbon" />
                    <Text color="marca.carbon">{fase === "decision" ? "Aplicando la decisión…" : "Consultando…"}</Text>
                  </HStack>
                ) : null}
              </Stack>
            )}
          </Box>
          <Box flexShrink={0} px={{ base: 4, md: 6 }} pt={3} pb={4} borderTopWidth="1px" borderColor="rgba(28, 28, 26, 0.08)">
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
          <Drawer.Content bg="marca.alabastro" color="marca.carbon" w="300px" maxW="85vw" h="100dvh">
            <Drawer.Title srOnly>Conversaciones</Drawer.Title>
            <Drawer.Body p={0} flex="1" minH={0} display="flex" flexDirection="column" overflow="hidden">
              <ListaConversaciones
                hilos={historial}
                error={hilos === null ? errorHilos : null}
                activoId={hiloActivo}
                bloqueado={bloqueado}
                onNueva={empezarNueva}
                onAbrir={elegirHilo}
                onReintentar={reintentarHilos}
                conCierre
              />
            </Drawer.Body>
            <Drawer.CloseTrigger asChild>
              <CloseButton aria-label="Cerrar" color="marca.carbon" />
            </Drawer.CloseTrigger>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  )
}
