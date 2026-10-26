import { describe, expect, it } from 'vitest';
import { extractJobRequirements } from '../requirements.js';

describe('job requirement extraction', () => {
  it('keeps mandatory, preferred, and uncertain evidence separate', () => {
    const requirements = extractJobRequirements(
      'German B1 is mandatory. A degree or equivalent practical experience is accepted. Kubernetes is a nice to have. Five years of professional experience.',
    );

    expect(requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'LANGUAGE',
          importance: 'MANDATORY',
        }),
        expect.objectContaining({
          category: 'EDUCATION',
          importance: 'UNCERTAIN',
        }),
        expect.objectContaining({
          category: 'TECHNOLOGY',
          importance: 'PREFERRED',
        }),
        expect.objectContaining({
          category: 'EXPERIENCE',
          importance: 'UNCERTAIN',
        }),
      ]),
    );
  });

  it('classifies an unqualified CS bachelor listing as mandatory', () => {
    expect(
      extractJobRequirements('Bachelor’s degree in Computer Science.')[0],
    ).toMatchObject({
      category: 'EDUCATION',
      importance: 'MANDATORY',
    });
  });
});
