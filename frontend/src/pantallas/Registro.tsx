import { useNavigate } from "react-router"
import { ErrorApi, cliente } from "../api/cliente"
import { useSesion } from "../sesion"
import { FormularioAcceso } from "./FormularioAcceso"

export function Registro() {
  const { entrar } = useSesion()
  const navigate = useNavigate()

  return (
    <FormularioAcceso
      titulo="Crear cuenta"
      descripcion="Al registrarte quedás a cargo de Mi hogar. Usá una frase larga."
      enviarEtiqueta="Crear cuenta"
      alterno={{ texto: "¿Ya tenés cuenta?", to: "/ingreso", etiqueta: "Ingresar" }}
      onEnviar={async (email, password) => {
        try {
          const token = await cliente.registrar({ email, password })
          entrar(token.access_token)
          navigate("/", { replace: true })
        } catch (error) {
          if (error instanceof ErrorApi && error.status === 409) {
            throw new ErrorApi("Ese email ya está registrado.", 409)
          }
          throw error
        }
      }}
    />
  )
}
