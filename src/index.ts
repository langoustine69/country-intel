import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { z } from 'zod';

const agent = await createAgent({
  name: 'country-intel',
  version: '1.0.0',
  description: 'Country & region intelligence - ISO codes, currencies, languages, borders, and more. Essential B2A data for international context.',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

// === HELPER: Fetch real data ===
async function fetchJSON(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// === FREE ENDPOINT: Overview ===
addEntrypoint({
  key: 'overview',
  description: 'Free overview - get total country count and sample data. Try before you buy.',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const data = await fetchJSON('https://restcountries.com/v3.1/all?fields=name,cca2');
    const sample = data.slice(0, 5).map((c: any) => ({
      name: c.name.common,
      code: c.cca2,
    }));
    return {
      output: {
        totalCountries: data.length,
        sample,
        fetchedAt: new Date().toISOString(),
        dataSource: 'REST Countries API (live)',
        availableEndpoints: [
          { key: 'lookup', price: '$0.001', description: 'Get full details for a country by code or name' },
          { key: 'search', price: '$0.002', description: 'Search countries by name, currency, or language' },
          { key: 'region', price: '$0.002', description: 'Get all countries in a region/subregion' },
          { key: 'neighbors', price: '$0.003', description: 'Get a country and all its bordering neighbors' },
          { key: 'compare', price: '$0.005', description: 'Compare multiple countries side by side' },
        ],
      },
    };
  },
});

// === PAID ENDPOINT 1 ($0.001): Lookup by code/name ===
addEntrypoint({
  key: 'lookup',
  description: 'Get comprehensive details for a country by ISO code (US, GB, AU) or name',
  input: z.object({ 
    query: z.string().describe('ISO 2/3 letter code or country name'),
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const q = ctx.input.query.trim();
    // Try alpha code first, then name
    let data;
    try {
      if (q.length === 2 || q.length === 3) {
        data = await fetchJSON(`https://restcountries.com/v3.1/alpha/${q}`);
      } else {
        data = await fetchJSON(`https://restcountries.com/v3.1/name/${encodeURIComponent(q)}?fullText=true`);
      }
    } catch {
      // Fallback to partial name search
      data = await fetchJSON(`https://restcountries.com/v3.1/name/${encodeURIComponent(q)}`);
    }
    
    const country = Array.isArray(data) ? data[0] : data;
    
    return {
      output: {
        name: {
          common: country.name.common,
          official: country.name.official,
          native: country.name.nativeName,
        },
        codes: {
          cca2: country.cca2,
          cca3: country.cca3,
          ccn3: country.ccn3,
          cioc: country.cioc,
        },
        capital: country.capital,
        region: country.region,
        subregion: country.subregion,
        languages: country.languages,
        currencies: country.currencies,
        callingCodes: country.idd,
        timezones: country.timezones,
        population: country.population,
        area: country.area,
        borders: country.borders,
        flag: country.flag,
        flagPng: country.flags?.png,
        flagSvg: country.flags?.svg,
        coatOfArms: country.coatOfArms,
        maps: country.maps,
        car: country.car,
        startOfWeek: country.startOfWeek,
        independent: country.independent,
        unMember: country.unMember,
        landlocked: country.landlocked,
        latlng: country.latlng,
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 2 ($0.002): Search countries ===
addEntrypoint({
  key: 'search',
  description: 'Search countries by partial name, currency code, or language code',
  input: z.object({
    query: z.string().describe('Search term'),
    by: z.enum(['name', 'currency', 'language']).optional().default('name'),
    limit: z.number().optional().default(10),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const { query, by, limit } = ctx.input;
    
    let endpoint: string;
    switch (by) {
      case 'currency':
        endpoint = `https://restcountries.com/v3.1/currency/${encodeURIComponent(query)}`;
        break;
      case 'language':
        endpoint = `https://restcountries.com/v3.1/lang/${encodeURIComponent(query)}`;
        break;
      default:
        endpoint = `https://restcountries.com/v3.1/name/${encodeURIComponent(query)}`;
    }
    
    const data = await fetchJSON(endpoint);
    const results = (Array.isArray(data) ? data : [data]).slice(0, limit);
    
    return {
      output: {
        searchBy: by,
        query,
        count: results.length,
        countries: results.map((c: any) => ({
          name: c.name.common,
          official: c.name.official,
          cca2: c.cca2,
          cca3: c.cca3,
          region: c.region,
          subregion: c.subregion,
          capital: c.capital,
          population: c.population,
          currencies: c.currencies,
          languages: c.languages,
          flag: c.flag,
        })),
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 3 ($0.002): Countries by region ===
addEntrypoint({
  key: 'region',
  description: 'Get all countries in a region (Africa, Americas, Asia, Europe, Oceania) or subregion',
  input: z.object({
    region: z.string().describe('Region name (Africa, Americas, Asia, Europe, Oceania) or subregion'),
    subregion: z.boolean().optional().default(false).describe('Set true if querying a subregion'),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const { region, subregion } = ctx.input;
    
    const endpoint = subregion
      ? `https://restcountries.com/v3.1/subregion/${encodeURIComponent(region)}`
      : `https://restcountries.com/v3.1/region/${encodeURIComponent(region)}`;
    
    const data = await fetchJSON(endpoint);
    
    return {
      output: {
        region: region,
        isSubregion: subregion,
        count: data.length,
        countries: data.map((c: any) => ({
          name: c.name.common,
          cca2: c.cca2,
          cca3: c.cca3,
          capital: c.capital,
          population: c.population,
          area: c.area,
          subregion: c.subregion,
          flag: c.flag,
        })),
        totalPopulation: data.reduce((sum: number, c: any) => sum + (c.population || 0), 0),
        totalArea: data.reduce((sum: number, c: any) => sum + (c.area || 0), 0),
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 4 ($0.003): Country with neighbors ===
addEntrypoint({
  key: 'neighbors',
  description: 'Get a country and full details of all its bordering neighbors',
  input: z.object({
    country: z.string().describe('ISO code or country name'),
  }),
  price: { amount: 3000 },
  handler: async (ctx) => {
    const q = ctx.input.country.trim();
    
    // Get the main country
    let mainData;
    try {
      if (q.length === 2 || q.length === 3) {
        mainData = await fetchJSON(`https://restcountries.com/v3.1/alpha/${q}`);
      } else {
        mainData = await fetchJSON(`https://restcountries.com/v3.1/name/${encodeURIComponent(q)}?fullText=true`);
      }
    } catch {
      mainData = await fetchJSON(`https://restcountries.com/v3.1/name/${encodeURIComponent(q)}`);
    }
    
    const country = Array.isArray(mainData) ? mainData[0] : mainData;
    const borders = country.borders || [];
    
    // Fetch all neighbors
    let neighbors: any[] = [];
    if (borders.length > 0) {
      const neighborsData = await fetchJSON(`https://restcountries.com/v3.1/alpha?codes=${borders.join(',')}`);
      neighbors = (Array.isArray(neighborsData) ? neighborsData : [neighborsData]).map((n: any) => ({
        name: n.name.common,
        official: n.name.official,
        cca2: n.cca2,
        cca3: n.cca3,
        capital: n.capital,
        region: n.region,
        subregion: n.subregion,
        population: n.population,
        languages: n.languages,
        currencies: n.currencies,
        flag: n.flag,
      }));
    }
    
    return {
      output: {
        country: {
          name: country.name.common,
          official: country.name.official,
          cca2: country.cca2,
          cca3: country.cca3,
          capital: country.capital,
          region: country.region,
          subregion: country.subregion,
          landlocked: country.landlocked,
          flag: country.flag,
        },
        borderCount: neighbors.length,
        neighbors,
        sharedLanguages: [...new Set(neighbors.flatMap((n: any) => Object.keys(n.languages || {})))],
        sharedCurrencies: [...new Set(neighbors.flatMap((n: any) => Object.keys(n.currencies || {})))],
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 5 ($0.005): Compare countries ===
addEntrypoint({
  key: 'compare',
  description: 'Compare multiple countries side by side - population, area, GDP, languages, etc.',
  input: z.object({
    countries: z.array(z.string()).min(2).max(10).describe('Array of ISO codes or country names'),
  }),
  price: { amount: 5000 },
  handler: async (ctx) => {
    const countries = ctx.input.countries;
    
    // Fetch all countries
    const results = await Promise.all(
      countries.map(async (q) => {
        const trimmed = q.trim();
        let data;
        try {
          if (trimmed.length === 2 || trimmed.length === 3) {
            data = await fetchJSON(`https://restcountries.com/v3.1/alpha/${trimmed}`);
          } else {
            data = await fetchJSON(`https://restcountries.com/v3.1/name/${encodeURIComponent(trimmed)}?fullText=true`);
          }
        } catch {
          data = await fetchJSON(`https://restcountries.com/v3.1/name/${encodeURIComponent(trimmed)}`);
        }
        return Array.isArray(data) ? data[0] : data;
      })
    );
    
    const comparison = results.map((c: any) => ({
      name: c.name.common,
      official: c.name.official,
      cca2: c.cca2,
      cca3: c.cca3,
      capital: c.capital,
      region: c.region,
      subregion: c.subregion,
      population: c.population,
      area: c.area,
      populationDensity: c.area ? Math.round(c.population / c.area) : null,
      languages: c.languages,
      currencies: c.currencies,
      timezones: c.timezones,
      borders: c.borders,
      landlocked: c.landlocked,
      independent: c.independent,
      unMember: c.unMember,
      flag: c.flag,
    }));
    
    // Calculate rankings
    const byPopulation = [...comparison].sort((a, b) => (b.population || 0) - (a.population || 0));
    const byArea = [...comparison].sort((a, b) => (b.area || 0) - (a.area || 0));
    const byDensity = [...comparison].sort((a, b) => (b.populationDensity || 0) - (a.populationDensity || 0));
    
    return {
      output: {
        count: comparison.length,
        countries: comparison,
        rankings: {
          byPopulation: byPopulation.map((c, i) => ({ rank: i + 1, name: c.name, population: c.population })),
          byArea: byArea.map((c, i) => ({ rank: i + 1, name: c.name, area: c.area })),
          byDensity: byDensity.map((c, i) => ({ rank: i + 1, name: c.name, density: c.populationDensity })),
        },
        totals: {
          combinedPopulation: comparison.reduce((sum, c) => sum + (c.population || 0), 0),
          combinedArea: comparison.reduce((sum, c) => sum + (c.area || 0), 0),
        },
        commonalities: {
          sharedRegion: [...new Set(comparison.map(c => c.region))].length === 1 ? comparison[0].region : null,
          sharedSubregion: [...new Set(comparison.map(c => c.subregion))].length === 1 ? comparison[0].subregion : null,
          sharedLanguages: comparison.reduce((shared, c, i) => {
            const langs = Object.keys(c.languages || {});
            return i === 0 ? langs : shared.filter(l => langs.includes(l));
          }, [] as string[]),
          sharedCurrencies: comparison.reduce((shared, c, i) => {
            const currs = Object.keys(c.currencies || {});
            return i === 0 ? currs : shared.filter(curr => currs.includes(curr));
          }, [] as string[]),
        },
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// Serve icon
app.get('/icon.png', async (c) => {
  try {
    const { readFileSync } = await import('fs');
    const icon = readFileSync('./icon.png');
    return new Response(icon, { headers: { 'Content-Type': 'image/png' } });
  } catch {
    return c.text('Icon not found', 404);
  }
});

// ERC-8004 registration
app.get('/.well-known/erc8004.json', (c) => {
  const baseUrl = process.env.AGENT_URL || 'https://country-intel-production.up.railway.app';
  return c.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'country-intel',
    description: 'Country & region intelligence - ISO codes, currencies, languages, borders, timezones, and more. 1 free + 5 paid endpoints via x402 micropayments.',
    image: `${baseUrl}/icon.png`,
    services: [
      { name: 'web', endpoint: baseUrl },
      { name: 'A2A', endpoint: `${baseUrl}/.well-known/agent.json`, version: '0.3.0' },
    ],
    x402Support: true,
    active: true,
    registrations: [],
    supportedTrust: ['reputation'],
  });
});

const port = Number(process.env.PORT ?? 3000);
console.log(`🌍 Country Intel Agent running on port ${port}`);

export default { port, fetch: app.fetch };
