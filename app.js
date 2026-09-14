/* ============================================================
 Pole — lógica de la app
 Sin dependencias. Todo el estado vive en localStorage.
 ============================================================ */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- almacenamiento ---------- */
const K = {
 log: 'pole.log', // { "2026-09-09": { dia, variante, series:{}, notas:{}, hecho } }
 checkin: 'pole.checkin', // { "2026-09-09": { energia, piernas, flags, veredicto } }
 videos: 'pole.videos', // { idEjercicio: url }
 variante: 'pole.variante', // "bici" | "caminata"
 nivel: 'pole.nivel' // { idEjercicio: {escalon, objetivo} }
};

function read(key, fb) {
 try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; }
 catch { return fb; }
}
function write(key, val) {
 try { localStorage.setItem(key, JSON.stringify(val)); return true; }
 catch { return false; }
}

/* ---------- fechas (siempre local, nunca UTC) ---------- */
function hoyISO(d = new Date()) {
 const p = n => String(n).padStart(2, '0');
 return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function diasEntre(isoA, isoB) {
 const [ay, am, ad] = isoA.split('-').map(Number);
 const [by, bm, bd] = isoB.split('-').map(Number);
 return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5);
}
function fechaLarga(d = new Date()) {
 return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ---------- estado en memoria ---------- */
let R = null; // rutina.json
let diaActual = 'a';
let varianteActual = read(K.variante, 'bici');
const HOY = hoyISO();

/* ============================================================
 ARRANQUE
 ============================================================ */
async function init() {
 try {
 R = await (await fetch('data/rutina.json', { cache: 'no-cache' })).json();
 } catch {
 document.body.innerHTML =
 '<div class="screen"><div class="ci-wrap"><h1 class="ci-title">No cargó la rutina</h1>' +
 '<p style="color:var(--muted)">Falta <code>data/rutina.json</code> o la app se abrió como archivo suelto. ' +
 'Tiene que servirse desde un servidor.</p></div></div>';
 return;
 }

 const ci = read(K.checkin, {});
 if (ci[HOY]) { mostrarApp(); } else { mostrarCheckin(); }

 registrarSW();
}

/* Estado del modo sin conexión, para poder diagnosticarlo desde el teléfono. */
let swEstado = { soportado: false, registrado: false, error: '', archivos: 0 };

async function registrarSW() {
 swEstado.soportado = 'serviceWorker' in navigator && window.isSecureContext;
 if (!('serviceWorker' in navigator)) { swEstado.error = 'El navegador no lo permite'; return; }
 if (!window.isSecureContext) {
 swEstado.error = 'La conexión no es de confianza: falta activar el certificado en Ajustes';
 return;
 }
 try {
 // scope explícito y sin caché HTTP: iOS es quisquilloso con ambas cosas
 await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
 await navigator.serviceWorker.ready;
 swEstado.registrado = true;
 } catch (e) {
 swEstado.error = (e && e.message) || 'No se pudo activar';
 }
 swEstado.archivos = await contarCache();

 // iOS detiene el service worker al pasar la app a segundo plano y a veces
 // pierde el registro. Al volver al frente lo comprobamos y lo rehacemos.
 document.addEventListener('visibilitychange', async () => {
 if (document.visibilityState !== 'visible') return;
 try {
 const reg = await navigator.serviceWorker.getRegistration('./');
 if (!reg) { swEstado.registrado = false; await registrarSW(); return; }
 reg.update().catch(() => {});
 swEstado.archivos = await contarCache();
 } catch {}
 });
}

async function contarCache() {
 try {
 if (!('caches' in window)) return 0;
 const nombres = await caches.keys();
 let n = 0;
 for (const k of nombres) n += (await (await caches.open(k)).keys()).length;
 return n;
 } catch { return 0; }
}

/* ============================================================
 CHECK-IN
 ============================================================ */
const respuesta = { energia: null, piernas: null, flags: {} };

function mostrarCheckin() {
 $('#checkin').hidden = false;
 $('#app').hidden = true;
 $('#ci-fecha').textContent = fechaLarga();

 // Entrena por la tarde: preguntar "cómo amaneciste" a las 6 pm no tiene sentido
 const h = new Date().getHours();
 $('#ci-title').textContent = h < 12 ? '¿Cómo amaneciste?' : '¿Cómo llegas?';
 $('#ci-energia').textContent = h < 12 ? 'Energía' : 'Energía ahora';

 $$('.scale').forEach(sc => {
 sc.addEventListener('click', e => {
 const b = e.target.closest('button'); if (!b) return;
 $$('button', sc).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
 respuesta[sc.dataset.field] = Number(b.dataset.v);
 });
 });

 $$('.flag').forEach(f => {
 f.addEventListener('click', () => {
 const on = f.getAttribute('aria-pressed') !== 'true';
 f.setAttribute('aria-pressed', String(on));
 respuesta.flags[f.dataset.flag] = on;
 });
 });

 $('#ci-go').addEventListener('click', () => {
 const v = evaluar(respuesta);
 const ci = read(K.checkin, {});
 ci[HOY] = { ...respuesta, veredicto: v.id };
 write(K.checkin, ci);
 mostrarVeredicto(v);
 });

 // Sin check-in no hay sesión completa: la ausencia de dato nunca es permiso.
 $('#ci-skip').addEventListener('click', () => {
 const ci = read(K.checkin, {});
 ci[HOY] = { saltado: true, veredicto: 'minima' };
 write(K.checkin, ci);
 mostrarVeredicto({
 id: 'minima', tono: 'warn', kicker: 'Sin check-in',
 titulo: 'Hoy, la versión corta',
 textos: ['Sin saber cómo llegas, la app no puede decidir si hoy toca la sesión completa. Te deja la de 15 minutos, que cuenta igual.',
 'Si quieres la completa, responde el check-in: son cuatro toques.'],
 ir: { dia: 'min', texto: 'Ir a la sesión de 15 minutos' },
 alt: { dia: null, texto: 'Mejor respondo el check-in' }
 });
 });
}

/* ---------- el motor de reglas ---------- */
function evaluar(r) {
 const diaHoy = R.calendario[String(new Date().getDay())];
 const info = R.dias[diaHoy];
 const esFuerza = info.tipo === 'fuerza';
 const esCardio = info.tipo === 'cardio';
 const hora = new Date().getHours();

 if (r.flags.irradiado) {
 return {
 id: 'parar', tono: 'stop', kicker: 'Hoy no',
 titulo: 'Hoy no se entrena',
 textos: [
 'Hormigueo o corrientazo bajando por la pierna no es agujetas: es una señal nerviosa, y entrenar encima la empeora.',
 'Descansa hoy y consulta antes de la siguiente sesión. Esto no se negocia con ganas.'
 ],
 ir: null, alt: { dia: diaHoy, texto: 'Ver la rutina de todos modos' }
 };
 }

 if (r.flags.lumbar) {
 return {
 id: 'retroceder', tono: 'warn', kicker: 'Con freno',
 titulo: 'Retrocede un escalón',
 textos: [
 'Dolor lumbar que lleva más de un día quiere decir que el volumen de la semana pasada fue demasiado.',
 'Hoy: un escalón menos de progresión en cada ejercicio. Si un ejercicio duele mientras lo haces, ese ejercicio se acabó por hoy.'
 ],
 ir: { dia: diaHoy, texto: 'Ir a la sesión, con un escalón menos' },
 alt: { dia: 'min', texto: 'Mejor la de 15 minutos' }
 };
 }

 if (r.flags.pulso || (r.energia !== null && r.energia <= 2)) {
 const motivo = r.flags.pulso
 ? 'El pulso arriba al despertar es el aviso de que todavía estás recuperando la sesión anterior.'
 : 'Con la energía en el piso, la sesión completa no construye: te cobra más de lo que deja.';
 if (esCardio) {
 return {
 id: 'cardio-corto', tono: 'warn', kicker: 'Versión corta',
 titulo: 'Solo el pedaleo suave',
 textos: [motivo, 'Hoy es cardio: haz la entrada y el bloque continuo suave, y sáltate el bloque del final salvo las piernas en la pared.'],
 ir: { dia: diaHoy, texto: 'Ir al cardio, versión suave' },
 alt: null
 };
 }
 return {
 id: 'minima', tono: 'warn', kicker: 'Versión corta',
 titulo: 'Hoy, los 15 minutos',
 textos: [motivo, 'Hacer la versión mínima cuenta como haber entrenado. Sin asterisco.'],
 ir: { dia: 'min', texto: 'Ir a la sesión de 15 minutos' },
 alt: { dia: diaHoy, texto: 'Me siento mejor de lo que marqué' }
 };
 }

 if (info.descanso_total) {
 return {
 id: 'sabado', tono: 'go', kicker: 'Sábado',
 titulo: 'Hoy descansas',
 textos: ['El descanso no es lo que sobra del plan: es cuando el cuerpo consolida lo de esta semana.'],
 ir: { dia: 's', texto: 'Ver el sábado' }, alt: null
 };
 }

 if (r.flags.sueno && info.prescindible) {
 return {
 id: 'quitar-domingo', tono: 'warn', kicker: 'Se cae',
 titulo: 'El domingo se cae esta semana',
 textos: [
 'Dos noches seguidas durmiendo mal: la movilidad del domingo es el día prescindible del plan, y hoy toca usar ese permiso.',
 'Si quieres algo, que sean las piernas arriba en la pared. Nada más.'
 ],
 ir: null, alt: { dia: 'e', texto: 'Ver la movilidad de todos modos' }
 };
 }

 if (esCardio && hora >= 20) {
 return {
 id: 'nocturno', tono: 'warn', kicker: 'Es tarde',
 titulo: 'Versión de noche',
 textos: [
 'Falta poco para dormir. Una sesión intensa a esta hora te quita más sueño del que te da entrenamiento, y tu sueño ya viene justo.',
 '15 minutos de pedaleo suave y las piernas en la pared. Eso cuenta.'
 ],
 ir: { dia: diaHoy, texto: 'Ir al cardio, versión corta', corto: true },
 alt: { dia: diaHoy, texto: 'Hacer la sesión completa' }
 };
 }

 const pesadas = r.piernas !== null && r.piernas >= 4;
 return {
 id: 'completa', tono: 'go', kicker: 'Vía libre',
 titulo: esFuerza ? info.nombre : info.nombre,
 textos: pesadas
 ? ['Piernas pesadas hoy: haz la sesión completa, y alarga las piernas en la pared del final a 8 minutos.']
 : ['Sesión completa. RPE 6–7: terminas cada serie sintiendo que te sobraban dos o tres repeticiones.'],
 ir: { dia: diaHoy, texto: 'Empezar' },
 alt: { dia: 'min', texto: 'Hoy solo puedo 15 minutos' }
 };
}

function mostrarVeredicto(v) {
 $('#checkin').hidden = true;
 $('#veredicto').hidden = false;

 const card = $('#ver-card');
 card.className = 'verdict ' + v.tono;
 card.innerHTML =
 `<p class="v-kicker">${v.kicker}</p><h2>${v.titulo}</h2>` +
 v.textos.map(t => `<p>${t}</p>`).join('');

 const go = $('#ver-go'), alt = $('#ver-alt');
 if (v.ir) {
 go.hidden = false; go.textContent = v.ir.texto;
 go.onclick = () => { $('#veredicto').hidden = true; mostrarApp(v.ir.dia, v.ir.corto); };
 } else { go.hidden = true; }

 if (v.alt) {
 alt.hidden = false; alt.textContent = v.alt.texto;
 alt.onclick = () => {
 $('#veredicto').hidden = true;
 if (v.alt.dia === null) { // volver a responder el check-in
 const ci = read(K.checkin, {}); delete ci[HOY]; write(K.checkin, ci);
 location.reload(); return;
 }
 mostrarApp(v.alt.dia, v.alt.corto);
 };
 } else { alt.hidden = true; }
}

/* ============================================================
 APP — selector de días
 ============================================================ */
let modoCorto = false;

function mostrarApp(dia, corto) {
 $('#checkin').hidden = true;
 $('#veredicto').hidden = true;
 $('#app').hidden = false;
 modoCorto = !!corto;

 construirSelector();
 wireGlobales();
 irA(dia || R.calendario[String(new Date().getDay())]);
 pintarPie();
}

function construirSelector() {
 const orden = [['a','L'],['d1','M'],['b','X'],['d2','J'],['c','V'],['s','S'],['e','D']];
 $('#days-row').innerHTML = orden.map(([id, letra]) => {
 const d = R.dias[id];
 return `<button type="button" class="daybtn" data-day="${id}" data-kind="${d.tipo}" aria-pressed="false">${letra}<i></i></button>`;
 }).join('');

 $$('.daybtn, .badbtn').forEach(b => {
 b.addEventListener('click', () => { modoCorto = false; irA(b.dataset.day); });
 });
}

function irA(dia) {
 diaActual = dia;
 $$('.daybtn, .badbtn').forEach(b =>
 b.setAttribute('aria-pressed', String(b.dataset.day === dia)));
 pintarDia();
 window.scrollTo(0, 0);
}

/* ---------- ejercicios del día, resolviendo variantes ---------- */
function ejerciciosDe(dia) {
 if (modoCorto && R.dias[dia].tipo === 'cardio') return R.cardio_corto.ejercicios;
 const d = R.dias[dia];
 if (d.variantes) return d.variantes[varianteActual].ejercicios;
 return d.ejercicios;
}

/* Items de calentamiento y enfriamiento, normalizados como ejercicios de 1 serie. */
function bloquesDelDia(dia) {
 const d = R.dias[dia] || {}, B = R.bloques_comunes, out = [];
 if (d.apertura) out.push(B.apertura);
 if (d.articular) out.push(B.articular);
 if (d.salida_comun) out.push(B.salida_comun);
 if (d.salida && B.salidas[d.salida]) out.push(B.salidas[d.salida]);
 if (d.drenaje) out.push(B.drenaje);
 return out;
}
function itemsDeBloques(dia) {
 return bloquesDelDia(dia).flatMap(b => b.items).map(i => ({ ...i, series: 1 }));
}

/* Todo lo que cuenta para el progreso, EN EL ORDEN EN QUE SE HACE.
 El orden importa: de aquí sale el "qué sigue" del cronómetro. */
function unidadesDelDia(dia) {
 const d = R.dias[dia] || {};
 const uno = i => ({ ...i, series: 1 });
 const B = R.bloques_comunes;
 return []
 .concat(d.apertura ? B.apertura.items.map(uno) : [])
 .concat(d.articular ? B.articular.items.map(uno) : [])
 .concat(ejerciciosDe(dia))
 .concat(d.salida_comun ? B.salida_comun.items.map(uno) : [])
 .concat(d.salida && B.salidas[d.salida] ? B.salidas[d.salida].items.map(uno) : [])
 .concat(d.drenaje ? B.drenaje.items.map(uno) : []);
}

/* Qué toca después de marcar una serie: repetir el mismo ejercicio o pasar al siguiente. */
function contextoTras(exId) {
 const us = unidadesDelDia(diaActual);
 const i = us.findIndex(u => u.id === exId);
 if (i < 0) return null;

 const ex = us[i];
 const log = registroHoy();
 const hechas = (log.series && log.series[exId] || []).length;
 const clave = u => (u.claves && u.claves[0]) || u.para || '';

 if (hechas < ex.series) {
 return { titulo: 'Ahora vuelves a', nombre: ex.nombre,
 detalle: `Serie ${hechas + 1} de ${ex.series} · ${ex.dosis}`, clave: clave(ex) };
 }

 const sem = semanaActual();
 const sig = us.slice(i + 1).find(u => !(u.desde_semana && sem < u.desde_semana));
 if (!sig) {
 return { titulo: 'Y con esto', nombre: 'terminaste la sesión', detalle: '', clave: '' };
 }
 return { titulo: 'Después sigue', nombre: sig.nombre,
 detalle: `${sig.series > 1 ? sig.series + ' × ' : ''}${sig.dosis}`, clave: clave(sig) };
}

function semanaActual() {
 return Math.floor(diasEntre(R.bloque.inicio, HOY) / 7) + 1;
}


/* ============================================================
 PROGRESIÓN — la app mira lo que hiciste y decide lo de hoy
 Doble progresión: primero suben las repeticiones dentro del
 escalón; cuando llegas al techo, cambia el escalón y vuelve
 a empezar por abajo. Si te quedas corta dos veces seguidas,
 baja. El cuerpo manda, no el calendario.
 ============================================================ */

/* "12, 10, 8" → [12, 10, 8] */
function valores(txt) {
 return String(txt || '').split(/[^0-9]+/).map(Number).filter(n => n > 0);
}

/* Las dos últimas sesiones en las que se tocó este ejercicio. */
function ultimasDe(exId, n = 2) {
 const log = read(K.log, {});
 return Object.keys(log).sort().reverse()
 .filter(f => f !== HOY && log[f].notas && valores(log[f].notas[exId]).length)
 .slice(0, n)
 .map(f => ({ fecha: f, vals: valores(log[f].notas[exId]),
 series: (log[f].series && log[f].series[exId] || []).length }));
}

function nivelDe(exId) {
 return read(K.nivel, {})[exId] || null;
}
function guardarNivel(exId, v) {
 const n = read(K.nivel, {}); n[exId] = v; write(K.nivel, n);
}

/* Qué toca hoy en este ejercicio, mirando lo que pasó la última vez. */
function plan(ex) {
 if (!ex.escalones || !ex.escalones.length) return null;

 const tope = ex.escalones.length - 1;
 let est = nivelDe(ex.id);
 if (!est) est = { escalon: 0, objetivo: ex.escalones[0].min };

 const prev = ultimasDe(ex.id, 2);
 let nota = '';

 if (est.fijado) {
 // lo ajustaste a mano: se respeta hasta que haya datos nuevos
 const esc0 = ex.escalones[Math.min(est.escalon, tope)];
 return { escalon: est.escalon, tope, nombre: esc0.nombre, objetivo: est.objetivo,
 unidad: ex.unidad === 'tiempo' ? 'seg' : 'reps',
 nota: 'Escalón elegido por ti. Anota lo que salga y desde ahí sigo yo.',
 previa: prev[0] || null };
 }

 if (prev.length) {
 const u = prev[0];
 const esc = ex.escalones[Math.min(est.escalon, tope)];
 const completas = u.vals.filter(v => v >= est.objetivo).length;
 const seriesPlan = ex.series;

 if (completas >= seriesPlan && est.objetivo >= esc.max) {
 // techo del escalón con todas las series: siguiente variante
 if (est.escalon < tope) {
 est = { escalon: est.escalon + 1, objetivo: ex.escalones[est.escalon + 1].min };
 nota = 'Subes de escalón: la última vez completaste todas las series en el techo.';
 } else {
 est = { escalon: tope, objetivo: est.objetivo + (ex.unidad === 'tiempo' ? 5 : 1) };
 nota = 'Ya estás en el escalón más alto: sube el número.';
 }
 } else if (completas >= seriesPlan) {
 est = { escalon: est.escalon, objetivo: Math.min(esc.max, est.objetivo + (ex.unidad === 'tiempo' ? 5 : 1)) };
 nota = 'Completaste todas las series: hoy una más.';
 } else if (completas === 0 &&
 (Math.max(...u.vals) < est.objetivo * 0.6 ||
 (prev.length >= 2 && prev[1].vals.filter(v => v >= est.objetivo).length === 0))) {
 // muy por debajo una vez, o por debajo dos seguidas: el escalón está alto
 if (est.escalon > 0) {
 est = { escalon: est.escalon - 1, objetivo: ex.escalones[est.escalon - 1].max };
 nota = 'Dos veces seguidas por debajo: bajas un escalón. No es retroceder, es coger base.';
 } else {
 est = { escalon: 0, objetivo: Math.max(1, est.objetivo - (ex.unidad === 'tiempo' ? 5 : 1)) };
 nota = 'Bajamos el número: la meta estaba muy alta para arrancar.';
 }
 } else {
 nota = 'Mismo objetivo que la última vez: consolidar antes de subir.';
 }
 } else {
 nota = 'Primera vez: empieza por aquí y anota lo que salga.';
 }

 // El motor PROPONE; solo se persiste cuando ella registra datos (ver aplicarPlan).
 const esc = ex.escalones[Math.min(est.escalon, tope)];
 return {
 escalon: est.escalon, tope, nombre: esc.nombre, objetivo: est.objetivo,
 estadoPropuesto: est,
 unidad: ex.unidad === 'tiempo' ? 'seg' : 'reps', nota,
 previa: prev[0] || null
 };
}

/* ============================================================
 RENDER DEL DÍA
 ============================================================ */
function pintarDia() {
 const d = R.dias[diaActual];
 const main = $('#main');
 const sem = semanaActual();
 let html = '';

 html += `<div class="day-head"><div class="letra">${d.letra} · ${d.etiqueta}</div><h2>${d.nombre}</h2></div>`;
 if (d.nota) html += `<p class="day-note">${d.nota}</p>`;

 if (d.descanso_total) {
 html += `<div class="libre">${d.texto.map(t => `<p>${md(t)}</p>`).join('')}</div>`;
 main.innerHTML = html;
 actualizarBarra();
 return;
 }

 if (d.variantes) {
 if (modoCorto) {
 html += `<p class="block-note" style="color:var(--chalk)">${R.cardio_corto.nota}</p>`;
 } else {
 html += '<div class="variantes">' + Object.entries(d.variantes).map(([k, v]) =>
 `<button type="button" class="varbtn" data-var="${k}" aria-pressed="${k === varianteActual}">${v.nombre}</button>`
 ).join('') + '</div>';
 html += `<p class="block-note">${d.variantes[varianteActual].nota}</p>`;
 }
 }

 if (d.apertura) html += bloqueSimple(R.bloques_comunes.apertura);
 if (d.articular) html += bloqueSimple(R.bloques_comunes.articular);

 if (d.aviso_agarre && R.agarre) {
 html += `<div class="agarre">
 <h3>${R.agarre.titulo}</h3>
 ${R.agarre.texto.map(t => `<p>${md(t)}</p>`).join('')}
 <details class="agarre-mas">
 <summary>Cómo cuidar el callo</summary>
 <ul>${R.agarre.cuidado.map(c => `<li>${c}</li>`).join('')}</ul>
 </details>
 </div>`;
 }

 const ejs = ejerciciosDe(diaActual);
 html += '<ol class="ex-list">' + ejs.map((e, i) => tarjetaEjercicio(e, i, sem)).join('') + '</ol>';

 if (d.salida_comun) html += bloqueSimple(R.bloques_comunes.salida_comun);
 if (d.salida && R.bloques_comunes.salidas[d.salida])
 html += bloqueSimple(R.bloques_comunes.salidas[d.salida]);
 if (d.drenaje) html += bloqueSimple(R.bloques_comunes.drenaje);

 if (!d.descanso_total) html += cierreHTML();

 html += `<div class="regla"><p>${md(`**La única regla que aplica a todo:** ${R.regla_maestra}`)}</p></div>`;

 main.innerHTML = html;
 wireDia();
 actualizarBarra();
}

/* Al cerrar: qué pasó hoy y qué cambia la próxima vez. */
function resumenDeCierre() {
 const log = registroHoy();
 const ejs = ejerciciosDe(diaActual).filter(e => e.escalones);
 const anotados = ejs.filter(e => (log.notas && log.notas[e.id] || '').trim());

 const lineas = anotados.map(e => {
 const v = valores(log.notas[e.id]);
 const n = nivelDe(e.id) || {};
 const obj = n.objetivo || 0;
 const ok = v.filter(x => x >= obj).length;
 const estado = ok >= e.series ? 'sube' : ok === 0 && v.length ? 'baja' : 'igual';
 const txt = { sube: 'la próxima, una más', baja: 'la próxima bajamos un punto', igual: 'mismo objetivo la próxima' }[estado];
 return `<li class="rc-${estado}"><b>${e.nombre}</b><span>${v.join(', ')} · ${txt}</span></li>`;
 });

 const body = $('#panel-body');
 body.innerHTML = `
 <div class="cierre-res">
 <p class="cr-tit">Listo por hoy.</p>
 ${lineas.length
 ? `<ul class="rc">${lineas.join('')}</ul>`
 : '<p class="ci-det">No anotaste números hoy. Sin ellos la app no puede ajustar la próxima sesión — vale la pena dedicarles los 20 segundos.</p>'}
 <p class="ci-pie">Queda guardado con la fecha de hoy. Lo ves en el historial cuando quieras.</p>
 </div>`;
 $('#panel').hidden = false;
}

/* Cerrar la sesión es un acto deliberado: la app no adivina si terminaste. */
function cierreHTML() {
 const log = registroHoy();
 const ejs = unidadesDelDia(diaActual);
 const sem = semanaActual();
 const activos = ejs.filter(e => !(e.desde_semana && sem < e.desde_semana));
 const total = activos.reduce((a, e) => a + e.series, 0);
 const hechas = activos.reduce((a, e) => a + ((log.series && log.series[e.id] || []).length), 0);
 const pct = total ? Math.round(hechas / total * 100) : 0;

 if (log.hecho) {
 const h = log.cerrada ? new Date(log.cerrada).toLocaleTimeString('es-CO',
 { hour: '2-digit', minute: '2-digit' }) : '';
 return `<div class="cierre hecho">
 <p class="ci-ok">Sesión cerrada${h ? ' a las ' + h : ''}</p>
 <p class="ci-det">${hechas} de ${total} series · queda guardada con la fecha de hoy.</p>
 <button type="button" class="btn-ghost" id="reabrir">Reabrir para seguir anotando</button>
 </div>`;
 }

 return `<div class="cierre">
 <p class="ci-det">Llevas <b>${hechas} de ${total}</b> series${pct ? ` · ${pct}%` : ''}.</p>
 <button type="button" class="btn-primary" id="cerrar-sesion">Terminé por hoy</button>
 <p class="ci-pie">No hace falta completarlo todo: lo que hiciste cuenta igual.</p>
 </div>`;
}

function bloqueSimple(b) {
 const log = registroHoy();
 const hechos = b.items.filter(i => (log.series && log.series[i.id] || []).length).length;
 return `<div class="block">
 <div class="block-head">
 <h3>${b.nombre}</h3>
 <span class="block-mins">${b.mins} min${b.cuando ? ' · ' + b.cuando : ''}</span>
 <span class="block-count ${hechos === b.items.length ? 'full' : ''}">${hechos}/${b.items.length}</span>
 </div>
 ${b.nota ? `<p class="block-note">${b.nota}</p>` : ''}
 <ul class="simple">${b.items.map(i => {
 const done = (log.series && log.series[i.id] || []).length > 0;
 const video = urlSegura(read(K.videos, {})[i.id] || i.video);
 const nota = (log.notas && log.notas[i.id]) || '';
 const unidad = i.modo === 'tiempo' ? 'seg' : 'reps';
 const ayuda = /×|2 ×/.test(i.dosis) ? `${unidad} de cada vez` : `${unidad} que lograste`;
 return `<li class="${done ? 'done' : ''}">
 <input type="checkbox" class="chk chk-sm" data-item="${i.id}" ${done ? 'checked' : ''} aria-label="${i.nombre}">
 <div class="n">
 <span class="t">${i.nombre}</span>${i.para ? `<span class="para">${i.para}</span>` : ''}
 <span class="logro">
 <input type="text" inputmode="numeric" data-nota="${i.id}" value="${attr(nota)}"
 placeholder="—" aria-label="${ayuda} en ${i.nombre}">
 <label>${ayuda}</label>
 </span>
 </div>
 <span class="acts">
 ${video ? `<a class="mini" href="${video}" target="_blank" rel="noopener" aria-label="Ver video de ${i.nombre}">▶</a>` : ''}
 ${i.infografia ? `<button type="button" class="mini fig" data-fig="${i.infografia}" data-ex="${i.id}" aria-label="Diagrama de ${i.nombre}">◧</button>` : ''}
 <span class="d">${i.dosis}</span>
 </span>
 </li>`;
 }).join('')}</ul>
 </div>`;
}

function tarjetaEjercicio(e, i, sem) {
 const log = registroHoy();
 const marcadas = (log.series && log.series[e.id]) || [];
 const bloqueado = e.desde_semana && sem < e.desde_semana;
 const done = !bloqueado && marcadas.length >= e.series;

 const series = Array.from({ length: e.series }, (_, s) =>
 `<button type="button" class="serie" data-ex="${e.id}" data-serie="${s}" aria-pressed="${marcadas.includes(s)}" aria-label="Serie ${s + 1}">${s + 1}</button>`
 ).join('');

 const video = urlSegura(read(K.videos, {})[e.id] || e.video);
 const tools = [];
 if (e.modo === 'tiempo' && e.segundos) {
 tools.push(`<button type="button" class="tool" data-timer="hold" data-ex="${e.id}">▶ ${fmt(e.segundos)}</button>`);
 }
 if (video) tools.push(`<a class="tool play" href="${video}" target="_blank" rel="noopener">▶ Ver el video</a>`);
 else if (e.busqueda) tools.push(`<a class="tool play" href="https://www.youtube.com/results?search_query=${encodeURIComponent(e.busqueda)}" target="_blank" rel="noopener">▶ Buscar video</a>`);
 if (e.infografia) tools.push(`<button type="button" class="tool fig" data-fig="${e.infografia}" data-ex="${e.id}">Cómo se hace</button>`);
 if (video && e.busqueda) tools.push(`<a class="tool" href="https://www.youtube.com/results?search_query=${encodeURIComponent(e.busqueda)}" target="_blank" rel="noopener">otros</a>`);

 const nota = (log.notas && log.notas[e.id]) || '';
 const unidad = e.modo === 'tiempo' ? 'seg' : 'reps';
 const ayuda = e.series > 1 ? `${unidad} de cada serie` : `${unidad} que lograste`;
 const ejemplo = e.series > 1
 ? Array.from({ length: Math.min(e.series, 3) }, () => '—').join(', ')
 : '—';

 const pg = bloqueado ? null : plan(e);
 const dosisHoy = pg ? `${e.series} × ${pg.objetivo} ${pg.unidad}` : `${e.series > 1 ? e.series + ' × ' : ''}${e.dosis}`;

 return `<li class="ex ${done ? 'done' : ''} ${bloqueado ? 'bloqueado' : ''}">
 <div class="ex-head">
 <div class="ex-name"><span class="ex-num">${i + 1}</span>${e.nombre}</div>
 <div class="ex-dose">${dosisHoy}</div>
 </div>
 ${pg ? `<div class="plan">
 <div class="plan-esc">
 <span class="plan-n">Escalón ${pg.escalon + 1} de ${pg.tope + 1}</span>
 <span class="plan-v">${pg.nombre}</span>
 </div>
 ${pg.previa ? `<p class="plan-prev">La vez pasada: <b>${pg.previa.vals.join(', ')}</b></p>` : ''}
 <p class="plan-nota">${pg.nota}</p>
 <div class="plan-ajuste">
 <button type="button" class="aj" data-aj="baja" data-ex="${e.id}"
 ${pg.escalon === 0 ? 'disabled' : ''} aria-label="Bajar un escalón">− fácil</button>
 <button type="button" class="aj" data-aj="sube" data-ex="${e.id}"
 ${pg.escalon >= pg.tope ? 'disabled' : ''} aria-label="Subir un escalón">+ difícil</button>
 <span class="aj-nota">si no te cuadra</span>
 </div>
 </div>` : ''}
 ${e.claves && e.claves.length ? `<ul class="ex-claves">${e.claves.map(c => `<li>${c}</li>`).join('')}</ul>` : ''}
 ${e.progresion && !pg ? `<p class="ex-prog"><b>Progresión:</b> ${e.progresion}</p>` : ''}
 ${bloqueado ? `<p class="ex-prog" style="color:var(--chalk)">Todavía no: empieza en la semana ${e.desde_semana}. Vas en la ${sem}.</p>` : `
 <div class="series">${series}${e.descanso ? `<button type="button" class="tool" data-timer="rest" data-ex="${e.id}">descanso ${e.descanso}s</button>` : ''}</div>
 <div class="ex-tools">${tools.join('')}</div>
 <div class="ex-log">
 <input type="text" inputmode="numeric" data-nota="${e.id}" value="${attr(nota)}"
 placeholder="${ejemplo}" aria-label="${ayuda} de ${e.nombre}">
 <label>${ayuda}</label>
 </div>`}
 </li>`;
}

/* ============================================================
 INTERACCIÓN DEL DÍA
 ============================================================ */
function wireDia() {
 $$('.varbtn').forEach(b => b.addEventListener('click', () => {
 varianteActual = b.dataset.var;
 write(K.variante, varianteActual);
 pintarDia();
 }));

 $$('.serie').forEach(b => b.addEventListener('click', () => {
 desbloquearAudio();
 const on = b.getAttribute('aria-pressed') !== 'true';
 b.setAttribute('aria-pressed', String(on));

 const log = registroHoy();
 log.series = log.series || {};
 const arr = new Set(log.series[b.dataset.ex] || []);
 const n = Number(b.dataset.serie);
 on ? arr.add(n) : arr.delete(n);
 log.series[b.dataset.ex] = Array.from(arr).sort((x, y) => x - y);
 guardarRegistro(log);

 const ex = todosLosEjercicios().find(e => e.id === b.dataset.ex);
 const card = b.closest('.ex');
 if (card) card.classList.toggle('done', log.series[b.dataset.ex].length >= ex.series);

 actualizarBarra();
 if (on && ex && ex.descanso) abrirTimer('rest', ex, contextoTras(ex.id));
 }));

 $$('[data-timer]').forEach(b => b.addEventListener('click', () => {
 desbloquearAudio();
 const ex = todosLosEjercicios().find(e => e.id === b.dataset.ex);
 if (ex) abrirTimer(b.dataset.timer, ex);
 }));

 $$('[data-nota]').forEach(inp => {
 let t = null;
 const marca = () => guardarNota(inp.dataset.nota, inp.value, inp);
 inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(marca, 500); });
 inp.addEventListener('change', () => { clearTimeout(t); marca(); });
 inp.addEventListener('blur', () => { clearTimeout(t); marca(); });
 });

 $$('[data-item]').forEach(c => c.addEventListener('change', () => {
 desbloquearAudio();
 const log = registroHoy();
 log.series = log.series || {};
 log.series[c.dataset.item] = c.checked ? [0] : [];
 guardarRegistro(log);

 const li = c.closest('li');
 if (li) li.classList.toggle('done', c.checked);

 // el contador del bloque, sin repintar toda la vista
 const ul = c.closest('.simple');
 const cont = ul && ul.parentElement.querySelector('.block-count');
 if (ul && cont) {
 const n = $$('[data-item]', ul).filter(x => x.checked).length;
 const t = $$('[data-item]', ul).length;
 cont.textContent = `${n}/${t}`;
 cont.classList.toggle('full', n === t);
 }
 actualizarBarra();
 }));

 $$('[data-aj]').forEach(b => b.addEventListener('click', () => {
 const ex = todosLosEjercicios().find(x => x.id === b.dataset.ex);
 if (!ex || !ex.escalones) return;
 const est = nivelDe(ex.id) || { escalon: 0, objetivo: ex.escalones[0].min };
 const n = b.dataset.aj === 'sube'
 ? Math.min(ex.escalones.length - 1, est.escalon + 1)
 : Math.max(0, est.escalon - 1);
 guardarNivel(ex.id, { escalon: n, objetivo: ex.escalones[n].min, fijado: true });
 pintarDia();
 }));

 const bc = $('#cerrar-sesion');
 if (bc) bc.addEventListener('click', () => {
 guardarPendientes();
 const log = registroHoy();
 log.hecho = true;
 log.cerrada = Date.now();
 guardarRegistro(log);
 pintarDia();
 resumenDeCierre();
 });

 const br = $('#reabrir');
 if (br) br.addEventListener('click', () => {
 const log = registroHoy();
 log.hecho = false; delete log.cerrada;
 guardarRegistro(log);
 pintarDia();
 });

 $$('[data-fig]').forEach(b => b.addEventListener('click', () => abrirFigura(b.dataset.fig, b.dataset.ex)));
}

function todosLosEjercicios() {
 const out = [];
 Object.values(R.dias).forEach(d => {
 if (d.variantes) Object.values(d.variantes).forEach(v => out.push(...v.ejercicios));
 else out.push(...(d.ejercicios || []));
 });
 out.push(...R.cardio_corto.ejercicios);
 const BC = R.bloques_comunes;
 [BC.apertura, BC.articular, BC.salida_comun, BC.drenaje, ...Object.values(BC.salidas)]
 .forEach(b => out.push(...b.items.map(i => ({ ...i, series: 1 }))));
 return out;
}

/* ---------- guardado de lo logrado ----------
 Se guarda solo, pero hay que decírselo a quien lo escribe: un campo que no
 confirma nada se siente como un campo que no guarda. */
let avisoId = null;
function guardarNota(id, valor, campo) {
 const log = registroHoy();
 log.notas = log.notas || {};
 log.notas[id] = String(valor).trim();
 guardarRegistro(log);

 // hay datos nuevos: el motor vuelve a tomar el mando y su propuesta se hace firme
 const niv = read(K.nivel, {});
 if (niv[id] && niv[id].fijado) { delete niv[id].fijado; write(K.nivel, niv); }
 const ex = todosLosEjercicios().find(x => x.id === id);
 if (ex && ex.escalones) {
 const pg = plan(ex);
 if (pg && pg.estadoPropuesto) guardarNivel(id, pg.estadoPropuesto);
 }

 if (campo) {
 campo.classList.add('ok');
 clearTimeout(avisoId);
 avisoId = setTimeout(() => campo.classList.remove('ok'), 1400);
 }
 const av = $('#aviso');
 if (av) {
 av.textContent = 'Guardado';
 av.classList.add('visible');
 setTimeout(() => av.classList.remove('visible'), 1400);
 }
}

/* Si cierra la app con el teclado abierto, el evento change no llega: guardamos aquí. */
function guardarPendientes() {
 $$('[data-nota]').forEach(inp => {
 const log = registroHoy();
 const previo = (log.notas && log.notas[inp.dataset.nota]) || '';
 if (inp.value.trim() !== previo) guardarNota(inp.dataset.nota, inp.value, null);
 });
}

/* ---------- registro ---------- */
function registroHoy() {
 const log = read(K.log, {});
 return log[HOY] || { dia: diaActual, variante: varianteActual, series: {}, notas: {} };
}
function guardarRegistro(entrada) {
 const log = read(K.log, {});
 // 'dia' y 'tipo' se fijan la PRIMERA vez y no se reescriben: si no, mirar otro
 // día reetiquetaría la sesión de hoy y envenenaría el conteo de días de carga.
 if (entrada.dia === undefined) entrada.dia = diaActual;
 if (entrada.tipo === undefined) entrada.tipo = R.dias[entrada.dia] ? R.dias[entrada.dia].tipo : null;
 entrada.variante = varianteActual;
 const ejs = unidadesDelDia(diaActual);
 const total = ejs.reduce((a, e) => a + e.series, 0);
 const hechas = ejs.reduce((a, e) => a + ((entrada.series[e.id] || []).length), 0);
 // 'hecho' lo decide ella con el botón de cerrar; esto solo es el avance
 entrada.avance = total ? hechas / total : 0;
 if (entrada.hecho === undefined) entrada.hecho = false;
 log[HOY] = entrada;
 write(K.log, log);
}

function actualizarBarra() {
 const ejs = unidadesDelDia(diaActual);
 const sem = semanaActual();
 const activos = ejs.filter(e => !(e.desde_semana && sem < e.desde_semana));
 const total = activos.reduce((a, e) => a + e.series, 0);
 const log = registroHoy();
 const hechas = activos.reduce((a, e) => a + ((log.series && log.series[e.id] || []).length), 0);
 $('#barfill').style.width = total ? Math.round(hechas / total * 100) + '%' : '0%';
 $('#count').textContent = `${hechas} / ${total}`;
 $('#count').hidden = total === 0;

 const btn = $(`.daybtn[data-day="${diaActual}"]`);
 if (btn) btn.classList.toggle('hecho', total > 0 && hechas >= total * 0.6);
}

/* ============================================================
 CRONÓMETRO
 ============================================================ */
let tId = null, tRestan = 0, wakeLock = null;

async function pedirWakeLock() {
 try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
function soltarWakeLock() {
 try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch {}
}

let audioCtx = null;
function desbloquearAudio() {
 if (audioCtx) return;
 try {
 audioCtx = new (window.AudioContext || window.webkitAudioContext)();
 if (audioCtx.state === 'suspended') audioCtx.resume();
 } catch {}
}
function beep() {
 if (!audioCtx) return;
 try {
 [0, 0.22, 0.44].forEach(t => {
 const o = audioCtx.createOscillator(), g = audioCtx.createGain();
 o.type = 'sine'; o.frequency.value = 880;
 g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
 g.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + t + 0.02);
 g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.18);
 o.connect(g); g.connect(audioCtx.destination);
 o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.2);
 });
 } catch {}
}

function fmt(s) {
 const m = Math.floor(s / 60), r = s % 60;
 return m ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
}

function abrirTimer(modo, ex, ctx) {
 const box = $('#timer');
 tRestan = modo === 'rest' ? ex.descanso : (ex.segundos || 30);
 if (!tRestan) return;

 box.hidden = false;
 box.classList.remove('ring');
 $('#t-label').textContent = modo === 'rest' ? 'Descanso' : 'Sostén';
 $('#t-ex').textContent = ex.nombre;

 // Durante el descanso: qué viene, para irse alistando
 const next = $('#t-next');
 if (ctx) {
 next.hidden = false;
 next.innerHTML =
 `<p class="tn-kicker">${ctx.titulo}</p>` +
 `<p class="tn-name">${ctx.nombre}</p>` +
 (ctx.detalle ? `<p class="tn-dose">${ctx.detalle}</p>` : '') +
 (ctx.clave ? `<p class="tn-clave">${ctx.clave}</p>` : '');
 } else {
 next.hidden = true;
 }
 pedirWakeLock();

 const pinta = () => { $('#t-num').textContent = fmt(Math.max(0, tRestan)); };
 pinta();

 clearInterval(tId);
 tId = setInterval(() => {
 tRestan--;
 pinta();
 if (tRestan <= 0) {
 clearInterval(tId); tId = null;
 box.classList.add('ring');
 $('#t-num').textContent = modo === 'rest' ? '¡Vamos!' : '¡Listo!';
 beep();
 }
 }, 1000);
}

function cerrarTimer() {
 clearInterval(tId); tId = null;
 $('#timer').hidden = true;
 $('#timer').classList.remove('ring');
 soltarWakeLock();
}

/* ============================================================
 INFOGRAFÍAS
 ============================================================ */
async function abrirFigura(nombre, exId) {
 const ex = todosLosEjercicios().find(e => e.id === exId);
 $('#fig-title').textContent = ex ? ex.nombre : 'Cómo se hace';
 const body = $('#fig-body');
 body.innerHTML = '<p style="color:var(--muted);font-size:.875rem">Cargando…</p>';
 $('#figbox').hidden = false;

 let dibujo = '';
 try {
 const r = await fetch(`img/${nombre}.svg`, { cache: 'force-cache' });
 if (r.ok) dibujo = await r.text();
 } catch {}
 if (!dibujo) {
 try {
 const r = await fetch(`img/${nombre}.png`, { method: 'HEAD' });
 if (r.ok) dibujo = `<img src="img/${nombre}.png" alt="${ex ? ex.nombre : nombre}">`;
 } catch {}
 }

 body.innerHTML = (dibujo || '<p style="color:var(--muted);font-size:.875rem">Todavía no hay diagrama para este ejercicio.</p>')
 + (ex && ex.claves && ex.claves.length
 ? `<ul class="fig-claves">${ex.claves.map(c => `<li>${c}</li>`).join('')}</ul>` : '');
}

/* ============================================================
 PANEL DE PROGRESO
 ============================================================ */
function abrirPanel() {
 const log = read(K.log, {});
 const ci = read(K.checkin, {});
 const sem = semanaActual();

 const fechas = Object.keys(log).filter(f => log[f].hecho).sort();
 const fuerza = fechas.filter(f => log[f].tipo === 'fuerza').length;

 // Adherencia = ventana móvil de 14 días (Sakti 2). No hay contador de días
 // consecutivos: un número que se resetea a 0 es una mecánica de pérdida, y con
 // antecedente de burnout se lee como fracaso, no como dato.
 let ultimos14 = 0;
 for (let i = 0; i < 14; i++) {
 const d = new Date(); d.setDate(d.getDate() - i);
 if ((log[hoyISO(d)] || {}).hecho) ultimos14++;
 }

 const rec = { colgada: 0, hollow: 0 };
 Object.values(log).forEach(e => {
 if (!e.notas) return;
 Object.entries(e.notas).forEach(([id, val]) => {
 // "12, 10, 8" o "12": el récord es el mejor de la sesión
 const n = Math.max(0, ...String(val).split(/[^0-9]+/).map(Number).filter(Boolean));
 if (!n) return;
 const ex = todosLosEjercicios().find(x => x.id === id);
 if (ex && ex.record === 'colgada') rec.colgada = Math.max(rec.colgada, n);
 if (ex && ex.record === 'hollow') rec.hollow = Math.max(rec.hollow, n);
 });
 });

 const sinDolor = !Object.values(ci).some(c => c.flags && c.flags.lumbar);
 const durmiendo = !Object.values(ci).some(c => c.flags && c.flags.sueno);
 const meta = R.bloque.sesiones_fuerza_objetivo;
 const cumple = [sinDolor, durmiendo, fuerza >= 9];

 $('#panel-body').innerHTML = `
 <div class="stats">
 <div class="stat"><b>${ultimos14}</b><span>sesiones en 14 días</span></div>
 <div class="stat"><b>${fuerza}<small style="font-size:.9rem;color:var(--muted)">/${meta}</small></b><span>sesiones de fuerza</span></div>
 <div class="stat"><b>${sem}</b><span>semana del bloque</span></div>
 <div class="stat"><b>${rec.colgada || '—'}<small style="font-size:.9rem;color:var(--muted)">${rec.colgada ? 's' : ''}</small></b><span>récord de colgada</span></div>
 <div class="stat"><b>${rec.hollow || '—'}<small style="font-size:.9rem;color:var(--muted)">${rec.hollow ? 's' : ''}</small></b><span>récord de hollow</span></div>
 <div class="stat"><b>${fechas.length}</b><span>sesiones totales</span></div>
 </div>

 <div class="puerta">
 <h3>La puerta de la semana 4</h3>
 <ul>
 <li class="${sinDolor ? 'ok' : 'no'}"><span class="mark">${sinDolor ? '✓' : '·'}</span>Sin dolor lumbar registrado</li>
 <li class="${durmiendo ? 'ok' : 'no'}"><span class="mark">${durmiendo ? '✓' : '·'}</span>Durmiendo igual o mejor</li>
 <li class="${fuerza >= 9 ? 'ok' : 'no'}"><span class="mark">${fuerza >= 9 ? '✓' : '·'}</span>9 de 12 sesiones de fuerza <b>(vas en ${fuerza})</b></li>
 </ul>
 <p class="verdicto">${
 sem < 4
 ? `Se evalúa al llegar a la semana 4. Vas en la ${sem}.`
 : cumple.every(Boolean)
 ? '<b style="color:var(--go)">Puerta abierta.</b> Un martes o un jueves puede volverse cuarto día de fuerza.'
 : 'Todavía no. La semana 5 sigue igual, y eso está bien: el plan aguanta más que las prisas.'
 }</p>
 </div>

 <div class="semanas">
 ${R.semanas.map(s => {
 const act = s.rango.split('–').map(Number);
 const dentro = act.length === 2 ? sem >= act[0] && sem <= act[1] : sem === act[0];
 return `<div class="sem ${dentro ? 'actual' : ''}"><b>Sem. ${s.rango} — ${s.titulo}</b><span>${s.texto}</span></div>`;
 }).join('')}
 </div>

 ${progresoHTML()}

 ${offlineHTML()}

 ${historialHTML()}

 <button type="button" class="btn-ghost" id="exportar" style="margin-top:1rem">Exportar el registro (CSV)</button>
 <p class="aviso-csv">El archivo sale sin cifrar. Si lo guardas en iCloud se sincroniza con tus otros dispositivos.</p>
 <button type="button" class="btn-ghost" id="rehacer-checkin">Rehacer el check-in de hoy</button>
 `;

 $('#panel').hidden = false;
 $('#exportar').addEventListener('click', exportarCSV);
 const rt = $('#off-retry');
 if (rt) rt.addEventListener('click', async () => {
 rt.textContent = 'Intentando…'; rt.disabled = true;
 await registrarSW();
 abrirPanel();
 });
 $('#rehacer-checkin').addEventListener('click', () => {
 const c = read(K.checkin, {}); delete c[HOY]; write(K.checkin, c);
 location.reload();
 });
}

/* Dónde va cada ejercicio: el mapa de escalones de un vistazo. */
function progresoHTML() {
 const niveles = read(K.nivel, {});
 const ids = Object.keys(niveles);
 if (!ids.length) return '';

 const todos = todosLosEjercicios();
 const filas = ids.map(id => {
 const ex = todos.find(x => x.id === id);
 if (!ex || !ex.escalones) return '';
 const n = niveles[id], tope = ex.escalones.length;
 const pts = Array.from({ length: tope }, (_, i) =>
 `<span class="pt ${i < n.escalon ? 'hecho' : i === n.escalon ? 'aqui' : ''}"></span>`).join('');
 return `<div class="pr">
 <div class="pr-top">
 <span class="pr-nom">${ex.nombre}</span>
 <span class="pr-obj">${ex.series} × ${n.objetivo} ${ex.unidad === 'tiempo' ? 'seg' : ''}</span>
 </div>
 <div class="pr-esc">${pts}<span class="pr-txt">${ex.escalones[Math.min(n.escalon, tope - 1)].nombre}</span></div>
 </div>`;
 }).filter(Boolean).join('');

 return filas ? `<div class="prog"><h3>En qué escalón vas</h3>${filas}</div>` : '';
}

/* ¿Funciona sin el Mac? La respuesta tiene que verse desde el teléfono. */
function offlineHTML() {
 const ok = swEstado.registrado && swEstado.archivos > 0;
 const parcial = swEstado.registrado && swEstado.archivos === 0;

 const estado = ok
 ? { cls: 'ok', txt: 'Listo para usar sin el Mac',
 det: `${swEstado.archivos} archivos guardados en el teléfono. Puedes entrenar con el Mac apagado.` }
 : parcial
 ? { cls: 'warn', txt: 'Guardando…',
 det: 'Deja esta pantalla abierta unos segundos con el Mac encendido y vuelve a mirar.' }
 : { cls: 'bad', txt: 'Todavía depende del Mac',
 det: (swEstado.error || 'No se pudo activar el modo sin conexión.') +
 ' Mientras esto diga esto, la app solo abre con el Mac encendido y en el mismo wifi.' };

 return `<div class="offline ${estado.cls}">
 <div class="off-head"><span class="off-dot"></span><b>${estado.txt}</b></div>
 <p class="off-det">${estado.det}</p>
 ${!ok ? `<button type="button" class="btn-ghost" id="off-retry">Volver a intentarlo</button>` : ''}
 </div>`;
}

/* Las últimas sesiones, con fecha, para ver el registro sin abrir el CSV. */
function historialHTML() {
 const log = read(K.log, {});
 const ci = read(K.checkin, {});
 const fechas = Object.keys(log).sort().reverse().slice(0, 14);
 if (!fechas.length) {
 return '<div class="hist"><h3>Historial</h3><p class="hist-vacio">Todavía no hay sesiones registradas.</p></div>';
 }

 const filas = fechas.map(f => {
 const e = log[f], d = R.dias[e.dia] || {};
 const [Y, M, D] = f.split('-').map(Number);
 const fecha = new Date(Y, M - 1, D);
 const dia = fecha.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });

 const marcadas = Object.values(e.series || {}).reduce((a, v) => a + v.length, 0);
 const logros = Object.entries(e.notas || {}).filter(([, v]) => v);
 const en = ci[f] || {};

 return `<details class="hs">
 <summary>
 <span class="hs-fecha">${dia}</span>
 <span class="hs-dia">${d.nombre || e.dia}</span>
 <span class="hs-marca ${e.hecho ? 'ok' : ''}">${e.hecho ? '✓' : marcadas || '—'}</span>
 </summary>
 <div class="hs-cuerpo">
 ${en.energia ? `<p class="hs-meta">Energía ${en.energia}/5 · piernas ${en.piernas || '—'}/5</p>` : ''}
 <p class="hs-meta">${marcadas} series marcadas${e.variante ? ' · ' + e.variante : ''}</p>
 ${logros.length
 ? `<ul class="hs-logros">${logros.map(([id, v]) => {
 const ex = todosLosEjercicios().find(x => x.id === id);
 const u = ex && ex.modo === 'tiempo' ? 's' : '';
 return `<li><b>${v}${u}</b> ${ex ? ex.nombre : id}</li>`;
 }).join('')}</ul>`
 : '<p class="hs-meta hs-sin">Sin datos anotados ese día.</p>'}
 </div>
 </details>`;
 }).join('');

 return `<div class="hist"><h3>Historial</h3>${filas}</div>`;
}

function exportarCSV() {
 const log = read(K.log, {});
 const ci = read(K.checkin, {});
 const filas = [['fecha', 'dia', 'tipo', 'variante', 'completada', 'energia', 'piernas', 'ejercicio', 'series_hechas', 'series_plan', 'logrado']];

 Object.keys(log).sort().forEach(f => {
 const e = log[f], c = ci[f] || {};
 const d = R.dias[e.dia];
 if (!d) return;
 let ejs = d.variantes ? (d.variantes[e.variante] || d.variantes.bici).ejercicios : (d.ejercicios || []);
 ejs = ejs.concat(bloquesDelDia(e.dia).flatMap(b => b.items).map(i => ({ ...i, series: 1 })));
 ejs.forEach(x => {
 filas.push([
 f, e.dia, e.tipo || d.tipo, e.variante || '', e.hecho ? 'si' : 'no',
 c.energia ?? '', c.piernas ?? '',
 x.nombre, (e.series && e.series[x.id] || []).length, x.series,
 (e.notas && e.notas[x.id]) || ''
 ]);
 });
 });

 const csv = filas.map(r => r.map(v => {
 const s = String(v);
 return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
 }).join(',')).join('\n');

 const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url; a.download = `pole-registro-${HOY}.csv`;
 document.body.appendChild(a); a.click(); a.remove();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================
 PIE
 ============================================================ */
function pintarPie() {
 $('#foot').innerHTML =
 `<div class="alertas">
 <h3>Cuándo se recorta o se acaba la sesión</h3>
 <ul>${R.alertas.map(a => `<li><b>${a.senal}:</b> ${a.accion}</li>`).join('')}</ul>
 </div>
 ${R.notas_finales.map(t => `<p>${md(t)}</p>`).join('')}`;
}

/* Un valor que va dentro de un atributo HTML. Sin esto, una nota con comillas
 rompe el atributo y corrompe el render. */
function attr(v) {
 return String(v == null ? '' : v)
 .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
 .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Solo https. Evita que un enlace guardado pueda ejecutar código. */
function urlSegura(u) {
 return typeof u === 'string' && /^https:\/\//i.test(u) ? u : '';
}

/* ---------- negritas de markdown, sin librería ---------- */
function md(s) {
 return String(s)
 .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
 .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/* ============================================================
 GLOBALES
 ============================================================ */
let wired = false;
function wireGlobales() {
 if (wired) return; wired = true;

 $('#t-close').addEventListener('click', cerrarTimer);
 $('#t-less').addEventListener('click', () => { tRestan = Math.max(0, tRestan - 15); $('#t-num').textContent = fmt(tRestan); });
 $('#t-more').addEventListener('click', () => { tRestan += 15; $('#timer').classList.remove('ring'); $('#t-num').textContent = fmt(tRestan); });

 $('#btn-panel').addEventListener('click', abrirPanel);
 $('#panel-close').addEventListener('click', () => { $('#panel').hidden = true; });
 $('#panel').addEventListener('click', e => { if (e.target.id === 'panel') $('#panel').hidden = true; });

 $('#fig-close').addEventListener('click', () => { $('#figbox').hidden = true; });
 $('#figbox').addEventListener('click', e => { if (e.target.id === 'figbox') $('#figbox').hidden = true; });

 document.addEventListener('keydown', e => {
 if (e.key !== 'Escape') return;
 if (!$('#timer').hidden) cerrarTimer();
 else if (!$('#panel').hidden) $('#panel').hidden = true;
 else if (!$('#figbox').hidden) $('#figbox').hidden = true;
 });

 document.addEventListener('visibilitychange', () => {
 if (document.visibilityState === 'hidden') guardarPendientes();
 else if (!$('#timer').hidden && tId) pedirWakeLock();
 });
 window.addEventListener('pagehide', guardarPendientes);
}

init();
