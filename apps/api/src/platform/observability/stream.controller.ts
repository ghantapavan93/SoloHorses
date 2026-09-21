import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Requires } from '../security/permission.guard';
import { PlatformBus } from './platform-bus';

/**
 * Server-sent events: the live feed behind the Reliability Lab and the Architecture page,
 * and the trigger for the web app's "refresh this page when its record changed" hook.
 * Push for the time-sensitive things; polling stays fine for everything else.
 */
@Controller('platform')
export class StreamController {
  constructor(private readonly bus: PlatformBus) {}

  @Get('stream')
  @Requires('read', 'platform')
  stream(@Req() req: Request, @Res() res: Response, @Query('replay') replay?: string): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const replayCount = Math.min(Number(replay ?? '0') || 0, 200);
    if (replayCount > 0) for (const signal of this.bus.history(replayCount)) send(signal);
    send({ kind: 'hello', at: new Date().toISOString() });

    const unsubscribe = this.bus.subscribe((signal) => send(signal));
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }
}
