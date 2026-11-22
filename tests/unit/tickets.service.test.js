// Funciones puras del ciclo de tickets (no necesitan MySQL).
const tickets = require('../../src/services/tickets.service');
const catalogo = require('../../src/config/tickets.catalogo');
const { TICKETS } = require('../../src/config/juego');

describe('catálogo de solicitudes', () => {
  test('tiene las 50 solicitudes (17 fáciles, 16 medias, 17 difíciles)', () => {
    expect(catalogo).toHaveLength(50);
    const cuenta = (d) => catalogo.filter((p) => p.dificultad === d).length;
    expect([cuenta('facil'), cuenta('media'), cuenta('dificil')]).toEqual([17, 16, 17]);
  });

  test('los títulos no se repiten y todas piden al menos un producto', () => {
    expect(new Set(catalogo.map((p) => p.titulo)).size).toBe(50);
    expect(catalogo.every((p) => Object.keys(p.requiere).length > 0)).toBe(true);
  });
});

describe('dificultades por reputación', () => {
  test('con poca reputación solo piden solicitudes fáciles', () => {
    expect(tickets.dificultadesDesbloqueadas(50)).toEqual(['facil']);
  });

  test('las medias y difíciles se desbloquean con más prestigio', () => {
    expect(tickets.dificultadesDesbloqueadas(TICKETS.DESBLOQUEO.media)).toEqual(['facil', 'media']);
    expect(tickets.dificultadesDesbloqueadas(100)).toEqual(['facil', 'media', 'dificil']);
  });

  test('elegirPlantilla respeta la dificultad y evita títulos recientes', () => {
    const faciles = catalogo.filter((p) => p.dificultad === 'facil');
    const recientes = faciles.slice(0, faciles.length - 1).map((p) => p.titulo);
    const elegida = tickets.elegirPlantilla(10, recientes, () => 0);
    expect(elegida.dificultad).toBe('facil');
    expect(elegida.titulo).toBe(faciles[faciles.length - 1].titulo);
  });
});

describe('requisitos y capacidad', () => {
  const stats = {
    'Dull PowerBorde R110 (1U)': { aumento_teraflops: 8, aumento_memoria: 16, impacto_anchoDeBanda: 25 },
    'MacroTik RouterBordo HEX-24 (1U)': { aumento_teraflops: 0, aumento_memoria: 0, impacto_anchoDeBanda: 150 }
  };

  test('convierte productos pedidos en TFLOPS / RAM / ancho de banda', () => {
    const r = tickets.requisitosDesdeProductos(
      { 'Dull PowerBorde R110 (1U)': 2, 'MacroTik RouterBordo HEX-24 (1U)': 1, 'Desconocido': 3 },
      stats
    );
    expect(r).toEqual({ teraflops: 16, memoria: 32, ancho_banda: 200 });
  });

  test('alcanza() exige las tres capacidades', () => {
    const cap = { teraflops: 20, memoria: 32, ancho_banda: 100 };
    expect(tickets.alcanza(cap, { teraflops: 20, memoria: 32, ancho_banda: 100 })).toBe(true);
    expect(tickets.alcanza(cap, { teraflops: 21, memoria: 0, ancho_banda: 0 })).toBe(false);
  });

  test('formatearTicket expone solo el cronómetro que aplica a su estado', () => {
    const base = { id_ticket: 7, descripcion: 'X', requiere_json: '{"A":1}', segundos_para_decidir: 30, segundos_para_entregar: -5 };
    const pendiente = tickets.formatearTicket({ ...base, estado: 'pendiente' });
    expect(pendiente.segundos_para_decidir).toBe(30);
    expect(pendiente.segundos_para_entregar).toBeNull();
    expect(pendiente.requiere).toEqual({ A: 1 });

    const enProceso = tickets.formatearTicket({ ...base, estado: 'en_proceso' });
    expect(enProceso.segundos_para_decidir).toBeNull();
    expect(enProceso.segundos_para_entregar).toBe(0); // nunca negativo
  });
});
