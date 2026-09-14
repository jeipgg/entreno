/* ============================================================
 main.js — arranque y orquestación.
 Lo único que conoce a todos los módulos.

 El motor PROPONE, estado.js DISPONE, vista.js PINTA.
 ============================================================ */
'use strict';

import * as T from './tiempo.js';
import * as E from './estado.js';
import * as V from './vista.js';
import * as C from './cronometro.js';
import { construirPlan, valores } from './motor.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let CONTENIDO = null, PLAN = null, SW = { registrado: false, archivos: 0, error: '' };
const HOY = T.hoyISO();

/* ============================================================
 ARRANQUE
 ============================================================ */
async function init() {
 if (location.protocol === 'file:') {
 document.body.innerHTML = pantalla('Ábrela desde un servidor',
 'Los módulos no cargan abriendo el archivo directamente. En la carpeta del proyecto: <code>python3 -m http.server 8080</code> y luego <code>http://localhost:8080/app/</code>');
 return;
 }

 E.alFallarEscritura(() => {
 const d = document.createElement('div');
 d.className = 'aviso-cuota';
 d.textContent = 'El teléfono no está guardando: el almacenamiento está lleno. Exporta el registro y libera espacio antes de seguir.';
 document.body.prepend(d);
 });

 try {
 CONTENIDO = await cargarContenido();
 } catch (e) {
 document.body.innerHTML = pantalla('No cargó el contenido',
 'Faltan archivos de <code>data/</code>. Vuelve a abrir la app con conexión.');
 return;
 }

 const mig = E.migrar();
 if (mig.error) {
 document.body.innerHTML = pantalla('No se pudo preparar el almacenamiento', mig.error);
 return;
 }

 E.purgarBanderasVencidas();
 registrarSW();

 const ci = E.checkinDe(HOY);
 if (ci) mostrarApp(); else mostrarCheckin();
}

async function cargarContenido() {
 const uno = async f => (await fetch(`data/${f}`, { cache: 'no-cache' })).json();
 const [ejercicios, sesiones, calendario, arbol, textos] = await Promise.all(
 ['ejercicios.json','sesiones.json','calendario.json','arbol.json','textos.json'].map(uno));
 return { ejercicios, sesiones, calendario, arbol, textos };
}

function pantalla(titulo, html) {
 return `<div class="screen"><div class="ci-wrap"><h1 class="ci-title">${titulo}</h1>
 <p style="color:var(--muted)">${html}</p></div></div>`;
}

/* ============================================================
 SERVICE WORKER
 ============================================================ */
async function registrarSW() {
 if (!('serviceWorker' in navigator) || !window.isSecureContext) {
 SW.error = 'La conexión no permite guardar la app en el teléfono.';
 return;
 }
 try {
 await navigator.serviceWorker.register('../sw.js', { scope: '../', updateViaCache: 'none' });
 await navigator.serviceWorker.ready;
 SW.registrado = true;
 } catch (e) { SW.error = e.message || 'No se pudo activar.'; }
 SW.archivos = await contarCache();
 document.addEventListener('visibilitychange', async () => {
 if (document.visibilityState !== 'visible') return;
 C.revalidarPantalla();
 try {
 const reg = await navigator.serviceWorker.getRegistration('../');
 if (!reg) { SW.registrado = false; return registrarSW(); }
 reg.update().catch(() => {});
 SW.archivos = await contarCache();
 } catch {}
 });
}

async function contarCache() {
 try {
 if (!('caches' in window)) return 0;
 let n = 0;
 for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length;
 return n;
 } catch { return 0; }
}

/* ============================================================
 CHECK-IN — obligatorio y vinculante (Sakti 4)
 ============================================================ */
const resp = { energia: null, sueno_calidad: null, sueno_horas: null, piernas: null,
 dolor_lumbar: 0, manos: 'integra', anorrectal: 'no' };

function mostrarCheckin() {
 $('#checkin').hidden = false;
 $('#app').hidden = true;
 $('#ci-fecha').textContent = T.fechaLarga();
 const h = T.ahora().getHours();
 $('#ci-title').textContent = h < 12 ? '¿Cómo amaneciste?' : '¿Cómo llegas?';

 $$('.scale').forEach(sc => sc.addEventListener('click', e => {
 const b = e.target.closest('button'); if (!b) return;
 $$('button', sc).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
 resp[sc.dataset.field] = Number(b.dataset.v);
 }));

 $$('.opcion').forEach(g => g.addEventListener('click', e => {
 const b = e.target.closest('button'); if (!b) return;
 $$('button', g).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
 resp[g.dataset.field] = b.dataset.v;
 }));

 $('#ci-horas').addEventListener('change', e => { resp.sueno_horas = Number(e.target.value) || null; });

 $('#ci-go').addEventListener('click', () => {
 if (resp.energia == null || resp.piernas == null) {
 $('#ci-falta').hidden = false; return;
 }
 E.guardarCheckin(HOY, { ...resp });
 mostrarApp();
 });
}

/* ============================================================
 LA APP
 ============================================================ */
function mostrarApp(forzarTipo) {
 $('#checkin').hidden = true;
 $('#app').hidden = false;
 calcular(forzarTipo);
 wireGlobal();
 pintar();
}

function calcular(forzarTipo) {
 const est = E.cargar();
 if (forzarTipo) est.forzar_tipo = forzarTipo;

 PLAN = construirPlan({
 contenido: CONTENIDO,
 estado: { ...est, log: { ...est.log, __arbol: E.nodosDominados() } },
 ahora: { hoyISO: HOY, minutos: T.minutosDelDia(), diaSemana: T.diaSemana() },
 checkin: E.checkinDe(HOY),
 });

 // el motor propuso; aquí se dispone
 E.aplicar(PLAN.decisiones);
 for (const b of PLAN.banderas || [])
 E.levantarBandera(b.id, { requiere_accion_manual: !!b.manual, dias: b.dias });

 if (PLAN.carga || (PLAN.ejercicios || []).length) E.abrirSesion(HOY, PLAN);

 // lo registrado hoy se mezcla en el plan para pintarlo
 const reg = E.registroDe(HOY) || {};
 PLAN.marcados = reg.series || {};
 PLAN.notas = reg.notas || {};
 PLAN.cerrada = reg.hecho ? reg.cerrada : null;
 for (const e of PLAN.ejercicios || []) {
 e.marcados = (reg.series || {})[e.id] || [];
 e.notaTexto = (reg.notas || {})[e.id] || '';
 e.rpe = (reg.rpe || {})[e.id] || '';
 }
 PLAN.agarre = CONTENIDO.agarre;
}

function pintar() {
 $('#days-row').innerHTML = V.selector(
 E.prefs().calendario || CONTENIDO.calendario.por_defecto,
 CONTENIDO.sesiones.tipos, T.diaSemana());
 $('#main').innerHTML = V.pintarDia(PLAN, CONTENIDO.textos, E.prefs());
 wireDia();
 actualizarBarra();
}

/* ============================================================
 EVENTOS DEL DÍA
 ============================================================ */
function wireDia() {
 $$('.serie').forEach(b => b.addEventListener('click', () => {
 C.desbloquearAudio();
 const on = b.getAttribute('aria-pressed') !== 'true';
 b.setAttribute('aria-pressed', String(on));
 E.marcarSerie(HOY, b.dataset.ex, Number(b.dataset.serie), on);
 const ex = (PLAN.ejercicios || []).find(e => e.id === b.dataset.ex);
 if (ex) {
 ex.marcados = (E.registroDe(HOY).series || {})[ex.id] || [];
 const li = b.closest('.ex');
 if (li) li.classList.toggle('done', ex.marcados.length >= ex.series);
 if (on && ex.descanso) C.abrir('rest', ex, queSigue(ex), elTimer());
 }
 actualizarBarra();
 }));

 $$('[data-item]').forEach(c => c.addEventListener('change', () => {
 C.desbloquearAudio();
 E.marcarSerie(HOY, c.dataset.item, 0, c.checked);
 const li = c.closest('li'); if (li) li.classList.toggle('done', c.checked);
 const ul = c.closest('.simple');
 const cont = ul && ul.parentElement.querySelector('.block-count');
 if (ul && cont) {
 const todos = $$('[data-item]', ul), n = todos.filter(x => x.checked).length;
 cont.textContent = `${n}/${todos.length}`;
 cont.classList.toggle('full', n === todos.length);
 }
 actualizarBarra();
 }));

 $$('[data-timer]').forEach(b => b.addEventListener('click', () => {
 C.desbloquearAudio();
 const ex = todos().find(e => e.id === b.dataset.ex);
 if (ex) C.abrir(b.dataset.timer, ex, b.dataset.timer === 'rest' ? queSigue(ex) : null, elTimer());
 }));

 $$('[data-nota]').forEach(inp => {
 let t = null;
 const guardar = () => { E.anotar(HOY, inp.dataset.nota, inp.value); avisoGuardado(inp); };
 inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(guardar, 500); });
 inp.addEventListener('change', () => { clearTimeout(t); guardar(); });
 inp.addEventListener('blur', () => { clearTimeout(t); guardar(); });
 });

 $$('[data-rpe]').forEach(inp => inp.addEventListener('change', () => {
 const v = Number(inp.value);
 if (v >= 1 && v <= 10) { E.anotarRPE(HOY, inp.dataset.rpe, v); avisoGuardado(inp); }
 }));

 $$('[data-corte]').forEach(b => b.addEventListener('click', () => {
 const on = b.getAttribute('aria-pressed') !== 'true';
 b.setAttribute('aria-pressed', String(on));
 b.classList.toggle('activo', on);
 E.marcarCorteAgarre(HOY, b.dataset.corte, on);
 b.textContent = on ? '✓ cortaste por el agarre' : 'corté por el agarre';
 }));

 $$('[data-aj]').forEach(b => b.addEventListener('click', () => {
 const ex = todos().find(e => e.id === b.dataset.ex);
 if (!ex || !ex.escalones) return;
 const est = E.cargar().nivel[ex.id] || { escalon: 0, objetivo: ex.escalones[0].min };
 const n = b.dataset.aj === 'sube'
 ? Math.min(ex.escalones.length - 1, est.escalon + 1)
 : Math.max(0, est.escalon - 1);
 E.aplicar([{ id: ex.id, estado: { escalon: n, objetivo: ex.escalones[n].min,
 fijado: true, confirmaciones: 0, cortes_agarre_seguidos: 0 } }]);
 calcular(); pintar();
 }));

 $$('[data-fig]').forEach(b => b.addEventListener('click', () => abrirFigura(b.dataset.fig, b.dataset.ex)));

 const bc = $('#cerrar-sesion');
 if (bc) bc.addEventListener('click', () => {
 const reg = E.registroDe(HOY) || {};
 E.cerrarSesion(HOY, tbcReal(reg), PLAN.tut_barra_seg || 0);
 marcarNodosDominados();
 calcular(); pintar();
 $('#panel-body').innerHTML = V.resumenCierre(PLAN, CONTENIDO.textos);
 $('#panel').hidden = false;
 });

 const br = $('#reabrir');
 if (br) br.addEventListener('click', () => { E.reabrirSesion(HOY); calcular(); pintar(); });
}

function elTimer() {
 return { caja: $('#timer'), label: $('#t-label'), num: $('#t-num'),
 ex: $('#t-ex'), next: $('#t-next') };
}

function todos() {
 const out = [...(PLAN.ejercicios || [])];
 for (const b of [...(PLAN.bloques || []), ...(PLAN.cierre || [])]) out.push(...b.items);
 return out;
}

function queSigue(ex) {
 const u = todos();
 const i = u.findIndex(x => x.id === ex.id);
 if (i < 0) return null;
 const reg = E.registroDe(HOY) || {};
 const hechas = ((reg.series || {})[ex.id] || []).length;
 const clave = x => (x.claves && x.claves[0]) || x.para || '';
 if (hechas < ex.series)
 return { titulo: 'Ahora vuelves a', nombre: ex.nombre,
 detalle: `Serie ${hechas + 1} de ${ex.series}`, clave: clave(ex) };
 const sig = u[i + 1];
 if (!sig) return { titulo: 'Y con esto', nombre: 'terminaste la sesión', detalle: '', clave: '' };
 return { titulo: 'Después sigue', nombre: sig.nombre,
 detalle: sig.objetivo ? `${sig.series} × ${sig.objetivo}` : (sig.dosis || ''),
 clave: clave(sig) };
}

function tbcReal(reg) {
 return (PLAN.ejercicios || []).reduce((a, e) => {
 const n = ((reg.series || {})[e.id] || []).length;
 const porSerie = e.unidad === 'tiempo' ? (e.objetivo || 20) : (e.objetivo || 6) * 3;
 return a + porSerie * n;
 }, 0);
}

/** Un nodo se marca dominado cuando su test se cumple. Nunca se desmarca. */
function marcarNodosDominados() {
 const reg = E.registroDe(HOY) || {};
 for (const [id, n] of Object.entries(PLAN.arbol || {})) {
 if (n.estado !== 'disponible' || !n.test) continue;
 const vals = valores((reg.notas || {})[n.test.ejercicio]);
 const ok = vals.length >= n.test.series && vals.every(v => v >= n.test.umbral);
 if (ok) E.marcarDominado(id, { fecha: HOY, valores: vals });
 }
}

function avisoGuardado(campo) {
 campo.classList.add('ok');
 setTimeout(() => campo.classList.remove('ok'), 1400);
 const a = $('#aviso');
 if (a) { a.textContent = 'Guardado'; a.classList.add('visible');
 setTimeout(() => a.classList.remove('visible'), 1400); }
}

function actualizarBarra() {
 const reg = E.registroDe(HOY) || {};
 const u = todos();
 const total = u.reduce((a, e) => a + (e.series || 1), 0);
 const hechas = u.reduce((a, e) => a + (((reg.series || {})[e.id] || []).length), 0);
 $('#barfill').style.width = total ? Math.round(hechas / total * 100) + '%' : '0%';
 $('#count').textContent = `${hechas} / ${total}`;
 const c = $('#cierre-cuenta'); if (c) c.textContent = hechas;
}

/* ============================================================
 FIGURAS
 ============================================================ */
async function abrirFigura(nombre, exId) {
 const ex = todos().find(e => e.id === exId);
 $('#fig-title').textContent = ex ? ex.nombre : 'Cómo se hace';
 const body = $('#fig-body');
 body.innerHTML = '<p class="hs-meta">Cargando…</p>';
 $('#figbox').hidden = false;
 let svg = '';
 try {
 const r = await fetch(`img/${nombre}.svg`, { cache: 'force-cache' });
 if (r.ok) svg = await r.text();
 } catch {}
 body.innerHTML = (svg || '<p class="hs-meta">Todavía no hay diagrama para este ejercicio.</p>') +
 (ex && ex.claves && ex.claves.length
 ? `<ul class="fig-claves">${ex.claves.map(c => `<li>${c}</li>`).join('')}</ul>` : '');
}

/* ============================================================
 PANEL
 ============================================================ */
function abrirPanel() {
 const est = E.cargar();
 const log = est.log;
 const rec = (id) => Math.max(0, ...Object.values(log).flatMap(e =>
 valores((e.notas || {})[id])));
 $('#panel-body').innerHTML = V.panel(PLAN, {
 sw: SW, log, checkins: leerCheckins(), catalogo: CONTENIDO.ejercicios.ejercicios,
 puerta: E.puertaMedica(), kb: E.tamanoUsadoKB(),
 diasSinRespaldar: E.diasSinRespaldar(),
 sesiones: Object.values(log).filter(e => e && e.hecho).length,
 recordColgada: rec('colgada-activa'), recordHollow: rec('hollow-hold'),
 }, CONTENIDO.arbol);
 $('#panel').hidden = false;
 wirePanel();
}

const leerCheckins = () => E.todosLosCheckins();

function wirePanel() {
 const ex = $('#exportar'); if (ex) ex.addEventListener('click', exportarCSV);
 const rp = $('#respaldo'); if (rp) rp.addEventListener('click', () => {
 descargar(`pole-respaldo-${HOY}.json`, E.respaldoJSON(), 'application/json');
 E.marcarRespaldado();
 rp.textContent = 'Respaldo descargado ✓';
 setTimeout(() => { rp.textContent = 'Descargar respaldo completo'; }, 2500);
 });
 const rc = $('#rehacer-checkin'); if (rc) rc.addEventListener('click', () => {
 E.borrarCheckin(HOY); location.reload();
 });
 const ce = $('#calendario-editar'); if (ce) ce.addEventListener('click', abrirCalendario);
 ['pm1','pm2'].forEach(id => { const i = $('#' + id); if (i) i.addEventListener('change', () => {
 E.guardarPuertaMedica({ control_1: $('#pm1').value, control_2: $('#pm2').value });
 calcular(); pintar(); abrirPanel();
 }); });
}

function abrirCalendario() {
 const cal = E.prefs().calendario || CONTENIDO.calendario.por_defecto;
 $('#panel-body').innerHTML = V.editorCalendario(cal, CONTENIDO.sesiones.tipos);
 $('#cal-guardar').addEventListener('click', () => {
 const nuevo = {};
 $$('[data-dia]', $('#panel-body')).forEach(s => { nuevo[s.dataset.dia] = s.value; });
 const err = validarCalendario(nuevo);
 if (err) { $('#cal-aviso').textContent = err; return; }
 E.guardarPrefs({ calendario: nuevo });
 calcular(); pintar(); $('#panel').hidden = true;
 });
}

/** Un calendario que rompe las reglas no se guarda. */
function validarCalendario(cal) {
 const tipos = CONTENIDO.sesiones.tipos;
 const carga = Object.values(cal).filter(t => tipos[t] && tipos[t].carga);
 const teatros = E.prefs().teatros_semana ?? 2;
 const tope = teatros >= 2 ? 3 : 4;
 if (carga.length > tope)
 return `Quedan ${carga.length} días de carga y el tope es ${tope}${teatros >= 2 ? ' (el teatro también cuenta como día de demanda)' : ''}.`;
 for (let d = 0; d < 7; d++) {
 const a = tipos[cal[String((d + 6) % 7)]], b = tipos[cal[String(d)]];
 if (a && b && a.carga && b.carga)
 return 'Hay dos sesiones de carga seguidas. Necesitan 48 horas entre ellas.';
 }
 return null;
}

/* ============================================================
 EXPORTAR
 ============================================================ */
function exportarCSV() {
 const est = E.cargar(), cks = leerCheckins(), cat = CONTENIDO.ejercicios.ejercicios;
 const filas = [['fecha','tipo','completada','energia','piernas','dolor_lumbar','manos',
 'ejercicio','series','logrado','rpe','corte_agarre','tbc_min']];
 for (const f of Object.keys(est.log).filter(x => !x.startsWith('__')).sort()) {
 const e = est.log[f], c = cks[f] || {};
 for (const id of new Set([...Object.keys(e.series || {}), ...Object.keys(e.notas || {})])) {
 filas.push([f, e.tipo || '', e.hecho ? 'si' : 'no', c.energia ?? '', c.piernas ?? '',
 c.dolor_lumbar ?? '', c.manos ?? '',
 (cat[id] || {}).nombre || id, (e.series || {})[id]?.length || 0,
 (e.notas || {})[id] || '', (e.rpe || {})[id] || '',
 (e.corte_agarre || {})[id] ? 'si' : '', e.tbc_seg ? Math.round(e.tbc_seg / 60) : '']);
 }
 }
 const csv = filas.map(r => r.map(v => {
 const s = String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
 }).join(',')).join('\n');
 descargar(`pole-registro-${HOY}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

function descargar(nombre, datos, tipo) {
 const blob = new Blob([datos], { type: tipo });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url; a.download = nombre;
 document.body.appendChild(a); a.click(); a.remove();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================
 GLOBAL
 ============================================================ */
let wired = false;
function wireGlobal() {
 if (wired) return; wired = true;
 const el = elTimer();
 $('#t-close').addEventListener('click', () => C.cerrar(el));
 $('#t-less').addEventListener('click', () => C.ajustar(-15, el));
 $('#t-more').addEventListener('click', () => C.ajustar(15, el));
 $('#btn-panel').addEventListener('click', abrirPanel);
 $('#panel-close').addEventListener('click', () => { $('#panel').hidden = true; });
 $('#panel').addEventListener('click', e => { if (e.target.id === 'panel') $('#panel').hidden = true; });
 $('#fig-close').addEventListener('click', () => { $('#figbox').hidden = true; });
 $('#figbox').addEventListener('click', e => { if (e.target.id === 'figbox') $('#figbox').hidden = true; });

 $('#days-row').addEventListener('click', e => {
 const b = e.target.closest('.daybtn'); if (!b) return;
 const cal = E.prefs().calendario || CONTENIDO.calendario.por_defecto;
 mostrarApp(cal[b.dataset.dia]);
 });
 $('#btn-min').addEventListener('click', () => mostrarApp('MIN'));

 document.addEventListener('keydown', e => {
 if (e.key !== 'Escape') return;
 if (!$('#timer').hidden) C.cerrar(el);
 else if (!$('#panel').hidden) $('#panel').hidden = true;
 else if (!$('#figbox').hidden) $('#figbox').hidden = true;
 });
 window.addEventListener('pagehide', () => {
 $$('[data-nota]').forEach(i => E.anotar(HOY, i.dataset.nota, i.value));
 });
}

init();
