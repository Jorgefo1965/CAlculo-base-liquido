async function cargarIndicadores() {
  const elemIndicadores = document.getElementById('indicadores');
  elemIndicadores.innerText = `Valores de referencia: UF $${VALORES_FALLBACK.uf.toLocaleString('es-CL')} | UTM $${VALORES_FALLBACK.utm.toLocaleString('es-CL')}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    // Usamos el proxy seguro de AllOrigins para saltarnos el bloqueo CORS de GitHub Pages
    const urlAPI = encodeURIComponent('https://mindicador.cl/api');
    const res = await fetch(`https://api.allorigins.win/get?url=${urlAPI}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) throw new Error('Error al conectar con la API');
    
    const wrapper = await res.json();
    const data = JSON.parse(wrapper.contents); // AllOrigins devuelve los datos dentro de 'contents'
    
    if (data.uf?.valor && data.utm?.valor) {
      indicadoresGlobales = {
        uf: data.uf.valor,
        utm: data.utm.valor,
        imm: VALORES_FALLBACK.imm
      };
      elemIndicadores.innerText = `Valores al día (API): UF $${indicadoresGlobales.uf.toLocaleString('es-CL')} | UTM $${indicadoresGlobales.utm.toLocaleString('es-CL')}`;
    }
  } catch (e) {
    clearTimeout(timeoutId);
    // Si la red bloquea o tarda demasiado, mantiene los valores de referencia sin romper la app
  }
}
