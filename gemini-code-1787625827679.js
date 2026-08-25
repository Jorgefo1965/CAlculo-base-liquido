// VALORES DE RESPALDO (SE USAN SI FALLA LA CONEXIÓN A LA API)
let INDICADORES = {
  uf: 40844.79,
  utm: 71649,
  imm: 553553
};

const AFPS = {
  uno: { nombre: 'AFP Uno', tasa: 0.1046 },
  modelo: { nombre: 'AFP Modelo', tasa: 0.1058 },
  planvital: { nombre: 'AFP PlanVital', tasa: 0.1116 },
  habitat: { nombre: 'AFP Habitat', tasa: 0.1127 },
  capital: { nombre: 'AFP Capital', tasa: 0.1144 },
  cuprum: { nombre: 'AFP Cuprum', tasa: 0.1144 },
  provida: { nombre: 'AFP Provida', tasa: 0.1145 }
};

// TABLA OFICIAL SII (8 TRAMOS VIGENTES)
const TRAMOS_IMPUESTO = [
  { desde: 0, hasta: 13.5, factor: 0, rebaja: 0 },
  { desde: 13.5, hasta: 30, factor: 0.04, rebaja: 0.54 },
  { desde: 30, hasta: 50, factor: 0.08, rebaja: 1.74 },
  { desde: 50, hasta: 70, factor: 0.135, rebaja: 4.49 },
  { desde: 70, hasta: 90, factor: 0.23, rebaja: 11.14 },
  { desde: 90, hasta: 120, factor: 0.304, rebaja: 17.8 },
  { desde: 120, hasta: 310, factor: 0.35, rebaja: 23.32 },
  { desde: 310, hasta: Infinity, factor: 0.40, rebaja: 38.82 }
];

function formatearNumero(valor) {
  const soloNumeros = valor.replace(/\D/g, '');
  if (!soloNumeros) return '';
  return parseInt(soloNumeros, 10).toLocaleString('es-CL');
}

function obtenerValorNumerico(id) {
  const elem = document.getElementById(id);
  if (!elem) return 0;
  const soloNumeros = elem.value.replace(/\D/g, '');
  return parseFloat(soloNumeros) || 0;
}

function aplicarFormatoEnVivo(id) {
  const elem = document.getElementById(id);
  if (!elem) return;
  elem.type = 'text';
  elem.addEventListener('input', (e) => {
    e.target.value = formatearNumero(e.target.value);
  });
}

// CARGA EN TIEMPO REAL DESDE MINDICADOR.CL
async function cargarIndicadores() {
  const elemIndicadores = document.getElementById('indicadores');
  try {
    const res = await fetch('https://mindicador.cl/api');
    if (res.ok) {
      const data = await res.json();
      if (data.uf && data.uf.valor) INDICADORES.uf = data.uf.valor;
      if (data.utm && data.utm.valor) INDICADORES.utm = data.utm.valor;
    }
  } catch (error) {
    console.warn('No se pudo conectar a mindicador.cl, usando valores de respaldo.', error);
  } finally {
    if (elemIndicadores) {
      elemIndicadores.innerText = `Valores oficiales vigentes: UF $${Math.round(INDICADORES.uf).toLocaleString('es-CL')} | UTM $${INDICADORES.utm.toLocaleString('es-CL')}`;
    }
  }
}

function calcularImpuesto(baseTributable, utm) {
  const baseUTM = baseTributable / utm;
  const tramo = TRAMOS_IMPUESTO.find(t => baseUTM > t.desde && baseUTM <= t.hasta);
  if (!tramo || tramo.factor === 0) return 0;
  return Math.max(0, Math.round((baseTributable * tramo.factor) - (tramo.rebaja * utm)));
}

function calcularLiquido(sueldoBase, afpKey, bonosImp, bonosNoImp, incGrat, tipoContrato, condicionCesantia, regimenApv = 'ninguno', montoApv = 0) {
  const afp = AFPS[afpKey] || AFPS.habitat;
  
  let gratificacion = 0;
  if (incGrat) {
    const topeGratMensual = Math.round((4.75 * INDICADORES.imm) / 12);
    gratificacion = Math.min(Math.round(sueldoBase * 0.25), topeGratMensual);
  }

  const totalImponible = sueldoBase + gratificacion + bonosImp;

  const topePrevisionalCLP = 90.0 * INDICADORES.uf;
  const topeCesantiaCLP = 135.2 * INDICADORES.uf;

  const imponiblePrevisional = Math.min(totalImponible, topePrevisionalCLP);
  const imponibleCesantia = Math.min(totalImponible, topeCesantiaCLP);

  const afpMonto = Math.round(imponiblePrevisional * afp.tasa);
  const saludMonto = Math.round(imponiblePrevisional * 0.07);
  
  let tasaCesantia = 0.0;
  if (tipoContrato === 'indefinido' && condicionCesantia === 'normal') {
    tasaCesantia = 0.006;
  }
  const cesantiaMonto = Math.round(imponibleCesantia * tasaCesantia);
  
  const totalPrevisional = afpMonto + saludMonto + cesantiaMonto;

  const topeApvB = 50 * INDICADORES.uf;
  const apvRebajable = (regimenApv === 'B') ? Math.min(montoApv, topeApvB) : 0;

  const baseTributable = Math.max(0, totalImponible - totalPrevisional - apvRebajable);
  const impuesto = calcularImpuesto(baseTributable, INDICADORES.utm);

  const apvTotalDescuento = (regimenApv !== 'ninguno') ? montoApv : 0;
  const liquido = totalImponible - totalPrevisional - impuesto - apvTotalDescuento + bonosNoImp;

  return { 
    sueldoBase, gratificacion, bonosImp, totalImponible, 
    afpMonto, saludMonto, cesantiaMonto, apvMonto: apvTotalDescuento, 
    regimenApv, impuesto, bonosNoImp, liquido 
  };
}

function calcularBrutoDesdeLiquido(liquidoDeseado, afpKey, bonosImp, bonosNoImp, incGrat, tipoContrato, condicionCesantia, regimenApv, montoApv) {
  let min = 0, max = liquidoDeseado * 3, res = null;
  while (min <= max) {
    let mid = Math.floor((min + max) / 2);
    res = calcularLiquido(mid, afpKey, bonosImp, bonosNoImp, incGrat, tipoContrato, condicionCesantia, regimenApv, montoApv);
    let diff = res.liquido - liquidoDeseado;
    if (Math.abs(diff) <= 1) break;
    if (diff < 0) min = mid + 1;
    else max = mid - 1;
  }
  return res;
}

function ejecutarCalculo() {
  const modo = document.getElementById('modo').value;
  const monto = obtenerValorNumerico('monto');
  const afp = document.getElementById('afp').value;
  const bonosImp = obtenerValorNumerico('bonosImponibles');
  const bonosNoImp = obtenerValorNumerico('bonosNoImponibles');
  const incGrat = document.getElementById('incluirGratificacion').checked;
  const tipoContrato = document.getElementById('tipoContrato').value;
  const condicionCesantia = document.getElementById('condicionCesantia').value;
  const regimenApv = document.getElementById('regimenApv').value;
  const montoApv = obtenerValorNumerico('montoApv');

  let res = (modo === 'brutoALiquido') 
    ? calcularLiquido(monto, afp, bonosImp, bonosNoImp, incGrat, tipoContrato, condicionCesantia, regimenApv, montoApv)
    : calcularBrutoDesdeLiquido(monto, afp, bonosImp, bonosNoImp, incGrat, tipoContrato, condicionCesantia, regimenApv, montoApv);

  const box = document.getElementById('resultado');
  box.style.display = 'block';
  box.innerHTML = `
    <h3>Resultado del Cálculo</h3>
    <div class="row"><span>Sueldo Base Requerido:</span> <strong>$${res.sueldoBase.toLocaleString('es-CL')}</strong></div>
    <div class="row"><span>Gratificación Legal:</span> <strong>$${res.gratificacion.toLocaleString('es-CL')}</strong></div>
    <div class="row"><span>Bonos Imponibles:</span> <strong>$${res.bonosImp.toLocaleString('es-CL')}</strong></div>
    <div class="row"><span>Total Imponible:</span> <strong>$${res.totalImponible.toLocaleString('es-CL')}</strong></div>
    <hr style="border: 0; border-top: 1px solid #d8f3dc; margin: 8px 0;">
    <div class="row"><span>Descuento AFP:</span> <span>-$${res.afpMonto.toLocaleString('es-CL')}</span></div>
    <div class="row"><span>Descuento Salud (7%):</span> <span>-$${res.saludMonto.toLocaleString('es-CL')}</span></div>
    <div class="row"><span>Seguro Cesantía:</span> <span>-$${res.cesantiaMonto.toLocaleString('es-CL')}</span></div>
    ${res.apvMonto > 0 ? `<div class="row"><span>Ahorro APV (Régimen ${res.regimenApv}):</span> <span>-$${res.apvMonto.toLocaleString('es-CL')}</span></div>` : ''}
    <div class="row"><span>Impuesto Único:</span> <span>-$${res.impuesto.toLocaleString('es-CL')}</span></div>
    <div class="row"><span>Bonos No Imponibles:</span> <span>+$${res.bonosNoImp.toLocaleString('es-CL')}</span></div>
    <div class="row total"><span>Sueldo Líquido Final:</span> <span>$${res.liquido.toLocaleString('es-CL')}</span></div>
  `;
}

// Eventos e inicialización
aplicarFormatoEnVivo('monto');
aplicarFormatoEnVivo('bonosImponibles');
aplicarFormatoEnVivo('bonosNoImponibles');
aplicarFormatoEnVivo('montoApv');

document.getElementById('regimenApv').addEventListener('change', (e) => {
  const group = document.getElementById('groupMontoApv');
  group.style.display = e.target.value === 'ninguno' ? 'none' : 'block';
});

document.getElementById('tipoContrato').addEventListener('change', (e) => {
  const group = document.getElementById('groupCondicionCesantia');
  group.style.display = e.target.value === 'plazoFijo' ? 'none' : 'block';
});

document.getElementById('modo').addEventListener('change', (e) => {
  document.getElementById('lblMonto').innerText = e.target.value === 'brutoALiquido' 
    ? 'Sueldo Base ($ CLP):' 
    : 'Sueldo Líquido Deseado ($ CLP):';
});

cargarIndicadores();

// --- MÓDULO ADICIONAL: RECOMENDADOR DE APV (NO ALTERA CÁLCULOS PRINCIPALES) ---

function abrirModalAPV() {
  const montoInput = obtenerValorNumerico('monto');
  const modal = document.getElementById('modalAPV');
  const contenido = document.getElementById('contenidoModalAPV');
  
  if (montoInput === 0) {
    contenido.innerHTML = `<p>Por favor, ingresa primero un <strong>Sueldo Base</strong> en la calculadora para evaluar la conveniencia tributaria.</p>`;
  } else {
    const utm = INDICADORES.utm;
    const baseUTM = montoInput / utm;
    
    let recomendacion = "";
    
    if (baseUTM <= 13.5) {
      recomendacion = `
        <p><strong>Régimen Recomendado: RÉGIMEN A</strong></p>
        <p>Tu nivel de renta se encuentra en el <strong>tramo exento de impuesto (0%)</strong>.</p>
        <p>En el Régimen B obtendrías $0 de ahorro tributario. En cambio, en el <strong>Régimen A</strong> el Estado te regala un <strong>15% adicional</strong> sobre todo lo que ahorres (con tope de 6 UTM al año).</p>`;
    } else if (baseUTM <= 30) {
      recomendacion = `
        <p><strong>Régimen Recomendado: RÉGIMEN A</strong></p>
        <p>Tu renta está en el tramo del <strong>4% de Impuesto Único</strong>.</p>
        <p>La bonificación estatal del <strong>15% (Régimen A)</strong> es considerablemente mayor al 4% de rebaja impositiva que obtendrías en el Régimen B.</p>`;
    } else if (baseUTM <= 50) {
      recomendacion = `
        <p><strong>Régimen Recomendado: RÉGIMEN A / MIXTO</strong></p>
        <p>Tu renta está en el tramo del <strong>8% de Impuesto Único</strong>.</p>
        <p>El Régimen A (15% del Estado) sigue siendo superior para aportes moderados. Si proyectas ahorrar montos muy altos (más de 40 UTM al año), te convendrá una estrategia mixta (A hasta el tope estatal y B para el resto).</p>`;
    } else {
      recomendacion = `
        <p><strong>Régimen Recomendado: RÉGIMEN B</strong></p>
        <p>Tu renta está en un tramo alto de Impuesto Único (<strong>13.5% o superior</strong>).</p>
        <p>Te conviene el <strong>Régimen B</strong>, ya que el ahorro directo de impuestos al descontar tu APV de la base tributable supera el beneficio del Régimen A y no tiene el tope tan acotado de las 6 UTM anuales.</p>`;
    }
    
    contenido.innerHTML = recomendacion;
  }
  
  modal.style.display = 'flex';
}

function cerrarModalAPV() {
  document.getElementById('modalAPV').style.display = 'none';
}