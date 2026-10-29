import { useNavigate } from "react-router"
import { ErrorApi, cliente } from "../api/cliente"
import { useSesion } from "../sesion"
import { FormularioAcceso } from "./FormularioAcceso"

export function Ingreso() {
  const { entrar } = useSesion()
  const navigate = useNavigate()

  return (
    <FormularioAcceso
      titulo="Ingresar"
      descripcion="Cargá un comprobante y preguntale por tus gastos."
      enviarEtiqueta="Ingresar"
      alterno={{ texto: "¿No tenés cuenta?", to: "/registro", etiqueta: "Crear cuenta" }}
      onEnviar={async (email, password) => {
        try {
          const token = await cliente.ingresar({ email, password })
          entrar(token.access_token)
          navigate("/", { replace: true })
        } catch (error) {
          if (error instanceof ErrorApi && error.status === 401) {
            throw new ErrorApi("Email o contraseña incorrectos.", 401)
          }
          throw error
        }
      }}
    />
  )
}
