/* ============================================================
 cronometro.js — descansos, sostenimientos y aviso.
 Pieza aparte: no sabe nada del plan ni del estado.
 ============================================================ */
'use strict';

import { fmt } from './tiempo.js';

let id = null, restan = 0, lock = null, audio = null, alCerrar = null;

/* iOS exige un toque del usuario antes de permitir audio. */
export function desbloquearAudio() {
 if (audio) return;
 try {
 audio = new (window.AudioContext || window.webkitAudioContext)();
 if (audio.state === 'suspended') audio.resume();
 } catch {}
}

function pitar() {
 if (!audio) return;
 try {
 [0, 0.22, 0.44].forEach(t => {
 const o = audio.createOscillator(), g = audio.createGain();
 o.type = 'sine'; o.frequency.value = 880;
 g.gain.setValueAtTime(0.0001, audio.currentTime + t);
 g.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + t + 0.02);
 g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.18);
 o.connect(g); g.connect(audio.destination);
 o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.2);
 });
 } catch {}
}

async function mantenerPantalla() {
 try { if ('wakeLock' in navigator) lock = await navigator.wakeLock.request('screen'); } catch {}
}
function soltarPantalla() {
 try { if (lock) { lock.release(); lock = null; } } catch {}
}

/**
 * @param {'rest'|'hold'} modo
 * @param {object} ex ejercicio
 * @param {object} ctx {titulo, nombre, detalle, clave} de lo que sigue
 */
export function abrir(modo, ex, ctx, el) {
 restan = modo === 'rest' ? (ex.descanso || 90) : (ex.segundos || ex.objetivo || 30);
 if (!restan) return;

 el.caja.hidden = false;
 el.caja.classList.remove('ring');
 el.label.textContent = modo === 'rest' ? 'Descanso' : 'Sostén';
 el.ex.textContent = ex.nombre;

 if (ctx) {
 el.next.hidden = false;
 el.next.innerHTML =
 `<p class="tn-kicker">${ctx.titulo}</p><p class="tn-name">${ctx.nombre}</p>` +
 (ctx.detalle ? `<p class="tn-dose">${ctx.detalle}</p>` : '') +
 (ctx.clave ? `<p class="tn-clave">${ctx.clave}</p>` : '');
 } else el.next.hidden = true;

 mantenerPantalla();
 const pinta = () => { el.num.textContent = fmt(Math.max(0, restan)); };
 pinta();

 clearInterval(id);
 id = setInterval(() => {
 restan--;
 pinta();
 if (restan <= 0) {
 clearInterval(id); id = null;
 el.caja.classList.add('ring');
 el.num.textContent = modo === 'rest' ? '¡Vamos!' : '¡Listo!';
 pitar();
 }
 }, 1000);
}

export function ajustar(seg, el) {
 restan = Math.max(0, restan + seg);
 if (seg > 0) el.caja.classList.remove('ring');
 el.num.textContent = fmt(restan);
}

export function cerrar(el) {
 clearInterval(id); id = null;
 el.caja.hidden = true;
 el.caja.classList.remove('ring');
 soltarPantalla();
 if (alCerrar) alCerrar();
}

export function corriendo() { return id !== null; }
export function alCerrarse(fn) { alCerrar = fn; }
export function revalidarPantalla() { if (id) mantenerPantalla(); }
