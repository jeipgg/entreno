/* ============================================================
 estado.js — el ÚNICO archivo que toca localStorage.

 El motor PROPONE; este archivo DISPONE. Nada más escribe.

 Principio que ordena el modelo: data/*.json es lo que decidiría
 la entrenadora; localStorage es lo que respondió el cuerpo.
 ============================================================ */
'use strict';

import { hoyISO, haceDias } from './tiempo.js';
import { MUESTRA_FINAL_POR_DEFECTO } from './reglas.js';

export const K = {
 esquema: 'pole.esquema',
 log: 'pole.log',
 checkin: 'pole.checkin',
 nivel: 'pole.nivel',
 arbol: 'pole.arbol',
 banderas: 'pole.banderas',
 puerta: 'pole.puerta_medica',
 prefs: 'pole.prefs',
 respaldo: 'pole.respaldo.v0',
 exportado: 'pole.ultimo_respaldo',
 nube: 'pole.nube', // {token, repo, ultimo, ultimo_error}
};

/** Lo que asume la app cuando todavía no hay preferencias guardadas. */
const PREFS_DEFECTO = { taller_dias_semana: 2, taller_muestra_final: MUESTRA_FINAL_POR_DEFECTO };

export const ESQUEMA_ACTUAL = 1;

let soloLectura = false;
let avisoCuota = null;

/** Un fallo al escribir NO puede ser silencioso: es el peor fallo posible. */
export function read(key, fb) {
 try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; }
 catch { return fb; }
}

export function write(key, val) {
 if (soloLectura) return false;
 try { localStorage.setItem(key, JSON.stringify(val)); return true; }
 catch (e) {
 soloLectura = true;
 if (avisoCuota) avisoCuota(e);
 return false;
 }
}

export function alFallarEscritura(fn) { avisoCuota = fn; }
export function esSoloLectura() { return soloLectura; }

/* ============================================================
 MIGRACIÓN — la operación de mayor riesgo del proyecto.
 No hay copia en ningún servidor: si esto sale mal, se pierde
 todo el registro. Por eso: respaldo primero, y si el respaldo
 falla, no se migra.
 ============================================================ */
export function migrar() {
 const esq = read(K.esquema, null);
 if (esq && esq.v >= ESQUEMA_ACTUAL) return { migrado: false, version: esq.v };

 // 0 · respaldo íntegro, y aborto si no se puede escribir
 const volcado = {};
 for (let i = 0; i < localStorage.length; i++) {
 const k = localStorage.key(i);
 if (k && k.startsWith('pole.')) volcado[k] = localStorage.getItem(k);
 }
 if (!write(K.respaldo, { fecha: new Date().toISOString(), datos: volcado })) {
 soloLectura = true;
 return { migrado: false, error: 'No se pudo guardar el respaldo. No se migra sin red de seguridad.' };
 }

 // 1 · el tipo de sesión sale del día registrado, no del que esté en pantalla
 const MAPA = { a:'F1', b:'F2', c:'F3', d1:'C1', d2:'C2', e:'L', s:'S', min:'MIN' };
 const CARGA = new Set(['F1','F2','F3']);
 const log = read(K.log, {});
 for (const [f, e] of Object.entries(log)) {
 if (!e || typeof e !== 'object') continue;
 if (e.dia && !e.dia_legacy) e.dia_legacy = e.dia;
 const tipo = MAPA[e.dia_legacy || e.dia];
 // D2 pudo corromper 'tipo'; si no se puede deducir, se marca dudoso y
 // NO cuenta para el cupo de días de carga. Un dato sospechoso no puede
 // ser la base de una decisión de seguridad.
 if (tipo) { e.tipo = tipo; e.carga = CARGA.has(tipo); }
 else { e.tipo_dudoso = true; e.carga = false; }
 }
 write(K.log, log);

 // 2 · el estado de progresión gana los contadores nuevos
 const niv = read(K.nivel, {});
 for (const v of Object.values(niv)) {
 if (v.confirmaciones == null) v.confirmaciones = 0;
 if (v.cortes_agarre_seguidos == null) v.cortes_agarre_seguidos = 0;
 }
 write(K.nivel, niv);

 // 3 · el árbol se siembra SOLO con lo demostrado
 const arbol = read(K.arbol, {});
 const SEMILLA = { 'colgada-activa':'GRIP-0', 'retraccion-colgada':'PULL-0', 'hollow-hold':'CORE-1' };
 for (const [ex, nodo] of Object.entries(SEMILLA))
 if (niv[ex] && niv[ex].escalon >= 1 && !arbol[nodo])
 arbol[nodo] = { dominado_el: hoyISO(), evidencia: { migracion: true, ejercicio: ex } };
 write(K.arbol, arbol);

 // 4 · preferencias: copiar, nunca mover
 const prefs = read(K.prefs, {});
 const variante = read('pole.variante', null);
 if (variante && !prefs.variante) prefs.variante = variante;
 const videos = read('pole.videos', null);
 if (videos && !prefs.videos) prefs.videos = videos;
 if (prefs.taller_dias_semana == null) prefs.taller_dias_semana = 2;
 write(K.prefs, prefs);

 write(K.esquema, { v: ESQUEMA_ACTUAL, migrado_el: new Date().toISOString() });
 return { migrado: true, version: ESQUEMA_ACTUAL, sesiones: Object.keys(log).length };
}

/* ============================================================
 LECTURA — lo que el motor recibe
 ============================================================ */
export function cargar() {
 return {
 log: read(K.log, {}),
 nivel: read(K.nivel, {}),
 arbol: read(K.arbol, {}),
 banderas: read(K.banderas, {}),
 puerta_medica: read(K.puerta, null),
 prefs: read(K.prefs, PREFS_DEFECTO),
 nivel_actual: read(K.prefs, {}).nivel_actual || 0,
 };
}

export function checkinDe(fecha) { return read(K.checkin, {})[fecha] || null; }

export function todosLosCheckins() { return read(K.checkin, {}); }

export function guardarCheckin(fecha, datos) {
 const c = read(K.checkin, {}); c[fecha] = datos; return write(K.checkin, c);
}

export function borrarCheckin(fecha) {
 const c = read(K.checkin, {}); delete c[fecha]; return write(K.checkin, c);
}

/* ============================================================
 ESCRITURA — aplicar lo que el motor decidió
 ============================================================ */
export function aplicar(decisiones) {
 if (!decisiones || !decisiones.length) return;
 const niv = read(K.nivel, {});
 for (const d of decisiones) if (d && d.id && d.estado) niv[d.id] = d.estado;
 write(K.nivel, niv);
}

export function registroDe(fecha) {
 return read(K.log, {})[fecha] || null;
}

/** El tipo se fija al ABRIR la sesión y no se reescribe nunca (corrige D2). */
export function abrirSesion(fecha, plan) {
 const log = read(K.log, {});
 if (!log[fecha]) {
 log[fecha] = { tipo: plan.tipo, carga: !!plan.carga, hora_inicio: new Date().toISOString(),
 series: {}, notas: {}, rpe: {}, corte_agarre: {}, hecho: false };
 write(K.log, log);
 }
 return log[fecha];
}

export function guardarSesion(fecha, entrada) {
 const log = read(K.log, {});
 const previo = log[fecha] || {};
 // tipo y carga son inmutables una vez fijados
 entrada.tipo = previo.tipo !== undefined ? previo.tipo : entrada.tipo;
 entrada.carga = previo.carga !== undefined ? previo.carga : entrada.carga;
 log[fecha] = entrada;
 return write(K.log, log);
}

export function marcarSerie(fecha, exId, serie, on) {
 const log = read(K.log, {});
 const e = log[fecha] || (log[fecha] = { series: {}, notas: {}, rpe: {}, corte_agarre: {} });
 const s = new Set(e.series[exId] || []);
 on ? s.add(serie) : s.delete(serie);
 e.series[exId] = [...s].sort((a, b) => a - b);
 return write(K.log, log) && e;
}

export function anotar(fecha, exId, valor) {
 const log = read(K.log, {});
 const e = log[fecha] || (log[fecha] = { series: {}, notas: {}, rpe: {}, corte_agarre: {} });
 e.notas = e.notas || {}; e.notas[exId] = String(valor).trim();
 return write(K.log, log);
}

export function anotarRPE(fecha, exId, rpe) {
 const log = read(K.log, {});
 const e = log[fecha] || (log[fecha] = { series: {}, notas: {}, rpe: {}, corte_agarre: {} });
 e.rpe = e.rpe || {}; e.rpe[exId] = rpe;
 return write(K.log, log);
}

export function marcarCorteAgarre(fecha, exId, on) {
 const log = read(K.log, {});
 const e = log[fecha] || (log[fecha] = { series: {}, notas: {}, rpe: {}, corte_agarre: {} });
 e.corte_agarre = e.corte_agarre || {};
 if (on) e.corte_agarre[exId] = true; else delete e.corte_agarre[exId];
 return write(K.log, log);
}

export function cerrarSesion(fecha, tbcSeg, tutSeg) {
 const log = read(K.log, {});
 const e = log[fecha]; if (!e) return false;
 e.hecho = true; e.cerrada = Date.now();
 e.tbc_seg = tbcSeg; e.tut_barra_seg = tutSeg;
 return write(K.log, log);
}

export function reabrirSesion(fecha) {
 const log = read(K.log, {});
 const e = log[fecha]; if (!e) return false;
 e.hecho = false; delete e.cerrada;
 return write(K.log, log);
}

/* ============================================================
 ÁRBOL — solo eventos de dominio. NO EXISTE desmarcarDominado.
 Para que un nodo retroceda habría que escribir código nuevo.
 Así la condición 6 de Sakti deja de depender de la disciplina.
 ============================================================ */
export function marcarDominado(nodoId, evidencia) {
 const a = read(K.arbol, {});
 if (a[nodoId]) return false; // ya estaba: no se reescribe
 a[nodoId] = { dominado_el: hoyISO(), evidencia: evidencia || {} };
 return write(K.arbol, a);
}

export function nodosDominados() { return read(K.arbol, {}); }

/* ---------- banderas ---------- */
export function levantarBandera(id, datos) {
 const b = read(K.banderas, {});
 if (!b[id]) b[id] = { desde: hoyISO(), ...datos };
 return write(K.banderas, b);
}

export function bajarBandera(id) {
 const b = read(K.banderas, {});
 if (b[id] && b[id].requiere_accion_manual) return false; // no vence por tiempo
 delete b[id]; return write(K.banderas, b);
}

export function bajarBanderaManual(id, fechaConsulta) {
 if (!fechaConsulta) return false;
 const b = read(K.banderas, {}); delete b[id]; return write(K.banderas, b);
}

export function purgarBanderasVencidas() {
 const b = read(K.banderas, {}); let cambio = false;
 for (const [id, x] of Object.entries(b)) {
 if (x.requiere_accion_manual || !x.dias) continue;
 if (x.desde <= haceDias(x.dias)) { delete b[id]; cambio = true; }
 }
 if (cambio) write(K.banderas, b);
}

/* ---------- puerta médica: etiquetas neutras (Bruja 7) ---------- */
export function puertaMedica() { return read(K.puerta, { control_1: null, control_2: null }); }

export function guardarPuertaMedica(p) {
 return write(K.puerta, { control_1: p.control_1 || null, control_2: p.control_2 || null });
}

/* ---------- preferencias ---------- */
export function prefs() { return read(K.prefs, PREFS_DEFECTO); }

/** Rellena preferencias que nacieron DESPUÉS de una migración ya hecha.
 Corre en cada arranque y solo escribe lo que falta: una preferencia
 nueva no puede obligar a subir el esquema y volver a migrar a todos.
 Un valor puesto a null a propósito no se vuelve a sembrar. */
/** Preferencias que cambiaron de nombre. Se copia el valor y se borra la
 vieja. `teatros_hasta` NO está aquí a propósito: la fecha que guardaba
 era una suposición equivocada, y arrastrarla sería propagar el error. */
const PREFS_RENOMBRADAS = { teatros_semana: 'taller_dias_semana' };

export function sembrarPrefs() {
 const p = read(K.prefs, {});
 let falta = false;
 for (const [viejo, nuevo] of Object.entries(PREFS_RENOMBRADAS)) {
 if (p[viejo] === undefined) continue;
 if (p[nuevo] === undefined) p[nuevo] = p[viejo];
 delete p[viejo]; falta = true;
 }
 if (p.teatros_hasta !== undefined) { delete p.teatros_hasta; falta = true; }
 for (const [k, v] of Object.entries(PREFS_DEFECTO))
 if (p[k] === undefined) { p[k] = v; falta = true; }
 if (falta) write(K.prefs, p);
 return p;
}

export function guardarPrefs(p) {
 return write(K.prefs, { ...read(K.prefs, {}), ...p });
}

/* ---------- respaldo ----------
 El registro vive SOLO en este teléfono. Si la app se desinstala, iOS borra
 lo que tenía guardado. Por eso el aviso no es una sugerencia amable: es la
 única red que hay. */
export function diasSinRespaldar() {
 const u = read(K.exportado, null);
 if (!u) return Infinity;
 const [Y, M, D] = u.split('-').map(Number);
 return Math.round((Date.now() - new Date(Y, M - 1, D).getTime()) / 864e5);
}

export function marcarRespaldado() { return write(K.exportado, hoyISO()); }

/* ---------- copia fuera del teléfono ----------
 El token vive aquí y en ningún otro sitio. Se borra con la app. */
export function nube() { return read(K.nube, null); }

export function guardarNube(cfg) {
 return write(K.nube, { token: cfg.token, repo: cfg.repo,
 ultimo: cfg.ultimo || null, ultimo_error: null });
}

export function olvidarNube() {
 try { localStorage.removeItem(K.nube); return true; } catch { return false; }
}

export function marcarSubida(fecha, error) {
 const n = read(K.nube, null); if (!n) return false;
 if (error) n.ultimo_error = error; else { n.ultimo = fecha; n.ultimo_error = null; }
 return write(K.nube, n);
}

/** Días desde la última copia fuera del teléfono. Infinity si nunca. */
export function diasSinSubir() {
 const n = read(K.nube, null);
 if (!n || !n.ultimo) return Infinity;
 const [Y, M, D] = n.ultimo.split('-').map(Number);
 return Math.round((Date.now() - new Date(Y, M - 1, D).getTime()) / 864e5);
}

/** Restaura desde un volcado. Solo si el esquema coincide. */
export function restaurar(json) {
 let d;
 try { d = JSON.parse(json); } catch { return { ok: false, error: 'El archivo no se pudo leer.' }; }
 if (!d['pole.log']) return { ok: false, error: 'Ese archivo no parece un respaldo de la app.' };

 // respaldo de lo que hay AHORA, antes de pisarlo
 write('pole.respaldo.antes_de_restaurar', respaldoJSON());

 let n = 0;
 for (const [k, v] of Object.entries(d)) {
 if (!k.startsWith('pole.') || k === K.nube) continue; // el token no se restaura nunca
 if (write(k, v)) n++;
 }
 return { ok: true, claves: n, sesiones: Object.keys(d['pole.log'] || {}).length };
}

/* ---------- respaldo ---------- */
export function respaldoJSON() {
 const out = {};
 for (let i = 0; i < localStorage.length; i++) {
 const k = localStorage.key(i);
 if (k && k.startsWith('pole.')) { try { out[k] = JSON.parse(localStorage.getItem(k)); } catch {} }
 }
 return JSON.stringify(out, null, 2);
}

export function tamanoUsadoKB() {
 let n = 0;
 for (let i = 0; i < localStorage.length; i++) {
 const k = localStorage.key(i);
 if (k && k.startsWith('pole.')) n += (localStorage.getItem(k) || '').length;
 }
 return Math.round(n / 1024);
}
