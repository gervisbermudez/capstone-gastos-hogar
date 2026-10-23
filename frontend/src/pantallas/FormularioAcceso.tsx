import { Alert, Button, Card, Center, Field, Heading, Input, Stack, Text } from "@chakra-ui/react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, Navigate } from "react-router"
import { ErrorApi } from "../api/cliente"
import { Cargando } from "../componentes/Cargando"
import { useSesion } from "../sesion"

type Props = {
  titulo: string
  descripcion: string
  enviarEtiqueta: string
  alterno: { texto: string; to: string; etiqueta: string }
  onEnviar: (email: string, password: string) => Promise<void>
}

export function FormularioAcceso({ titulo, descripcion, enviarEtiqueta, alterno, onEnviar }: Props) {
  const { token, listo } = useSesion()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vivo = useRef(true)

  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  if (!listo) return <Cargando texto="Cargando la sesión" />
  if (token) return <Navigate to="/" replace />

  async function alEnviar(event: FormEvent) {
    event.preventDefault()
    if (enviando) return
    if (!email.trim() || password === "") {
      setError("Completá email y contraseña.")
      return
    }
    setEnviando(true)
    setError(null)
    try {
      await onEnviar(email.trim(), password)
    } catch (falla) {
      if (!vivo.current) return
      setError(falla instanceof ErrorApi ? falla.message : "No se pudo completar el pedido.")
    } finally {
      if (vivo.current) setEnviando(false)
    }
  }

  return (
    <Center minH="100vh" bg="bg" px={4} py={8}>
      <Card.Root w="100%" maxW="md">
        <Card.Header>
          <Heading size="lg">{titulo}</Heading>
          <Card.Description>{descripcion}</Card.Description>
        </Card.Header>
        <Card.Body>
          <form onSubmit={(event) => void alEnviar(event)}>
            <Stack gap={4}>
              {error ? (
                <Alert.Root status="error">
                  <Alert.Indicator />
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Root>
              ) : null}
              <Field.Root required>
                <Field.Label>Email</Field.Label>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field.Root>
              <Field.Root required>
                <Field.Label>Contraseña</Field.Label>
                <Input
                  type="password"
                  autoComplete={titulo === "Ingresar" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field.Root>
              <Button type="submit" loading={enviando}>
                {enviarEtiqueta}
              </Button>
              <Text fontSize="sm">
                {alterno.texto}{" "}
                <Button asChild variant="plain" size="sm" px={0}>
                  <Link to={alterno.to}>{alterno.etiqueta}</Link>
                </Button>
              </Text>
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>
    </Center>
  )
}
