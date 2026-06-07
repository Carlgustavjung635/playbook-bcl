# FFBB Sync v2 — scraper des rencontres d'un championnat

Script Python **autonome** (`ffbb_sync_v2.py`) pour récupérer les rencontres d'un
championnat FFBB et les exporter en **JSON + CSV**. Étape de validation manuelle
avant intégration (n8n cron → Supabase, ou edge function). **N'écrit rien dans la
base** — uniquement des fichiers dans `tools/output/`.

Basé sur la librairie [`ffbb-api-client-v2`](https://pypi.org/project/ffbb-api-client-v2/)
(testé avec la **v1.4.0**).

## 1. Installation

```bash
pip install ffbb-api-client-v2
```

Python ≥ 3.10 requis. Sur Windows, si `pip` n'est pas dans le PATH :

```powershell
python -m pip install ffbb-api-client-v2
```

## 2. Lancer

Depuis la racine du repo :

```bash
python tools/ffbb_sync_v2.py
```

Le script journalise (logging) chaque étape : récupération des jetons, championnats
candidats trouvés, championnat retenu, nombre de rencontres par poule, fichiers écrits.

## 3. Sorties

Deux fichiers horodatés (`AAAAMMJJ`) dans `tools/output/` :

| Fichier | Usage |
|---|---|
| `matches_AAAAMMJJ.json` | structuré, fidèle (officiels = liste), pour intégration |
| `matches_AAAAMMJJ.csv`  | tableur (UTF-8 + BOM → s'ouvre direct dans Excel FR) |

Champs exportés par rencontre :

```
id, date (ISO 8601, jour+heure), heure, journee,
equipe_domicile, equipe_exterieur,
salle, salle_adresse, salle_commune,
officiels (liste — vide si non désignés), score_domicile, score_exterieur,
joue, id_poule
```

## 4. Changer de championnat

Éditez les variables en haut de `tools/ffbb_sync_v2.py` :

```python
CHAMPIONNAT_NAME = "U18 Région Féminin"   # nom ou fragment ; recherche floue
POULE_NAME_FILTER = None                  # ex "Poule A" pour une seule poule
```

La recherche FFBB est **floue** (Meilisearch) : un fragment suffit souvent. Le script
**liste tous les championnats candidats** dans les logs — si le mauvais est retenu,
copiez le nom exact affiché dans `CHAMPIONNAT_NAME`. Exemples de noms observés :

- `Régionale Masculine 2`
- `U18 Région Féminin` _(probable pour le BCL)_
- `U18 Régional Féminin`
- `Championnat Régional U18 F`

## 5. Authentification

**Rien à fournir.** `TokenManager.get_tokens()` résout les jetons automatiquement :

1. depuis des **variables d'environnement** si définies, sinon
2. depuis l'**endpoint public de configuration FFBB**.

Les données de compétition/calendrier sont **publiques** → aucun identifiant requis.
Si une future version de la lib exige des jetons explicites, définissez-les en variables
d'environnement (voir le README de la lib) — **ne pas** les coder en dur dans le script.

## 6. Robustesse intégrée

- **Retry** (3 tentatives, backoff exponentiel 2s/4s/8s) sur les appels API.
- **try/except par rencontre** : un match malformé est journalisé et ignoré, le reste passe.
- **Officiels** : toujours une liste (`[]` si non désignés), jamais de crash `NoneType`.
- **Encodage UTF-8** explicite (JSON `ensure_ascii=False`, CSV `utf-8-sig`) → accents OK.
- **Double voie** de récupération : Meilisearch (`search_rencontres`) puis repli Directus
  (`list_rencontres_by_poules`) ; `extract_match()` gère les deux nommages.

## 7. Si la structure des données diffère

Voir la section **NOTES D'ADAPTATION** en fin de `ffbb_sync_v2.py` : noms réels des
champs en v1.4.0 (`nom_equipe1`, `date_rencontre`, `salle.libelle`, `officiels`…),
le wrapper `.hits`, les alias de repli, et les méthodes alternatives du client
(`get_poule`, `get_competition`).

## 8. Prochaines étapes (hors périmètre de ce script)

Une fois la structure validée sur les exports : brancher la même logique dans un
cron n8n qui pousse vers Supabase, ou une edge function. Ce script reste l'outil de
diagnostic/validation manuel.
