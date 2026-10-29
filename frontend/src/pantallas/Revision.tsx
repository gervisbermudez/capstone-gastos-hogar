import {
  Alert,
  Box,
  Button,
  Card,
  Field,
  Flex,
  Heading,
  Image,
  Input,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import { CATEGORIAS, ETIQUETA_CATEGORIA, esBorrador, type Categoria, type DocumentoDetalle } from "../api/tipos"
import { toaster } from "../avisos"
import { Cargando } from "../componentes/Cargando"
import { armarFactura, desdeCampos, type BorradorFactura, type ErroresFactura } from "../formulario"
import { leerVista } from "../vistas"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"

const alertaFalla = {
  borderRadius: "16px",
  bg: "estado.fallaFondo",
  color: "marca.carbon",
}

const alertaAviso = {
  borderRadius: "16px",
  bg: "estado.avisoFondo",
  color: "marca.carbon",
}

const alertaNeutra = {
  borderRadius: "16px",
  bg: "marca.alabastro",
  color: "fg.muted",
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

function etiquetaEstado(documento: DocumentoDetalle): { texto: string; bg: string; color: string } {
  if (!esBorrador(documento) && documento.anulado) {
    return { texto: "Anulado", bg: "estado.fallaFondo", color: "estado.falla" }
  }
  if (esBorrador(documento)) return { texto: "Borrador", bg: "estado.avisoFondo", color: "estado.aviso" }
  return { texto: "Confirmado", bg: "estado.okFondo", color: "estado.ok" }
}

function mimeBase(mime: string): string {
  return mime.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

export function Revision() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
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
      setDocumento(actualizado)
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
          css={{ color: "marca.carbon", _hover: { bg: "marca.alabastro" } }}
        >
          <Link to="/">Volver al tablero</Link>
        </Button>
      </Stack>
    )
  }

  const anulado = !esBorrador(documento) && documento.anulado
  const soloLectura = !esBorrador(documento) && (anulado || !corrigiendo)
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

  return (
    <Stack gap={{ base: 6, md: 8 }}>
      <Stack gap={3}>
        <Flex justify="space-between" gap={3} align={{ base: "flex-start", sm: "center" }} wrap="wrap">
          <Heading
            as="h1"
            color="marca.carbon"
            fontSize={{ base: "2rem", md: "2.5rem" }}
            fontWeight="medium"
            letterSpacing="-0.03em"
            lineHeight="1.1"
          >
            Revisar comprobante
          </Heading>
          <Flex gap={2} align="center" wrap="wrap" alignSelf={{ base: "flex-start", sm: "center" }}>
            <Button
              asChild
              size="sm"
              variant="outline"
              borderRadius="full"
              css={{
                color: "marca.carbon",
                borderColor: "rgba(28, 28, 26, 0.2)",
                bg: "marca.papel",
                _hover: { bg: "marca.alabastro", color: "marca.carbon" },
              }}
            >
              <Link
                to={`/chat?comprobante=${encodeURIComponent(documento.id)}`}
                state={{ nuevoComprobante: documento.id }}
              >
                Chat
              </Link>
            </Button>
            <Box
              display="inline-flex"
              alignItems="center"
              bg={estado.bg}
              color={estado.color}
              borderRadius="full"
              px={3}
              py={1}
              fontSize="sm"
              fontWeight="medium"
              lineHeight="1.4"
              whiteSpace="nowrap"
            >
              {estado.texto}
            </Box>
          </Flex>
        </Flex>
        <Button
          asChild
          variant="ghost"
          alignSelf="flex-start"
          borderRadius="full"
          css={{ color: "marca.carbon", _hover: { bg: "marca.alabastro" } }}
        >
          <Link to="/">Volver al tablero</Link>
        </Button>
      </Stack>
      {anulado ? (
        <Alert.Root status="info" css={alertaNeutra}>
          <Alert.Indicator color="fg.muted" />
          <Alert.Description color="fg.muted">Este comprobante está anulado.</Alert.Description>
        </Alert.Root>
      ) : !esBorrador(documento) ? (
        <Alert.Root status="info" css={alertaNeutra}>
          <Alert.Indicator color="fg.muted" />
          <Alert.Description color="fg.muted">Este comprobante ya está confirmado.</Alert.Description>
        </Alert.Root>
      ) : null}
      {!esBorrador(documento) && documento.indexado === "error" ? (
        <Alert.Root status="warning" css={alertaAviso}>
          <Alert.Indicator color="estado.aviso" />
          <Alert.Description color="marca.carbon">
            El monto ya quedó guardado. El texto de la factura todavía no se puede buscar.
          </Alert.Description>
        </Alert.Root>
      ) : null}
      {!esBorrador(documento) && documento.indexado === "omitido" ? (
        <Text color="fg.muted">Esta factura no se puede buscar por su texto.</Text>
      ) : null}
      {esBorrador(documento)
        ? documento.advertencias.map((aviso) => (
            <Alert.Root key={aviso} status="warning" css={alertaAviso}>
              <Alert.Indicator color="estado.aviso" />
              <Alert.Description color="marca.carbon">{aviso}</Alert.Description>
            </Alert.Root>
          ))
        : null}
      {falla ? (
        <Alert.Root status="error" css={alertaFalla}>
          <Alert.Indicator color="estado.falla" />
          <Alert.Description color="marca.carbon">{falla}</Alert.Description>
        </Alert.Root>
      ) : null}
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={{ base: 4, md: 6 }}>
        <Card.Root bg="marca.papel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA}>
          <Card.Header>
            <Card.Title fontWeight="medium" color="marca.carbon">
              Vista previa
            </Card.Title>
          </Card.Header>
          <Card.Body>
            <Stack gap={3}>
              {vista && esImagen ? (
                <Image
                  src={vista.url}
                  alt={nombre || "Comprobante"}
                  maxH="24rem"
                  objectFit="contain"
                  w="100%"
                  display="block"
                  borderRadius="16px"
                  bg="marca.alabastro"
                  p={3}
                />
              ) : null}
              {vista && esPdf ? (
                <Box h="24rem" borderRadius="16px" overflow="hidden" bg="marca.alabastro">
                  <iframe
                    title={nombre || "Comprobante"}
                    src={vista.url}
                    style={{ width: "100%", height: "100%", border: 0, background: "#f3efe4" }}
                  />
                </Box>
              ) : null}
              {nombre ? <Text fontSize="sm" color="fg.muted">{nombre}</Text> : null}
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
                  color="marca.carbon"
                  bg="marca.alabastro"
                  borderRadius="16px"
                  p={4}
                >
                  {documento.texto || "Sin texto extraído."}
                </Box>
              ) : null}
            </Stack>
          </Card.Body>
        </Card.Root>
        <Card.Root bg="marca.papel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA}>
          <Card.Header>
            <Flex justify="space-between" align="center" gap={3} wrap="wrap">
              <Card.Title fontWeight="medium" color="marca.carbon">
                Datos
              </Card.Title>
              {!esBorrador(documento) && !anulado && !corrigiendo ? (
                <Button
                  type="button"
                  variant="outline"
                  borderRadius="full"
                  disabled={guardando}
                  onClick={() => setCorrigiendo(true)}
                  css={{
                    color: "marca.carbon",
                    borderColor: "rgba(28, 28, 26, 0.2)",
                    _hover: { bg: "marca.alabastro" },
                  }}
                >
                  Editar
                </Button>
              ) : null}
            </Flex>
          </Card.Header>
          <Card.Body>
            {cambios.length > 0 ? (
              <Stack gap={1} mb={4}>
                <Text fontWeight="medium" color="marca.carbon">
                  Cambios
                </Text>
                {cambios.map((cambio, indice) => (
                  <Text key={`${cambio.campo}-${indice}`} fontSize="sm" color="fg.muted">
                    {etiquetaCampo(cambio.campo)}: antes {textoCambio(cambio.campo, cambio.antes)}, después{" "}
                    {textoCambio(cambio.campo, cambio.despues)}
                  </Text>
                ))}
              </Stack>
            ) : null}
            {soloLectura && !anulado ? (
              <Text mb={4} fontSize="sm" color="fg.muted">
                Los datos están bloqueados. Editar los habilita.
              </Text>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!documento || guardando) return
                if (esBorrador(documento)) {
                  void confirmar()
                  return
                }
                void corregir()
              }}
            >
              <Stack gap={4}>
                <Field.Root invalid={Boolean(errores.proveedor)} disabled={soloLectura}>
                  <Field.Label>Proveedor</Field.Label>
                  <Input
                    value={form.proveedor}
                    disabled={soloLectura}
                    onChange={(event) => actualizar("proveedor", event.target.value)}
                  />
                  {errores.proveedor ? <Field.ErrorText color="estado.falla">{errores.proveedor}</Field.ErrorText> : null}
                </Field.Root>
                <Field.Root invalid={Boolean(errores.categoria)} disabled={soloLectura}>
                  <Field.Label>Categoría</Field.Label>
                  <NativeSelect.Root disabled={soloLectura} invalid={Boolean(errores.categoria)}>
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
                  {errores.categoria ? <Field.ErrorText color="estado.falla">{errores.categoria}</Field.ErrorText> : null}
                </Field.Root>
                <Field.Root invalid={Boolean(errores.periodo)} disabled={soloLectura}>
                  <Field.Label>Período</Field.Label>
                  <Input
                    type="month"
                    value={form.periodo}
                    disabled={soloLectura}
                    onChange={(event) => actualizar("periodo", event.target.value)}
                  />
                  {errores.periodo ? <Field.ErrorText color="estado.falla">{errores.periodo}</Field.ErrorText> : null}
                </Field.Root>
                <Field.Root invalid={Boolean(errores.monto)} disabled={soloLectura}>
                  <Field.Label>Monto</Field.Label>
                  <Input
                    inputMode="decimal"
                    value={form.monto}
                    disabled={soloLectura}
                    onChange={(event) => actualizar("monto", event.target.value)}
                  />
                  <Field.HelperText color="fg.muted">Dos decimales, por ejemplo 18500.50</Field.HelperText>
                  {errores.monto ? <Field.ErrorText color="estado.falla">{errores.monto}</Field.ErrorText> : null}
                </Field.Root>
                <Field.Root invalid={Boolean(errores.moneda)} disabled={soloLectura}>
                  <Field.Label>Moneda</Field.Label>
                  <Input
                    value={form.moneda}
                    disabled={soloLectura}
                    onChange={(event) => actualizar("moneda", event.target.value)}
                  />
                  <Field.HelperText color="fg.muted">Si lo dejás vacío, se usa ARS.</Field.HelperText>
                  {errores.moneda ? <Field.ErrorText color="estado.falla">{errores.moneda}</Field.ErrorText> : null}
                </Field.Root>
                <Field.Root invalid={Boolean(errores.numero_comprobante)} disabled={soloLectura}>
                  <Field.Label>Número de comprobante</Field.Label>
                  <Input
                    value={form.numero_comprobante}
                    disabled={soloLectura}
                    onChange={(event) => actualizar("numero_comprobante", event.target.value)}
                  />
                  <Field.HelperText color="fg.muted">Opcional.</Field.HelperText>
                  {errores.numero_comprobante ? (
                    <Field.ErrorText color="estado.falla">{errores.numero_comprobante}</Field.ErrorText>
                  ) : null}
                </Field.Root>
                {esBorrador(documento) ? (
                  <Flex gap={3} wrap="wrap">
                    <Button
                      type="submit"
                      loading={guardando}
                      borderRadius="full"
                      css={{
                        bg: "marca.carbon",
                        color: "marca.papel",
                        _hover: { bg: "marca.grafito" },
                      }}
                    >
                      Confirmar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      borderRadius="full"
                      disabled={guardando}
                      onClick={() => void descartar()}
                      css={{
                        color: "estado.falla",
                        borderColor: "estado.falla",
                        _hover: { bg: "estado.fallaFondo" },
                      }}
                    >
                      Descartar
                    </Button>
                  </Flex>
                ) : null}
                {!esBorrador(documento) && !documento.anulado ? (
                  <Flex gap={3} wrap="wrap">
                    {corrigiendo ? (
                      <Button
                        type="submit"
                        loading={guardando}
                        borderRadius="full"
                        css={{
                          bg: "marca.carbon",
                          color: "marca.papel",
                          _hover: { bg: "marca.grafito" },
                        }}
                      >
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
                        css={{ color: "marca.carbon", _hover: { bg: "marca.alabastro" } }}
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
                      css={{
                        color: "estado.falla",
                        borderColor: "estado.falla",
                        _hover: { bg: "estado.fallaFondo" },
                      }}
                    >
                      Anular
                    </Button>
                  </Flex>
                ) : null}
              </Stack>
            </form>
          </Card.Body>
        </Card.Root>
      </SimpleGrid>
    </Stack>
  )
}
