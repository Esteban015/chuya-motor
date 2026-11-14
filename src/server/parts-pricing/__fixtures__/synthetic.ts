/**
 * synthetic.ts — SYNTHETIC provider responses for tests (Incremento 7C spike).
 *
 * These are NOT real listings and NOT real prices: titles, ids, prices and URLs are invented to
 * exercise parsing and matching. They follow the documented response SHAPES of each provider
 * (Mercado Libre /sites/MLA/search "results"; SerpApi google_shopping "shopping_results").
 * Never show them to users or use them as market references.
 */
export const SYNTHETIC_NOTICE = 'SYNTHETIC — not real listings or prices'

export const meliSearchResponse = {
  site_id: 'MLA',
  query: 'manguera respiracion gases fiat palio 1.4 8v',
  paging: { total: 4, offset: 0, limit: 10 },
  results: [
    {
      id: 'MLA0000000001',
      title: 'Manguera Respiradero Gases Fiat Palio Siena 1.4 8v 2010-2017',
      price: 15000,
      currency_id: 'ARS',
      condition: 'new',
      permalink: 'https://articulo.mercadolibre.com.ar/MLA-0000000001-synthetic',
      seller: { id: 1, nickname: 'SYNTH_SELLER_A' },
      attributes: [
        { id: 'BRAND', value_name: 'MarcaSintetica' },
        { id: 'PART_NUMBER', value_name: 'SYN-123' },
      ],
    },
    {
      id: 'MLA0000000002',
      title: 'Manguera Radiador Fiat Palio 1.4',
      price: 9000,
      currency_id: 'ARS',
      condition: 'new',
      permalink: 'https://articulo.mercadolibre.com.ar/MLA-0000000002-synthetic',
      seller: { id: 2, nickname: 'SYNTH_SELLER_B' },
      attributes: [],
    },
    {
      id: 'MLA0000000003',
      title: 'Manguera Respiradero Gases Fiat Palio 1.8 16v 2004-2008 Usada',
      price: 5000,
      currency_id: 'ARS',
      condition: 'used',
      permalink: 'https://articulo.mercadolibre.com.ar/MLA-0000000003-synthetic',
      seller: { id: 3, nickname: 'SYNTH_SELLER_C' },
      attributes: [],
    },
    {
      id: 'MLA0000000004',
      title: 'Manguera Respiradero Gases Fiat Palio 1.4',
      price: 20,
      currency_id: 'USD',
      condition: 'new',
      permalink: 'https://evil.example.com/redirect',
      seller: { id: 4, nickname: 'SYNTH_SELLER_D' },
      attributes: [],
    },
  ],
}

export const serpApiShoppingResponse = {
  search_metadata: { status: 'Success' },
  search_parameters: { engine: 'google_shopping', gl: 'ar', hl: 'es-419' },
  shopping_results: [
    {
      position: 1,
      title: 'Pastillas De Freno Delanteras Fiat Palio 2017 Juego',
      price: '$ 25.000,00',
      extracted_price: 25000,
      source: 'Tienda Sintética Uno',
      product_link: 'https://www.google.com.ar/shopping/product/0000000000000000001',
      product_id: '0000000000000000001',
    },
    {
      position: 2,
      title: 'Pastillas Freno Fiat Palio Trasero',
      price: 'US$ 30,00',
      extracted_price: 30,
      source: 'Tienda Sintética Dos',
      product_link: 'https://www.google.com.ar/shopping/product/0000000000000000002',
      product_id: '0000000000000000002',
    },
    {
      position: 3,
      title: 'Pastillas De Freno Delanteras Fiat Palio 2017',
      price: '$ 27.500,50',
      extracted_price: 27500.5,
      source: 'Tienda Sintética Tres',
      product_link: 'javascript:alert(1)',
      product_id: '0000000000000000003',
    },
  ],
}

export const serpApiNoResults = { search_metadata: { status: 'Success' }, shopping_results: [] }
