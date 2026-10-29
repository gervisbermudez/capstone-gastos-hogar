import { Center, Spinner, Stack, Text } from "@chakra-ui/react"
import { Logotipo } from "./Logotipo"

export function Cargando({ texto, completo = false }: { texto: string; completo?: boolean }) {
  if (completo) {
    return (
      <Center minH="100vh" w="100%" px={4} bg="transparent">
        <Stack align="center" gap={8}>
          <Logotipo tamano="md" />
          <Spinner size="lg" color="marca.carbon" />
          <Text color="marca.carbon" textAlign="center">
            {texto}
          </Text>
        </Stack>
      </Center>
    )
  }

  return (
    <Center minH="40vh" w="100%" px={4} bg="transparent">
      <Stack align="center" gap={3}>
        <Spinner size="lg" color="marca.carbon" />
        <Text color="marca.carbon" textAlign="center">
          {texto}
        </Text>
      </Stack>
    </Center>
  )
}
