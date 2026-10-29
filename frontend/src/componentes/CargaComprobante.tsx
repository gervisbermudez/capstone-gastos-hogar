import { Alert, Button, FileUpload, Stack, Text } from "@chakra-ui/react"
import { useRef, useState } from "react"
import { ErrorApi, cliente } from "../api/cliente"
import type { DocumentoBorrador } from "../api/tipos"
import { toaster } from "../avisos"

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

export function CargaComprobante({
  onListo,
}: {
  onListo: (documento: DocumentoBorrador, archivo: File) => void
}) {
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ocupado = useRef(false)

  async function subir(archivo: File) {
    if (ocupado.current) return
    ocupado.current = true
    setSubiendo(true)
    setError(null)
    try {
      const documento = await cliente.subir(archivo)
      onListo(documento, archivo)
    } catch (falla) {
      setError(falla instanceof ErrorApi ? falla.message : "No se pudo cargar el comprobante.")
    } finally {
      ocupado.current = false
      setSubiendo(false)
    }
  }

  function alAceptar(detalles: { files: File[] }) {
    const archivo = detalles.files[0]
    if (archivo) void subir(archivo)
  }

  function alRechazar() {
    toaster.create({
      title: "Archivo no aceptado",
      description: "Un archivo por vez: jpeg, png, webp o pdf.",
      type: "error",
      closable: true,
    })
  }

  return (
    <Stack gap={6}>
      <Text color="fg.muted">Un archivo por vez: jpeg, png, webp o pdf.</Text>
      {error ? (
        <Alert.Root
          status="error"
          css={{
            borderRadius: "16px",
            bg: "estado.fallaFondo",
            color: "marca.carbon",
          }}
        >
          <Alert.Indicator color="estado.falla" />
          <Alert.Content>
            <Alert.Title color="marca.carbon">No se pudo cargar</Alert.Title>
            <Alert.Description color="marca.carbon">{error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}
      <FileUpload.Root
        accept={ACEPTADOS}
        maxFiles={1}
        locale="es-AR"
        disabled={subiendo}
        w="100%"
        onFileAccept={alAceptar}
        onFileReject={alRechazar}
      >
        <FileUpload.HiddenInput />
        <FileUpload.Dropzone
          w="100%"
          minH={{ base: "18rem", md: "24rem" }}
          px={{ base: 6, md: 10 }}
          py={{ base: 10, md: 14 }}
          css={{
            borderRadius: "20px",
            bg: "marca.alabastro",
            borderWidth: "2px",
            borderStyle: "dashed",
            borderColor: "rgba(28, 28, 26, 0.2)",
            color: "marca.carbon",
            _hover: { bg: "marca.lino" },
            _dragging: {
              bg: "rgba(245, 203, 92, 0.22)",
              borderStyle: "solid",
              borderColor: "marca.sol",
            },
          }}
        >
          <FileUpload.DropzoneContent>
            <Text color="marca.carbon" fontSize="lg" fontWeight="medium">
              Arrastrá el comprobante o elegí un archivo
            </Text>
            <Text color="fg.muted" fontSize="sm">
              jpeg, png, webp o pdf
            </Text>
          </FileUpload.DropzoneContent>
        </FileUpload.Dropzone>
        <FileUpload.List clearable />
      </FileUpload.Root>
      <FileUpload.Root
        accept={IMAGENES}
        capture="environment"
        maxFiles={1}
        locale="es-AR"
        disabled={subiendo}
        onFileAccept={alAceptar}
        onFileReject={alRechazar}
      >
        <FileUpload.HiddenInput />
        <FileUpload.Trigger asChild>
          <Button
            type="button"
            loading={subiendo}
            loadingText="Leyendo…"
            borderRadius="full"
            px={6}
            css={{
              bg: "marca.sol",
              color: "marca.carbon",
              borderColor: "transparent",
              _hover: { bg: "#e8bc45" },
              _expanded: { bg: "#e8bc45" },
            }}
          >
            Sacar foto
          </Button>
        </FileUpload.Trigger>
      </FileUpload.Root>
    </Stack>
  )
}
