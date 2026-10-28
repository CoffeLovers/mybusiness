import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserContext } from '@mybusiness/contracts';

export const CurrentUser = createParamDecorator(
  (data: keyof UserContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as UserContext;
    return data && user ? user[data] : user;
  },
);
