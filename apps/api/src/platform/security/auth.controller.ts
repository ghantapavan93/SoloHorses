import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { Public } from './jwt-auth.guard';
import { RateLimit } from '../resilience/rate-limit';
import { ZodBodyPipe } from '../http/zod-body.pipe';
import { PrismaService } from '../persistence/prisma.service';
import { EnvService } from '../config/env.module';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

/**
 * Credential verification for the web app's session provider. Only the web server calls
 * this, proving it with the shared secret; the browser never posts a password here.
 * Passwords are compared with bcrypt and never logged.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
  ) {}

  @Post('login')
  @Public()
  @RateLimit({ name: 'login', points: 10, windowMs: 60_000, scope: 'email' })
  async login(
    @Headers('x-service-secret') serviceSecret: string | undefined,
    @Body(new ZodBodyPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
  ) {
    if (serviceSecret !== this.envService.env.AUTH_SECRET) {
      throw new UnauthorizedException('service secret required');
    }
    const user = await this.prisma.client.user.findUnique({ where: { email: body.email.toLowerCase() } });
    // Same response and timing whether the email exists or the password is wrong.
    const ok = user ? await compare(body.password, user.passwordHash) : await compare(body.password, DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('invalid credentials');
    return { id: user.id, email: user.email, name: user.name, role: user.role, customerId: user.customerId };
  }
}

// A valid bcrypt hash of a random string, used to keep failed lookups constant-time.
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8Z0v5o0jS3wdxgQ8y1lYy4QmJ4ScKe';
