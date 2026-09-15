/* ============================================================
 motor.js — construye el plan del día.

 PURO: no importa estado.js, no importa vista.js, no importa
 tiempo.js. Recibe todo por parámetro, incluida la hora.
 Devuelve un objeto; NO ESCRIBE NADA.

 Esa restricción corrige D1 por construcción: no hay forma de
 que mirar un día cambie el estado, porque el motor no tiene
 con qué escribir.

 ─────────────────────────────────────────────────────────────
 En una app gamificada de entrenamiento, la mecánica más
 peligrosa no es la que empuja a entrenar de más. Es la que
 hace que romper la racha se sienta como fracasar.
 — Ixchel
 ─────────────────────────────────────────────────────────────
 ============================================================ */
'use strict';

import * as R from './reglas.js';

/** Piso 1 embebido: el peor día de la app sigue teniendo ocho minutos que sirven. */
const PISO1_FIJO = {
 tipo: 'PISO1', nombre: 'Piso 1', carga: false, modo: 'piso1',
 minimo_valido_min: 8, duracion_min: 8,
 bloques: [{ nombre: 'Piso 1', mins: 8, items: [
 { id: 'c-01', nombre: 'Respiración 360° tumbada', dosis: '6 ciclos', series: 1 },
 { id: 'dr-2', nombre: 'Bombeo de pantorrilla', dosis: '30', series: 1 },
 { id: 'dr-1', nombre: 'Piernas arriba en la pared', dosis: '3 min', series: 1 },
 { id: 'a-06', nombre: 'Rotación torácica', dosis: '8 × lado', series: 1 },
 ]}],
 ejercicios: [],
};

/* ============================================================
 ENTRADA ÚNICA
 ============================================================ */
export function construirPlan({ contenido, estado, ahora, checkin }) {
 const ctx = contexto({ contenido, estado, ahora, checkin });

 // 1 · qué sesión toca hoy
 let plan = elegirSesion(contenido, estado, ctx);

 // 2 · puertas duras: degradan la sesión ANTES de calcular nada
 plan = puertasDuras(plan, ctx, contenido);

 if (plan.modo === 'piso1') return cerrar(plan, ctx, contenido);

 // 3–5 · progresión de cada ejercicio
 const veto = vetoGlobal(ctx);
 const props = plan.ejercicios.map(e => progresar(e, estado, ctx, veto));
 aplicarCupo(props, ctx);

 // 6 · presupuesto de barra
 presupuestoTUT(props, plan, ctx);

 plan.ejercicios = props.map(p => p.ejercicio);
 plan.decisiones = props.map(p => p.decision).filter(Boolean);

 // 7 · regresiones automáticas por banderas
 plan.banderas = regresiones(ctx, props);

 // 8 · si algo viola un invariante, se entrega Piso 1
 const fallos = R.comprobar(plan, ctx);
 if (fallos.length) {
 return cerrar({ ...PISO1_FIJO, fallos_invariante: fallos,
 motivo: 'El plan de hoy salió raro, así que te dejo el Piso 1.' }, ctx, contenido);
 }
 return cerrar(plan, ctx, contenido);
}

/* ============================================================
 CONTEXTO — todo lo que las reglas necesitan saber
 ============================================================ */
export function contexto({ contenido, estado, ahora, checkin }) {
 const log = estado.log || {};
 const hoy = ahora.hoyISO;

 const fechasCarga = Object.keys(log)
 .filter(f => log[f] && log[f].hecho && log[f].carga && f !== hoy)
 .sort().reverse();

 const diasCarga7 = fechasCarga.filter(f => diffDias(f, hoy) < 7).length;
 const horasDesdeCarga = fechasCarga.length ? diffDias(fechasCarga[0], hoy) * 24 : null;

 const sesionesAgarre = Object.values(log)
 .filter(e => e && e.hecho && e.tut_barra_seg > 0).length;

 let adherencia = 0;
 for (let i = 0; i < R.VENTANA_ADHERENCIA_DIAS; i++) {
 const f = restarDias(hoy, i);
 if (log[f] && log[f].hecho) adherencia++;
 }

 return {
 hoy,
 minutos: ahora.minutos,
 diaSemana: String(ahora.diaSemana),
 checkin: checkin || null,
 nivel: estado.nivel_actual || 0,
 diasCarga7,
 horasDesdeCarga,
 sesionesAgarre,
 adherencia,
 tallerDias: R.tallerVigente(estado.prefs, hoy),
 muestraFinal: (estado.prefs && estado.prefs.taller_muestra_final) || null,
 tallerHoy: R.tallerDeHoy(estado.prefs, String(ahora.diaSemana), hoy),
 tallerHorario: (estado.prefs && estado.prefs.taller_horario) || [],
 ventanaFin: R.ventanaFin(estado.prefs, String(ahora.diaSemana), hoy),
 manos: (checkin && checkin.manos) || 'integra',
 puertaMedica: estado.puerta_medica || null,
 semanaMeso: semanaMesociclo(log),
 banderas: estado.banderas || {},
 log,
 };
}

const diffDias = (a, b) => {
 const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number);
 return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5);
};
const restarDias = (iso, n) => {
 const [Y, M, D] = iso.split('-').map(Number);
 const d = new Date(Y, M - 1, D); d.setDate(d.getDate() - n);
 const p = x => String(x).padStart(2, '0');
 return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
function semanaMesociclo(log) {
 const n = Object.values(log).filter(e => e && e.hecho && e.carga).length;
 return ((Math.floor(n / 3)) % 4) + 1;
}

/* ============================================================
 1 · ELEGIR SESIÓN
 ============================================================ */
export function elegirSesion(contenido, estado, ctx) {
 const cal = (estado.prefs && estado.prefs.calendario) || contenido.calendario.por_defecto;
 const tipoId = (estado.forzar_tipo) || cal[ctx.diaSemana] || 'PISO1';
 return materializar(tipoId, contenido, estado, ctx);
}

function materializar(tipoId, contenido, estado, ctx) {
 const t = contenido.sesiones.tipos[tipoId];
 if (!t) return { ...PISO1_FIJO };

 const cat = contenido.ejercicios.ejercicios;
 const dame = id => ({ id, ...(cat[id] || { nombre: id, series: 1, dosis: '' }) });

 let ids = t.ejercicios || [];
 if (t.variantes) {
 const v = (estado.prefs && estado.prefs.variante) || Object.keys(t.variantes)[0];
 ids = t.variantes[v] || Object.values(t.variantes)[0];
 }

 const bloquesId = [...(t.bloques || [])];
 if (t.flex_rotativo) {
 // rota por semana del mesociclo: las mismas estructuras no se acumulan
 const b = t.flex_rotativo[String(ctx.semanaMeso)] || t.flex_rotativo['1'];
 if (b) bloquesId.push(b);
 }
 const bl = bloquesId.map(b => bloque(b, contenido, cat));
 const cierre = (t.cierre || []).map(b => bloque(b, contenido, cat));
 const calMin = bl.reduce((a, b) => a + (b.mins || 0), 0);

 return {
 tipo: tipoId, nombre: t.nombre, carga: !!t.carga, carga_axial: !!t.carga_axial,
 nota: t.nota, texto: t.texto, descanso_total: !!t.descanso_total,
 aviso_agarre: !!t.aviso_agarre, prescindible: !!t.prescindible,
 minimo_valido_min: t.minimo_valido_min || 15,
 calentamiento_min: calMin,
 demanda: t.demanda || (t.carga ? 'alta' : 'baja'),
 flex_cargado: bl.some(b => (b.items || []).some(i => i.rama === 'FLEX' && i.modo === 'reps')),
 modo: 'completo',
 bloques: bl, cierre,
 ejercicios: ids.map(dame),
 };
}

function bloque(id, contenido, cat) {
 const b = contenido.sesiones.bloques[id];
 if (!b) return { nombre: id, mins: 0, items: [] };
 return { id, nombre: b.nombre, mins: b.mins, nota: b.nota, recortable: !!b.recortable,
 items: b.items.map(i => ({ id: i, ...(cat[i] || { nombre: i }), series: 1 })) };
}

/* ============================================================
 2 · PUERTAS DURAS — corren antes de calcular un solo escalón
 ============================================================ */
export function puertasDuras(plan, ctx, contenido) {
 const T = contenido.textos.bloqueo;
 const piso1 = motivo => ({ ...PISO1_FIJO, motivo, modo: 'piso1' });

 if (ctx.banderas.irradiado) return piso1(T.irradiado);
 if (ctx.checkin && ctx.checkin.dolor_lumbar >= 3) return piso1(T.irradiado);

 // La semana de descarga alcanza a TODO, no solo a los días de carga:
 // el Día de Pole también baja el trabajo cargado en rango final.
 if (ctx.semanaMeso === 4) plan = { ...plan, descarga: true };

 if (!plan.carga) return plan;

 const v = R.ventana(ctx.minutos, ctx.ventanaFin);
 if (v === 'solo_piso1')
 return piso1(ctx.minutos < R.VENTANA_INICIO_MIN ? T.ventana_temprano
 : ctx.tallerHoy ? T.ventana_taller.replace('{desde}', ctx.tallerHoy.desde)
 : T.ventana_tarde);

 if (ctx.checkin === null)
 return { ...plan, modo: 'minimo', carga: false, motivo: T.sin_checkin, progresion: false };

 if (ctx.diasCarga7 >= R.topeCargaSemana(ctx.tallerDias))
 return piso1(T.cupo_carga.replace('{n}', ctx.diasCarga7)
 .replace('{max}', R.topeCargaSemana(ctx.tallerDias)));

 if (ctx.horasDesdeCarga !== null && ctx.horasDesdeCarga < R.HORAS_ENTRE_CARGA)
 return piso1(T['48h']);

 if (plan.descarga)
 plan = { ...plan, motivo: T.descarga, progresion: false,
 ejercicios: plan.ejercicios.map(e => ({ ...e, series: Math.max(1, Math.ceil(e.series / 2)) })) };

 // el check-in decide el modo
 const s = puntaje(ctx.checkin);
 if (s < 0.35) return { ...plan, modo: 'minimo', progresion: false, semaforo: 'rojo' };
 if (s <= 0.65) return { ...plan, modo: 'reducido', progresion: false, semaforo: 'ambar',
 ejercicios: plan.ejercicios.slice(0, 3).map(e => ({ ...e, series: 2 })) };

 // fuera de la ventana de inicio: la sesión completa no cabe antes de las 20:00
 if (ctx.minutos > R.ultimaHoraFuerza(ctx.ventanaFin))
 return { ...plan, modo: 'reducido', progresion: false, semaforo: 'verde',
 motivo: ctx.tallerHoy
 ? `Hoy hay taller a las ${ctx.tallerHoy.desde}: la sesión completa no cabe antes. Esta sí.`
 : 'Es tarde para la sesión completa: esta versión cierra antes de las 20:00.',
 ejercicios: plan.ejercicios.slice(0, 3).map(e => ({ ...e, series: 2 })) };

 return { ...plan, semaforo: 'verde', progresion: true };
}

export function puntaje(c) {
 if (!c) return 0;
 const E = c.energia || 3, S = c.sueno_calidad || c.energia || 3;
 const P = 6 - (c.piernas || 3), D = 6 - (c.doms || 2);
 let base = (E + S + P + D) / 20;
 const h = c.sueno_horas;
 if (h != null && h < 7) base -= 0.10;
 if (h != null && h < 6) base -= 0.10;
 if (c.rpe_previo > 8.5) base -= 0.05;
 return Math.max(0, base);
}

/* ============================================================
 3 · VETO — booleano, en su propia etapa: nada lo compensa
 ============================================================ */
export function vetoGlobal(ctx) {
 if (!ctx.checkin) return true;
 if (ctx.checkin.dolor_lumbar >= 1) return true;
 if (ctx.manos !== 'integra') return true;
 return false;
}

function vetoPorRPE(ex, ctx) {
 const prev = ultimaDe(ex.id, ctx.log, ctx.hoy);
 if (!prev) return false;
 const rpe = prev.rpe == null ? R.RPE_POR_DEFECTO : prev.rpe;
 return rpe >= R.RPE_VETO;
}

/* ============================================================
 4 · PROGRESAR — doble progresión con confirmación en dos sesiones
 ============================================================ */
export function progresar(ex, estado, ctx, vetoDelDia) {
 const niveles = estado.nivel || {};
 if (!ex.escalones || !ex.escalones.length) return { ejercicio: ex, decision: null };

 const tope = ex.escalones.length - 1;
 let e = niveles[ex.id] || { escalon: 0, objetivo: ex.escalones[0].min,
 confirmaciones: 0, cortes_agarre_seguidos: 0 };
 e = { ...e };
 const esc = ex.escalones[Math.min(e.escalon, tope)];
 const paso = ex.unidad === 'tiempo' ? (ex.rama === 'GRIP' ? 3 : 5) : 1;
 let nota = 'primera', cambios = 0, sube = false;

 if (e.fijado) {
 return { ejercicio: { ...ex, objetivo: e.objetivo, escalon: e.escalon, tope,
 escalon_nombre: esc.nombre, nota: 'manual' },
 decision: { id: ex.id, estado: e, cambios: 0, tipo: 'manual' } };
 }

 const prev = ultimaDe(ex.id, ctx.log, ctx.hoy);

 if (prev) {
 const vals = valores(prev.notas);
 const corte = prev.corte === 'corte_agarre';

 if (corte) {
 // neutro... hasta la tercera vez seguida (Chimi C4)
 e.cortes_agarre_seguidos = (e.cortes_agarre_seguidos || 0) + 1;
 if (e.cortes_agarre_seguidos > R.CORTES_AGARRE_NEUTROS) {
 e = bajar(e, ex, tope, paso);
 e.cortes_agarre_seguidos = 0;
 nota = 'regresion_piel'; cambios = 1;
 } else nota = 'corte_piel';
 } else {
 e.cortes_agarre_seguidos = 0;
 const completas = vals.filter(v => v >= e.objetivo).length;
 const peor = vals.length ? Math.min(...vals) : 0;

 if (vetoDelDia || vetoPorRPE(ex, ctx)) {
 nota = 'veto_rpe'; e.confirmaciones = 0;
 } else if (completas >= ex.series) {
 e.confirmaciones = (e.confirmaciones || 0) + 1;
 if (e.confirmaciones >= R.CONFIRMACIONES_PARA_SUBIR) {
 sube = true; cambios = 1;
 if (e.objetivo >= esc.max) {
 if (e.escalon < tope) { e.escalon++; e.objetivo = ex.escalones[e.escalon].min; nota = 'sube_escalon'; }
 else { e.objetivo += paso; nota = 'sube_objetivo'; }
 } else { e.objetivo = Math.min(esc.max, e.objetivo + paso); nota = 'sube_objetivo'; }
 e.confirmaciones = 0;
 } else nota = 'consolida';
 } else if (completas === 0 && vals.length &&
 (peor < e.objetivo * 0.6 || dosFallosSeguidos(ex.id, ctx))) {
 e = bajar(e, ex, tope, paso); nota = 'regresion'; cambios = 1;
 } else { nota = 'mantiene'; e.confirmaciones = 0; }
 }
 }

 const escFinal = ex.escalones[Math.min(e.escalon, tope)];
 return {
 ejercicio: { ...ex, objetivo: e.objetivo, escalon: e.escalon, tope,
 escalon_nombre: escFinal.nombre, nota,
 previa: prev ? valores(prev.notas) : null },
 decision: { id: ex.id, estado: e, cambios, sube, rama: ex.rama, nota },
 };
}

function bajar(e, ex, tope, paso) {
 const x = { ...e, confirmaciones: 0 };
 if (x.escalon > 0) { x.escalon--; x.objetivo = ex.escalones[x.escalon].max; }
 else x.objetivo = Math.max(1, x.objetivo - paso);
 return x;
}

function dosFallosSeguidos(id, ctx) {
 const fs = Object.keys(ctx.log).filter(f => f !== ctx.hoy && ctx.log[f].notas &&
 valores(ctx.log[f].notas[id]).length).sort().reverse().slice(0, 2);
 return fs.length === 2;
}

export function valores(n) {
 if (n == null) return [];
 const t = typeof n === 'object' ? '' : String(n);
 return t.split(/[^0-9]+/).map(Number).filter(v => v > 0);
}

function ultimaDe(id, log, hoy) {
 const f = Object.keys(log).filter(x => x !== hoy && log[x] && log[x].notas &&
 valores(log[x].notas[id]).length).sort().reverse()[0];
 if (!f) return null;
 const e = log[f];
 return { fecha: f, notas: e.notas[id], rpe: (e.rpe || {})[id],
 corte: (e.corte_agarre || {})[id] ? 'corte_agarre' : null };
}

/* ============================================================
 PROGRESIÓN DE FLEXIBILIDAD — marca y banda, no escalones.
 A un split no se le suma una repetición. Se entrena en el
 90–95 % de la marca; la marca solo se mueve en el test.
 ============================================================ */
export function planFlex(nodoId, estadoFlex, medidaTest) {
 const e = estadoFlex || {};
 if (medidaTest == null) {
 return { marca: e.marca || null, banda: R.bandaFlex(e.marca),
 nota: e.marca ? 'banda' : 'sin_marca', congelado: !!e.congelado_hasta };
 }
 // el test es lo ÚNICO que mueve la marca
 if (!e.marca) return { marca: medidaTest, banda: R.bandaFlex(medidaTest), nota: 'primera_marca' };

 const mejora = (medidaTest - e.marca) / e.marca;
 if (mejora >= R.FLEX_MEJORA_MIN)
 return { marca: medidaTest, banda: R.bandaFlex(medidaTest), nota: 'marca_nueva' };
 if (mejora <= -R.FLEX_CAIDA_MAX)
 return { marca: e.marca, banda: R.bandaFlex(e.marca * 0.85),
 congelado_hasta: 'dos_semanas', nota: 'retrocede' };
 return { marca: e.marca, banda: R.bandaFlex(e.marca), nota: 'mantiene_sube_tiempo' };
}

/* ============================================================
 5 · CUPO — máximo 2 ascensos por sesión
 ============================================================ */
export function aplicarCupo(props, ctx) {
 const suben = props.filter(p => p.decision && p.decision.sube);
 if (suben.length <= R.CUPO_ASCENSOS_SESION) return;

 const orden = R.PRIORIDAD_RAMA[ctx.nivel] || R.PRIORIDAD_RAMA[0];
 suben.sort((a, b) => orden.indexOf(a.decision.rama) - orden.indexOf(b.decision.rama));

 // los que no entran conservan la confirmación: suben la próxima
 suben.slice(R.CUPO_ASCENSOS_SESION).forEach(p => {
 p.decision.estado.confirmaciones = R.CONFIRMACIONES_PARA_SUBIR;
 p.decision.sube = false; p.decision.cambios = 0;
 p.ejercicio.nota = 'cupo';
 });
}

/* ============================================================
 6 · PRESUPUESTO DE BARRA — lo gobierna la piel
 ============================================================ */
export function presupuestoTUT(props, plan, ctx) {
 const techo = R.tutBarraSesion(ctx.sesionesAgarre);
 let usado = 0;
 for (const p of props) {
 const e = p.ejercicio;
 if (!e.cuenta_tut_barra) continue;
 const porSerie = e.unidad === 'tiempo' ? (e.objetivo || 20) : (e.objetivo || 6) * R.TEMPO_POR_REP_SEG;
 let series = e.series;
 while (series > 1 && usado + porSerie * series > techo) series--;
 usado += porSerie * series;
 if (series !== e.series) { e.series = series; e.recorte_tut = true; }
 }
 plan.tut_barra_seg = usado;
 plan.tut_barra_techo = techo;
}

/* ============================================================
 7 · REGRESIONES AUTOMÁTICAS — el sistema actúa, no pregunta
 ============================================================ */
export function regresiones(ctx, props) {
 const b = [];
 const c = ctx.checkin || {};
 if (c.dolor_lumbar >= 3) b.push({ id: 'irradiado', nivel: 'parada', manual: true });
 if (c.dolor_lumbar === 2) b.push({ id: 'lumbar-24h', nivel: 'regresion', dias: 7 });
 if (c.manos === 'ampolla') b.push({ id: 'ampolla', nivel: 'sin-barra', dias: 8 });
 if (c.manos === 'punto_caliente') b.push({ id: 'punto-caliente', nivel: 'corta-ejercicio' });
 if (c.anorrectal && c.anorrectal !== 'no') b.push({ id: 'anorrectal', nivel: 'sin-isometricos', dias: 14 });
 if (c.piernas >= 4) b.push({ id: 'piernas-pesadas', nivel: 'mas-drenaje' });
 if (c.sueno_horas != null && c.sueno_horas < 6) b.push({ id: 'sueno', nivel: 'semana-reducida' });
 if (props.some(p => p.decision && p.decision.nota === 'regresion_piel'))
 b.push({ id: 'piel', nivel: 'revisar-agarre' });
 return b;
}

/* ============================================================
 CIERRE — adherencia, tiempo bajo carga y celebraciones
 ============================================================ */
function cerrar(plan, ctx, contenido) {
 plan.adherencia = { ventana: R.VENTANA_ADHERENCIA_DIAS, hechas: ctx.adherencia,
 etiqueta: contenido.textos.adherencia.etiqueta };
 plan.tbc_min = Math.round(tbc(plan) / 60);
 plan.minimo_valido_min = plan.minimo_valido_min || 15;
 plan.nivel = ctx.nivel;
 plan.semana_meso = ctx.semanaMeso;
 plan.taller = { por_semana: ctx.tallerDias, horario: ctx.tallerHorario, hoy: ctx.tallerHoy,
 hasta: ctx.muestraFinal, tope_carga: R.topeCargaSemana(ctx.tallerDias) };
 plan.arbol = estadoArbol(contenido, ctx);
 return plan;
}

export function tbc(plan) {
 const cuenta = (e, factor = 1) => {
 const porSerie = e.unidad === 'tiempo' ? (e.objetivo || e.segundos || 20)
 : (e.objetivo || 6) * R.TEMPO_POR_REP_SEG;
 return porSerie * (e.series || 1) * factor;
 };
 let t = (plan.ejercicios || []).reduce((a, e) => a + cuenta(e), 0);
 // El trabajo cargado en rango final cuenta a la mitad: es excéntrico, no estímulo
 // de fuerza. Lo activo y lo pasivo no cuentan.
 for (const b of plan.bloques || [])
 for (const i of b.items || [])
 if (i.rama === 'FLEX' && i.modo === 'reps') t += cuenta(i, R.FLEX_FACTOR_TBC);
 return t;
}

/** Estado del árbol: se DERIVA, nunca se guarda una conclusión. */
export function estadoArbol(contenido, ctx) {
 const nodos = contenido.arbol.nodos;
 const dominados = ctx.log.__arbol || {};
 const dom = id => !!dominados[id];
 const out = {};
 for (const [id, n] of Object.entries(nodos)) {
 const listo = n.prerequisitos.every(dom);
 const puerta = !n.requiere_puerta_medica || R.puertaMedicaAbierta(ctx.puertaMedica);
 // El motivo del bloqueo importa: "te falta un paso" y "falta una cita
 // médica" son cosas distintas y la app tiene que decir cuál es.
 // Un nodo fuera de ruta no está bloqueado ni disponible: es otra cosa,
 // y se muestra con su propio motivo en vez de esconderse.
 const estado = n.fuera_de_ruta ? 'fuera_de_ruta'
 : dom(id) ? 'dominado'
 : (listo && puerta) ? 'disponible' : 'bloqueado';
 const porque = estado !== 'bloqueado' ? null
 : !listo ? 'prerequisitos'
 : 'puerta_medica';
 out[id] = { ...n, estado, porque,
 faltan: n.prerequisitos.filter(p => !dom(p)) };
 }
 return out;
}
