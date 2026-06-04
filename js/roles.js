// Modelo de roles jerárquico: cada rol incluye las capacidades del anterior.
// Este es el único punto de verdad de la jerarquía en el cliente y espeja el
// helper isAtLeast() de firestore.rules. Usar isAtLeast() en lugar de comparar
// strings sueltos evita el drift entre vistas (ej. olvidarse de sumar un rol a
// una lista de OR).

export const ROLE_PRIORITY = ["usuario", "tecnico", "supervisor", "admin", "superadmin"];

/**
 * Devuelve true si `role` es igual o superior a `minRole` en la jerarquía.
 * Un rol vacío/desconocido (o un minRole inválido) devuelve false.
 *
 * @param {string} role     Rol del usuario actual.
 * @param {string} minRole  Rol mínimo requerido.
 * @returns {boolean}
 */
export function isAtLeast(role, minRole) {
  const roleIdx = ROLE_PRIORITY.indexOf(role);
  const minIdx = ROLE_PRIORITY.indexOf(minRole);
  if (roleIdx === -1 || minIdx === -1) return false;
  return roleIdx >= minIdx;
}
