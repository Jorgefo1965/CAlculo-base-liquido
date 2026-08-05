const VALORES_FALLBACK = { uf: 38850, utm: 67250, imm: 553553 };

const AFPS = {
  uno: { nombre: 'AFP Uno', tasa: 0.1046 },
  modelo: { nombre: 'AFP Modelo', tasa: 0.1058 },
  planvital: { nombre: 'AFP PlanVital', tasa: 0.1116 },
  habitat: { nombre: 'AFP Habitat', tasa: 0.1127 },
  capital: { nombre: 'AFP Capital', tasa: 0.1144 },
  cuprum: { nombre: 'AFP Cuprum', tasa: 0.1144 },
  provida: { nombre: 'AFP Provida', tasa: 0.1145 }
};

const TRAMOS_IMPUESTO = [
  { desde: 0, hasta: 13.5, factor: 0, rebaja: 0 },
  { desde: 13.5, hasta: 30, factor: 0.04, rebaja: 0.54 },
  { desde: 30, hasta: 50, factor: 0.08, rebaja: 1.74 },
  { desde: 50, hasta: 90, factor: 0.135, rebaja: 4.49 },
  { desde: 90, hasta: 120, factor: 0.23, rebaja: 13.04 },
  { desde: 120, hasta: 150, factor: 0.304, rebaja: 21.92 },
  { desde: 150, hasta: 310, factor: 0.35, rebaja: 28.82 },
  { desde: 310, hasta: Infinity, factor: 0.40, rebaja: 44.32 }
];

let indicadoresGlobales = VALORES_FALLBACK;

// Carga asíncrona segura con Fallback inmediato ante bloqueo CORS
async function cargarIndicadores() {
  try {
    const res = await fetch('https://mindicador.cl/api', { mode: 'cors' });
    if (!res.ok) throw new Error('Error API');
    const data = await res.json();
    indicadoresGlobales = {
      uf: data.uf.valor,
      utm: data.utm.valor,
      imm: VALORES_FALLBACK.imm
    };
    document.getElementById('indicadores').innerText = `Indicadores al día: UF $${indicadoresGlobales.uf.toLocaleString('es-CL')} | UTM $${indicadoresGlobales.utm.toLocaleString('es-CL')}`;
  } catch (e) {
    document.getElementById('indicadores').innerText = `Valores de referencia: UF $${VALORES_FALLBACK.uf.toLocaleString('es-CL')} | UTM $${VALORES_FALLBACK.utm.toLocaleString('es-CL')}`;
  }
}

function calcularImpuesto(baseTributable, utm) {
  const baseUTM = baseTributable / utm;
  const tramo = TRAMOS_IMPUESTO.find(t => baseUTM > t.desde && baseUTM <= t.hasta);
  if (!tramo || tramo.factor === 0) return 0;
  return Math.max(0, Math.round((baseTributable * tramo.factor) - (tramo.rebaja * utm)));
}

function calcularLiquido(sueldoBase, afpKey, bonosNoImp) {
  const afp = AFPS[afpKey] || AFPS.habitat;
  const gratificacion = Math.min(Math.round(sueldoBase * 0.25), Math.round((4.75 * indicadoresGlobales.imm) / 12));
  const totalImponible = sueldoBase + gratificacion;

  const imponiblePrevisional = Math.min(totalImponible, 84.3 * indicadoresGlobales.uf);
  const imponibleCesantia = Math.min(totalImponible, 126.6 * indicadoresGlobales.uf);

  const afpMonto = Math.round(imponiblePrevisional * afp.tasa);
  const saludMonto = Math.round(imponiblePrevisional * 0.07);
  const cesantiaMonto = Math.round(imponibleCesantia * 0.006);
  const totalPrevisional = afpMonto + saludMonto + cesantiaMonto;

  const baseTributable = Math.max(0, totalImponible - totalPrevisional);
  const impuesto = calcularImpuesto(baseTributable, indicadoresGlobales.utm);

  const liquido = totalImponible - totalPrevisional - impuesto + bonosNoImp;

  return { sueldoBase, gratificacion, totalImponible, afpMonto, saludMonto, cesantiaMonto, impuesto, liquido };
}

function calcularBrutoDesdeLiquido(liquidoDeseado, afpKey, bonosNoImp) {
  let min = 0, max = liquidoDeseado * 3, res = null;
  while (min <= max) {
    let mid = Math.floor((min + max) / 2);
    res = calcularLiquido(mid, afpKey, bonosNoImp);
    let diff = res.liquido - liquidoDeseado;
    if (Math.abs(diff) <= 1) break;
    if (diff < 0) min = mid + 1;
    else max = mid - 1;
  }
  return res;
}

function ejecutarCalculo() {
  const modo = document.getElementById('modo').value;
  const monto = parseFloat(document.getElementById('monto').value) || 0;
  const afp = document.getElementById('afp').value;
  const bonosNoImp = parseFloat(document.getElementById('bonosNoImponibles').value) || 0;

  let res = (modo === 'brutoALiquido') 
    ? calcularLiquido(monto, afp, bonosNoImp)
    : calcularBrutoDesdeLiquido(monto, afp, bonosNoImp);

  const box = document.getElementById('resultado');
  box.style.display = 'block';
  box.innerHTML = `
    <h3>Resultado del Cálculo</h3>
    <div class="row"><span>Sueldo Base:</span> <strong>$${res.sueldoBase.toLocaleString('es-CL')}</strong></div>
    <div class="row"><span>Gratificación Legal:</span> <strong>$${res.gratificacion.toLocaleString('es-CL')}</strong></div>
    <div class="row"><span>Total Imponible:</span> <strong>$${res.totalImponible.toLocaleString('es-CL')}</strong></div>
    <hr>
    <div class="row"><span>Descuento AFP:</span> <span>-$${res.afpMonto.toLocaleString('es-CL')}</span></div>
    <div class="row"><span>Descuento Salud (7%):</span> <span>-$${res.saludMonto.toLocaleString('es-CL')}</span></div>
    <div class="row"><span>Seguro Cesantía:</span> <span>-$${res.cesantiaMonto.toLocaleString('es-CL')}</span></div>
    <div class="row"><span>Impuesto Único:</span> <span>-$${res.impuesto.toLocaleString('es-CL')}</span></div>
    <hr>
    <div class="row" font-size: 16px;"><span>Sueldo Líquido Final:</span> <strong>$${res.liquido.toLocaleString('es-CL')}</strong></div>
  `;
}

// Cambiar etiqueta del input según el modo elegido
document.getElementById('modo').addEventListener('change', (e) => {
  document.getElementById('lblMonto').innerText = e.target.value === 'brutoALiquido' 
    ? 'Sueldo Base ($ CLP):' 
    : 'Sueldo Líquido Deseado ($ CLP):';
});

// Inicializar al cargar
cargarIndicadores();
