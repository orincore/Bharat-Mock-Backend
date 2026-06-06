const { mergeStructuredData } = require('./structuredData');

const schema = { '@context': 'https://schema.org', '@type': 'Course', name: 'SSC CGL' };
const config = { tab_headings: { overview: 'SSC Overview' }, toc_order: { intro: 1 } };

describe('mergeStructuredData', () => {
  test('saving schema-only payload keeps existing tab_headings/toc_order', () => {
    const existing = { ...schema, ...config };
    const result = mergeStructuredData(existing, schema);
    expect(result['@type']).toBe('Course');
    expect(result.tab_headings).toEqual({ overview: 'SSC Overview' });
    expect(result.toc_order).toEqual({ intro: 1 });
  });

  test('saving tab_headings-only payload keeps existing schema', () => {
    const existing = { ...schema, ...config };
    const result = mergeStructuredData(existing, { tab_headings: { overview: 'New Heading' } });
    expect(result['@type']).toBe('Course');
    expect(result.tab_headings).toEqual({ overview: 'New Heading' });
  });

  test('saving toc_order-only payload keeps schema and tab_headings', () => {
    const existing = { ...schema, ...config };
    const result = mergeStructuredData(existing, { toc_order: { intro: 5 } });
    expect(result['@type']).toBe('Course');
    expect(result.tab_headings).toEqual({ overview: 'SSC Overview' });
    expect(result.toc_order).toEqual({ intro: 5 });
  });

  test('schema is replaced as a set (removed fields do not linger)', () => {
    const existing = { '@context': 'x', '@type': 'Course', name: 'Old', extra: 'drop-me', ...config };
    const result = mergeStructuredData(existing, { '@context': 'x', '@type': 'Course', name: 'New' });
    expect(result.name).toBe('New');
    expect(result.extra).toBeUndefined();
    expect(result.tab_headings).toEqual({ overview: 'SSC Overview' }); // config still preserved
  });

  test('non-object incoming keeps existing object untouched', () => {
    const existing = { ...schema, ...config };
    expect(mergeStructuredData(existing, 'garbage')).toEqual(existing);
    expect(mergeStructuredData(existing, null)).toEqual(existing);
    expect(mergeStructuredData(existing, undefined)).toEqual(existing);
  });

  test('fresh save (no existing) stores incoming as-is', () => {
    expect(mergeStructuredData(null, schema)).toEqual(schema);
    expect(mergeStructuredData(undefined, config)).toEqual(config);
  });

  test('string JSON schema is parsed and merged, keeping config', () => {
    const existing = { tab_headings: { overview: 'SSC' } };
    const result = mergeStructuredData(existing, '{"@context":"https://schema.org","@type":"Course","name":"SSC"}');
    expect(result['@type']).toBe('Course');
    expect(result.tab_headings).toEqual({ overview: 'SSC' });
  });

  test('pasted <script> JSON-LD block is extracted and merged', () => {
    const existing = { tab_headings: { overview: 'SSC' } };
    const raw = '<script type="application/ld+json">{"@type":"Course","name":"SSC"}</script>';
    const result = mergeStructuredData(existing, raw);
    expect(result['@type']).toBe('Course');
    expect(result.tab_headings).toEqual({ overview: 'SSC' });
  });

  test('JSON with literal newlines (control chars) is recovered', () => {
    const existing = { tab_headings: { overview: 'SSC' } };
    const raw = '{"@type":"Course",\n"name":"SSC"}';
    const result = mergeStructuredData(existing, raw);
    expect(result['@type']).toBe('Course');
    expect(result.tab_headings).toEqual({ overview: 'SSC' });
  });

  test('unparseable string keeps existing config instead of wiping it', () => {
    const existing = { tab_headings: { overview: 'SSC' } };
    const result = mergeStructuredData(existing, 'not json at all');
    expect(result.tab_headings).toEqual({ overview: 'SSC' });
  });

  test('combined payload (schema + config) overwrites both', () => {
    const existing = { '@type': 'Course', name: 'Old', tab_headings: { overview: 'Old' } };
    const incoming = { '@type': 'WebPage', name: 'New', tab_headings: { overview: 'New' } };
    const result = mergeStructuredData(existing, incoming);
    expect(result['@type']).toBe('WebPage');
    expect(result.tab_headings).toEqual({ overview: 'New' });
  });
});
