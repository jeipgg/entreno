/* ============================================================
 respaldo.js — copia del registro fuera del teléfono.

 Existe porque el registro vive SOLO en este dispositivo y iOS
 lo borra al desinstalar la app. Eso ya pasó una vez.

 Aprobado por Bruja con 9 condiciones (REGLA-SEC-001). Las que
 afectan a este archivo:
 · token de alcance fino, UN solo repositorio, contents:write
 · sin caducidad, pero con indicador visible de último respaldo
 · confirmación explícita antes de guardarlo
 · el respaldo NO se sanea: uno saneado no restaura, y uno que
 no restaura no es un respaldo
 · el respaldo conserva historial: borrar en la app no borra
 del respaldo

 No importa estado.js: recibe y devuelve datos por parámetro.
 ============================================================ */
'use strict';

const API = 'https://api.github.com';
const ARCHIVO = 'registro.json';

/** Un token de GitHub, sin confundirlo con cualquier otra cadena. */
export function pareceToken(t) {
 return typeof t === 'string' && /^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(t.trim());
}

/** Comprueba que el token sirve y que llega SOLO a donde debe. */
export async function verificar(cfg) {
 if (!pareceToken(cfg.token)) return { ok: false, error: 'Eso no parece un token de GitHub.' };
 try {
 const r = await fetch(`${API}/repos/${cfg.repo}`, { headers: cabeceras(cfg) });
 if (r.status === 404)
 return { ok: false, error: `No encuentro el repositorio ${cfg.repo}, o el token no llega a él.` };
 if (r.status === 401)
 return { ok: false, error: 'El token no es válido o fue revocado.' };
 if (!r.ok) return { ok: false, error: `GitHub respondió ${r.status}.` };
 const d = await r.json();
 if (!d.private)
 return { ok: false, error: 'Ese repositorio es público. El respaldo tiene que ir a uno privado.' };
 return { ok: true, repo: d.full_name };
 } catch {
 return { ok: false, error: 'Sin conexión. Inténtalo cuando tengas red.' };
 }
}

const cabeceras = cfg => ({
 'Authorization': `Bearer ${cfg.token}`,
 'Accept': 'application/vnd.github+json',
 'X-GitHub-Api-Version': '2022-11-28',
});

/** Sube el volcado. Si falla, no rompe nada: la app sigue local. */
export async function subir(cfg, datosJSON, fecha) {
 if (!cfg || !cfg.token || !cfg.repo) return { ok: false, error: 'sin_configurar' };

 const url = `${API}/repos/${cfg.repo}/contents/${ARCHIVO}`;
 try {
 // hace falta el sha del archivo anterior para reemplazarlo
 let sha = null;
 const prev = await fetch(url, { headers: cabeceras(cfg) });
 if (prev.ok) sha = (await prev.json()).sha;
 else if (prev.status === 401) return { ok: false, error: 'token_invalido' };

 const r = await fetch(url, {
 method: 'PUT',
 headers: { ...cabeceras(cfg), 'Content-Type': 'application/json' },
 body: JSON.stringify({
 message: `Registro ${fecha}`,
 content: aBase64(datosJSON),
 ...(sha ? { sha } : {}),
 }),
 });
 if (!r.ok) return { ok: false, error: `github_${r.status}` };
 return { ok: true, fecha };
 } catch {
 return { ok: false, error: 'sin_red' };
 }
}

/** Trae la última copia, para restaurar en un teléfono nuevo. */
export async function bajar(cfg) {
 try {
 const r = await fetch(`${API}/repos/${cfg.repo}/contents/${ARCHIVO}`, { headers: cabeceras(cfg) });
 if (r.status === 404) return { ok: false, error: 'Todavía no hay ninguna copia guardada.' };
 if (!r.ok) return { ok: false, error: `GitHub respondió ${r.status}.` };
 const d = await r.json();
 return { ok: true, datos: deBase64(d.content), fecha: d.sha.slice(0, 7) };
 } catch {
 return { ok: false, error: 'Sin conexión.' };
 }
}

/* UTF-8 ⇄ base64, que es lo que pide la API de contenidos */
function aBase64(txt) {
 const bytes = new TextEncoder().encode(txt);
 let bin = '';
 for (const b of bytes) bin += String.fromCharCode(b);
 return btoa(bin);
}

function deBase64(b64) {
 const bin = atob(b64.replace(/\s/g, ''));
 const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
 return new TextDecoder().decode(bytes);
}
