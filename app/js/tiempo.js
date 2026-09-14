/* ============================================================
 tiempo.js — el ÚNICO archivo que construye new Date()
 Congelar el reloj en una prueba es cambiar un parámetro,
 no parchear un global.
 ============================================================ */
'use strict';

/** Fecha y hora actuales. Inyectable en pruebas. */
export function ahora() { return new Date(); }

/** "2026-09-14" en hora LOCAL, nunca UTC. */
export function hoyISO(d = ahora()) {
 const p = n => String(n).padStart(2, '0');
 return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Días calendario entre dos fechas ISO. */
export function diasEntre(isoA, isoB) {
 const [ay, am, ad] = isoA.split('-').map(Number);
 const [by, bm, bd] = isoB.split('-').map(Number);
 return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5);
}

/** La fecha ISO de hace n días. */
export function haceDias(n, d = ahora()) {
 const x = new Date(d); x.setDate(x.getDate() - n); return hoyISO(x);
}

/** Minutos desde medianoche. Lo que leen las reglas de ventana horaria. */
export function minutosDelDia(d = ahora()) { return d.getHours() * 60 + d.getMinutes(); }

/** 0 = domingo. Índice del calendario. */
export function diaSemana(d = ahora()) { return d.getDay(); }

export function fechaLarga(d = ahora()) {
 return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function fechaCorta(iso) {
 const [Y, M, D] = iso.split('-').map(Number);
 return new Date(Y, M - 1, D).toLocaleDateString('es-CO',
 { weekday: 'short', day: 'numeric', month: 'short' });
}

/** mm:ss, o "45s" cuando no llega al minuto. */
export function fmt(seg) {
 const m = Math.floor(seg / 60), r = seg % 60;
 return m ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
}

/* ------------------------------------------------------------
 semanaDeCarga — corrige D4.
 La semana NO se cuenta por almanaque: se cuenta por sesiones de
 carga hechas. Si para dos semanas, al volver no aparece en la
 "semana 6" sin haber entrenado las cinco anteriores.
 ------------------------------------------------------------ */
export function semanaDeCarga(log, sesionesPorSemana = 3) {
 const hechas = Object.values(log || {}).filter(e => e && e.hecho && e.carga).length;
 return Math.floor(hechas / sesionesPorSemana) + 1;
}

/** Semana dentro del mesociclo de 4. La 4 es de descarga, siempre. */
export function semanaDeMesociclo(log, sesionesPorSemana = 3) {
 return ((semanaDeCarga(log, sesionesPorSemana) - 1) % 4) + 1;
}
