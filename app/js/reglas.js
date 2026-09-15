/* ============================================================
 reglas.js — invariantes del sistema. NO IMPORTA NADA.
 Es el único archivo que comparten el validador y el motor:
 una regla se escribe una vez y no puede divergir.

 Estas reglas NO son configuración. No hay bandera que las
 apague. Si una regla y un objetivo entran en conflicto,
 gana la regla.
 ============================================================ */
'use strict';

/* ---------- constantes duras ---------- */
export const MAX_DIAS_CARGA_SEMANA = 4; // techo absoluto, nunca meta
export const MAX_DIAS_CARGA_CON_TALLER = 3;
export const MAX_DEMANDA_ALTA_SEMANA = 5; // Sakti 12: el taller cuenta
export const MUESTRA_FINAL_POR_DEFECTO = '2026-11-30'; // se puede correr: se edita en el panel

/** El horario real del taller. 0 = domingo. Editable desde el panel. */
export const HORARIO_TALLER_POR_DEFECTO = [
 { dia: '1', desde: '18:30', hasta: '20:30' },
 { dia: '6', desde: '14:00', hasta: '18:00' },
];
export const HORAS_ENTRE_CARGA = 48;
export const VENTANA_INICIO_MIN = 7 * 60; // 07:00
export const VENTANA_FIN_MIN = 20 * 60 + 30; // 20:30
export const ULTIMA_HORA_INICIO_FUERZA = 18 * 60 + 45;
export const DURACION_SESION_COMPLETA_MIN = 105; // lo que tarda una completa con calentamiento y cierre
export const AVISO_CIERRE_MIN = 19 * 60 + 45;
export const CALENTAMIENTO_MIN_BASE = 6;
export const CALENTAMIENTO_MIN_MANANA = 10;
export const CONFIRMACIONES_PARA_SUBIR = 2; // Ixchel, defecto 1
export const RPE_VETO = 8; // Ixchel, defecto 2
export const CUPO_ASCENSOS_SESION = 2; // Ixchel, defecto 3
export const CORTES_AGARRE_NEUTROS = 2; // Chimi C4: al tercero, baja
export const VENTANA_ADHERENCIA_DIAS = 14; // Sakti 2
export const RPE_POR_DEFECTO = 8; // sin dato, se asume lo conservador
export const TEMPO_POR_REP_SEG = 3;

/** Techo de tiempo bajo carga por nivel (Sakti 7 sustituida). */
export const TBC_SEMANAL_MIN = { 0: 22, 1: 28, 2: 34, 3: 42, 4: 50, 5: 40 };
export const TBC_SESION_MIN = 10;

/** Presupuesto de barra: lo gobierna la piel, no el músculo.
 Indexado a SESIONES de agarre acumuladas, no a semanas (Chimi C1). */
export const TUT_BARRA = [
 { hasta_sesiones: 6, seg_sesion: 180 },
 { hasta_sesiones: 8, seg_sesion: 90 }, // descarga
 { hasta_sesiones: 16, seg_sesion: 240 },
 { hasta_sesiones: 24, seg_sesion: 300 },
 { hasta_sesiones: Infinity, seg_sesion: 360 },
];

export const PATRONES_VALIDOS = [
 'flexion_lumbar_cargada', 'flexion_lumbar_pasiva', 'hiperextension_lumbar',
 'valsalva', 'carga_axial_pesada', 'impacto',
];

/* ---------- flexibilidad ----------
 No progresa por escalones: a un split no se le suma una repetición.
 Se entrena en el 90–95 % de la marca, nunca EN la marca: perseguir el
 récord cada viernes es como se lesiona la gente en flexibilidad. */
export const FLEX_BANDA = [0.90, 0.95];
export const FLEX_MEJORA_MIN = 0.03; // sube la marca solo con +3 % en el test
export const FLEX_CAIDA_MAX = 0.05; // −5 % → baja la banda y congela
export const FLEX_CONGELA_SEMANAS = 2;
export const PNF_MAX_ESTRUCTURAS = 2; // por sesión
export const PNF_CONTRACCION_MAX = 0.40; // del máximo, y exhalando
export const FLEX_CARGADO_MAX_MIN = { 0: 4, 1: 4, 2: 6, 3: 6, 4: 6, 5: 6 };
export const FLEX_FACTOR_TBC = 0.5; // el cargado cuenta a la mitad

export const PRIORIDAD_RAMA = {
 0: ['GRIP','CORE','HIP','FLEX','PULL','PUSH','MOB','POLE-V','POLE'],
 1: ['GRIP','CORE','HIP','FLEX','PULL','PUSH','MOB','POLE-V','POLE'],
 2: ['GRIP','CORE','PULL','FLEX','HIP','PUSH','MOB','POLE-V','POLE'],
 3: ['GRIP','CORE','PULL','FLEX','HIP','PUSH','MOB','POLE-V','POLE'],
 4: ['PULL','CORE','POLE','FLEX','GRIP','PUSH','HIP','POLE-V','MOB'],
 5: ['PULL','CORE','POLE','FLEX','GRIP','PUSH','HIP','POLE-V','MOB'],
};

/* ---------- las 14 prohibiciones (Ixchel 7.1) ----------
 Cada una trae dos predicados: uno para el CONTENIDO (lo aplica el
 validador al publicar) y otro para el PLAN construido (etapa 8). */
const prohibePatron = (p) => ({
 contenido: ej => !(ej.patron || []).includes(p),
 plan: plan => (plan.ejercicios || []).every(e => !(e.patron || []).includes(p)),
});

export const PROHIBICIONES = [
 { id: 'flexion-lumbar-cargada', n: 1, ...prohibePatron('flexion_lumbar_cargada'),
 copy: 'Flexión lumbar cargada o repetida: prohibida sin excepción.' },
 { id: 'flexion-lumbar-pasiva', n: 2, ...prohibePatron('flexion_lumbar_pasiva'),
 copy: 'Estiramiento en flexión lumbar sin apoyo: prohibido.' },
 { id: 'hiperextension', n: 3, ...prohibePatron('hiperextension_lumbar'),
 copy: 'Hiperextensión lumbar: prohibida. La extensión se busca en la torácica.' },
 { id: 'valsalva', n: 4, ...prohibePatron('valsalva'),
 copy: 'Cualquier cosa que exija aguantar el aire: prohibida.' },
 { id: 'carga-axial-pesada', n: 5,
 contenido: ej => !(ej.patron || []).includes('carga_axial_pesada'),
 plan: (plan, ctx) => (ctx.nivel >= 3) ||
 (plan.ejercicios || []).every(e => !(e.patron || []).includes('carga_axial_pesada')),
 copy: 'Carga axial pesada antes del nivel 3: prohibida.' },
 { id: 'impacto', n: 6,
 contenido: ej => !(ej.patron || []).includes('impacto'),
 plan: (plan, ctx) => (ctx.nivel >= 4) ||
 (plan.ejercicios || []).every(e => !(e.patron || []).includes('impacto')),
 copy: 'Impacto, saltos y carrera antes del nivel 4: prohibidos.' },
 { id: 'ventana-horaria', n: 7,
 contenido: () => true,
 plan: (plan, ctx) => !plan.carga ||
 (ctx.minutos >= VENTANA_INICIO_MIN && ctx.minutos <= VENTANA_FIN_MIN),
 copy: 'Fuera de la ventana de 7:00 a 20:30 no hay carga.' },
 { id: 'max-dias-carga', n: 8,
 contenido: () => true,
 plan: (plan, ctx) => !plan.carga || ctx.diasCarga7 < topeCargaSemana(ctx.tallerDias),
 copy: 'Se superó el tope de días de carga de la semana.' },
 { id: 'consecutivos', n: 9,
 contenido: () => true,
 plan: (plan, ctx) => !plan.carga || ctx.horasDesdeCarga === null ||
 ctx.horasDesdeCarga >= HORAS_ENTRE_CARGA,
 copy: 'Dos sesiones de carga con menos de 48 horas entre ellas.' },
 { id: 'sin-acumular', n: 10,
 contenido: () => true,
 plan: plan => !plan.recupera_sesiones,
 copy: 'Las sesiones perdidas no se acumulan ni se recuperan.' },
 { id: 'sin-nutricion', n: 11,
 contenido: ej => !/\b(caloría|calorias|kcal|déficit|deficit|peso corporal objetivo|IMC)\b/i
 .test(JSON.stringify(ej)),
 plan: plan => !plan.nutricion,
 copy: 'Contenido de peso, calorías o déficit: fuera de alcance.' },
 { id: 'piel-rota', n: 12,
 contenido: () => true,
 plan: (plan, ctx) => ctx.manos !== 'ampolla' ||
 (plan.ejercicios || []).every(e => !e.cuenta_tut_barra),
 copy: 'Con ampolla activa no hay barra.' },
 { id: 'calentamiento-minimo', n: 13,
 contenido: () => true,
 plan: (plan, ctx) => !plan.carga ||
 (plan.calentamiento_min || 0) >= calentamientoMinimoMin(ctx.minutos),
 copy: 'Una sesión de carga necesita su calentamiento completo.' },
 { id: 'flex-con-lumbar', n: 15,
 contenido: () => true,
 plan: (plan, ctx) => !plan.flex_cargado ||
 !ctx.checkin || (ctx.checkin.dolor_lumbar || 0) < 1,
 copy: 'Con molestia en la espalda baja no hay flexibilidad cargada.' },
 { id: 'flex-48h', n: 16,
 contenido: () => true,
 plan: (plan, ctx) => !plan.flex_cargado || ctx.horasDesdeCarga === null ||
 ctx.horasDesdeCarga >= HORAS_ENTRE_CARGA,
 copy: 'El trabajo cargado en rango final necesita 48 horas desde la última sesión que cargó esas estructuras.' },
 { id: 'una-variable', n: 14,
 contenido: () => true,
 plan: plan => (plan.decisiones || []).every(d => (d.cambios || 0) <= 1),
 copy: 'Solo puede cambiar una variable por ejercicio y sesión.' },
];

/* ---------- las 12 condiciones de Sakti ---------- */
export const CONDICIONES_SAKTI = [
 { id: 'sin-racha', n: 1, plan: plan => !('racha' in plan),
 copy: 'Ningún número que se resetee a cero.' },
 { id: 'adherencia-movil', n: 2,
 plan: plan => !plan.adherencia || (plan.adherencia.ventana === VENTANA_ADHERENCIA_DIAS &&
 !('meta' in plan.adherencia)),
 copy: 'La adherencia es ventana móvil de 14 días, sin meta.' },
 { id: 'tope-carga', n: 3,
 plan: (plan, ctx) => !plan.carga || ctx.diasCarga7 < topeCargaSemana(ctx.tallerDias),
 copy: 'Máximo 4 días de carga por semana; 3 mientras el taller esté en curso.' },
 { id: 'checkin-vinculante', n: 4,
 plan: (plan, ctx) => ctx.checkin !== null || !plan.carga,
 copy: 'Sin check-in no hay sesión de carga.' },
 { id: 'descarga-automatica', n: 5,
 plan: (plan, ctx) => ctx.semanaMeso !== 4 || plan.descarga === true,
 copy: 'La semana 4 de cada mesociclo es de descarga y no se salta.' },
 { id: 'nivel-no-retrocede', n: 6,
 plan: plan => (plan.decisiones || []).every(d => d.tipo !== 'quitar_nodo'),
 copy: 'Ningún nodo dominado se pierde jamás.' },
 { id: 'tbc-y-hora', n: 7,
 plan: (plan, ctx) => (!plan.carga || (plan.tbc_min || 0) <= TBC_SESION_MIN) &&
 (!plan.carga || ctx.minutos <= ULTIMA_HORA_INICIO_FUERZA ||
 plan.modo !== 'completo'),
 copy: 'Tiempo bajo carga ≤ 10 min por sesión, y ninguna sesión termina después de las 20:00.' },
 { id: 'puerta-medica', n: 8,
 plan: (plan, ctx) => !plan.ejercicios || plan.ejercicios.every(e =>
 !e.requiere_puerta_medica || puertaMedicaAbierta(ctx.puertaMedica)),
 copy: 'Esa rama necesita las dos fechas médicas registradas.' },
 { id: 'sin-nutricion', n: 9, plan: plan => !plan.nutricion,
 copy: 'Cero prescripción nutricional dentro de la app.' },
 { id: 'minimo-30', n: 10,
 plan: plan => (plan.minimo_valido_min || 0) <= 30,
 copy: 'Toda sesión debe tener una versión mínima ejecutable en 30 minutos.' },
 { id: 'mantenimiento', n: 11, plan: () => true,
 copy: 'Al volver a trabajar, el sistema baja solo a mantenimiento.' },
 { id: 'demanda-alta', n: 12,
 plan: (plan, ctx) => !plan.carga ||
 (ctx.diasCarga7 + (ctx.tallerDias || 0)) < MAX_DEMANDA_ALTA_SEMANA + 1,
 copy: 'Máximo 5 días de demanda alta por semana, contando el taller.' },
];

/* ---------- funciones que las reglas usan ---------- */

/* ---------- el taller ----------
 El taller no es una condición permanente: va hasta la muestra final.
 Mientras dure, sus días cuentan como demanda alta y bajan el tope de
 días de carga; pasada la muestra, el tope vuelve solo.

 La fecha vive en prefs y se edita desde el panel, porque la muestra
 se puede correr. Una fecha quemada en el código es exactamente la
 que nadie corrige cuando cambia. */
export function tallerVigente(prefs, hoyISO) {
 const p = prefs || {};
 const fin = p.taller_muestra_final;
 // las fechas ISO se comparan como texto: 2026-12-01 > 2026-11-30
 if (fin && hoyISO && hoyISO > fin) return 0;
 // el conteo se DERIVA del horario: un número aparte se desincroniza solo
 if (Array.isArray(p.taller_horario)) return p.taller_horario.filter(b => b && b.desde).length;
 return p.taller_dias_semana ?? 0;
}

/** "18:30" → 1110. Devuelve null si no es una hora. */
export function aMinutos(hhmm) {
 const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
 if (!m) return null;
 const h = Number(m[1]), min = Number(m[2]);
 if (h > 23 || min > 59) return null;
 return h * 60 + min;
}

/** El bloque de taller de hoy, si lo hay. */
export function tallerDeHoy(prefs, diaSemana, hoyISO) {
 const p = prefs || {};
 if (!tallerVigente(p, hoyISO)) return null;
 const h = Array.isArray(p.taller_horario) ? p.taller_horario : [];
 return h.find(b => b && b.desde && String(b.dia) === String(diaSemana)) || null;
}

/** La ventana de entreno se cierra ANTES si hoy hay taller: no se entrena
 encima de él, y después ya no cabe nada. */
export function ventanaFin(prefs, diaSemana, hoyISO) {
 const t = tallerDeHoy(prefs, diaSemana, hoyISO);
 const inicio = t ? aMinutos(t.desde) : null;
 return inicio == null ? VENTANA_FIN_MIN : Math.min(VENTANA_FIN_MIN, inicio);
}

/** La última hora a la que una sesión completa todavía cabe entera. */
export function ultimaHoraFuerza(fin = VENTANA_FIN_MIN) {
 return Math.min(ULTIMA_HORA_INICIO_FUERZA, fin - DURACION_SESION_COMPLETA_MIN);
}

export function topeCargaSemana(diasTaller = 0) {
 return diasTaller >= 2 ? MAX_DIAS_CARGA_CON_TALLER : MAX_DIAS_CARGA_SEMANA;
}

export function calentamientoMinimoMin(minutosDelDia) {
 // A primera hora la espalda baja lleva toda la noche rehidratándose y está más
 // presurizado: el calentamiento deja de ser preparación y pasa a ser requisito.
 return minutosDelDia < 10 * 60 ? CALENTAMIENTO_MIN_MANANA : CALENTAMIENTO_MIN_BASE;
}

export function puertaMedicaAbierta(p) {
 return !!(p && p.control_1 && p.control_2);
}

export function tutBarraSesion(sesionesAgarre) {
 for (const t of TUT_BARRA) if (sesionesAgarre <= t.hasta_sesiones) return t.seg_sesion;
 return TUT_BARRA[TUT_BARRA.length - 1].seg_sesion;
}

export function tbcSemanalMax(nivel) { return TBC_SEMANAL_MIN[nivel] ?? 22; }

/** La banda de trabajo de un nodo de flexibilidad: 90–95 % de la marca. */
export function bandaFlex(marca) {
 if (!marca) return null;
 return [Math.round(marca * FLEX_BANDA[0] * 10) / 10,
 Math.round(marca * FLEX_BANDA[1] * 10) / 10];
}

export function flexCargadoMaxMin(nivel) { return FLEX_CARGADO_MAX_MIN[nivel] ?? 4; }

/** Ventana horaria: qué se permite a esta hora. */
export function ventana(minutos, fin = VENTANA_FIN_MIN) {
 if (minutos < VENTANA_INICIO_MIN) return 'solo_piso1';
 if (minutos > fin) return 'solo_piso1';
 return 'normal';
}

/** Comprueba un plan ya construido contra TODAS las reglas. Etapa 8 del motor. */
export function comprobar(plan, ctx) {
 const fallos = [];
 for (const r of [...PROHIBICIONES, ...CONDICIONES_SAKTI]) {
 try { if (!r.plan(plan, ctx)) fallos.push({ id: r.id, copy: r.copy }); }
 catch { fallos.push({ id: r.id, copy: r.copy + ' (la regla no pudo evaluarse)' }); }
 }
 return fallos;
}

/** Comprueba un ejercicio del catálogo. La usa el validador al publicar. */
export function comprobarEjercicio(ej) {
 const fallos = [];
 if (!Array.isArray(ej.patron)) {
 fallos.push({ id: 'patron-ausente',
 copy: 'No declara "patron". Un ejercicio sin patrón declarado es un error, no un ejercicio permitido.' });
 return fallos;
 }
 for (const p of ej.patron)
 if (!PATRONES_VALIDOS.includes(p))
 fallos.push({ id: 'patron-desconocido', copy: `Patrón desconocido: "${p}".` });
 for (const r of PROHIBICIONES)
 if (r.contenido && !r.contenido(ej)) fallos.push({ id: r.id, copy: r.copy });
 return fallos;
}
