import { addDays, weekdayOf, type BarnDate } from '../time';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Turns the arrival phrase a text uses ("Tue by 1pm", "fedex tomorrow", "tonight") into a
 * barn date, relative to the day the text was confirmed. Weekday names mean the next such
 * day, today included — "Tuesday" said on a Tuesday is today, not next week. Anything the
 * function cannot place stays null; nobody guesses a date for a shipping embryo.
 */
export function resolveArrival(phrase: string | null, today: BarnDate): BarnDate | null {
  if (!phrase) return null;
  const text = phrase.toLowerCase();
  if (/\b(today|tonight)\b/.test(text)) return today;
  if (/\btomorrow\b/.test(text)) return addDays(today, 1);
  const named = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(text);
  if (named) {
    const target = WEEKDAYS.indexOf(named[1] ?? '');
    const offset = (target - weekdayOf(today) + 7) % 7;
    return addDays(today, offset);
  }
  return null;
}
