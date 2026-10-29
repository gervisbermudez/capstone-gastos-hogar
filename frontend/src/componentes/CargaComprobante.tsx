import { Alert, Box, Button, FileUpload, Flex, Image, Stack, Text } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"
import type { DocumentoBorrador } from "../api/tipos"
import { toaster } from "../avisos"
import { EsqueletoDocumento } from "./esqueleto"
import {
  MENSAJE_TAMANO,
  TAMANO_MAXIMO_BYTES,
  consumirListo,
  iniciarCarga,
  leerCarga,
  soltarCarga,
  suscribirCarga,
  type EstadoCarga,
} from "../cargaActiva"
import { ChipArchivo } from "./revision/ChipArchivo"

const ACEPTADOS = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
}

const IMAGENES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
}

const formatoTamano = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 })

const botonSol = {
  bg: "marca.sol",
  color: "marca.carbon",
  borderColor: "transparent",
  _hover: { bg: "#e8bc45" },
  _expanded: { bg: "#e8bc45" },
} as const

const botonContorno = {
  color: "fg",
  borderColor: "borde",
  bg: "bg.panel",
  _hover: { bg: "bg.hover", color: "fg" },
} as const

const botonFantasma = {
  color: "fg.muted",
  _hover: { bg: "bg.hover", color: "fg" },
} as const

const alertaFalla = {
  borderRadius: "16px",
  bg: "estado.fallaFondo",
  color: "marca.carbon",
} as const

function textoTamano(bytes: number): string {
  if (bytes < 1024) return `${formatoTamano.format(bytes)} B`
  if (bytes < 1024 * 1024) return `${formatoTamano.format(bytes / 1024)} KB`
  return `${formatoTamano.format(bytes / (1024 * 1024))} MB`
}

function clasificar(archivo: File): { esImagen: boolean; esPdf: boolean; tipo: "pdf" | "imagen" | "otro" } {
  const mime = archivo.type.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  const nombre = archivo.name
  const esPdf = mime === "application/pdf" || /\.pdf$/i.test(nombre)
  const esImagen = mime.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(nombre)
  if (esPdf) return { esImagen: false, esPdf: true, tipo: "pdf" }
  if (esImagen) return { esImagen: true, esPdf: false, tipo: "imagen" }
  return { esImagen: false, esPdf: false, tipo: "otro" }
}

function archivoEnCurso(estado: EstadoCarga): File | null {
  if (estado.fase === "leyendo" || estado.fase === "extrayendo" || estado.fase === "falla") return estado.archivo
  return null
}

function ocupada(estado: EstadoCarga): boolean {
  return estado.fase === "leyendo" || estado.fase === "extrayendo"
}

function useVistaLocal(archivo: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!archivo) {
      setUrl(null)
      return
    }
    const creada = URL.createObjectURL(archivo)
    setUrl(creada)
    return () => URL.revokeObjectURL(creada)
  }, [archivo])

  return url
}

function VistaPrevia({ archivo, url, leyendo }: { archivo: File; url: string | null; leyendo: boolean }) {
  const nombre = archivo.name.trim() || "Comprobante"
  const { esImagen, esPdf } = clasificar(archivo)
  const ajustada = Boolean(url && esImagen)

  return (
    <Box
      position="relative"
      alignSelf={ajustada ? "center" : "stretch"}
      w={ajustada ? "auto" : "100%"}
      maxW="100%"
      minW={0}
      h={esPdf ? { base: "24rem", md: "32rem" } : "auto"}
      minH={!esPdf && !ajustada ? { base: "12rem", md: "16rem" } : undefined}
      borderRadius="20px"
      overflow="hidden"
      bg="bg.subtle"
    >
      {url && esImagen ? (
        <Image
          src={url}
          alt={nombre}
          display="block"
          w="auto"
          h="auto"
          maxW="100%"
          maxH={{ base: "20rem", md: "28rem" }}
        />
      ) : null}
      {url && esPdf ? (
        <iframe
          title={nombre}
          src={url}
          style={{ width: "100%", height: "100%", border: 0, background: "var(--chakra-colors-bg-subtle, #f3efe4)" }}
        />
      ) : null}
      {url && !esImagen && !esPdf ? (
        <Flex align="center" justify="center" h="100%" px={6}>
          <Text color="fg.muted" textAlign="center">
            Hay un archivo elegido, pero no se puede mostrar acá.
          </Text>
        </Flex>
      ) : null}
      {leyendo ? (
        <Flex position="absolute" inset={0} align="center" justify="center" borderRadius="20px" overflow="hidden">
          <Box position="absolute" inset={0} bg="bg.panel" opacity={0.92} />
          <Stack position="relative" align="center" gap={3} px={6}>
            <EsqueletoDocumento />
            <Text color="fg" fontWeight="medium" textAlign="center">
              Leyendo el comprobante…
            </Text>
          </Stack>
        </Flex>
      ) : null}
    </Box>
  )
}

export function CargaComprobante({
  onListo,
}: {
  onListo: (documento: DocumentoBorrador, archivo: File) => void
}) {
  const alListo = useRef(onListo)
  alListo.current = onListo
  const [remota, setRemota] = useState<EstadoCarga>(leerCarga)
  const [elegido, setElegido] = useState<File | null>(() => archivoEnCurso(leerCarga()))
  const [errorLocal, setErrorLocal] = useState<string | null>(null)
  const leyendo = ocupada(remota)
  const archivo = archivoEnCurso(remota) ?? elegido
  const url = useVistaLocal(archivo)
  const error = errorLocal ?? (remota.fase === "falla" ? remota.mensaje : null)

  useEffect(() => {
    function aplicar(siguiente: EstadoCarga) {
      if (siguiente.fase === "lista") {
        const listo = consumirListo()
        if (listo) alListo.current(listo.documento, listo.archivo)
        return
      }
      setRemota(siguiente)
    }

    const baja = suscribirCarga(aplicar)
    aplicar(leerCarga())
    return baja
  }, [])

  function tomar(siguiente: File) {
    if (ocupada(leerCarga())) return
    if (siguiente.size > TAMANO_MAXIMO_BYTES) {
      setErrorLocal(MENSAJE_TAMANO)
      return
    }
    setErrorLocal(null)
    if (leerCarga().fase === "falla") soltarCarga()
    setElegido(siguiente)
  }

  function alAceptar(detalles: { files: File[] }) {
    const siguiente = detalles.files[0]
    if (siguiente) tomar(siguiente)
  }

  function alRechazar(detalles: { files: Array<{ errors: readonly string[] }> }) {
    if (ocupada(leerCarga())) return
    if (detalles.files.some((item) => item.errors.includes("FILE_TOO_LARGE"))) {
      setErrorLocal(MENSAJE_TAMANO)
      return
    }
    const repetido = detalles.files.every(
      (item) =>
        item.errors.includes("FILE_EXISTS") &&
        !item.errors.includes("FILE_INVALID_TYPE") &&
        !item.errors.includes("TOO_MANY_FILES"),
    )
    if (repetido) return
    toaster.create({
      title: "Archivo no aceptado",
      description: "Un archivo por vez: jpeg, png, webp o pdf.",
      type: "error",
      closable: true,
    })
  }

  function cargar() {
    if (!archivo || ocupada(leerCarga())) return
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      setErrorLocal(MENSAJE_TAMANO)
      return
    }
    setErrorLocal(null)
    iniciarCarga(archivo)
  }

  function quitar() {
    if (ocupada(leerCarga())) return
    setElegido(null)
    setErrorLocal(null)
    soltarCarga()
  }

  const comunes = {
    maxFiles: 1,
    maxFileSize: TAMANO_MAXIMO_BYTES,
    locale: "es-AR" as const,
    disabled: leyendo,
    onFileAccept: alAceptar,
    onFileReject: alRechazar,
  }

  return (
    <Stack gap={6} aria-busy={leyendo}>
      {error ? (
        <Alert.Root status="error" css={alertaFalla}>
          <Alert.Indicator color="estado.falla" />
          <Alert.Content>
            <Alert.Title color="marca.carbon">
              {error === MENSAJE_TAMANO ? "Archivo demasiado grande" : "No se pudo cargar"}
            </Alert.Title>
            <Alert.Description color="marca.carbon">{error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}
      {archivo ? (
        <Stack gap={5}>
          <Stack gap={2}>
            <Flex align="center" justify="space-between" gap={3} minW={0}>
              <Box minW={0}>
                <ChipArchivo nombre={archivo.name} tipo={clasificar(archivo).tipo} />
              </Box>
              <Text flexShrink={0} color="fg.muted" fontSize="sm" fontVariantNumeric="tabular-nums">
                {textoTamano(archivo.size)}
              </Text>
            </Flex>
            <Text color="fg.muted" fontSize="sm" lineHeight="1.45">
              {leyendo
                ? "Podés salir de esta pantalla. Te avisamos cuando el borrador esté listo."
                : "Revisá que sea el comprobante correcto."}
            </Text>
          </Stack>
          <VistaPrevia archivo={archivo} url={url} leyendo={leyendo} />
          <Flex display={{ base: "none", md: "flex" }} justify="space-between" align="center" gap={3}>
            <Button
              type="button"
              variant="ghost"
              borderRadius="full"
              disabled={leyendo}
              onClick={quitar}
              css={botonFantasma}
            >
              Quitar
            </Button>
            <Flex align="center" gap={3}>
              <FileUpload.Root {...comunes} accept={ACEPTADOS}>
                <FileUpload.HiddenInput />
                <FileUpload.Trigger asChild>
                  <Button type="button" variant="outline" borderRadius="full" disabled={leyendo} css={botonContorno}>
                    Cambiar
                  </Button>
                </FileUpload.Trigger>
              </FileUpload.Root>
              <FileUpload.Root {...comunes} accept={IMAGENES} capture="environment">
                <FileUpload.HiddenInput />
                <FileUpload.Trigger asChild>
                  <Button type="button" variant="outline" borderRadius="full" disabled={leyendo} css={botonContorno}>
                    Sacar foto
                  </Button>
                </FileUpload.Trigger>
              </FileUpload.Root>
              <Button
                type="button"
                loading={leyendo}
                loadingText="Leyendo…"
                borderRadius="full"
                onClick={cargar}
                css={botonSol}
              >
                Leer comprobante
              </Button>
            </Flex>
          </Flex>
          <Stack display={{ base: "flex", md: "none" }} gap={3}>
            <Button
              type="button"
              w="100%"
              loading={leyendo}
              loadingText="Leyendo…"
              borderRadius="full"
              onClick={cargar}
              css={botonSol}
            >
              Leer comprobante
            </Button>
            <Flex gap={3}>
              <FileUpload.Root {...comunes} accept={ACEPTADOS} flex="1">
                <FileUpload.HiddenInput />
                <FileUpload.Trigger asChild>
                  <Button
                    type="button"
                    w="100%"
                    variant="outline"
                    borderRadius="full"
                    disabled={leyendo}
                    css={botonContorno}
                  >
                    Cambiar
                  </Button>
                </FileUpload.Trigger>
              </FileUpload.Root>
              <FileUpload.Root {...comunes} accept={IMAGENES} capture="environment" flex="1">
                <FileUpload.HiddenInput />
                <FileUpload.Trigger asChild>
                  <Button
                    type="button"
                    w="100%"
                    variant="outline"
                    borderRadius="full"
                    disabled={leyendo}
                    css={botonContorno}
                  >
                    Sacar foto
                  </Button>
                </FileUpload.Trigger>
              </FileUpload.Root>
            </Flex>
            <Button
              type="button"
              alignSelf="center"
              size="sm"
              variant="ghost"
              borderRadius="full"
              disabled={leyendo}
              onClick={quitar}
              css={botonFantasma}
            >
              Quitar
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack gap={3}>
          <FileUpload.Root {...comunes} accept={ACEPTADOS} w="100%">
            <FileUpload.HiddenInput />
            <FileUpload.Dropzone
              w="100%"
              minH={{ base: "18rem", md: "24rem" }}
              px={{ base: 6, md: 10 }}
              py={{ base: 10, md: 14 }}
              css={{
                borderRadius: "20px",
                bg: "bg.subtle",
                borderWidth: "2px",
                borderStyle: "dashed",
                borderColor: "borde",
                color: "fg",
                _hover: { bg: "bg" },
                _dragging: {
                  bg: "rgba(245, 203, 92, 0.22)",
                  borderStyle: "solid",
                  borderColor: "marca.sol",
                },
              }}
            >
              <FileUpload.DropzoneContent>
                <Text color="fg" fontSize="lg" fontWeight="medium">
                  Arrastrá el comprobante o elegí un archivo
                </Text>
                <Text color="fg.muted" fontSize="sm">
                  jpeg, png, webp o pdf · hasta 10 MB
                </Text>
              </FileUpload.DropzoneContent>
            </FileUpload.Dropzone>
          </FileUpload.Root>
          <Flex align="center" gap={3} w="100%">
            <Box flex="1" h="1px" bg="borde" />
            <Text color="fg.muted" fontSize="sm">
              o
            </Text>
            <Box flex="1" h="1px" bg="borde" />
          </Flex>
          <FileUpload.Root {...comunes} accept={IMAGENES} capture="environment" w={{ base: "100%", md: "auto" }} alignSelf={{ md: "center" }}>
            <FileUpload.HiddenInput />
            <FileUpload.Trigger asChild>
              <Button type="button" w={{ base: "100%", md: "auto" }} borderRadius="full" px={6} css={botonSol}>
                Sacar foto
              </Button>
            </FileUpload.Trigger>
          </FileUpload.Root>
        </Stack>
      )}
    </Stack>
  )
}
