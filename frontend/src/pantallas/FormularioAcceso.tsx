import { Alert, Button, Card, Center, Field, Heading, Input, Stack, Text } from "@chakra-ui/react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, Navigate } from "react-router"
import { ErrorApi } from "../api/cliente"
import { EsqueletoMarco } from "../componentes/esqueleto"
import { Logotipo } from "../componentes/Logotipo"
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

  if (!listo) return <EsqueletoMarco pathname="/" />
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
    <Center minH="100vh" px={4} py={8} bg="transparent">
      <Stack align="center" gap={6} w="100%" maxW="md">
        <Logotipo tamano="md" />
        <Card.Root
          w="100%"
          size="lg"
          bg="bg.panel"
          color="fg"
          borderWidth="0"
          borderRadius="l3"
          boxShadow="0 24px 60px rgba(28, 27, 23, 0.12)"
          _dark={{ borderWidth: "1px", borderColor: "borde" }}
        >
          <Card.Header>
            <Heading
              fontFamily="heading"
              fontWeight="500"
              fontSize="2.25rem"
              letterSpacing="-0.03em"
              lineHeight="1.15"
              color="fg"
            >
              {titulo}
            </Heading>
            <Card.Description color="fg.muted">{descripcion}</Card.Description>
          </Card.Header>
          <Card.Body>
            <form onSubmit={(event) => void alEnviar(event)}>
              <Stack gap={4}>
                {error ? (
                  <Alert.Root
                    status="error"
                    alignItems="center"
                    bg="estado.fallaFondo"
                    color="marca.carbon"
                    borderWidth="1px"
                    borderStyle="solid"
                    borderColor="estado.falla"
                    borderRadius="16px"
                  >
                    <Alert.Indicator color="estado.falla" />
                    <Alert.Description color="marca.carbon">{error}</Alert.Description>
                  </Alert.Root>
                ) : null}
                <Field.Root required>
                  <Field.Label color="fg" fontWeight="medium">
                    Email
                  </Field.Label>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field.Root>
                <Field.Root required>
                  <Field.Label color="fg" fontWeight="medium">
                    Contraseña
                  </Field.Label>
                  <Input
                    type="password"
                    autoComplete={titulo === "Ingresar" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field.Root>
                <Button
                  type="submit"
                  loading={enviando}
                  w="100%"
                  borderRadius="full"
                  fontWeight="600"
                  bg="marca.sol"
                  color="marca.carbon"
                  _hover={{ bg: "#e8bc45", color: "marca.carbon" }}
                  _active={{ bg: "#e8bc45", color: "marca.carbon" }}
                >
                  {enviarEtiqueta}
                </Button>
                <Text fontSize="sm" color="fg">
                  {alterno.texto}{" "}
                  <Text
                    asChild
                    display="inline"
                    fontSize="sm"
                    fontWeight="600"
                    color="fg"
                    textDecoration="underline"
                    textUnderlineOffset="3px"
                    textDecorationColor="fg"
                    _hover={{ color: "fg", textDecorationColor: "fg" }}
                    _active={{ color: "fg", textDecorationColor: "fg" }}
                  >
                    <Link to={alterno.to}>{alterno.etiqueta}</Link>
                  </Text>
                </Text>
              </Stack>
            </form>
          </Card.Body>
        </Card.Root>
      </Stack>
    </Center>
  )
}
