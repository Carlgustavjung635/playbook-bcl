// ============================================================================
// Edge Function : push-send — envoi de notifications Web Push (Phase 2)
// ----------------------------------------------------------------------------
// Appelée par l'app (best-effort) après une mutation pertinente. Body :
//   { ownerKeys: string[], payload: { title, body, url?, tag?, badge_count?,
//     icon?, type? } }
// → lit push_subscriptions (service role) pour ces ownerKeys, envoie le push
//   VAPID à chacune, supprime les abonnements expirés (404/410).
//
// Secrets requis (supabase secrets set ...) :
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...),
//   PROJECT_URL, SERVICE_ROLE_KEY (ou réutilise SUPABASE_URL / SERVICE_ROLE_KEY
//   injectés par défaut).
// Déploiement : supabase functions deploy push-send --no-verify-jwt
// ============================================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:coach@playbook-bcl.app';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); } catch (_e) { /* config */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });

  try {
    const { ownerKeys, payload } = await req.json();
    if (!Array.isArray(ownerKeys) || !ownerKeys.length || !payload || !payload.title) {
      return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: allSubs, error } = await sb
      .from('push_subscriptions')
      .select('id, endpoint, p256dh_key, auth_key, owner_key, ua, last_seen_at')
      .in('owner_key', ownerKeys);
    if (error) throw error;

    // Anti-doublon : au plus 1 envoi par (owner_key, appareil=ua) — on garde la
    // souscription au last_seen_at le plus récent. iOS/Safari rotationnent
    // l'endpoint push ; une ancienne ligne orpheline (même appareil, endpoint
    // différent) survivait et provoquait 2 notifs sur le même appareil. On ne
    // supprime rien ici (non destructif) : on n'envoie juste pas deux fois.
    //
    // ⚠️ ANDROID — le User-Agent n'identifie PLUS un appareil. Chrome a gelé son
    // UA Android : tout appareil renvoie désormais la MÊME chaîne
    // « Mozilla/5.0 (Linux; Android 10; K) … » (Samsung Internet aussi). La
    // prendre pour une clé d'appareil revient à fusionner deux Samsung distincts
    // en un seul : la deuxième joueuse ne reçoit jamais rien, sans la moindre
    // erreur nulle part. On ne collapse donc QUE sur un ua discriminant ; sinon
    // chaque endpoint est traité comme son propre appareil. Le doublon que ce
    // filtre évitait reste couvert deux fois : côté client par
    // _pushStaleEndpoint (purge de l'endpoint précédent à la rotation), et par
    // le `tag` de la notification, qui fait qu'Android n'empile pas deux
    // bannières identiques.
    const UA_NON_DISCRIMINANT = /Android\s+10;\s*K\)/i;
    const seen = new Set<string>();
    const subs = (allSubs || [])
      .slice()
      .sort((a: any, b: any) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')))
      .filter((s: any) => {
        const ua = String(s.ua || '');
        if (!ua || UA_NON_DISCRIMINANT.test(ua)) return true; // ua sans identité → pas de collapse
        const key = String(s.owner_key || '') + '|' + ua;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const body = JSON.stringify({
      title: String(payload.title).slice(0, 80),
      body: String(payload.body || '').slice(0, 180),
      url: payload.url || '/',
      tag: payload.tag || 'pb8',
      icon: payload.icon || '/icon-192.png',
      badge_count: Number.isFinite(payload.badge_count) ? payload.badge_count : undefined,
      type: payload.type || null,
    });

    // URGENCY — sans en-tête `Urgency`, FCM classe le message en « normal » et
    // Android a le droit de le garder jusqu'au prochain réveil de l'appareil.
    // Sur Samsung (One UI met le navigateur en « veille profonde » de son propre
    // chef) cela veut dire : jamais. Apple ignore l'en-tête, donc c'est gratuit.
    // TTL explicite : 24 h. Une notif d'équipe qui arrive 4 semaines plus tard
    // (le défaut de web-push) n'a plus aucun sens.
    const SEND_OPTS = { TTL: 86400, urgency: 'high' as const };

    // Les échecs étaient AVALÉS : seuls 404/410 étaient traités, tout le reste
    // (403 clé VAPID, 400 payload, 429…) disparaissait sans laisser de trace, et
    // `sent` ne disait rien de qui avait réellement reçu. C'est précisément ce
    // qui rendait « ça ne marche pas sur Samsung » indiagnosticable. On journalise
    // et on remonte, par HÔTE (fcm/apple) — jamais l'endpoint, qui est un secret.
    let sent = 0; const stale: string[] = [];
    const failures: Array<{ host: string; code: number | null; msg: string }> = [];
    const byHost: Record<string, { ok: number; ko: number }> = {};
    const hostOf = (u: string) => { try { return new URL(u).host; } catch (_e) { return '?'; } };
    await Promise.all((subs || []).map(async (s) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh_key, auth: s.auth_key } };
      const host = hostOf(String(s.endpoint || ''));
      byHost[host] = byHost[host] || { ok: 0, ko: 0 };
      try { await webpush.sendNotification(subscription, body, SEND_OPTS); sent++; byHost[host].ok++; }
      catch (err: any) {
        byHost[host].ko++;
        const code = (err && Number.isFinite(err.statusCode)) ? err.statusCode : null;
        if (code === 404 || code === 410) { stale.push(s.id); return; } // abonnement mort → purge
        const msg = String((err && (err.body || err.message)) || err).slice(0, 200);
        failures.push({ host, code, msg });
        console.error('[push-send] échec', host, code, msg);
      }
    }));
    if (stale.length) await sb.from('push_subscriptions').delete().in('id', stale);
    console.log('[push-send] par hôte', JSON.stringify(byHost));

    return new Response(JSON.stringify({ ok: true, sent, pruned: stale.length, targeted: subs.length, total: (allSubs || []).length, byHost, failures }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
