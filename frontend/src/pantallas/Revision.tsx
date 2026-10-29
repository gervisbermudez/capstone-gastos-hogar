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
  Menu,
  NativeSelect,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react"
import { Fragment, forwardRef, useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import { esBorrador, etiquetaCategoria, type CategoriaItem, type DocumentoDetalle, type Hilo } from "../api/tipos"
import { opcionActual, opcionesDelCatalogo, opcionesGenerales } from "../categorias"
import { toaster } from "../avisos"
import { EsqueletoCampo, EsqueletoRevision, EsqueletoVista } from "../componentes/esqueleto"
import {
  CampoProveedor,
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
  IconoPuntos,
  IconoVolver,
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

const botonSolido = {
  bg: "fg",
  color: "fg.sobreSolido",
  _hover: { bg: "solido.hover", color: "fg.sobreSolido" },
} as const

const itemMenu = {
  px: 3,
  py: 2,
  mx: 1,
  borderRadius: "12px",
  cursor: "pointer",
  color: "fg",
  _highlighted: { bg: "bg.subtle" },
} as const

const itemPeligro = {
  ...itemMenu,
  color: "estadoTexto.falla",
  _highlighted: { bg: "estado.fallaFondo", color: "estado.falla" },
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

function pideCorregir(state: unknown): boolean {
  if (!state || typeof state !== "object" || !("corregir" in state)) return false
  return (state as { corregir?: unknown }).corregir === true
}

function textoCambio(campo: string, valor: string | null): string {
  if (valor == null || valor.trim() === "") return "vacío"
  if (campo === "categoria") return etiquetaCategoria(valor)
  return valor
}

function MenuAcciones({
  puedeEditar,
  puedeAnular,
  guardando,
  onEditar,
  onAnular,
  onEliminar,
}: {
  puedeEditar: boolean
  puedeAnular: boolean
  guardando: boolean
  onEditar: () => void
  onAnular: () => void
  onEliminar: () => void
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <Button
          type="button"
          aria-label="Acciones"
          variant="ghost"
          borderRadius="full"
          flexShrink={0}
          boxSize="2.75rem"
          px={0}
          disabled={guardando}
          css={botonFantasma}
        >
          <IconoPuntos />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content bg="bg.panel" borderWidth="1px" borderColor="borde" borderRadius="16px" boxShadow={SOMBRA} minW="11rem" py={1}>
            {puedeEditar ? (
              <Menu.Item value="editar" onClick={onEditar} css={itemMenu}>
                Editar
              </Menu.Item>
            ) : null}
            {puedeAnular ? (
              <Menu.Item value="anular" onClick={onAnular} css={itemPeligro}>
                Anular
              </Menu.Item>
            ) : null}
            <Menu.Item value="eliminar" onClick={onEliminar} css={itemPeligro}>
              Eliminar
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
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

function Nota({ children, fondo, color = "marca.carbon" }: { children: string; fondo: string; color?: string }) {
  return (
    <Box bg={fondo} color={color} borderRadius="16px" px={4} py={3} fontSize="sm" lineHeight="1.45">
      {children}
    </Box>
  )
}

const FRASE_FALTA: Partial<Record<keyof BorradorFactura, string>> = {
  proveedor: "el proveedor",
  categoria: "la categoría",
  periodo: "el período",
  monto: "el monto",
  moneda: "la moneda",
  numero_comprobante: "el número de comprobante",
}

const marcaInvalida = {
  "&[aria-invalid=true]": {
    borderColor: "estado.falla",
    focusRingColor: "estado.falla",
  },
} as const

function esPedidoDeCompletar(aviso: string): boolean {
  return aviso.startsWith("Falta ") && aviso.includes("antes de confirmar")
}

function enfocarCampo(clave: keyof BorradorFactura) {
  const nodo = document.querySelector<HTMLElement>(
    `[data-campo="${clave}"] input, [data-campo="${clave}"] select`,
  )
  if (!nodo) return
  nodo.focus({ preventScroll: true })
  nodo.scrollIntoView({ behavior: "smooth", block: "center" })
}

function verboCompletar(claves: Array<keyof BorradorFactura>): string {
  if (claves.length !== 1) return "Completalos"
  const frase = FRASE_FALTA[claves[0]!] ?? ""
  return frase.startsWith("la ") ? "Completala" : "Completalo"
}

function EnlaceCampo({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      display="inline"
      h="auto"
      minW={0}
      px={0}
      py={0}
      fontSize="inherit"
      fontWeight="medium"
      lineHeight="inherit"
      color="inherit"
      textDecoration="underline"
      textUnderlineOffset="2px"
      verticalAlign="baseline"
      _hover={{ bg: "transparent", color: "inherit" }}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function ListaCampos({
  claves,
  onIr,
}: {
  claves: Array<keyof BorradorFactura>
  onIr: (clave: keyof BorradorFactura) => void
}) {
  return claves.map((clave, indice) => {
    const ultimo = indice === claves.length - 1
    const conector = indice === 0 ? null : ultimo ? " y " : ", "
    return (
      <Fragment key={clave}>
        {conector}
        <EnlaceCampo onClick={() => onIr(clave)}>
          {FRASE_FALTA[clave] ?? etiquetaCampo(clave).toLocaleLowerCase("es")}
        </EnlaceCampo>
      </Fragment>
    )
  })
}

const AvisoAlEnviar = forwardRef<
  HTMLDivElement,
  {
    errores: ErroresFactura
    accion: "confirmar" | "guardar"
    onIr: (clave: keyof BorradorFactura) => void
  }
>(function AvisoAlEnviar({ errores, accion, onIr }, ref) {
  const claves = CLAVES.filter((clave) => errores[clave])
  const faltan = claves.filter((clave) => (errores[clave] ?? "").startsWith("Falta "))
  const otros = claves.filter((clave) => !(errores[clave] ?? "").startsWith("Falta "))
  if (claves.length === 0) return null
  const cierre = accion === "confirmar" ? "confirmar" : "guardar"
  return (
    <Box ref={ref} role="alert" bg="estado.avisoFondo" color="marca.carbon" borderRadius="16px" px={4} py={3}>
      <Stack gap={1}>
        {faltan.length > 0 ? (
          <Text as="div" fontSize="sm" lineHeight="1.45">
            {faltan.length === 1 ? "Falta " : "Faltan "}
            <ListaCampos claves={faltan} onIr={onIr} />
            {`. ${verboCompletar(faltan)} antes de ${cierre}.`}
          </Text>
        ) : null}
        {otros.map((clave) => (
          <Text key={clave} as="div" fontSize="sm" lineHeight="1.45">
            <EnlaceCampo onClick={() => onIr(clave)}>{etiquetaCampo(clave)}</EnlaceCampo>
            {": "}
            {errores[clave]}
          </Text>
        ))}
      </Stack>
    </Box>
  )
})

function mimeBase(mime: string): string {
  return mime.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

export function Revision() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const estadoNavegacion = useRef(location.state)
  estadoNavegacion.current = location.state
  const { email, nombre: alias } = useSesion()
  const [documento, setDocumento] = useState<DocumentoDetalle | null>(null)
  const [form, setForm] = useState<BorradorFactura | null>(null)
  const [errores, setErrores] = useState<ErroresFactura>({})
  const [revisado, setRevisado] = useState(false)
  const [falla, setFalla] = useState<string | null>(null)
  const avisoRef = useRef<HTMLDivElement>(null)
  const enfocarAviso = useRef(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [vistaServidor, setVistaServidor] = useState<{ id: string; url: string; mime: string } | null>(null)
  const [consultaArchivo, setConsultaArchivo] = useState<{ id: string; listo: boolean }>({ id: "", listo: false })
  const [fallaArchivo, setFallaArchivo] = useState<{ id: string; texto: string } | null>(null)
  const [catalogo, setCatalogo] = useState<CategoriaItem[] | null>(null)
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null)
  const [intentoCatalogo, setIntentoCatalogo] = useState(0)
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
    const abrirEdicion = pideCorregir(estadoNavegacion.current)
    const ctrl = new AbortController()
    setCargando(true)
    setCorrigiendo(false)
    setErrores({})
    setRevisado(false)
    cliente
      .verDocumento(id, ctrl.signal)
      .then((dato) => {
        setDocumento(dato)
        setForm(desdeCampos(dato.campos))
        setCorrigiendo(abrirEdicion && !esBorrador(dato) && !dato.anulado)
        setErrores({})
        setRevisado(false)
        setFalla(null)
        if (abrirEdicion) navigate(`/documentos/${id}`, { replace: true, state: null })
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
  }, [id, navigate])

  useEffect(() => {
    const ctrl = new AbortController()
    cliente
      .listarCategorias(ctrl.signal)
      .then((lista) => {
        setCatalogo(lista.items)
        setErrorCatalogo(null)
      })
      .catch((error: unknown) => {
        if (esAbort(error)) return
        setCatalogo([])
        setErrorCatalogo(error instanceof ErrorApi ? error.message : "No se pudieron cargar las categorías.")
      })
    return () => ctrl.abort()
  }, [intentoCatalogo])

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
    if (!form) return
    const siguiente = { ...form, [clave]: valor }
    if (revisado) {
      const armado = armarFactura(siguiente)
      setErrores(armado.ok ? {} : armado.errores)
      return
    }
    setErrores((actual) => {
      if (!actual[clave]) return actual
      const copia = { ...actual }
      delete copia[clave]
      return copia
    })
  }

  function publicarErrores(siguientes: ErroresFactura) {
    enfocarAviso.current = true
    setRevisado(true)
    setErrores(siguientes)
    setFalla(null)
  }

  function publicarErrorApi(error: ErrorApi) {
    const siguientes = erroresDeApi(error.campos)
    if (Object.keys(siguientes).length > 0) {
      enfocarAviso.current = true
      setRevisado(true)
    }
    setErrores(siguientes)
    setFalla(error.message)
  }

  useEffect(() => {
    if (!enfocarAviso.current) return
    enfocarAviso.current = false
    avisoRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [errores])

  async function confirmar() {
    if (!form || !documento || !esBorrador(documento) || guardando) return
    const armado = armarFactura(form)
    if (!armado.ok) {
      publicarErrores(armado.errores)
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
      navigate("/registros")
    } catch (error) {
      if (error instanceof ErrorApi) {
        publicarErrorApi(error)
      } else {
        setFalla("No se pudo confirmar el comprobante.")
      }
    } finally {
      setGuardando(false)
    }
  }

  async function corregir() {
    if (!form || !documento || esBorrador(documento) || documento.anulado || guardando) return
    const armado = armarFactura(form)
    if (!armado.ok) {
      publicarErrores(armado.errores)
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
      setErrores({})
      setRevisado(false)
      setCorrigiendo(false)
      toaster.create({ title: "Comprobante corregido", type: "success" })
    } catch (error) {
      if (error instanceof ErrorApi) {
        publicarErrorApi(error)
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
    setRevisado(false)
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
      navigate("/registros")
    } catch (error) {
      setFalla(error instanceof ErrorApi ? error.message : "No se pudo anular el comprobante.")
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar() {
    if (!documento || guardando) return
    if (!window.confirm("¿Eliminás este comprobante? Se borra el archivo y no se puede deshacer.")) return
    setGuardando(true)
    setFalla(null)
    try {
      await cliente.eliminar(documento.id)
      toaster.create({ title: "Comprobante eliminado", type: "success" })
      navigate("/registros")
    } catch (error) {
      setFalla(error instanceof ErrorApi ? error.message : "No se pudo eliminar el comprobante.")
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <EsqueletoRevision />

  if (!documento || !form) {
    return (
      <Stack gap={4}>
        <Alert.Root status="error" css={alertaFalla}>
          <Alert.Indicator color="estado.falla" />
          <Alert.Description color="marca.carbon">{falla ?? "No encontramos ese comprobante."}</Alert.Description>
        </Alert.Root>
        <Button
          asChild
          aria-label="Volver a registros"
          alignSelf="flex-start"
          variant="ghost"
          borderRadius="full"
          boxSize="2.75rem"
          px={0}
          css={botonFantasma}
        >
          <Link to="/registros">
            <IconoVolver />
          </Link>
        </Button>
      </Stack>
    )
  }

  const anulado = !esBorrador(documento) && documento.anulado
  const editando = esBorrador(documento) || corrigiendo
  const avisosDatos = esBorrador(documento)
    ? documento.advertencias.filter((aviso) => !esPedidoDeCompletar(aviso))
    : []
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
  const categoriaTexto = etiquetaCategoria(form.categoria)
  const categoriasPropias = opcionesDelCatalogo(catalogo ?? [])
  const categoriasOcupadas = new Set(categoriasPropias.map((opcion) => opcion.value))
  const categoriasGenerales = opcionesGenerales(categoriasOcupadas)
  for (const opcion of categoriasGenerales) categoriasOcupadas.add(opcion.value)
  const categoriaEnGasto = opcionActual(form.categoria, categoriasOcupadas)
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
      <Flex align="center" gap={1} minW={0}>
        <Button
          asChild
          aria-label="Volver a registros"
          variant="ghost"
          borderRadius="full"
          flexShrink={0}
          boxSize={{ base: "2.75rem", md: "3.25rem" }}
          px={0}
          css={botonFantasma}
        >
          <Link to="/registros">
            <IconoVolver />
          </Link>
        </Button>
        <Heading
          as="h1"
          minW={0}
          color="fg"
          fontFamily="'Fraunces', Georgia, serif"
          fontSize={{ base: "2.15rem", md: "2.85rem" }}
          fontWeight="600"
          letterSpacing="-0.03em"
          lineHeight="1.05"
        >
          {titulo}
        </Heading>
        <MenuAcciones
            puedeEditar={!esBorrador(documento) && !anulado && !corrigiendo}
            puedeAnular={!esBorrador(documento) && !anulado}
            guardando={guardando}
            onEditar={() => {
              setErrores({})
              setRevisado(false)
              setFalla(null)
              setCorrigiendo(true)
            }}
            onAnular={() => void anular()}
            onEliminar={() => void eliminar()}
          />
      </Flex>

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
                {editando ? null : (
                  <Text color="fg.muted" fontSize="sm">
                    {formatPeriodo(form.periodo)}
                    {form.categoria ? ` · ${categoriaTexto}` : ""}
                  </Text>
                )}
                <Flex gap={2} wrap="wrap">
                  {editando ? null : (
                    <Pastilla tono={form.categoria ? "sol" : "gris"}>{categoriaTexto}</Pastilla>
                  )}
                  <Pastilla tono={estado.tono}>{estado.texto}</Pastilla>
                  {editando ? null : <Pastilla tono="gris">{moneda}</Pastilla>}
                </Flex>
                {editando ? null : (
                  <Text color="fg.muted" fontSize="xs">
                    {datosListos(form)} de 6 datos
                  </Text>
                )}
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
          <Card.Root bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
            <Card.Header>
              <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
                Vista previa
              </Card.Title>
            </Card.Header>
            <Card.Body>
              <Stack gap={3}>
                {!vista && !archivoListo && !textoFallaArchivo ? <EsqueletoVista /> : null}
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
          {editando ? null : (
          <Card.Root bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
            <Card.Header>
              <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
                Información general
              </Card.Title>
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
                <FilaDato icono={<IconoPersona />} etiqueta="Cargado por" valor={alias?.trim() || email?.trim() || "Tu cuenta"} />
                <FilaDato icono={<IconoFecha />} etiqueta={etiquetaFecha} valor={formatFecha(marcaTiempo)} />
                <FilaDato icono={<IconoBusqueda />} etiqueta="Búsqueda" valor={etiquetaBusqueda(documento)} />
                <FilaDato icono={<IconoArchivo />} etiqueta="Archivo" valor={textoArchivo} />
              </Stack>
            </Card.Body>
          </Card.Root>
          )}

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
                    {avisosDatos.length > 0 ? (
                      <Box bg="bg.subtle" borderRadius="16px" px={4} py={3}>
                        <Stack gap={1}>
                          {avisosDatos.map((aviso) => (
                            <Text key={aviso} fontSize="sm" lineHeight="1.45" color="fg">
                              {aviso}
                            </Text>
                          ))}
                        </Stack>
                      </Box>
                    ) : null}
                    {editando ? (
                      <>
                        <Field.Root invalid={Boolean(errores.proveedor)} data-campo="proveedor">
                          <Field.Label>Proveedor</Field.Label>
                          <CampoProveedor valor={form.proveedor} onChange={(valor) => actualizar("proveedor", valor)} />
                          {errores.proveedor ? <Field.ErrorText color="estadoTexto.falla">{errores.proveedor}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.categoria)} data-campo="categoria">
                          <Field.Label>Categoría</Field.Label>
                          <NativeSelect.Root invalid={Boolean(errores.categoria)}>
                            <NativeSelect.Field
                              aria-invalid={errores.categoria ? true : undefined}
                              css={marcaInvalida}
                              value={form.categoria}
                              onChange={(event) => actualizar("categoria", event.target.value)}
                            >
                              <option value="">Elegir</option>
                              {categoriasPropias.length > 0 ? (
                                <optgroup label="Tus categorías">
                                  {categoriasPropias.map((opcion) => (
                                    <option key={opcion.value} value={opcion.value}>
                                      {opcion.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                              {categoriasGenerales.length > 0 ? (
                                <optgroup label="Generales">
                                  {categoriasGenerales.map((opcion) => (
                                    <option key={opcion.value} value={opcion.value}>
                                      {opcion.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                              {categoriaEnGasto ? (
                                <optgroup label="En este gasto">
                                  <option value={categoriaEnGasto.value}>{categoriaEnGasto.label}</option>
                                </optgroup>
                              ) : null}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                          </NativeSelect.Root>
                          {catalogo === null && !errorCatalogo ? (
                            <EsqueletoCampo etiqueta="Cargando categorías" />
                          ) : (
                          <Field.HelperText color="fg.muted">
                            {errorCatalogo ? (
                              <>
                                No se pudieron cargar tus categorías.{" "}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  height="auto"
                                  minW={0}
                                  px={1}
                                  color="fg"
                                  textDecoration="underline"
                                  onClick={() => {
                                    setCatalogo(null)
                                    setErrorCatalogo(null)
                                    setIntentoCatalogo((valor) => valor + 1)
                                  }}
                                >
                                  Reintentar
                                </Button>
                              </>
                            ) : catalogo !== null && catalogo.length === 0 ? (
                              <>
                                Todavía no hay categorías propias.{" "}
                                <Link to="/categorias" style={{ color: "inherit", textDecoration: "underline" }}>
                                  Crear una
                                </Link>
                              </>
                            ) : (
                              "Elegí una de tus categorías o una general."
                            )}
                          </Field.HelperText>
                          )}
                          {errores.categoria ? <Field.ErrorText color="estadoTexto.falla">{errores.categoria}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.periodo)} data-campo="periodo">
                          <Field.Label>Período</Field.Label>
                          <Input
                            type="month"
                            aria-invalid={errores.periodo ? true : undefined}
                            css={marcaInvalida}
                            value={form.periodo}
                            onChange={(event) => actualizar("periodo", event.target.value)}
                          />
                          {errores.periodo ? <Field.ErrorText color="estadoTexto.falla">{errores.periodo}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.monto)} data-campo="monto">
                          <Field.Label>Monto</Field.Label>
                          <Input
                            inputMode="decimal"
                            aria-invalid={errores.monto ? true : undefined}
                            css={marcaInvalida}
                            value={form.monto}
                            onChange={(event) => actualizar("monto", event.target.value)}
                          />
                          <Field.HelperText color="fg.muted">Dos decimales, por ejemplo 18500.50</Field.HelperText>
                          {errores.monto ? <Field.ErrorText color="estadoTexto.falla">{errores.monto}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.moneda)} data-campo="moneda">
                          <Field.Label>Moneda</Field.Label>
                          <Input
                            aria-invalid={errores.moneda ? true : undefined}
                            css={marcaInvalida}
                            value={form.moneda}
                            onChange={(event) => actualizar("moneda", event.target.value)}
                          />
                          <Field.HelperText color="fg.muted">Si lo dejás vacío, se usa ARS.</Field.HelperText>
                          {errores.moneda ? <Field.ErrorText color="estadoTexto.falla">{errores.moneda}</Field.ErrorText> : null}
                        </Field.Root>
                        <Field.Root invalid={Boolean(errores.numero_comprobante)} data-campo="numero_comprobante">
                          <Field.Label>Número de comprobante</Field.Label>
                          <Input
                            aria-invalid={errores.numero_comprobante ? true : undefined}
                            css={marcaInvalida}
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
                    <AvisoAlEnviar
                      ref={avisoRef}
                      errores={errores}
                      accion={esBorrador(documento) ? "confirmar" : "guardar"}
                      onIr={enfocarCampo}
                    />
                    {esBorrador(documento) ? (
                      <Button type="submit" loading={guardando} alignSelf="flex-start" borderRadius="full" css={botonSolido}>
                        Confirmar
                      </Button>
                    ) : null}
                    {corrigiendo ? (
                      <Flex gap={3} wrap="wrap">
                        <Button type="submit" loading={guardando} borderRadius="full" css={botonSolido}>
                          Guardar
                        </Button>
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
                      </Flex>
                    ) : null}
                  </Stack>
                </form>
                <Stack gap={3} mt={4} pt={4} borderTopWidth="1px" borderColor="borde">
                  <FilaDato icono={<IconoPersona />} etiqueta="Cargado por" valor={alias?.trim() || email?.trim() || "Tu cuenta"} />
                  <FilaDato icono={<IconoFecha />} etiqueta={etiquetaFecha} valor={formatFecha(marcaTiempo)} />
                  <FilaDato icono={<IconoBusqueda />} etiqueta="Búsqueda" valor={etiquetaBusqueda(documento)} />
                  <FilaDato icono={<IconoArchivo />} etiqueta="Archivo" valor={textoArchivo} />
                </Stack>
              </Card.Body>
            </Card.Root>
          ) : null}

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
        </Stack>
      </Grid>
    </Stack>
  )
}
