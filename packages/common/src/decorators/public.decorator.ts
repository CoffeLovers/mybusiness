import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca un controlador o handler como accesible sin Access Token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
