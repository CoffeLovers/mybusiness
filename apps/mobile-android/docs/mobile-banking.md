# Bancos y biometría — app Android

## Enlace bancario y biometría (SF2-10)

### Flujo de vinculación

1. El usuario pulsa **Vincular cuenta** y elige proveedor (Plaid o Belvo).
2. La app llama `POST /banking/link-token` y recibe un `link_token` de un solo uso.
3. Se abre el widget alojado del proveedor en **Custom Tabs** con la URL `BANK_LINK_URL`
   más los parámetros `provider`, `token` y `redirect_uri`. No se usa SDK nativo.
4. Al terminar, el proveedor redirige al deep link
   `mybusiness://banking/return?public_token=...`.
5. La app captura el deep link, llama `POST /banking/exchange` y recarga las cuentas
   (`GET /banking/connections` + cuentas por conexión).
6. El estado se refleja en pantalla: institución, estado de la conexión, `lastSuccessfulSyncAt`
   por conexión y `lastSyncedAt` por cuenta.

Los tokens de vinculación nunca se registran en logs ni se persisten en claro.

### Variables de build

| Variable            | Uso                                           | Valor por defecto                           |
| ------------------- | --------------------------------------------- | ------------------------------------------- |
| `BANK_LINK_URL`     | URL del widget alojado del proveedor          | `https://app.mybusiness.local/banking/link` |
| `BANK_REDIRECT_URI` | Deep link de retorno tras completar el widget | `mybusiness://banking/return`               |
| `API_BASE_URL`      | Base de la API del backend                    | `http://10.0.2.2:3000/api/v1/`              |

Se pueden inyectar por propiedad de Gradle (`-Pbank.link.url=...`) o por variable de entorno.

### Almacenamiento de tokens

La sesión de la app se guarda cifrada en DataStore con **AES-256-GCM** y clave del
**Android Keystore** (alias `mybusiness_session_key_v1`). El formato persistido es
`v1:iv:ct` (versión, IV y ciphertext en Base64). La clave nunca sale del Keystore y no se
exporta ni se respalda.

### Biometría

- API ≥ 30: `BiometricPrompt` con `BIOMETRIC_WEAK or DEVICE_CREDENTIAL`
  (`setAllowedAuthenticators`), lo que permite huella, rostro o PIN/patrón del dispositivo.
- API < 30: fallback legacy con `BiometricPrompt` clásico y `setDeviceCredentialAllowed(true)`.
- Si no hay hardware o no hay credenciales configuradas, se informa y **no** se ejecuta la acción.

Acciones que exigen autenticación:

- `DISCONNECT_BANK` (desvincular una conexión bancaria): activa hoy.
- `CAPTURE`, `REFUND`, `APPROVE` (pagos): enumeradas y listas para el flujo de pagos, aún sin UI.

Cancelar o fallar la autenticación **no** desvincula ni ejecuta la acción.

### Limitaciones conocidas

- No hay SDK nativo de Plaid en la app: se usa el widget alojado en Custom Tabs, con el
  deep link como canal de retorno. Si el navegador no soporta Custom Tabs se abre en el
  navegador por defecto.
- Belvo está integrado en el contrato pero el backend responde **501 Not Implemented**;
  la UI mostrará el error del backend sin bloquear el resto de la pantalla.
- El refresco de la lista es manual (botón **Actualizar** y **Sincronizar** por conexión);
  no hay polling ni sincronización en segundo plano.

## Prueba manual en dispositivo/emulador

1. Crear/arrancar un emulador con **API 34**.
2. En el emulador: Ajustes → Seguridad → Huella digital, y enrolar una huella (o configurar PIN).
3. Instalar la app: `./gradlew :app:installDebug`.
4. Abrir **Cuentas bancarias** → **Vincular cuenta** → **Plaid**.
5. Completar el flujo _sandbox_ de Plaid (credenciales de prueba `user_good` / `pass_good`).
6. Verificar que la web (panel de administración) refleja la cuenta recién vinculada.
7. En la app, comprobar que la conexión muestra **Activa** y que `lastSyncedAt` se actualiza
   tras pulsar **Sincronizar**.
8. Pulsar **Desvincular** y **cancelar** la biometría: la cuenta debe seguir vinculada y
   debe aparecer el aviso de que no se desvinculó.
9. Repetir autenticando correctamente: la conexión desaparece de la lista.
10. Revisar logs sin datos sensibles:
    `adb logcat | grep -i token` (no debe aparecer ningún token de vinculación ni de sesión).
    `adb logcat | grep -i banking` (solo mensajes no sensibles).
11. Ejecutar la verificación automatizada:
    ```bash
    ./gradlew :app:testDebugUnitTest
    ./gradlew :app:assembleDebug
    ```
