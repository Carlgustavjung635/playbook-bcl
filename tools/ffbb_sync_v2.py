#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ffbb_sync_v2.py — Scraper des rencontres d'un championnat FFBB.

But
---
Script autonome (lancé manuellement par le coach) qui interroge l'API privée
FFBB via la librairie `ffbb-api-client-v2`, retrouve un championnat par son nom,
et exporte toutes les rencontres (date, équipes, salle, officiels) en JSON + CSV.

C'est une étape de VALIDATION : on regarde la vraie structure des données avant
de l'intégrer proprement (n8n cron -> Supabase, ou edge function). Rien n'est
écrit dans la base ici, uniquement des fichiers locaux dans tools/output/.

Prérequis
---------
    pip install ffbb-api-client-v2          (testé avec la v1.4.0)
    Python >= 3.10

Auth
----
`TokenManager.get_tokens()` résout les jetons tout seul :
  - soit depuis des variables d'environnement (si définies),
  - soit depuis l'endpoint public de configuration FFBB.
=> Aucun secret à coder en dur ici. Voir README_FFBB_SYNC.md pour les variables
   d'environnement optionnelles.

Usage
-----
    python tools/ffbb_sync_v2.py

Sorties (voir OUTPUT_DIR plus bas) :
    tools/output/matches_AAAAMMJJ.json
    tools/output/matches_AAAAMMJJ.csv
"""

from __future__ import annotations

import csv
import datetime as _dt
import json
import logging
import time
from pathlib import Path
from typing import Any, Iterable, Optional

# La librairie est importée paresseusement dans get_client() pour qu'un simple
# `import ffbb_sync_v2` (ou --help) ne plante pas si elle n'est pas installée.

# ---------------------------------------------------------------------------
# CONFIGURATION (à éditer par le coach)
# ---------------------------------------------------------------------------

# Nom (ou fragment de nom) du championnat à scraper. La recherche est "floue"
# côté FFBB (Meilisearch) : un fragment suffit souvent. Le script affiche tous
# les championnats candidats trouvés -> ajustez cette variable si besoin.
#
# Exemples observés sur la FFBB :
#   "Régionale Masculine 2"
#   "U18 Région Féminin"          <- probable pour le BCL (équipe féminine U18)
#   "U18 Régional Féminin"
#   "Championnat Régional U18 F"
CHAMPIONNAT_NAME: str = "U18 Région Féminin"

# Filtre optionnel sur le nom de poule (sous-ensemble du championnat).
# Laissez None pour récupérer TOUTES les poules du championnat trouvé.
# Exemple : "Poule A"
POULE_NAME_FILTER: Optional[str] = None

# Dossier de sortie (créé si absent).
OUTPUT_DIR: Path = Path(__file__).resolve().parent / "output"

# Nombre max de rencontres récupérées par poule (garde-fou).
MAX_RENCONTRES_PAR_POULE: int = 1000

# Paramètres du retry sur l'appel API principal.
RETRY_ATTEMPTS: int = 3
RETRY_BACKOFF_BASE_S: float = 2.0  # 2s, 4s, 8s...

# ---------------------------------------------------------------------------
# LOGGER
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ffbb_sync_v2")


# ---------------------------------------------------------------------------
# OUTILS BAS NIVEAU
# ---------------------------------------------------------------------------

def _first_attr(obj: Any, names: Iterable[str], default: Any = None) -> Any:
    """Renvoie le premier attribut non vide parmi `names` (tolérant au None).

    Sert à absorber les différences de nommage entre les objets Meilisearch
    (ex: `nom_equipe1`) et d'éventuels objets Directus (ex: `equipe1`).
    """
    if obj is None:
        return default
    for name in names:
        val = getattr(obj, name, None)
        if val not in (None, "", [], {}):
            return val
    return default


def _call_with_retry(func, *args, **kwargs) -> Any:
    """Appelle `func` avec retry + backoff exponentiel simple.

    Réessaie sur toute exception (timeout réseau, 5xx, rate-limit...) jusqu'à
    RETRY_ATTEMPTS fois, puis relance la dernière exception.
    """
    last_exc: Optional[BaseException] = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            return func(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 (on veut tout attraper pour retry)
            last_exc = exc
            if attempt == RETRY_ATTEMPTS:
                break
            wait = RETRY_BACKOFF_BASE_S ** attempt
            logger.warning(
                "Appel API échoué (tentative %d/%d) : %s — nouvelle tentative dans %.0fs",
                attempt, RETRY_ATTEMPTS, exc, wait,
            )
            time.sleep(wait)
    assert last_exc is not None
    raise last_exc


def _to_iso(value: Any) -> Optional[str]:
    """Normalise une date (datetime, str ISO, ou None) en chaîne ISO 8601."""
    if value is None:
        return None
    if isinstance(value, (_dt.datetime, _dt.date)):
        return value.isoformat()
    # Déjà une chaîne (ou autre) : on renvoie tel quel en string.
    return str(value)


# ---------------------------------------------------------------------------
# CLIENT
# ---------------------------------------------------------------------------

def get_client() -> Any:
    """Instancie le client FFBB authentifié.

    Récupère les jetons via TokenManager puis crée le FFBBAPIClientV2.
    Lève une exception explicite si la librairie n'est pas installée.
    """
    try:
        from ffbb_api_client_v2 import FFBBAPIClientV2, TokenManager
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "La librairie 'ffbb-api-client-v2' est introuvable.\n"
            "Installez-la avec : pip install ffbb-api-client-v2"
        ) from exc

    logger.info("Récupération des jetons FFBB (TokenManager)...")
    tokens = _call_with_retry(TokenManager.get_tokens)

    logger.info("Initialisation du client FFBBAPIClientV2...")
    client = FFBBAPIClientV2.create(
        api_bearer_token=tokens.api_token,
        meilisearch_bearer_token=tokens.meilisearch_token,
    )
    return client


# ---------------------------------------------------------------------------
# RECHERCHE DU CHAMPIONNAT
# ---------------------------------------------------------------------------

def find_competition(client: Any, name: str) -> Optional[Any]:
    """Cherche un championnat par nom et renvoie le meilleur candidat.

    Renvoie un objet `CompetitionsHit` (qui porte la liste `.poules`), ou None
    si rien ne correspond. Tous les candidats sont journalisés pour permettre
    au coach d'ajuster CHAMPIONNAT_NAME.
    """
    logger.info("Recherche du championnat : %r", name)
    result = _call_with_retry(client.search_competitions, name, limit=25)

    hits = getattr(result, "hits", None) or []
    if not hits:
        logger.error("Aucun championnat trouvé pour %r.", name)
        return None

    logger.info("%d championnat(s) candidat(s) :", len(hits))
    for hit in hits:
        nb_poules = len(getattr(hit, "poules", None) or [])
        logger.info(
            "  - id=%s | %s | sexe=%s | %d poule(s)",
            getattr(hit, "id", "?"),
            getattr(hit, "nom", "?"),
            getattr(hit, "sexe", "?"),
            nb_poules,
        )

    # Heuristique de sélection : correspondance exacte (insensible à la casse)
    # en priorité, sinon le premier hit qui contient le nom recherché, sinon le
    # tout premier renvoyé par l'API (déjà trié par pertinence).
    lname = name.strip().lower()
    exact = [h for h in hits if (getattr(h, "nom", "") or "").strip().lower() == lname]
    contains = [h for h in hits if lname in (getattr(h, "nom", "") or "").lower()]
    chosen = (exact or contains or hits)[0]

    logger.info(
        "Championnat retenu : %r (id=%s)",
        getattr(chosen, "nom", "?"), getattr(chosen, "id", "?"),
    )
    return chosen


def _poules_of(competition: Any) -> list[Any]:
    """Renvoie la liste des poules du championnat, filtrée par POULE_NAME_FILTER."""
    poules = list(getattr(competition, "poules", None) or [])
    if POULE_NAME_FILTER:
        lf = POULE_NAME_FILTER.strip().lower()
        poules = [p for p in poules if lf in (getattr(p, "nom", "") or "").lower()]
        logger.info("Filtre poule %r -> %d poule(s) retenue(s).", POULE_NAME_FILTER, len(poules))
    return poules


# ---------------------------------------------------------------------------
# RÉCUPÉRATION DES RENCONTRES
# ---------------------------------------------------------------------------

def _id_value(obj: Any) -> Optional[str]:
    """Extrait un id sous forme de chaîne, que `obj` soit déjà un id ou un objet `.id`."""
    if obj is None:
        return None
    if isinstance(obj, (str, int)):
        return str(obj)
    inner = getattr(obj, "id", None)
    return str(inner) if inner is not None else None


def fetch_rencontres(client: Any, competition: Any) -> list[Any]:
    """Récupère toutes les rencontres du championnat.

    Stratégie en deux temps (robuste aux évolutions de la lib) :
      1) PRINCIPAL — Meilisearch `search_rencontres` filtré par poule. Renvoie
         des objets `RencontresHit` dont les champs sont connus et stables.
      2) REPLI — si (1) ne renvoie rien ou échoue, `list_rencontres_by_poules`
         (voie Directus). Les objets peuvent avoir un nommage différent, mais
         `extract_match()` est défensif et gère les deux.
    """
    poules = _poules_of(competition)
    if not poules:
        logger.error("Le championnat retenu n'a aucune poule exploitable.")
        return []

    poule_ids = [pid for pid in (_id_value(p) for p in poules) if pid]
    logger.info("%d poule(s) à interroger : %s", len(poule_ids), poule_ids)

    rencontres: list[Any] = []

    # --- 1) Voie principale : Meilisearch, filtre par poule -----------------
    for poule in poules:
        pid = _id_value(poule)
        pnom = getattr(poule, "nom", "?")
        if not pid:
            continue
        hits = _search_rencontres_for_poule(client, pid)
        logger.info("Poule %r (id=%s) : %d rencontre(s).", pnom, pid, len(hits))
        rencontres.extend(hits)

    if rencontres:
        return rencontres

    # --- 2) Repli : Directus, par ids de poules -----------------------------
    logger.warning(
        "Aucune rencontre via Meilisearch — bascule sur list_rencontres_by_poules (Directus)."
    )
    try:
        ids_int = [int(p) for p in poule_ids if str(p).isdigit()]
        if ids_int:
            fallback = _call_with_retry(
                client.list_rencontres_by_poules,
                ids_int,
                limit=MAX_RENCONTRES_PAR_POULE * max(1, len(ids_int)),
            )
            rencontres = list(fallback or [])
            logger.info("Voie de repli : %d rencontre(s).", len(rencontres))
    except Exception as exc:  # noqa: BLE001
        logger.error("La voie de repli a aussi échoué : %s", exc)

    return rencontres


def _search_rencontres_for_poule(client: Any, poule_id: str) -> list[Any]:
    """Recherche Meilisearch des rencontres d'une poule.

    Essaie plusieurs expressions de filtre (le nom exact de l'attribut filtrable
    peut varier selon l'index FFBB) ; en dernier recours, recherche sans filtre
    puis post-filtre côté Python sur l'id de poule des hits.
    """
    filter_candidates = [
        [f'id_poule = "{poule_id}"'],
        [f'id_poule.id = "{poule_id}"'],
        [f"id_poule = {poule_id}"],
    ]
    for flt in filter_candidates:
        try:
            res = _call_with_retry(
                client.search_rencontres,
                None,
                filter=flt,
                limit=MAX_RENCONTRES_PAR_POULE,
            )
            hits = getattr(res, "hits", None) or []
            if hits:
                return hits
        except Exception as exc:  # noqa: BLE001 (filtre invalide -> on tente le suivant)
            logger.debug("Filtre %s refusé (%s), tentative suivante.", flt, exc)

    # Dernier recours : pas de filtre serveur, on filtre nous-mêmes.
    try:
        res = _call_with_retry(client.search_rencontres, None, limit=MAX_RENCONTRES_PAR_POULE)
        hits = getattr(res, "hits", None) or []
        return [h for h in hits if _id_value(getattr(h, "id_poule", None)) == str(poule_id)]
    except Exception as exc:  # noqa: BLE001
        logger.debug("Recherche sans filtre échouée pour la poule %s : %s", poule_id, exc)
        return []


# ---------------------------------------------------------------------------
# EXTRACTION D'UNE RENCONTRE
# ---------------------------------------------------------------------------

def _extract_salle(rencontre: Any) -> dict[str, Optional[str]]:
    """Extrait les infos de salle (nom + adresse + commune), tolérant au None."""
    salle = getattr(rencontre, "salle", None)
    if salle is None:
        # Repli : certains objets exposent un nom de salle à plat.
        flat = _first_attr(rencontre, ["nom_salle", "gymnase", "lieu"])
        return {"nom": flat, "adresse": None, "commune": None}

    nom = _first_attr(salle, ["libelle", "libelle2", "nom", "name"])
    adresse = _first_attr(salle, ["adresse", "address"])
    commune_obj = getattr(salle, "commune", None)
    commune = _first_attr(commune_obj, ["libelle", "nom", "name"]) if commune_obj else None
    return {"nom": nom, "adresse": adresse, "commune": commune}


def _extract_officiels(rencontre: Any) -> list[str]:
    """Extrait la liste des officiels/arbitres désignés.

    Renvoie TOUJOURS une liste (vide si non désignés) — jamais None, pas de crash.
    Priorité : `officiels` (list[str]) -> `officiels_string` (séparé par ';' ou ',')
    -> alias possibles côté Directus (`arbitres`, `referees`, `designations`).
    """
    officiels = _first_attr(rencontre, ["officiels", "arbitres", "referees", "designations"])
    if isinstance(officiels, list):
        return [str(o).strip() for o in officiels if o not in (None, "")]

    # Forme "chaîne" : on découpe sur ; ou ,
    raw = _first_attr(rencontre, ["officiels_string"]) or (
        officiels if isinstance(officiels, str) else None
    )
    if isinstance(raw, str) and raw.strip():
        sep = ";" if ";" in raw else ","
        return [part.strip() for part in raw.split(sep) if part.strip()]

    return []


def extract_match(rencontre: Any) -> dict[str, Any]:
    """Transforme un objet rencontre brut en dict structuré et propre.

    Ne lève jamais d'exception sur un champ manquant : tous les accès passent
    par des fallbacks. Champs absents -> None (ou [] pour les officiels).
    """
    # Date : on préfère la date de rencontre, sinon la date générique.
    date_obj = _first_attr(rencontre, ["date_rencontre", "date"])
    date_iso = _to_iso(date_obj)

    salle = _extract_salle(rencontre)

    return {
        "id": _id_value(getattr(rencontre, "id", None)),
        "date": date_iso,                                   # jour + heure (ISO 8601)
        "heure": _first_attr(rencontre, ["horaire"]),       # ex "20:30" si fourni
        "journee": _first_attr(rencontre, ["numero_journee", "journee"]),
        "equipe_domicile": _first_attr(
            rencontre, ["nom_equipe1", "equipe1", "equipe_domicile", "home_team"]
        ),
        "equipe_exterieur": _first_attr(
            rencontre, ["nom_equipe2", "equipe2", "equipe_exterieur", "away_team"]
        ),
        "salle": salle["nom"],
        "salle_adresse": salle["adresse"],
        "salle_commune": salle["commune"],
        "officiels": _extract_officiels(rencontre),         # liste (vide si aucun)
        "score_domicile": _first_attr(rencontre, ["resultat_equipe1"]),
        "score_exterieur": _first_attr(rencontre, ["resultat_equipe2"]),
        "joue": getattr(rencontre, "joue", None),
        "id_poule": _id_value(getattr(rencontre, "id_poule", None)),
    }


# ---------------------------------------------------------------------------
# EXPORTS
# ---------------------------------------------------------------------------

# Colonnes du CSV (ordre stable). Les listes (officiels) sont aplaties.
CSV_COLUMNS: list[str] = [
    "id", "date", "heure", "journee",
    "equipe_domicile", "equipe_exterieur",
    "salle", "salle_adresse", "salle_commune",
    "officiels", "score_domicile", "score_exterieur", "joue", "id_poule",
]


def export_json(matches: list[dict[str, Any]], path: Path) -> None:
    """Écrit les rencontres en JSON (UTF-8, indenté, accents préservés)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(matches, fh, ensure_ascii=False, indent=2)
    logger.info("JSON écrit : %s (%d rencontres)", path, len(matches))


def export_csv(matches: list[dict[str, Any]], path: Path) -> None:
    """Écrit les rencontres en CSV (UTF-8 avec BOM pour Excel FR)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig => Excel ouvre correctement les accents.
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for match in matches:
            row = dict(match)
            # Aplatit la liste d'officiels en une cellule lisible.
            if isinstance(row.get("officiels"), list):
                row["officiels"] = " ; ".join(row["officiels"])
            writer.writerow(row)
    logger.info("CSV écrit : %s (%d rencontres)", path, len(matches))


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main() -> int:
    """Point d'entrée : auth -> recherche -> extraction -> export. Renvoie un code de sortie."""
    logger.info("=== FFBB sync v2 — championnat : %r ===", CHAMPIONNAT_NAME)

    try:
        client = get_client()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("Impossible d'initialiser le client FFBB : %s", exc)
        return 2

    competition = find_competition(client, CHAMPIONNAT_NAME)
    if competition is None:
        logger.error("Arrêt : championnat introuvable. Ajustez CHAMPIONNAT_NAME.")
        return 1

    rencontres = fetch_rencontres(client, competition)
    if not rencontres:
        logger.error("Aucune rencontre récupérée. Arrêt.")
        return 1

    # Extraction défensive, une rencontre à la fois : un match malformé est
    # journalisé puis ignoré, sans interrompre le reste.
    matches: list[dict[str, Any]] = []
    erreurs = 0
    for i, rencontre in enumerate(rencontres):
        try:
            matches.append(extract_match(rencontre))
        except Exception as exc:  # noqa: BLE001
            erreurs += 1
            logger.warning("Rencontre #%d ignorée (extraction impossible) : %s", i, exc)

    if erreurs:
        logger.warning("%d rencontre(s) ignorée(s) sur %d.", erreurs, len(rencontres))

    # Tri par date pour une sortie lisible (les None en fin).
    matches.sort(key=lambda m: (m.get("date") is None, m.get("date") or ""))

    stamp = _dt.datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"matches_{stamp}.json"
    csv_path = OUTPUT_DIR / f"matches_{stamp}.csv"

    export_json(matches, json_path)
    export_csv(matches, csv_path)

    logger.info("=== Terminé : %d rencontre(s) exportée(s). ===", len(matches))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# ===========================================================================
# NOTES D'ADAPTATION (si la lib évolue ou si la structure diffère)
# ===========================================================================
#
# Vérifié sur ffbb-api-client-v2 == 1.4.0 (introspection des dataclasses).
#
# 1) WRAPPER `.hits`
#    - search_competitions(...) -> CompetitionsMultiSearchResult, champ `.hits`
#      (liste de CompetitionsHit). Chaque hit : .nom, .id, .code, .sexe,
#      .categorie, .poules (liste de Poule -> .id, .nom, .engagements).
#    - search_rencontres(...) -> RencontresMultiSearchResult, champ `.hits`
#      (liste de RencontresHit).
#    Si une future version renomme `.hits`, adaptez getattr(result, "hits", ...)
#    dans find_competition() et _search_rencontres_for_poule().
#
# 2) ATTRIBUTS D'UNE RENCONTRE (RencontresHit, Meilisearch) — noms RÉELS v1.4.0 :
#       date_rencontre : datetime   (jour + heure)   <- utilisé en priorité
#       date           : datetime                    <- repli
#       horaire        : str                         (ex "20:30")
#       nom_equipe1    : str  (domicile)
#       nom_equipe2    : str  (extérieur)
#       numero_journee : int
#       salle          : Salle  -> .libelle (nom), .adresse, .commune (Commune)
#       officiels      : list[str]                   <- arbitres désignés
#       officiels_string : str                       (repli, séparé par ';')
#       resultat_equipe1 / resultat_equipe2 : str    (scores)
#       id_poule       : objet -> .id
#    extract_match() lit ces noms EN PREMIER, avec des alias de repli
#    (equipe1/equipe_domicile/home_team, arbitres/referees/designations, etc.)
#    au cas où la voie de repli Directus renvoie un autre nommage.
#
# 3) CHAMP "OFFICIELS"
#    Ordre d'essai : officiels (list) > officiels_string (str) > arbitres >
#    referees > designations. _extract_officiels() renvoie TOUJOURS une liste
#    (vide si non désignés) — jamais None.
#
# 4) RÉCUPÉRATION DES RENCONTRES D'UN CHAMPIONNAT
#    Voie principale : search_rencontres(filter=['id_poule = "<id>"']).
#    Le nom exact de l'attribut filtrable Meilisearch peut différer ; plusieurs
#    variantes sont tentées, puis un repli sans filtre + post-filtre Python.
#    Voie de secours : client.list_rencontres_by_poules([ids_int]).
#    Autres méthodes utiles si besoin : client.get_poule(poule_id) (rencontres
#    + classement en profondeur), client.get_competition(competition_id).
