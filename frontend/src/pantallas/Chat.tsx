import { Alert, Box, Button, Card, EmptyState, Flex, Heading, HStack, Spinner, Stack, Text, Textarea } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import type { Hilo, TareaEstado } from "../api/tipos"
import {
  TOPE_TRANSCRIPTO,
  guardarConsultaPendiente,
  guardarHilo,
  guardarJobPendiente,
  guardarTranscripto,
  leerConsultaPendiente,
  leerHilo,
  leerJobAplicado,
  leerJobPendiente,
  leerTranscripto,
  olvidarConsultaPendiente,
  olvidarHilo,
  olvidarJobAplicado,
  olvidarJobPendiente,
  olvidarTranscripto,
  type MensajeGuardado,
} from "../almacen"

const EJEMPLOS = [
  "¿Cuánto pagué de expensas en marzo?",
  "Compará la luz de enero contra febrero.",
  "¿Qué dice la factura de alquiler sobre el ajuste?",
]

const ETIQUETAS_FICHA = ["Acción", "Motivo", "Pedido", "Datos"] as const

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

type Mensaje = MensajeGuardado

type LineaFicha = { etiqueta: (typeof ETIQUETAS_FICHA)[number]; valor: string }

type Trozo = { tipo: "texto"; texto: string } | { tipo: "enlace"; texto: string; href: string }

type AccionesChat = {
  observarHilo: (threadId: string) => void
  aplicar: (estado: TareaEstado) => void
  reponerPersona: () => void
}

function nuevoId(): string {
  return crypto.randomUUID()
}

function mensajeDesdeServidor(rol: "persona" | "asistente" | "nota", texto: string): Mensaje {
  if (rol === "persona") return { id: nuevoId(), tipo: "persona", texto }
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

async function seguir(
  jobId: string,
  signal: AbortSignal,
  saltarAprobacionActual: boolean,
  alHilo?: (threadId: string) => void,
): Promise<TareaEstado> {
  let puedePararEnAprobacion = !saltarAprobacionActual
  for (;;) {
    const estado = await cliente.verTarea(jobId, signal)
    guardarHilo(estado.thread_id)
    alHilo?.(estado.thread_id)
    if (estado.status === "DONE" || estado.status === "FAILED") return estado
    if (estado.status === "AWAITING_APPROVAL" && puedePararEnAprobacion) return estado
    if (estado.status !== "AWAITING_APPROVAL") puedePararEnAprobacion = true
    await esperar(1000, signal)
  }
}

function personaYaRegistrada(mensajes: readonly Mensaje[], texto: string): boolean {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const mensaje = mensajes[i]
    if (mensaje?.tipo === "persona") return mensaje.texto === texto
  }
  return false
}

function trozosConEnlaces(texto: string): Trozo[] {
  const patron = new RegExp(`\\[comprobante ([^\\s|\\]]+)(?:\\s*\\|[^\\]]*)?\\]|\\bBorrador:\\s*(${UUID})`, "g")
  const trozos: Trozo[] = []
  let cursor = 0
  for (const coincidencia of texto.matchAll(patron)) {
    const inicio = coincidencia.index ?? cursor
    if (inicio > cursor) trozos.push({ tipo: "texto", texto: texto.slice(cursor, inicio) })
    const id = coincidencia[1] || coincidencia[2]
    if (id) {
      trozos.push({ tipo: "enlace", texto: coincidencia[0], href: `/documentos/${encodeURIComponent(id)}` })
    }
    cursor = inicio + coincidencia[0].length
  }
  if (cursor < texto.length) trozos.push({ tipo: "texto", texto: texto.slice(cursor) })
  return trozos.length > 0 ? trozos : [{ tipo: "texto", texto }]
}

function TextoConEnlaces({ texto }: { texto: string }) {
  return (
    <>
      {trozosConEnlaces(texto).map((trozo, indice) =>
        trozo.tipo === "enlace" ? (
          <Link key={`${trozo.href}-${indice}`} to={trozo.href} style={{ textDecoration: "underline" }}>
            {trozo.texto}
          </Link>
        ) : (
          <span key={`texto-${indice}`}>{trozo.texto}</span>
        ),
      )}
    </>
  )
}

function leerLineasFicha(texto: string): LineaFicha[] | null {
  const halladas: LineaFicha[] = []
  for (const cruda of texto.split(/\r?\n/)) {
    const limpia = cruda.trim()
    for (const etiqueta of ETIQUETAS_FICHA) {
      const prefijo = `${etiqueta}:`
      if (!limpia.startsWith(prefijo)) continue
      halladas.push({ etiqueta, valor: limpia.slice(prefijo.length).trim() })
      break
    }
  }
  return halladas.length > 0 ? halladas : null
}

function DetalleFicha({ texto }: { texto: string }) {
  const lineas = leerLineasFicha(texto)
  if (!lineas) {
    return (
      <Alert.Description>
        <TextoConEnlaces texto={texto} />
      </Alert.Description>
    )
  }
  return (
    <Alert.Description>
      <Stack gap={1}>
        {lineas.map((linea, indice) => (
          <Text key={`${linea.etiqueta}-${indice}`} whiteSpace="pre-wrap" overflowWrap="anywhere">
            <Text as="span" fontWeight="medium">
              {linea.etiqueta}:{" "}
            </Text>
            <TextoConEnlaces texto={linea.valor} />
          </Text>
        ))}
      </Stack>
    </Alert.Description>
  )
}

function estadoInicial(): { hilo: string | null; mensajes: Mensaje[] } {
  const hilo = leerHilo()
  return { hilo, mensajes: hilo ? leerTranscripto(hilo) : [] }
}

export function Chat() {
  const [inicial] = useState(estadoInicial)
  const hiloRef = useRef(inicial.hilo)
  const [hiloActivo, setHiloActivo] = useState<string | null>(inicial.hilo)
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
  const abortar = useRef<AbortController | null>(null)
  const cargaHilo = useRef<AbortController | null>(null)
  const vivo = useRef(true)
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

  function observarHilo(threadId: string) {
    if (!threadId) return
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
    lista.current?.scrollTo({ top: lista.current.scrollHeight })
  }, [mensajes, ocupado])

  async function enviar(texto: string) {
    const query = texto.trim()
    if (!query || ocupado || hayPendiente) return
    setBorrador("")
    setError(null)
    guardarConsultaPendiente(query)
    publicar([...mensajesRef.current, { id: nuevoId(), tipo: "persona", texto: query }])
    setOcupado(true)
    setFase("consulta")
    abortar.current?.abort()
    const ctrl = new AbortController()
    abortar.current = ctrl
    let conJob = false
    try {
      const creada = await cliente.crearTarea({ query, thread_id: hiloRef.current })
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
    cargaHilo.current?.abort()
    const anterior = hiloRef.current
    if (anterior && anterior !== threadId) guardarTranscripto(anterior, mensajesRef.current)
    hiloRef.current = threadId
    setHiloActivo(threadId)
    guardarHilo(threadId)
    setError(null)
    const local = leerTranscripto(threadId)
    if (local.length > 0) {
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
    if (ocupado) return
    abortar.current?.abort()
    cargaHilo.current?.abort()
    const hilo = hiloRef.current ?? leerHilo()
    hiloRef.current = null
    setHiloActivo(null)
    mensajesRef.current = []
    setMensajes([])
    setCargandoHilo(false)
    setError(null)
    setBorrador("")
    if (hilo) {
      olvidarTranscripto(hilo)
      olvidarJobAplicado(hilo)
    }
    olvidarHilo()
  }

  return (
    <Stack gap={4}>
      <Flex justify="space-between" gap={3} align={{ base: "stretch", sm: "center" }} direction={{ base: "column", sm: "row" }}>
        <Heading size="lg">Chat</Heading>
        <Button variant="outline" onClick={nueva} disabled={ocupado}>
          Nueva conversación
        </Button>
      </Flex>
      <Text color="fg.muted">
        Los montos salen de los comprobantes confirmados. Lo que dice una factura sale del texto indexado. La pregunta se encola.
      </Text>
      {hilos === null && !errorHilos ? (
        <Text fontSize="sm" color="fg.muted">
          Cargando conversaciones…
        </Text>
      ) : null}
      {errorHilos ? (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Description>{errorHilos}</Alert.Description>
        </Alert.Root>
      ) : null}
      {hilos && hilos.length > 0 ? (
        <Stack gap={2}>
          <Text fontWeight="medium">Conversaciones</Text>
          <Flex gap={2} flexWrap="wrap">
            {hilos.map((hilo) => (
              <Button
                key={hilo.thread_id}
                size="sm"
                variant={hilo.thread_id === hiloActivo ? "solid" : "outline"}
                height="auto"
                maxW="100%"
                whiteSpace="normal"
                textAlign="left"
                py={2}
                disabled={ocupado || hayPendiente}
                aria-pressed={hilo.thread_id === hiloActivo}
                onClick={() => void abrirHilo(hilo.thread_id)}
              >
                {hilo.titulo.trim() || "Sin título"}
              </Button>
            ))}
          </Flex>
        </Stack>
      ) : null}
      <Flex gap={2} flexWrap="wrap">
        {EJEMPLOS.map((ejemplo) => (
          <Button
            key={ejemplo}
            size="sm"
            variant="outline"
            height="auto"
            whiteSpace="normal"
            textAlign="left"
            py={2}
            disabled={ocupado || hayPendiente}
            onClick={() => void enviar(ejemplo)}
          >
            {ejemplo}
          </Button>
        ))}
      </Flex>
      <Card.Root>
        <Card.Body>
          <Stack gap={3}>
            <Box ref={lista} aria-live="polite" maxH={{ base: "55vh", md: "28rem" }} overflowY="auto">
              {cargandoHilo && mensajes.length === 0 ? (
                <HStack>
                  <Spinner size="sm" />
                  <Text>Abriendo la conversación…</Text>
                </HStack>
              ) : mensajes.length === 0 && !ocupado ? (
                <EmptyState.Root size="sm">
                  <EmptyState.Content>
                    <EmptyState.Title>Todavía no hay mensajes</EmptyState.Title>
                    <EmptyState.Description>
                      Preguntá cuánto pagaste, compará dos períodos o pedí el texto de una factura.
                    </EmptyState.Description>
                  </EmptyState.Content>
                </EmptyState.Root>
              ) : (
                <Stack gap={3}>
                  {mensajes.map((mensaje) => {
                    if (mensaje.tipo === "aprobacion") {
                      return (
                        <Alert.Root key={mensaje.id} status="warning">
                          <Alert.Indicator />
                          <Alert.Content>
                            <Alert.Title>
                              {mensaje.resuelta === "si"
                                ? "Aprobaste la acción."
                                : mensaje.resuelta === "no"
                                  ? "Rechazaste la acción."
                                  : "Hace falta tu decisión"}
                            </Alert.Title>
                            <DetalleFicha texto={mensaje.texto} />
                            {mensaje.resuelta === null ? (
                              <HStack mt={3}>
                                <Button
                                  size="sm"
                                  colorPalette="green"
                                  disabled={ocupado}
                                  onClick={() => void decidir(mensaje.jobId, true)}
                                >
                                  Aprobar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  colorPalette="red"
                                  disabled={ocupado}
                                  onClick={() => void decidir(mensaje.jobId, false)}
                                >
                                  Rechazar
                                </Button>
                              </HStack>
                            ) : null}
                          </Alert.Content>
                        </Alert.Root>
                      )
                    }
                    const propio = mensaje.tipo === "persona"
                    return (
                      <Card.Root key={mensaje.id} variant={propio ? "subtle" : "outline"} colorPalette={propio ? "blue" : undefined}>
                        <Card.Body py={3}>
                          <Text fontSize="sm" color="fg.muted" mb={1}>
                            {propio ? "Vos" : mensaje.tipo === "asistente" ? "Asistente" : "Estado"}
                          </Text>
                          <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
                            {mensaje.tipo === "asistente" ? <TextoConEnlaces texto={mensaje.texto} /> : mensaje.texto}
                          </Text>
                        </Card.Body>
                      </Card.Root>
                    )
                  })}
                  {ocupado ? (
                    <HStack>
                      <Spinner size="sm" />
                      <Text>{fase === "decision" ? "Aplicando la decisión…" : "Consultando…"}</Text>
                    </HStack>
                  ) : null}
                </Stack>
              )}
            </Box>
            {error ? (
              <Alert.Root status="error">
                <Alert.Indicator />
                <Alert.Description>{error}</Alert.Description>
              </Alert.Root>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void enviar(borrador)
              }}
            >
              <Stack direction={{ base: "column", sm: "row" }} gap={3} align={{ sm: "flex-end" }}>
                <Textarea
                  value={borrador}
                  rows={3}
                  flex="1"
                  disabled={ocupado || hayPendiente}
                  placeholder="Escribí tu pregunta"
                  onChange={(event) => setBorrador(event.target.value)}
                />
                <Button type="submit" loading={ocupado} disabled={hayPendiente}>
                  Enviar
                </Button>
              </Stack>
            </form>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  )
}
