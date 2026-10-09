import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Db } from 'mongodb';
import { InjectDb } from '../mongo/mongo.module';
import { InjectRedis } from '../redis/redis.module';
import type { RedisClient } from '../redis/redis.module';
import { SkipTracking } from '../http/track-action.decorator';

type CheckResult = { status: 'up' } | { status: 'down'; error: string };

async function check(fn: () => Promise<unknown>, timeoutMs = 2_000): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { status: 'up' };
  } catch (err) {
    return { status: 'down', error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@ApiTags('health')
@SkipTracking()
@Controller('health')
export class HealthController {
  constructor(
    @InjectDb() private readonly db: Db,
    @InjectRedis() private readonly redis: RedisClient,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (process is up)' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Readiness probe (MongoDB + Redis reachable)' })
  @ApiOkResponse({ description: 'All dependencies are up' })
  @ApiServiceUnavailableResponse({ description: 'At least one dependency is down' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [mongo, redis] = await Promise.all([
      check(() => this.db.command({ ping: 1 })),
      check(() => this.redis.ping()),
    ]);
    const ok = mongo.status === 'up' && redis.status === 'up';
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'error', checks: { mongo, redis }, uptimeSec: Math.round(process.uptime()) };
  }
}
