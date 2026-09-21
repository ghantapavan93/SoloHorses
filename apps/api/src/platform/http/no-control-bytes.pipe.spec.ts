import { BadRequestException } from '@nestjs/common';
import { NoControlBytesPipe } from './no-control-bytes.pipe';

const NUL = String.fromCharCode(0);

describe('NoControlBytesPipe', () => {
  const pipe = new NoControlBytesPipe();

  it('lets ordinary values through untouched', () => {
    for (const value of ['Payment', 42, null, undefined, { a: ['x', { b: 'y' }] }])
      expect(pipe.transform(value)).toBe(value);
  });

  it('refuses a NUL byte in a string, an array, a nested field or a key', () => {
    for (const value of [NUL, `Payment${NUL}x`, ['ok', NUL], { a: { b: `z${NUL}` } }, { [`k${NUL}`]: 'v' }]) {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    }
  });
});
