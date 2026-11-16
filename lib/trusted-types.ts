// Détection, sans rien déclencher, d'une page qui impose les Trusted Types aux scripts
// (`require-trusted-types-for 'script'`, Meet par exemple). Créer un worker depuis une URL
// texte y est refusé et Chrome logue une erreur, visible dans la page Erreurs de l'extension :
// on lit donc la politique de sécurité avant, dans les balises meta et dans l'en-tête de la
// page (requête HEAD vers la même adresse, même origine). Monde MAIN.

/** Délai au-delà duquel on suppose les Trusted Types imposés (choix sans erreur possible). */
const TIMEOUT_MS = 1500;
const DIRECTIVE = /require-trusted-types-for\s+[^;]*'script'/i;

let detection: Promise<string | null> | null = null;

/**
 * Raison lisible si la page impose les Trusted Types aux scripts, sinon null. En cas de doute
 * (en-tête illisible, délai dépassé), la page est supposée les imposer. Résultat mis en cache :
 * l'appeler tôt (à l'activation) pour qu'il soit prêt quand la plateforme demande la caméra.
 */
export function trustedTypesEnforcement(): Promise<string | null> {
  detection ??= detect();
  return detection;
}

async function detect(): Promise<string | null> {
  // Navigateur sans Trusted Types (Firefox) : rien n'est imposé.
  if (!('trustedTypes' in window)) return null;
  for (const meta of document.querySelectorAll('meta[http-equiv]')) {
    if (meta.getAttribute('http-equiv')?.toLowerCase() !== 'content-security-policy') continue;
    if (DIRECTIVE.test(meta.getAttribute('content') ?? '')) return 'balise meta CSP require-trusted-types-for';
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(location.href, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if (!response.ok) return `en-tête de la page illisible (HEAD ${response.status}) : Trusted Types supposés`;
    // Plusieurs en-têtes CSP sont réunis par des virgules : la directive peut être dans n'importe lequel.
    const policy = response.headers.get('content-security-policy') ?? '';
    return DIRECTIVE.test(policy) ? 'en-tête CSP require-trusted-types-for' : null;
  } catch (error) {
    return `en-tête de la page illisible (${error instanceof Error ? error.message : String(error)}) : Trusted Types supposés`;
  } finally {
    clearTimeout(timer);
  }
}
