# Aperçus (vignettes) des vidéos — Instagram, TikTok, Vimeo, YouTube

_v.102 — 2 août 2026_

## Le symptôme

Sur l'écran **PLAYS** (et le carrousel Playbook de l'accueil), une carte dont la
vidéo est un **reel Instagram** affichait un carré gris quasi vide, avec un
minuscule ▶ en haut à gauche. La même carte avec une vidéo **YouTube** affichait
correctement la capture de la vidéo.

## Le diagnostic

Il n'y avait **aucun mécanisme** de récupération de vignette Instagram : ni
proxy, ni oEmbed, ni scraping. `parseVideo()` renvoyait simplement
`thumb: null` pour Instagram (comme pour Vimeo et TikTok), et `playTile()`
tombait alors sur son placeholder générique.

Pourquoi YouTube marche : YouTube publie sa vignette à une **URL déterministe**
(`https://img.youtube.com/vi/<id>/hqdefault.jpg`). Aucun appel réseau, aucune
autorisation. Instagram n'offre rien d'équivalent :

| Piste | Réponse réelle (vérifiée le 2026-08-02) |
| --- | --- |
| `api.instagram.com/oembed/?url=…` (l'oEmbed public historique) | Retiré par Meta en **octobre 2020**. Répond aujourd'hui une **page HTML de connexion**, plus du JSON. |
| `graph.facebook.com/v21.0/instagram_oembed?url=…` | **HTTP 403** — `(#200) Provide valid app ID`. Exige un **jeton d'app Facebook**. |
| Scraper l'`og:image` de `instagram.com/p/<id>/` ou de `/embed/captioned/` | **HTTP 200 mais mur de connexion Facebook** : zéro balise `og:image`, zéro `display_url`. C'est la réponse servie à toute IP serveur (donc aussi à Netlify). |
| Fetch direct depuis le navigateur | Impossible : Instagram n'envoie aucun en-tête CORS, et le navigateur ne peut pas surcharger le `User-Agent`. |

**Conclusion : il n'existe aucune voie gratuite et fiable vers une vignette
Instagram.** La seule voie officielle est l'oEmbed Meta, qui exige un jeton.

## Le correctif livré

### 1. Une fonction serveur : `/api/video-thumb`

`netlify/functions/video-thumb.js` — répond `{ ok, provider, thumb, source }`.

- **Vimeo** → oEmbed public `vimeo.com/api/oembed.json`. Marche **tout de
  suite**, sans jeton.
- **TikTok** → oEmbed public `tiktok.com/oembed`. Idem.
- **Instagram** → oEmbed officiel Meta **si** la variable d'environnement
  `FB_OEMBED_TOKEN` est posée ; sinon repli best-effort sur l'`og:image`
  (documenté comme quasi toujours bloqué), puis réponse propre
  `{ ok:false, reason:'instagram-token-absent' }`.
- **YouTube** → vignette déterministe (le front n'appelle même pas).

Garde-fous : liste blanche d'hôtes (anti-SSRF), timeout 6 s, réponse toujours
en HTTP 200 (le front lit `ok`), cache CDN court pour Instagram — **ses URL de
vignette sont signées et expirent**.

### 2. Côté application

- Les tuiles dont la vignette exige un aller-retour portent `data-vthumb="<url>"` ;
  `_hydrateVideoThumbs()` (appelé à la fin de chaque rendu) résout la vignette,
  puis l'injecte **seulement si l'image charge vraiment** — une URL expirée ne
  laisse jamais une image cassée.
- Cache local `pb8_video_thumbs` : TTL 6 h en cas de succès, **1 h en cas
  d'échec** (cache négatif : on ne martèle ni Instagram ni la fonction), borné à
  200 entrées.
- **Placeholder de marque** quand il n'y a pas de vignette : dégradé aux
  couleurs du réseau, glyphe + nom du réseau, gros ▶ et **titre du play**. Il
  remplace le carré gris. Il s'applique aussi aux petites tuiles carrées
  (vidéos de prépa match, focus).

## Action éventuelle : activer les vraies vignettes Instagram

Rien à recoder — juste une variable d'environnement à poser :

1. [developers.facebook.com](https://developers.facebook.com/) → créer/ouvrir
   une app de type **Entreprise**.
2. Ajouter le produit **oEmbed Read** (ex-« Instagram oEmbed ») et le faire
   valider (revue d'app, gratuite).
3. Récupérer le jeton d'app : `<APP_ID>|<APP_SECRET>`.
4. Netlify → **Site settings → Environment variables** → ajouter
   `FB_OEMBED_TOKEN` = le jeton. **Jamais dans le dépôt.**
5. Redéployer. Les vignettes Instagram apparaissent d'elles-mêmes ; les caches
   négatifs déjà posés expirent en 1 h maximum.

Tant que le jeton n'est pas posé, l'app reste dans l'état livré : Vimeo et
TikTok ont leur vraie vignette, Instagram a son placeholder lisible.

## Tests

`node scripts/test-video-thumbs.mjs` — 25 assertions (dissymétrie YouTube /
Instagram, pose de `data-vthumb`, placeholder de marque, cache positif ET
négatif, garde-fous de la fonction serveur dont l'absence de secret en dur).
