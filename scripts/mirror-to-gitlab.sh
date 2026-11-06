#!/usr/bin/env bash
#
# mirror-to-gitlab.sh — Espeja GitHub (origin) hacia GitLab (gitlab) — MIG-08 (#141)
#
# - Empuja todas las ramas de `origin` a `gitlab` conservando el nombre.
# - Excluye `origin/HEAD` y las ramas protegidas (`main`, `develop`), que en
#   GitLab solo aceptan cambios vía MR: para ellas se publica una rama temporal
#   `sync/<rama>-<timestamp>` y se avisa de que hay que abrir el MR.
# - No borra ramas en GitLab ni usa --force: si una rama diverge, se reporta y
#   el script termina en error para revisarlo a mano.
#
# Uso:
#   ./scripts/mirror-to-gitlab.sh           # espejo real
#   ./scripts/mirror-to-gitlab.sh --dry-run # solo muestra lo que haría
#
# Requisitos: git con acceso SSH a ambos remotos y permiso de push en GitLab.

set -euo pipefail

readonly ORIGIN_REMOTE="origin"
readonly GITLAB_REMOTE="gitlab"
readonly PROTECTED_BRANCHES=("main" "develop")

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ $# -gt 0 ]]; then
  echo "ERROR: argumento desconocido '$1'. Uso: $0 [--dry-run]" >&2
  exit 2
fi

log() { printf '%s\n' "$*"; }
fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run() {
  if [[ "$DRY_RUN" == true ]]; then
    log "  [dry-run] $*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# 0. Comprobaciones de remotos
# ---------------------------------------------------------------------------
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "no es un repositorio git"

if ! git remote get-url "$GITLAB_REMOTE" >/dev/null 2>&1; then
  fail "no existe el remoto '$GITLAB_REMOTE'. Añádelo con:
       git remote add gitlab git@gitlab.com:coffelovers2/mybusiness.git"
fi

if ! git remote get-url "$ORIGIN_REMOTE" >/dev/null 2>&1; then
  fail "no existe el remoto '$ORIGIN_REMOTE' (se espera GitHub)."
fi

log "Remoto origen : $ORIGIN_REMOTE -> $(git remote get-url "$ORIGIN_REMOTE")"
log "Remoto destino: $GITLAB_REMOTE -> $(git remote get-url "$GITLAB_REMOTE")"
[[ "$DRY_RUN" == true ]] && log "Modo: dry-run (no se escribe nada)"
log ""

# ---------------------------------------------------------------------------
# 1. Actualizar referencias locales de origin
# ---------------------------------------------------------------------------
log "Actualizando referencias de $ORIGIN_REMOTE..."
git fetch "$ORIGIN_REMOTE" --prune --tags
log ""

# ---------------------------------------------------------------------------
# 2. Clasificar ramas remotas
# ---------------------------------------------------------------------------
is_protected() {
  local branch="$1"
  local protected
  for protected in "${PROTECTED_BRANCHES[@]}"; do
    [[ "$branch" == "$protected" ]] && return 0
  done
  return 1
}

declare -a SYNCED=()
declare -a SKIPPED=()
declare -a TEMP_BRANCHES=()
declare -a FAILED=()

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

while IFS= read -r ref; do
  [[ -z "$ref" ]] && continue

  branch="${ref#refs/remotes/${ORIGIN_REMOTE}/}"

  # `origin/HEAD` es un puntero simbólico, no una rama.
  [[ "$branch" == "HEAD" ]] && continue

  if is_protected "$branch"; then
    temp_branch="sync/${branch}-${TIMESTAMP}"

    # Si GitLab ya tiene el mismo SHA no hace falta rama temporal.
    origin_sha="$(git rev-parse "$ref")"
    gitlab_sha="$(git ls-remote --heads "$GITLAB_REMOTE" "refs/heads/${branch}" | cut -f1)"
    if [[ -n "$gitlab_sha" && "$gitlab_sha" == "$origin_sha" ]]; then
      SKIPPED+=("$branch (protegida, ya sincronizada)")
      continue
    fi

    log "Rama protegida '$branch': se publica como '$temp_branch' para abrir MR"
    if run git push "$GITLAB_REMOTE" "${ref}:refs/heads/${temp_branch}"; then
      TEMP_BRANCHES+=("${temp_branch}:${branch}")
    else
      FAILED+=("$branch")
    fi
    continue
  fi

  log "Sincronizando '$branch'..."
  if run git push "$GITLAB_REMOTE" "${ref}:refs/heads/${branch}"; then
    SYNCED+=("$branch")
  else
    FAILED+=("$branch")
  fi
done < <(git for-each-ref --format='%(refname)' "refs/remotes/${ORIGIN_REMOTE}")

# ---------------------------------------------------------------------------
# 3. Resumen
# ---------------------------------------------------------------------------
log ""
log "================ RESUMEN DE ESPEJO GITHUB -> GITLAB ================"
log "Ramas sincronizadas directamente: ${#SYNCED[@]}"
for branch in "${SYNCED[@]:-}"; do
  [[ -n "$branch" ]] && log "  - $branch"
done

log "Ramas protegidas pendientes de MR: ${#TEMP_BRANCHES[@]}"
for entry in "${TEMP_BRANCHES[@]:-}"; do
  [[ -z "$entry" ]] && continue
  temp_branch="${entry%%:*}"
  target="${entry##*:}"
  log "  - $temp_branch  -> abrir MR en GitLab contra '$target'"
done

if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  log "Omitidas:"
  for item in "${SKIPPED[@]}"; do
    log "  - $item"
  done
fi

log "==================================================================="
log ""
log "Recordatorio:"
log "  1. Abre MR en GitLab para cada rama 'sync/*' (los merges a main/develop"
log "     no se hacen por push directo)."
log "  2. Verifica los SHA tras el merge:"
log "     git fetch gitlab --prune && git rev-parse origin/develop gitlab/develop"
log "  3. main solo avanza por fast-forward desde develop."

if [[ ${#FAILED[@]} -gt 0 ]]; then
  log ""
  printf 'ERROR: no se pudieron empujar %d rama(s):\n' "${#FAILED[@]}" >&2
  for branch in "${FAILED[@]}"; do
    printf '  - %s\n' "$branch" >&2
  done
  printf 'Resuelve la divergencia manualmente (rebase/merge desde origin) y reintenta.\n' >&2
  exit 1
fi

log ""
log "Espejo completado."
