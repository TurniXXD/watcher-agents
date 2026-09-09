import { parseCzechDate } from '../domain/czech-date.js';
import type { HtmlParser } from './html-source.js';
import {
  absoluteUrl,
  cleanText,
  dateValue,
  eventCandidate,
  htmlDocument,
  parseEnglishDateRange,
} from './utils.js';

export const parseGoOutHtml: HtmlParser = (html, pageUrl, _now, categories) => {
  const $ = htmlDocument(html);
  return $('.schedule-box')
    .toArray()
    .flatMap((box) => {
      const root = $(box);
      const link = root.find('a.title[href]').first();
      const candidate = eventCandidate({
        title: cleanText(link.attr('title') ?? link.text()),
        startAt: dateValue(
          root.find('time[datetime]').first().attr('datetime'),
        ),
        eventUrl: absoluteUrl(link.attr('href'), pageUrl),
        venue: {
          name: cleanText(root.find('.info > a.text-truncate').last().text()),
        },
        categories,
        raw: { parser: 'goout-html' },
      });
      return candidate ? [candidate] : [];
    });
};

export const parseVisitBrnoHtml: HtmlParser = (
  html,
  pageUrl,
  now,
  categories,
) => {
  const $ = htmlDocument(html);
  return $('li.c-grid__item')
    .toArray()
    .flatMap((item) => {
      const root = $(item);
      const link = root.find('a.b-image[href]').first();
      const dateElement = root.find('.b-image__desc').first();
      const dateValues = (dateElement.html() ?? dateElement.text())
        .split(/<br\s*\/?>/giu)
        .map((value) => parseEnglishDateRange(value, now))
        .filter((value) => value !== undefined);
      const range =
        dateValues.find((value) => (value.end ?? value.start) >= now) ??
        dateValues[0];
      const candidate = eventCandidate({
        title: cleanText(root.find('.b-image__title').text()),
        startAt: range?.start,
        endAt: range?.end,
        eventUrl: absoluteUrl(link.attr('href'), pageUrl),
        imageUrl: absoluteUrl(root.find('img[src]').attr('src'), pageUrl),
        organizer: { name: 'TIC BRNO', url: new URL('/', pageUrl).toString() },
        language: 'en',
        categories,
        raw: { parser: 'visitbrno-html' },
      });
      return candidate ? [candidate] : [];
    });
};

export const parseMuniHtml: HtmlParser = (html, pageUrl, now, categories) => {
  const $ = htmlDocument(html);
  return $('article.box-event')
    .toArray()
    .flatMap((article) => {
      const root = $(article);
      const link = root.find('a.box-event__inner[href]').first();
      const range = parseEnglishDateRange(
        root.find('.box-event__date').text(),
        now,
      );
      const candidate = eventCandidate({
        title: cleanText(
          root
            .find('.box-event__title')
            .clone()
            .children()
            .remove()
            .end()
            .text(),
        ),
        description: cleanText(
          root.find('.box-event__content > p').last().text(),
        ),
        startAt: range?.start,
        endAt: range?.end,
        eventUrl: absoluteUrl(link.attr('href'), pageUrl),
        organizer: { name: 'Masaryk University' },
        language: 'en',
        categories,
        raw: { parser: 'muni-html' },
      });
      return candidate ? [candidate] : [];
    });
};

export const parseVutHtml: HtmlParser = (html, pageUrl, _now, categories) => {
  const $ = htmlDocument(html);
  return $('li.c-events__item')
    .toArray()
    .flatMap((item) => {
      const root = $(item);
      const link = root.find('a.c-events__term[href]').first();
      const candidate = eventCandidate({
        title: cleanText(
          link.attr('title') ?? root.find('.b-term__title').text(),
        ),
        startAt: dateValue(root.find('time[datetime]').attr('datetime')),
        eventUrl: absoluteUrl(link.attr('href'), pageUrl),
        organizer: { name: 'Brno University of Technology' },
        language: 'en',
        categories,
        raw: { parser: 'vut-html' },
      });
      return candidate ? [candidate] : [];
    });
};

const jicDateTime = (
  date: string,
  time: string,
  now: Date,
): Date | undefined => {
  const normalizedTime = time.replace('.', ':').split(/[–—-]/u)[0]?.trim();
  return parseCzechDate(`${date.trim()} ${normalizedTime}`, now);
};

export const parseJicHtml: HtmlParser = (html, pageUrl, now, categories) => {
  const $ = htmlDocument(html);
  return $('.event-container .article-item')
    .toArray()
    .flatMap((item) => {
      const root = $(item);
      const link = root.find('a.article-item-link[href]').first();
      const info = root.find('.datetimeplace-box > span');
      const candidate = eventCandidate({
        title: cleanText(root.find('.article-item-title').text()),
        description: cleanText(root.find('.article-item-perex').text()),
        startAt: jicDateTime(info.eq(0).text(), info.eq(1).text(), now),
        eventUrl: absoluteUrl(link.attr('href'), pageUrl),
        venue: { name: cleanText(info.eq(2).text()) },
        organizer: { name: 'JIC', url: new URL('/', pageUrl).toString() },
        language: 'cs',
        categories,
        raw: { parser: 'jic-html' },
      });
      return candidate ? [candidate] : [];
    });
};
