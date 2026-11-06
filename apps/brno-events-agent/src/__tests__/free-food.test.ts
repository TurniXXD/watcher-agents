import { describe, expect, it } from 'vitest';
import { classifyFreeFood } from '../domain/free-food.js';

const classify = (description: string, isFree: boolean | null = null) =>
  classifyFreeFood({
    title: 'Meetup',
    description,
    isFree,
    sourceUrl: 'https://organiser.example.org/e/1',
  });

describe('free food classification', () => {
  it.each([
    'Free pizza for all attendees!',
    'Join us for talks and complimentary lunch.',
    'Food will be provided at no charge.',
    'Snacks and drinks are provided free of charge.',
    'Pizza is on us.',
    'Občerstvení zdarma.',
    'Po přednášce bude pizza zdarma.',
    'Čeká vás zdarma občerstvení a networking.',
  ])('detects explicit free food: %s', (text) => {
    const result = classify(text);
    expect(result.freeFood).toBe('yes');
    expect(result.evidence[0]).toMatchObject({
      text,
      sourceUrl: 'https://organiser.example.org/e/1',
    });
    expect(result.foodDetails).toBeTruthy();
  });

  it.each([
    'No food will be provided.',
    'Food and drinks available for purchase at the bar.',
    'Please bring your own lunch.',
    'Občerstvení není zajištěno.',
    'Občerstvení si hradí každý sám.',
    'Občerstvení bude k zakoupení na místě.',
  ])('detects explicit absence of free food: %s', (text) => {
    expect(classify(text).freeFood).toBe('no');
  });

  it('never infers free food from free admission', () => {
    expect(
      classifyFreeFood({
        title: 'Free entry lecture',
        description: 'Vstup zdarma. Free admission for students.',
        isFree: true,
      }),
    ).toEqual({
      freeFood: 'unknown',
      foodDetails: null,
      evidence: [],
    });
  });

  it('treats generic refreshment mentions as unknown', () => {
    expect(classify('Refreshments will be available.').freeFood).toBe(
      'unknown',
    );
    expect(classify('Občerstvení zajištěno.').freeFood).toBe('unknown');
    expect(classify('There will be food and music.').freeFood).toBe('unknown');
  });

  it('interprets food included in admission according to admission price', () => {
    expect(classify('Jídlo v ceně vstupu.', true).freeFood).toBe('yes');
    expect(classify('Jídlo v ceně vstupu.', false).freeFood).toBe('no');
    expect(classify('Jídlo v ceně vstupu.', null).freeFood).toBe('unknown');
    expect(classify('Lunch is included in the ticket.', true).freeFood).toBe(
      'yes',
    );
  });

  it('resolves contradictory statements to unknown while keeping evidence for editors', () => {
    const result = classify(
      'Free pizza for speakers. No food will be provided for attendees.',
    );
    expect(result.freeFood).toBe('unknown');
    expect(result.evidence).toHaveLength(2);
  });

  it('does not treat negated free food as positive', () => {
    expect(classify('There is no free pizza this time.').freeFood).toBe('no');
  });
});
