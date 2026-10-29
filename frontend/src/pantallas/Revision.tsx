import {
  Alert,
  Box,
  Button,
  Card,
  Field,
  Flex,
  Grid,
  Heading,
  Image,
  Input,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import {
  CATEGORIAS,
  ETIQUETA_CATEGORIA,
  esBorrador,
  type Categoria,
  type DocumentoDetalle,
  type Hilo,
} from "../api/tipos"
import { toaster } from "../avisos"
import { Cargando } from "../componentes/Cargando"
import {
  ChipArchivo,
  FilaDato,
  IconoArchivo,
  IconoBusqueda,
  IconoCategoria,
  IconoComprobante,
  IconoFecha,
  IconoMoneda,
  IconoPeriodo,
  IconoPersona,
  IconoProveedor,
  ListaChats,
  Pastilla,
  type TonoPastilla,
} from "../componentes/revision"
import { armarFactura, desdeCampos, type BorradorFactura, type ErroresFactura } from "../formulario"
import { formatFecha, formatMonto, formatPeriodo } from "../formato"
import { useSesion } from "../sesion"
import { leerVista } from "../vistas"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"

const botonFantasma = {
  color: "fg",
  _hover: { bg: "bg.hover", color: "fg" },
} as const

const botonContorno = {
  color: "fg",
  borderColor: "borde",
  bg: "bg.panel",
  _hover: { bg: "bg.hover", color: "fg" },
} as const

const botonSolido = {
  bg: "fg",
  color: "fg.sobreSolido",
  _hover: { bg: "solido.hover", color: "fg.sobreSolido" },
} as const

const botonPeligro = {
  color: "estadoTexto.falla",
  borderColor: "estadoTexto.falla",
  _hover: { bg: "estado.fallaFondo", color: "estado.falla" },
} as const


const alertaFalla = {
  borderRadius: "16px",
  bg: "estado.fallaFondo",
  color: "marca.carbon",
}

const CLAVES: Array<keyof BorradorFactura> = [
  "proveedor",
  "categoria",
  "periodo",
  "monto",
  "moneda",
  "numero_comprobante",
]

const ETIQUETA_CAMPO: Record<string, string> = {
  proveedor: "Proveedor",
  categoria: "Categoría",
  periodo: "Período",
  monto: "Monto",
  moneda: "Moneda",
  numero_comprobante: "Número de comprobante",
}

function erroresDeApi(campos: Readonly<Record<string, string>>): ErroresFactura {
  const errores: ErroresFactura = {}
  for (const clave of CLAVES) {
    const mensaje = campos[clave]
    if (mensaje) errores[clave] = mensaje
  }
  return errores
}

function etiquetaCampo(campo: string): string {
  return ETIQUETA_CAMPO[campo] ?? campo
}

function esCategoria(valor: string): valor is Categoria {
  return valor === "servicios" || valor === "expensas" || valor === "alquiler"
}

function textoCambio(campo: string, valor: string | null): string {
  if (valor == null || valor.trim() === "") return "vacío"
  if (campo === "categoria" && esCategoria(valor)) return ETIQUETA_CATEGORIA[valor]
  return valor
}

function etiquetaEstado(documento: DocumentoDetalle): { texto: string; tono: TonoPastilla } {
  if (!esBorrador(documento) && documento.anulado) return { texto: "Anulado", tono: "falla" }
  if (esBorrador(documento)) return { texto: "Borrador", tono: "aviso" }
  return { texto: "Confirmado", tono: "ok" }
}

function etiquetaBusqueda(documento: DocumentoDetalle): string {
  if (esBorrador(documento)) return "Al confirmar"
  if (documento.indexado === "ok") return "Se puede buscar"
  if (documento.indexado === "error") return "Texto no indexado"
  return "Sin texto buscable"
}

function datosListos(form: BorradorFactura): number {
  const presentes = [
    form.proveedor.trim() !== "",
    form.categoria !== "",
    form.periodo.trim() !== "",
    form.monto.trim() !== "",
    true,
    form.numero_comprobante.trim() !== "",
  ]
  return presentes.filter(Boolean).length
}

function idCorto(id: string): string {
  return id.slice(-8)
}

function Nota({ children, fondo, color = "marca.carbon" }: { children: string; fondo: string; color?: string }) {
  return (
    <Box bg={fondo} color={color} borderRadius="16px" px={4} py={3} fontSize="sm" lineHeight="1.45">
      {children}
    </Box>
  )
}

function mimeBase(mime: string): string {
  return mime.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

export function Revision() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { email } = useSesion()
  const [documento, setDocumento] = useState<DocumentoDetalle | null>(null)
  const [form, setForm] = useState<BorradorFactura | null>(null)
  const [errores, setErrores] = useState<ErroresFactura>({})
  const [falla, setFalla] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [vistaServidor, setVistaServidor] = useState<{ id: string; url: string; mime: string } | null>(null)
  const [consultaArchivo, setConsultaArchivo] = useState<{ id: string; listo: boolean }>({ id: "", listo: false })
  const [fallaArchivo, setFallaArchivo] = useState<{ id: string; texto: string } | null>(null)
  const [chats, setChats] = useState<Hilo[]>([])
  const [cargandoChats, setCargandoChats] = useState(false)
  const [fallaChats, setFallaChats] = useState(false)
  const vistaLocal = id ? leerVista(id) : undefined

  useEffect(() => {
    if (!id) {
      setFalla("Falta el comprobante.")
      setCargando(false)
      return
    }
    const ctrl = new AbortController()
    setCargando(true)
    setCorrigiendo(false)
    cliente
      .verDocumento(id, ctrl.signal)
      .then((dato) => {
        setDocumento(dato)
        setForm(desdeCampos(dato.campos))
        setCorrigiendo(false)
        setFalla(null)
      })
      .catch((error: unknown) => {
        if (esAbort(error)) return
        setDocumento(null)
        setFalla(error instanceof ErrorApi ? error.message : "No se pudo abrir el comprobante.")
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [id])

  useEffect(() => {
    if (!id) return
    const ctrl = new AbortController()
    let vivo = true
    let url: string | null = null
    cliente
      .archivo(id, ctrl.signal)
      .then((blob) => {
        if (!vivo) return
        url = URL.createObjectURL(blob)
        setVistaServidor({ id, url, mime: mimeBase(blob.type) })
      })
      .catch((error: unknown) => {
        if (!vivo || esAbort(error)) return
        if (error instanceof ErrorApi && error.status === 404) return
        setFallaArchivo({
          id,
          texto: error instanceof ErrorApi ? error.message : "No se pudo abrir el archivo.",
        })
      })
      .finally(() => {
        if (vivo) setConsultaArchivo({ id, listo: true })
      })
    return () => {
      vivo = false
      ctrl.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])

  const fichaLista = !cargando && documento?.id === id

  useEffect(() => {
    if (!id || !fichaLista) return
    const ctrl = new AbortController()
    setCargandoChats(true)
    setFallaChats(false)
    setChats([])
    cliente
      .hilosDelDocumento(id, ctrl.signal)
      .then((lista) => {
        setChats(lista.items)
        setFallaChats(false)
      })
      .catch((error: unknown) => {
        if (esAbort(error)) return
        setFallaChats(true)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargandoChats(false)
      })
    return () => ctrl.abort()
  }, [id, fichaLista])

  function actualizar<K extends keyof BorradorFactura>(clave: K, valor: BorradorFactura[K]) {
    setForm((actual) => (actual ? { ...actual, [clave]: valor } : actual))
  }

  async function confirmar() {
    if (!form || !documento || !esBorrador(documento) || guardando) return
    const armado = armarFactura(form)
    if (!armado.ok) {
      setErrores(armado.errores)
      setFalla("Revisá los campos antes de confirmar.")
      return
    }
    setGuardando(true)
    setErrores({})
    setFalla(null)
    try {
      const confirmado = await cliente.confirmar(documento.id, armado.factura)
      if (confirmado.indexado === "error") {
        toaster.create({
          title: "El monto ya quedó guardado. El texto de la factura todavía no se puede buscar.",
          type: "warning",
        })
      } else {
        toaster.create({ title: "Comprobante confirmado", type: "success" })
      }
      navigate("/")
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrores(erroresDeApi(error.campos))
        setFalla(error.message)
      } else {
        setFalla("No se pudo confirmar el comprobante.")
      }
    } finally {
      setGuardando(false)
    }
  }

  async function descartar() {
    if (!documento || !esBorrador(documento) || guardando) return
    if (!window.confirm("¿Descartás este borrador? No se puede deshacer.")) return
    setGuardando(true)
    setFalla(null)
    try {
      await cliente.descartar(documento.id)
      toaster.create({ title: "Borrador descartado", type: "success" })
      navigate("/")
    } catch (error) {
      setFalla(error instanceof ErrorApi ? error.message : "No se pudo descartar el borrador.")
    } finally {
      setGuardando(false)
    }
  }

  async function corregir() {
    if (!form || !documento || esBorrador(documento) || documento.anulado || guardando) return
    const armado = armarFactura(form)
    if (!armado.ok) {
      setErrores(armado.errores)
      setFalla("Revisá los campos antes de guardar.")
      return
    }
    setGuardando(true)
    setErrores({})
    setFalla(null)
    try {
      const actualizado = await cliente.corregir(documento.id, armado.factura)
      const conFecha =
        !actualizado.confirmado_en && !esBorrador(documento) && documento.confirmado_en
          ? { ...actualizado, confirmado_en: documento.confirmado_en }
          : actualizado
      setDocumento(conFecha)
      setForm(desdeCampos(actualizado.campos))
      setCorrigiendo(false)
      toaster.create({ title: "Comprobante corregido", type: "success" })
    } catch (error) {
      if (error instanceof ErrorApi) {
        setErrores(erroresDeApi(error.campos))
        setFalla(error.message)
      } else {
        setFalla("No se pudo corregir el comprobante.")
      }
    } finally {
      setGuardando(false)
    }
  }

  function cancelarCorreccion() {
    if (!documento) return
    setForm(desdeCampos(documento.campos))
    setErrores({})
    setFalla(null)
    setCorrigiendo(false)
  }

  async function anular() {
    if (!documento || esBorrador(documento) || documento.anulado || guardando) return
    if (!window.confirm("¿Anulás este comprobante? Sale del resumen y de las consultas.")) return
    setGuardando(true)
    setFalla(null)
    try {
      await cliente.anular(documento.id)
      toaster.create({ title: "Comprobante anulado", type: "success" })
      navigate("/")
    } catch (error) {
      setFalla(error instanceof ErrorApi ? error.message : "No se pudo anular el comprobante.")
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <Cargando texto="Abriendo el comprobante" />

  if (!documento || !form) {
    return (
      <Stack gap={4}>
        <Alert.Root status="error" css={alertaFalla}>
          <Alert.Indicator color="estado.falla" />
          <Alert.Description color="marca.carbon">{falla ?? "No encontramos ese comprobante."}</Alert.Description>
        </Alert.Root>
        <Button
          asChild
          alignSelf="flex-start"
          variant="ghost"
          borderRadius="full"
          css={botonFantasma}
        >
          <Link to="/">Volver al tablero</Link>
        </Button>
      </Stack>
    )
  }

  const anulado = !esBorrador(documento) && documento.anulado
  const editando = esBorrador(documento) || corrigiendo
  const vistaRemota = vistaServidor?.id === id ? vistaServidor : null
  const vista = vistaRemota
    ? { url: vistaRemota.url, mime: vistaRemota.mime, nombre: vistaLocal?.nombre }
    : vistaLocal
  const archivoListo = consultaArchivo.id === id && consultaArchivo.listo
  const textoFallaArchivo = fallaArchivo?.id === id ? fallaArchivo.texto : null
  const mime = mimeBase(vista?.mime ?? "")
  const nombre = vista?.nombre ?? ""
  const esImagen = Boolean(vista) && (mime.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(nombre))
  const esPdf = Boolean(vista) && (mime === "application/pdf" || /\.pdf$/i.test(nombre))
  const cambios = esBorrador(documento) ? [] : documento.cambios
  const estado = etiquetaEstado(documento)
  const proveedor = form.proveedor.trim()
  const titulo = proveedor || "Revisar comprobante"
  const categoriaTexto = form.categoria ? ETIQUETA_CATEGORIA[form.categoria] : "Sin categoría"
  const moneda = (form.moneda.trim() || "ARS").toUpperCase()
  const marcaTiempo = esBorrador(documento) ? documento.creado_en : documento.confirmado_en
  const etiquetaFecha = esBorrador(documento) ? "Cargado" : "Confirmado"
  const tipoArchivo = esPdf ? "pdf" : esImagen ? "imagen" : "otro"
  const textoArchivo = textoFallaArchivo
    ? "No se pudo abrir"
    : !archivoListo && !vista
      ? "Abriendo archivo"
      : !vista
        ? "Sin archivo"
        : !esImagen && !esPdf
          ? nombre || "No se puede mostrar"
          : nombre || (esPdf ? "PDF" : "Imagen")

  function abrirConversacion(threadId: string) {
    navigate(`/chat?hilo=${encodeURIComponent(threadId)}`)
  }

  function abrirChatNuevo() {
    if (!documento) return
    navigate(`/chat?comprobante=${encodeURIComponent(documento.id)}`, {
      state: { nuevoComprobante: documento.id },
    })
  }

  return (
    <Stack gap={{ base: 5, md: 6 }}>
      <Stack gap={2}>
        <Button asChild variant="ghost" alignSelf="flex-start" borderRadius="full" css={botonFantasma}>
          <Link to="/">Volver al tablero</Link>
        </Button>
        <Heading
          as="h1"
          color="fg"
          fontFamily="'Fraunces', Georgia, serif"
          fontSize={{ base: "2.15rem", md: "2.85rem" }}
          fontWeight="600"
          letterSpacing="-0.03em"
          lineHeight="1.05"
        >
          {titulo}
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {proveedor ? "Revisar comprobante" : "Comprobante"}
          <Text as="span" color="fg.muted">
            {" "}
            · {idCorto(documento.id)}
          </Text>
        </Text>
      </Stack>

      {falla ? (
        <Alert.Root status="error" css={alertaFalla}>
          <Alert.Indicator color="estado.falla" />
          <Alert.Description color="marca.carbon">{falla}</Alert.Description>
        </Alert.Root>
      ) : null}

      <Grid
        templateColumns={{ base: "1fr", lg: "minmax(0, 1.45fr) minmax(18rem, 0.9fr)" }}
        gap={{ base: 4, md: 6 }}
        alignItems="start"
      >
        <Stack gap={4}>
          <Card.Root bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
            <Card.Body>
              <Stack gap={4}>
                <Text
                  color="fg"
                  fontFamily="'Fraunces', Georgia, serif"
                  fontSize={{ base: "2.4rem", md: "3.15rem" }}
                  fontWeight="600"
                  letterSpacing="-0.03em"
                  lineHeight="1"
                  fontVariantNumeric="tabular-nums"
                >
                  {formatMonto(form.monto, moneda)}
                </Text>
                <Text color="fg.muted" fontSize="sm">
                  {formatPeriodo(form.periodo)}
                  {form.categoria ? ` · ${categoriaTexto}` : ""}
                </Text>
                <Flex gap={2} wrap="wrap">
                  <Pastilla tono={form.categoria ? "sol" : "gris"}>{categoriaTexto}</Pastilla>
                  <Pastilla tono={estado.tono}>{estado.texto}</Pastilla>
                  <Pastilla tono="gris">{moneda}</Pastilla>
                </Flex>
                <Text color="fg.muted" fontSize="xs">
                  {datosListos(form)} de 6 datos
                </Text>
              </Stack>
            </Card.Body>
          </Card.Root>

          {anulado ? (
            <Nota fondo="bg.subtle" color="fg">
              Este comprobante está anulado.
            </Nota>
          ) : null}
          {!esBorrador(documento) && documento.indexado === "error" ? (
            <Nota fondo="estado.avisoFondo">
              El monto ya quedó guardado. El texto de la factura todavía no se puede buscar.
            </Nota>
          ) : null}
          {esBorrador(documento)
            ? documento.advertencias.map((aviso) => (
                <Nota key={aviso} fondo="estado.avisoFondo">
                  {aviso}
                </Nota>
              ))
            : null}

          <Card.Root bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
            <Card.Header>
              <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
                Vista previa
              </Card.Title>
            </Card.Header>
            <Card.Body>
              <Stack gap={3}>
                {vista && esImagen ? (
                  <Image
                    src={vista.url}
                    alt={nombre || "Comprobante"}
                    maxH="70vh"
                    minH={{ base: "16rem", md: "24rem" }}
                    objectFit="contain"
                    w="100%"
                    display="block"
                    borderRadius="16px"
                    bg="bg.subtle"
                    p={3}
                  />
                ) : null}
                {vista && esPdf ? (
                  <Box h={{ base: "24rem", md: "70vh" }} minH="24rem" borderRadius="16px" overflow="hidden" bg="bg.subtle">
                    <iframe
                      title={nombre || "Comprobante"}
                      src={vista.url}
                      style={{ width: "100%", height: "100%", border: 0, background: "var(--chakra-colors-bg-subtle, #f3efe4)" }}
                    />
                  </Box>
                ) : null}
                {vista && (esImagen || esPdf) ? <ChipArchivo nombre={nombre} tipo={tipoArchivo} /> : null}
                {vista && !esImagen && !esPdf ? (
                  <Text color="fg.muted">Hay un archivo guardado, pero no se puede mostrar acá.</Text>
                ) : null}
                {!vista && textoFallaArchivo ? <Text color="fg.muted">{textoFallaArchivo}</Text> : null}
                {!vista && archivoListo && !textoFallaArchivo ? (
                  <Text color="fg.muted">
                    El archivo se ve en esta pestaña justo después de cargarlo. El texto es el que devolvió la API.
                  </Text>
                ) : null}
                {esBorrador(documento) ? (
                  <Box
                    maxH="16rem"
                    overflowY="auto"
                    whiteSpace="pre-wrap"
                    fontSize="sm"
                    color="fg"
                    bg="bg.subtle"
                    borderRadius="16px"
                    p={4}
                  >
                    {documento.texto || "Sin texto extraído."}
                  </Box>
                ) : null}
              </Stack>
            </Card.Body>
          </Card.Root>
        </Stack>

        <Stack gap={4}>
          <Card.Root bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
            <Card.Header>
              <Flex justify="space-between" align="center" gap={3} wrap="wrap">
                <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
                  Información general
                </Card.Title>
                {!esBorrador(documento) && !anulado && !corrigiendo ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    borderRadius="full"
                    disabled={guardando}
                    onClick={() => setCorrigiendo(true)}
                    css={botonContorno}
                  >
                    Editar
                  </Button>
                ) : null}
              </Flex>
            </Card.Header>
            <Card.Body>
              <Stack gap={3}>
                <FilaDato icono={<IconoProveedor />} etiqueta="Proveedor" valor={proveedor || "Sin proveedor"} />
                <FilaDato icono={<IconoCategoria />} etiqueta="Categoría" valor={categoriaTexto} />
                <FilaDato icono={<IconoPeriodo />} etiqueta="Período" valor={formatPeriodo(form.periodo)} />
                <FilaDato icono={<IconoMoneda />} etiqueta="Moneda" valor={moneda} />
                <FilaDato
                  icono={<IconoComprobante />}
                  etiqueta="Comprobante"
                  valor={form.numero_comprobante.trim() || "Sin número"}
                />
                <FilaDato icono={<IconoPersona />} etiqueta="Cargado por" valor={email?.trim() || "Tu cuenta"} />
                <FilaDato icono={<IconoFecha />} etiqueta={etiquetaFecha} valor={formatFecha(marcaTiempo)} />
                <FilaDato icono={<IconoBusqueda />} etiqueta="Búsqueda" valor={etiquetaBusqueda(documento)} />
                <FilaDato icono={<IconoArchivo />} etiqueta="Archivo" valor={textoArchivo} />
              </Stack>
              {!esBorrador(documento) && !anulado && !corrigiendo ? (
                <Button
                  type="button"
                  variant="outline"
                  borderRadius="full"
                  mt={4}
                  disabled={guardando}
                  onClick={() => void anular()}
                  css={botonPeligro}
                >
                  Anular
                </Button>
              ) : null}
            </Card.Body>
          </Card.Root>

          <Card.Root bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
            <Card.Header>
              <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
                Chats
              </Card.Title>
            </Card.Header>
            <Card.Body>
              <ListaChats
                chats={chats.map((chat) => ({
                  threadId: chat.thread_id,
                  titulo: chat.titulo,
                  cuando: formatFecha(chat.actualizado_en),
                }))}
                cargando={cargandoChats}
                falla={fallaChats}
                onAbrir={abrirConversacion}
                onNuevo={abrirChatNuevo}
              />
            </Card.Body>
          </Card.Root>

          {cambios.length > 0 ? (
            <Card.Root bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
              <Card.Header>
                <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
                  Cambios
                </Card.Title>
              </Card.Header>
              <Card.Body>
                <Stack gap={2}>
                  {cambios.map((cambio, indice) => (
                    <Text key={`${cambio.campo}-${indice}`} fontSize="sm" color="fg">
                      <Text as="span" color="fg.muted">
                        {etiquetaCampo(cambio.campo)}
                      </Text>
                      {": "}
                      {textoCambio(cambio.campo, cambio.antes)}
                      {" → "}
                      <Text as="span" fontWeight="medium">
                        {textoCambio(cambio.campo, cambio.despues)}
                      </Text>
                    </Text>
                  ))}
                </Stack>
              </Card.Body>
            </Card.Root>
          ) : null}

          {editando ? (
            <Card.Root bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
              {editando ? (
                <Card.Header>
                  <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
                    Datos
                  </Card.Title>
                </Card.Header>
              ) : null}
              <Card.Body>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!documento || guardando || !editando) return
                    if (esBorrador(documento)) {
                      void confirmar()
                      return
                    }
                    void corregir()
                  }}
                >
                  <Stack gap={4}>
                    {editando ? (
                      <>
                        <Field.Root invalid={Boolean(errores.proveedor)}>
                          <Field.Label>Proveedor</Field.Label>
                          <Input value={form.proveedor} onChange={(event) => actualizar("proveedor", event.target.value)} />
                          {errores.proveedor ? <Field.ErrorText color="estadoTexto.falla">{errores.proveedor}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.categoria)}>
                          <Field.Label>Categoría</Field.Label>
                          <NativeSelect.Root invalid={Boolean(errores.categoria)}>
                            <NativeSelect.Field
                              value={form.categoria}
                              onChange={(event) => actualizar("categoria", event.target.value as BorradorFactura["categoria"])}
                            >
                              <option value="">Elegir</option>
                              {CATEGORIAS.map((categoria) => (
                                <option key={categoria} value={categoria}>
                                  {ETIQUETA_CATEGORIA[categoria]}
                                </option>
                              ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                          </NativeSelect.Root>
                          {errores.categoria ? <Field.ErrorText color="estadoTexto.falla">{errores.categoria}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.periodo)}>
                          <Field.Label>Período</Field.Label>
                          <Input
                            type="month"
                            value={form.periodo}
                            onChange={(event) => actualizar("periodo", event.target.value)}
                          />
                          {errores.periodo ? <Field.ErrorText color="estadoTexto.falla">{errores.periodo}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.monto)}>
                          <Field.Label>Monto</Field.Label>
                          <Input
                            inputMode="decimal"
                            value={form.monto}
                            onChange={(event) => actualizar("monto", event.target.value)}
                          />
                          <Field.HelperText color="fg.muted">Dos decimales, por ejemplo 18500.50</Field.HelperText>
                          {errores.monto ? <Field.ErrorText color="estadoTexto.falla">{errores.monto}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.moneda)}>
                          <Field.Label>Moneda</Field.Label>
                          <Input value={form.moneda} onChange={(event) => actualizar("moneda", event.target.value)} />
                          <Field.HelperText color="fg.muted">Si lo dejás vacío, se usa ARS.</Field.HelperText>
                          {errores.moneda ? <Field.ErrorText color="estadoTexto.falla">{errores.moneda}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.numero_comprobante)}>
                          <Field.Label>Número de comprobante</Field.Label>
                          <Input
                            value={form.numero_comprobante}
                            onChange={(event) => actualizar("numero_comprobante", event.target.value)}
                          />
                          <Field.HelperText color="fg.muted">Opcional.</Field.HelperText>
                          {errores.numero_comprobante ? (
                            <Field.ErrorText color="estadoTexto.falla">{errores.numero_comprobante}</Field.ErrorText>
                          ) : null}
                        </Field.Root>
                      </>
                    ) : null}
                    {esBorrador(documento) ? (
                      <Flex gap={3} wrap="wrap">
                        <Button type="submit" loading={guardando} borderRadius="full" css={botonSolido}>
                          Confirmar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          borderRadius="full"
                          disabled={guardando}
                          onClick={() => void descartar()}
                          css={botonPeligro}
                        >
                          Descartar
                        </Button>
                      </Flex>
                    ) : null}
                    {!esBorrador(documento) && !anulado ? (
                      <Flex gap={3} wrap="wrap">
                        {corrigiendo ? (
                          <Button type="submit" loading={guardando} borderRadius="full" css={botonSolido}>
                            Guardar
                          </Button>
                        ) : null}
                        {corrigiendo ? (
                          <Button
                            type="button"
                            variant="ghost"
                            borderRadius="full"
                            disabled={guardando}
                            onClick={cancelarCorreccion}
                            css={botonFantasma}
                          >
                            Cancelar
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          borderRadius="full"
                          disabled={guardando}
                          onClick={() => void anular()}
                          css={botonPeligro}
                        >
                          Anular
                        </Button>
                      </Flex>
                    ) : null}
                  </Stack>
                </form>
              </Card.Body>
            </Card.Root>
          ) : null}
        </Stack>
      </Grid>
    </Stack>
  )
}
