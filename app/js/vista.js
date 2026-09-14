/* ============================================================
 vista.js — render y eventos.
 NO importa estado.js: recibe un plan ya calculado y emite
 intenciones hacia arriba. Es lo que impide que mirar un día
 cambie algo.
 ============================================================ */
'use strict';

import { fechaCorta, fechaLarga, fmt } from './tiempo.js';

/* Un valor dentro de un atributo. Sin esto, una nota con comillas
 rompe el HTML y corrompe el render. */
export const attr = v => String(v == null ? '' : v)
 .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
 .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Solo https: evita que un enlace guardado pueda ejecutar código. */
export const urlSegura = u => (typeof u === 'string' && /^https:\/\//i.test(u)) ? u : '';

const md = s => String(s)
 .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
 .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/* ============================================================
 SELECTOR DE DÍAS
 ============================================================ */
export function selector(calendario, tipos, actual) {
 const L = ['D','L','M','X','J','V','S'];
 const orden = [1,2,3,4,5,6,0];
 return orden.map(d => {
 const t = tipos[calendario[String(d)]] || {};
 const clase = t.carga ? 'fuerza' : t.descanso_total ? 'libre' :
 /Cardio/i.test(t.nombre || '') ? 'cardio' : 'movilidad';
 return `<button type="button" class="daybtn" data-dia="${d}" data-kind="${clase}"
 aria-pressed="${String(d) === String(actual)}">${L[d]}<i></i></button>`;
 }).join('');
}

/* ============================================================
 EL DÍA
 ============================================================ */
export function pintarDia(plan, textos, prefs) {
 let h = '';

 h += `<div class="day-head">
 <div class="letra">${plan.tipo} · ${fechaLarga()}</div>
 <h2>${plan.nombre}</h2>
 </div>`;

 if (plan.motivo) h += `<div class="motivo ${plan.modo === 'piso1' ? 'stop' : 'warn'}"><p>${md(plan.motivo)}</p></div>`;
 if (plan.nota) h += `<p class="day-note">${plan.nota}</p>`;
 if (plan.descarga) h += `<div class="motivo warn"><p>${md(textos.bloqueo.descarga)}</p></div>`;

 if (plan.descanso_total && plan.texto)
 h += `<div class="libre">${plan.texto.map(t => `<p>${md(t)}</p>`).join('')}</div>`;

 if (plan.aviso_agarre && plan.agarre) h += tarjetaAgarre(plan.agarre);

 for (const b of plan.bloques || []) h += bloqueSimple(b, plan, prefs);

 if ((plan.ejercicios || []).length)
 h += `<ol class="ex-list">${plan.ejercicios.map((e, i) => tarjeta(e, i, textos, prefs)).join('')}</ol>`;

 for (const b of plan.cierre || []) h += bloqueSimple(b, plan, prefs);

 if (!plan.descanso_total) h += cierre(plan);

 return h;
}

function tarjetaAgarre(a) {
 return `<div class="agarre">
 <h3>${a.titulo}</h3>
 ${a.texto.map(t => `<p>${md(t)}</p>`).join('')}
 <details class="agarre-mas"><summary>Cómo cuidar el callo</summary>
 <ul>${a.cuidado.map(c => `<li>${c}</li>`).join('')}</ul></details>
 </div>`;
}

function bloqueSimple(b, plan, prefs) {
 const marcados = (plan.marcados || {});
 const hechos = b.items.filter(i => (marcados[i.id] || []).length).length;
 return `<div class="block">
 <div class="block-head">
 <h3>${b.nombre}</h3>
 <span class="block-mins">${b.mins} min</span>
 <span class="block-count ${hechos === b.items.length ? 'full' : ''}">${hechos}/${b.items.length}</span>
 </div>
 ${b.nota ? `<p class="block-note">${b.nota}</p>` : ''}
 <ul class="simple">${b.items.map(i => itemSimple(i, plan, prefs)).join('')}</ul>
 </div>`;
}

function itemSimple(i, plan, prefs) {
 const done = ((plan.marcados || {})[i.id] || []).length > 0;
 const nota = (plan.notas || {})[i.id] || '';
 const video = urlSegura((prefs.videos || {})[i.id] || i.video);
 const unidad = i.modo === 'tiempo' ? 'seg' : 'reps';
 return `<li class="${done ? 'done' : ''}">
 <input type="checkbox" class="chk chk-sm" data-item="${i.id}" ${done ? 'checked' : ''}
 aria-label="${attr(i.nombre)}">
 <div class="n">
 <span class="t">${i.nombre}</span>${i.para ? `<span class="para">${i.para}</span>` : ''}
 <span class="logro">
 <input type="text" inputmode="numeric" data-nota="${i.id}" value="${attr(nota)}"
 placeholder="—" aria-label="${unidad} en ${attr(i.nombre)}">
 <label>${unidad}</label>
 </span>
 </div>
 <span class="acts">
 ${video ? `<a class="mini" href="${video}" target="_blank" rel="noopener" aria-label="Video">▶</a>` : ''}
 ${i.infografia ? `<button type="button" class="mini fig" data-fig="${i.infografia}" data-ex="${i.id}" aria-label="Diagrama">◧</button>` : ''}
 <span class="d">${i.dosis || ''}</span>
 </span>
 </li>`;
}

function tarjeta(e, idx, textos, prefs) {
 const marcadas = (e.marcados || []);
 const done = marcadas.length >= e.series;
 const video = urlSegura((prefs.videos || {})[e.id] || e.video);
 const dosis = e.objetivo != null
 ? `${e.series} × ${e.objetivo} ${e.unidad === 'tiempo' ? 'seg' : ''}`
 : `${e.series > 1 ? e.series + ' × ' : ''}${e.dosis || ''}`;

 const series = Array.from({ length: e.series }, (_, s) =>
 `<button type="button" class="serie" data-ex="${e.id}" data-serie="${s}"
 aria-pressed="${marcadas.includes(s)}" aria-label="Serie ${s + 1}">${s + 1}</button>`).join('');

 const unidad = e.unidad === 'tiempo' ? 'seg' : 'reps';
 const ayuda = e.series > 1 ? `${unidad} de cada serie` : `${unidad} que lograste`;

 return `<li class="ex ${done ? 'done' : ''}">
 <div class="ex-head">
 <div class="ex-name"><span class="ex-num">${idx + 1}</span>${e.nombre}</div>
 <div class="ex-dose">${dosis}${e.recorte_tut ? ' <span class="tag-tut">piel</span>' : ''}</div>
 </div>

 ${e.escalon != null ? `<div class="plan">
 <div class="plan-esc">
 <span class="plan-n">Escalón ${e.escalon + 1} de ${e.tope + 1}</span>
 <span class="plan-v">${e.escalon_nombre}</span>
 </div>
 ${e.previa ? `<p class="plan-prev">La vez pasada: <b>${e.previa.join(', ')}</b></p>` : ''}
 <p class="plan-nota">${textos.progresion[e.nota] || ''}</p>
 <div class="plan-ajuste">
 <button type="button" class="aj" data-aj="baja" data-ex="${e.id}" ${e.escalon === 0 ? 'disabled' : ''}>− fácil</button>
 <button type="button" class="aj" data-aj="sube" data-ex="${e.id}" ${e.escalon >= e.tope ? 'disabled' : ''}>+ difícil</button>
 <span class="aj-nota">si no te cuadra</span>
 </div>
 </div>` : ''}

 ${e.claves && e.claves.length ? `<ul class="ex-claves">${e.claves.map(c => `<li>${c}</li>`).join('')}</ul>` : ''}

 <div class="series">${series}
 ${e.descanso ? `<button type="button" class="tool" data-timer="rest" data-ex="${e.id}">descanso ${e.descanso}s</button>` : ''}
 ${e.unidad === 'tiempo' ? `<button type="button" class="tool" data-timer="hold" data-ex="${e.id}">▶ ${fmt(e.objetivo || e.segundos || 20)}</button>` : ''}
 </div>

 <div class="ex-tools">
 ${video ? `<a class="tool play" href="${video}" target="_blank" rel="noopener">▶ Ver el video</a>`
 : e.busqueda ? `<a class="tool play" href="https://www.youtube.com/results?search_query=${encodeURIComponent(e.busqueda)}" target="_blank" rel="noopener">▶ Buscar video</a>` : ''}
 ${e.infografia ? `<button type="button" class="tool fig" data-fig="${e.infografia}" data-ex="${e.id}">Cómo se hace</button>` : ''}
 ${e.cuenta_tut_barra ? `<button type="button" class="tool" data-corte="${e.id}">corté por el agarre</button>` : ''}
 </div>

 <div class="ex-log">
 <input type="text" inputmode="numeric" data-nota="${e.id}" value="${attr(e.notaTexto || '')}"
 placeholder="—" aria-label="${ayuda}">
 <label>${ayuda}</label>
 <input type="number" min="1" max="10" class="rpe" data-rpe="${e.id}" value="${attr(e.rpe || '')}"
 placeholder="—" aria-label="Esfuerzo del 1 al 10">
 <label class="rpe-lbl">esfuerzo</label>
 </div>
 </li>`;
}

function cierre(plan) {
 if (plan.cerrada) {
 const h = new Date(plan.cerrada).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
 return `<div class="cierre hecho">
 <p class="ci-ok">Sesión cerrada a las ${h}</p>
 <p class="ci-det">Queda guardada con la fecha de hoy.</p>
 <button type="button" class="btn-ghost" id="reabrir">Reabrir para seguir anotando</button>
 </div>`;
 }
 return `<div class="cierre">
 <p class="ci-det">Llevas <b id="cierre-cuenta">0</b> series.</p>
 <button type="button" class="btn-primary" id="cerrar-sesion">Terminé por hoy</button>
 <p class="ci-pie">No hace falta completarlo todo: lo que hiciste cuenta igual.</p>
 </div>`;
}

/* ============================================================
 PANEL
 ============================================================ */
export function panel(plan, datos, textos) {
 return `
 ${estadoOffline(datos.sw)}
 ${arbolHTML(plan.arbol, textos)}
 ${statsHTML(plan, datos)}
 ${puertaHTML(datos.puerta)}
 ${historialHTML(datos.log, datos.checkins, datos.catalogo)}
 <button type="button" class="btn-ghost" id="exportar" style="margin-top:1rem">Exportar el registro (CSV)</button>
 <p class="aviso-csv">El archivo sale sin cifrar. Si lo guardas en iCloud se sincroniza con tus otros dispositivos.</p>
 <button type="button" class="btn-ghost" id="respaldo">Descargar respaldo completo</button>
 <button type="button" class="btn-ghost" id="calendario-editar">Cambiar qué día es cada sesión</button>
 <button type="button" class="btn-ghost" id="rehacer-checkin">Rehacer el check-in de hoy</button>
 <p class="aviso-csv">Guardado en este teléfono: ${datos.kb} KB.</p>`;
}

function statsHTML(plan, d) {
 return `<div class="stats">
 <div class="stat"><b>${plan.adherencia.hechas}</b><span>${plan.adherencia.etiqueta}</span></div>
 <div class="stat"><b>${d.recordColgada || '—'}<small>${d.recordColgada ? 's' : ''}</small></b><span>récord de colgada</span></div>
 <div class="stat"><b>${d.recordHollow || '—'}<small>${d.recordHollow ? 's' : ''}</small></b><span>récord de hollow</span></div>
 <div class="stat"><b>${plan.semana_meso}<small>/4</small></b><span>semana del ciclo</span></div>
 <div class="stat"><b>${d.sesiones}</b><span>sesiones en total</span></div>
 <div class="stat"><b>${plan.tbc_min}<small>min</small></b><span>bajo carga hoy</span></div>
 </div>`;
}

function arbolHTML(arbol, textos) {
 if (!arbol) return '';
 const n = Object.values(arbol);
 const dom = n.filter(x => x.estado === 'dominado').length;
 const disp = n.filter(x => x.estado === 'disponible');
 return `<div class="arbol">
 <h3>El camino al invertido</h3>
 <p class="arbol-meta">${dom} de ${n.length} pasos. ${textos.meta || ''}</p>
 <div class="arbol-lista">
 ${Object.entries(arbol).map(([id, x]) => `
 <div class="nodo ${x.estado}">
 <span class="nodo-id">${id}</span>
 <span class="nodo-nom">${x.nombre}${x.motivo ? `<span class="nodo-por">${x.motivo}</span>` : ''}</span>
 <span class="nodo-est">${
 x.estado === 'dominado' ? '✓' :
 x.estado === 'disponible' ? '·' :
 x.estado === 'fuera_de_ruta' ? '✕' :
 x.porque === 'puerta_medica' ? '🔒' : '—'}</span>
 </div>`).join('')}
 </div>
 ${disp.length ? `<p class="arbol-hoy">Disponibles ahora: ${disp.map(x => x.nombre).join(' · ')}</p>` : ''}
 </div>`;
}

function puertaHTML(p) {
 const abierta = p && p.control_1 && p.control_2;
 return `<div class="puerta-med ${abierta ? 'ok' : ''}">
 <h3>Las dos fechas</h3>
 <p class="pm-nota">${abierta
 ? 'Registradas. La rama de progresión de colgada está abierta.'
 : 'Mientras no estén, la progresión de colgada más allá de 4 series queda cerrada. El ejercicio es parte de tu tratamiento; la otra mitad también.'}</p>
 <div class="pm-campos">
 <label>Laboratorios<input type="date" id="pm1" value="${attr(p && p.control_1 || '')}"></label>
 <label>Control<input type="date" id="pm2" value="${attr(p && p.control_2 || '')}"></label>
 </div>
 </div>`;
}

function estadoOffline(sw) {
 const ok = sw && sw.registrado && sw.archivos > 0;
 return `<div class="offline ${ok ? 'ok' : 'bad'}">
 <div class="off-head"><span class="off-dot"></span><b>${ok ? 'Funciona sin conexión' : 'Todavía no guardado'}</b></div>
 <p class="off-det">${ok ? `${sw.archivos} archivos en el teléfono. Puedes entrenar sin red.`
 : (sw && sw.error) || 'Ábrela una vez con conexión para que se guarde.'}</p>
 </div>`;
}

function historialHTML(log, checkins, catalogo) {
 const fechas = Object.keys(log || {}).filter(f => !f.startsWith('__')).sort().reverse().slice(0, 14);
 if (!fechas.length) return '<div class="hist"><h3>Historial</h3><p class="hist-vacio">Todavía no hay sesiones.</p></div>';
 return `<div class="hist"><h3>Historial</h3>${fechas.map(f => {
 const e = log[f], c = (checkins || {})[f] || {};
 const marcadas = Object.values(e.series || {}).reduce((a, v) => a + v.length, 0);
 const logros = Object.entries(e.notas || {}).filter(([, v]) => v);
 return `<details class="hs">
 <summary>
 <span class="hs-fecha">${fechaCorta(f)}</span>
 <span class="hs-dia">${e.tipo || '—'}${e.tipo_dudoso ? ' ?' : ''}</span>
 <span class="hs-marca ${e.hecho ? 'ok' : ''}">${e.hecho ? '✓' : marcadas || '—'}</span>
 </summary>
 <div class="hs-cuerpo">
 ${c.energia ? `<p class="hs-meta">Energía ${c.energia}/5 · piernas ${c.piernas || '—'}/5</p>` : ''}
 <p class="hs-meta">${marcadas} series${e.tbc_seg ? ` · ${Math.round(e.tbc_seg / 60)} min bajo carga` : ''}</p>
 ${logros.length ? `<ul class="hs-logros">${logros.map(([id, v]) => {
 const ex = catalogo[id];
 return `<li><b>${attr(v)}${ex && ex.unidad === 'tiempo' ? 's' : ''}</b> ${ex ? ex.nombre : id}</li>`;
 }).join('')}</ul>` : '<p class="hs-meta hs-sin">Sin datos anotados.</p>'}
 </div>
 </details>`;
 }).join('')}</div>`;
}

/* ============================================================
 PANTALLA DE CALENDARIO
 ============================================================ */
export function editorCalendario(cal, tipos) {
 const L = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
 const orden = [1,2,3,4,5,6,0];
 return `<div class="cal-editor">
 <p class="cal-nota">Mueve las sesiones al día que te sirva. No se pierde ningún escalón ni nada del historial: el día de la semana es solo dónde aparece.</p>
 ${orden.map(d => `
 <label class="cal-fila">
 <span>${L[d]}</span>
 <select data-dia="${d}">
 ${Object.entries(tipos).map(([id, t]) =>
 `<option value="${id}" ${cal[String(d)] === id ? 'selected' : ''}>${t.nombre}</option>`).join('')}
 </select>
 </label>`).join('')}
 <p class="cal-aviso" id="cal-aviso"></p>
 <button type="button" class="btn-primary" id="cal-guardar">Guardar</button>
 </div>`;
}

/* ============================================================
 RESUMEN AL CERRAR
 ============================================================ */
export function resumenCierre(plan, textos) {
 const con = (plan.ejercicios || []).filter(e => e.escalon != null && e.notaTexto);
 return `<div class="cierre-res">
 <p class="cr-tit">Listo por hoy.</p>
 ${con.length ? `<ul class="rc">${con.map(e => {
 const clase = e.nota && e.nota.startsWith('sube') ? 'sube'
 : e.nota && e.nota.startsWith('regres') ? 'baja' : 'igual';
 return `<li class="rc-${clase}"><b>${e.nombre}</b><span>${attr(e.notaTexto)} · ${textos.progresion[e.nota] || ''}</span></li>`;
 }).join('')}</ul>`
 : '<p class="ci-det">No anotaste números hoy. Sin ellos la app no puede ajustar la próxima sesión.</p>'}
 <p class="ci-pie">Queda guardado con la fecha de hoy.</p>
 </div>`;
}
