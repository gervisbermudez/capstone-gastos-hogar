import { Center, Spinner, Stack, Text } from "@chakra-ui/react"

export function Cargando({ texto }: { texto: string }) {
  return (
    <Center minH="40vh" px={4}>
      <Stack align="center" gap={3}>
        <Spinner size="lg" />
        <Text color="fg.muted">{texto}</Text>
      </Stack>
    </Center>
  )
}
