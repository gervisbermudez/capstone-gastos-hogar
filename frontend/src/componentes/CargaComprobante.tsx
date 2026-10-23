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
    <Stack gap={4}>
      <Text color="fg.muted">Un archivo por vez: jpeg, png, webp o pdf.</Text>
      {error ? (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>No se pudo cargar</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
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
        <FileUpload.Dropzone w="100%">
          <FileUpload.DropzoneContent>
            <Text>Arrastrá el comprobante o elegí un archivo</Text>
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
          <Button variant="outline" type="button" loading={subiendo} loadingText="Leyendo…">
            Sacar foto
          </Button>
        </FileUpload.Trigger>
      </FileUpload.Root>
    </Stack>
  )
}
