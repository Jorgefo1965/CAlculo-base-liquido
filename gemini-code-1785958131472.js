/**
 * CALCULADORA DE SUELDOS EN CHILE CON API EN TIEMPO REAL
 * Consume mindicador.cl para obtener UF y UTM actualizadas.
 */

// 1. VALORES DE RESPALDO Y CONFIGURACIÓN BASE
const VALORES_FALLBACK = {
  uf: 38850,
  utm: 67250,
  imm: 553553, // Ingreso Mínimo Mensual (Se actualiza por ley)
  fechaConsulta: null
};

// Caché en memoria para evitar llamadas repetitivas e innecesarias a la API
let cacheIndicadores = null;

// Comisiones AFP (10% obligatorio + comisión administradora)
const AFPS = {
  uno: { nombre: 'AFP Uno', tasa: 0.1046 },
  modelo: { nombre: 'AFP Modelo', tasa: 0.1058 },
  planvital: { nombre: 'AFP PlanVital', tasa: 0.1116 },
  habitat: { nombre: 'AFP Habitat', tasa: 0.1127 },
  capital: { nombre: 'AFP Capital', tasa: 0.1144 },
  cuprum: { nombre: 'AFP Cuprum', tasa: 0.1144 },
  provida: { nombre: 'AFP Provida', tasa: 0.1145 }
};

// Tramos Impuesto Único de Segunda Categoría (En UTM)
const TRAMOS_IMPUESTO_UTM = [
  { desde: 0, hasta: 13.5, factor: 0, rebajaUTM: 0 },
  { desde: 13.5, hasta: 30, factor: 0.04, rebajaUTM: 0.54 },
  { desde: 30, hasta: 50, factor: 0.08, rebajaUTM: 1.74 },
  { desde: 50, hasta: 90, factor: 0.135, rebajaUTM: 4.49 },
  { desde: 90, hasta: 120, factor: 0.23, rebajaUTM: 13.04 },
  { desde: 120, hasta: 150, factor: 0.304, rebajaUTM: 21.92 },
  { desde: 150, hasta: 310, factor: 0.35, rebajaUTM: 28.82 },
  { desde: 310, hasta: Infinity, factor: 0.40, rebajaUTM: 44.32 }
];

/**
 * SERVICIO DE INDICADORES: Obtiene UF y UTM desde la API mindicador.cl
 * @param {boolean} forzarRefresco - Si es true, omite la caché y consulta la API
 * @returns {Promise<{uf: number, utm: number, imm: number}>}
 */
async function obtenerIndicadoresEconomicos(forzarRefresco = false) {
  // Retornar datos en caché si existen y no se fuerza el refresco
  if (cacheIndicadores && !forzarRefresco) {
    return cacheIndicadores;
  }

  try {
    const response = await fetch('https://mindicador.cl/api', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Error en respuesta HTTP: ${response.status}`);
    }

    const data = await response.json();

    cacheIndicadores = {
      uf: data.uf?.valor || VALORES_FALLBACK.uf,
      utm: data.utm?.valor || VALORES_FALLBACK.utm,
      imm: VALORES_FALLBACK.imm, // El IMM se mantiene según legislación
      fechaConsulta: new Date().toISOString(),
      esOrigenAPI: true
    };

    return cacheIndicadores;
  } catch (error) {
    console.warn('Falló la conexión con mindicador.cl. Se usarán valores de respaldo:', error.message);
    
    cacheIndicadores = {
      ...VALORES_FALLBACK,
      esOrigenAPI: false
    };

    return cacheIndicadores;
  }
}

/**
 * Función Auxiliar: Calcula el Impuesto Único usando la UTM vigente
 */
function calcularImpuestoUnico(baseTributable, valorUTM) {
  const baseUTM = baseTributable / valorUTM;
  const tramo = TRAMOS_IMPUESTO_UTM.find(t => baseUTM > t.desde && baseUTM <= t.hasta);

  if (!tramo || tramo.factor === 0) return 0;

  const impuestoBase = baseTributable * tramo.factor;
  const rebajaMonto = tramo.rebajaUTM * valorUTM;
  return Math.max(0, Math.round(impuestoBase - rebajaMonto));
}

/**
 * CÁLCULO DIRECTO: De Bruto a Líquido (Asíncrona)
 */
async function calcularLiquidoDesdeBruto({
  sueldoBase = 0,
  afpKey = 'habitat',
  incluirGratificacion = true,
  bonosImponibles = 0,
  bonosNoImponibles = 0,
  tipoContrato = 'indefinido',
  indicadoresPersonalizados = null // Permite inyectar indicadores manualmente
}) {
  // Obtener UF y UTM (vía API o custom)
  const indicadores = indicadoresPersonalizados || await obtenerIndicadoresEconomicos();
  const afp = AFPS[afpKey] || AFPS.habitat;

  // 1. Gratificación Legal (25% con tope de 4.75 IMM anuales)
  let gratificacion = 0;
  if (incluirGratificacion) {
    const topeGratificacionMensual = Math.round((4.75 * indicadores.imm) / 12);
    gratificacion = Math.min(Math.round(sueldoBase * 0.25), topeGratificacionMensual);
  }

  // 2. Total Imponible Bruto
  const totalImponibleBruto = sueldoBase + gratificacion + bonosImponibles;

  // 3. Topes Imponibles Previsionales (84.3 UF para AFP/Salud, 126.6 UF para Cesantía)
  const topePrevisionalCLP = 84.3 * indicadores.uf;
  const topeCesantiaCLP = 126.6 * indicadores.uf;

  const imponiblePrevisional = Math.min(totalImponibleBruto, topePrevisionalCLP);
  const imponibleCesantia = Math.min(totalImponibleBruto, topeCesantiaCLP);

  // 4. Descuentos Previsionales Obligatorios
  const descuentoAFP = Math.round(imponiblePrevisional * afp.tasa);
  const descuentoSalud = Math.round(imponiblePrevisional * 0.07);
  const tasaCesantia = tipoContrato === 'indefinido' ? 0.006 : 0.0;
  const descuentoCesantia = Math.round(imponibleCesantia * tasaCesantia);

  const totalPrevisional = descuentoAFP + descuentoSalud + descuentoCesantia;

  // 5. Base Tributable e Impuesto Único de Segunda Categoría
  const baseTributable = Math.max(0, totalImponibleBruto - totalPrevisional);
  const impuestoUnico = calcularImpuestoUnico(baseTributable, indicadores.utm);

  // 6. Sueldo Líquido Final
  const sueldoLiquido = totalImponibleBruto - totalPrevisional - impuestoUnico + bonosNoImponibles;

  return {
    sueldoBase,
    gratificacion,
    bonosImponibles,
    totalImponibleBruto,
    descuentos: {
      afp: descuentoAFP,
      salud: descuentoSalud,
      cesantia: descuentoCesantia,
      totalPrevisional,
      impuestoUnico
    },
    bonosNoImponibles,
    sueldoLiquido,
    indicadoresUsados: indicadores
  };
}

/**
 * CÁLCULO INVERSO: De Líquido deseado a Bruto Requerido (Asíncrona)
 * Utiliza Búsqueda Binaria sobre la función de cálculo directo.
 */
async function calcularBrutoDesdeLiquido({
  liquidoDeseado,
  afpKey = 'habitat',
  incluirGratificacion = true,
  bonosImponibles = 0,
  bonosNoImponibles = 0,
  tipoContrato = 'indefinido',
  tolerancia = 1,
  maxIteraciones = 100
}) {
  // Consultar la API una sola vez antes de iniciar el bucle de búsqueda
  const indicadores = await obtenerIndicadoresEconomicos();

  let minBase = 0;
  let maxBase = liquidoDeseado * 3;
  let resultado = null;
  let iteraciones = 0;

  while (minBase <= maxBase && iteraciones < maxIteraciones) {
    iteraciones++;
    const baseMedio = Math.floor((minBase + maxBase) / 2);

    // Pasamos los indicadores pre-cargados para evitar llamadas repetidas a la API en cada iteración
    resultado = await calcularLiquidoDesdeBruto({
      sueldoBase: baseMedio,
      afpKey,
      incluirGratificacion,
      bonosImponibles,
      bonosNoImponibles,
      tipoContrato,
      indicadoresPersonalizados: indicadores
    });

    const diferencia = resultado.sueldoLiquido - liquidoDeseado;

    if (Math.abs(diferencia) <= tolerancia) {
      break;
    }

    if (diferencia < 0) {
      minBase = baseMedio + 1;
    } else {
      maxBase = baseMedio - 1;
    }
  }

  return {
    ...resultado,
    metaLiquidoDeseado: liquidoDeseado,
    iteracionesAlgoritmo: iteraciones
  };
}

// ==========================================
// DEMOSTRACIÓN DE USO ASÍNCRONO
// ==========================================
(async () => {
  console.log("Cargando datos desde la API de mindicador.cl...\n");

  // Ejemplo 1: Cálculo Bruto a Líquido
  const resBruto = await calcularLiquidoDesdeBruto({
    sueldoBase: 1200000,
    afpKey: 'cuprum',
    bonosNoImponibles: 80000
  });

  console.log("--- 1. CÁLCULO BRUTO A LÍQUIDO ---");
  console.log(`Indicadores usados: UF = $${resBruto.indicadoresUsados.uf} | UTM = $${resBruto.indicadoresUsados.utm}`);
  console.log(`Origen de datos: ${resBruto.indicadoresUsados.esOrigenAPI ? 'API en Vivo' : 'Valores de Respaldo'}`);
  console.log(`Sueldo Base: $${resBruto.sueldoBase.toLocaleString('es-CL')}`);
  console.log(`Sueldo Líquido Resultante: $${resBruto.sueldoLiquido.toLocaleString('es-CL')}\n`);

  // Ejemplo 2: Cálculo Líquido a Bruto (Búsqueda Binaria)
  const LIQUIDO_DESEADO = 1500000;
  const resInverso = await calcularBrutoDesdeLiquido({
    liquidoDeseado: LIQUIDO_DESEADO,
    afpKey: 'cuprum',
    bonosNoImponibles: 80000
  });

  console.log("--- 2. CÁLCULO LÍQUIDO A BRUTO ---");
  console.log(`Líquido Deseado: $${LIQUIDO_DESEADO.toLocaleString('es-CL')}`);
  console.log(`Sueldo Base Requerido: $${resInverso.sueldoBase.toLocaleString('es-CL')}`);
  console.log(`Convergencia lograda en ${resInverso.iteracionesAlgoritmo} iteraciones.`);
})();